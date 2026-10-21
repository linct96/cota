import { beforeEach, expect, it, vi } from 'vitest'
import { hasRunningJob, stopProcessTree } from '../src/main/process-tree'

const mocks = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.exec }) }
})

beforeEach(() => mocks.exec.mockReset())

it.each([
  ['idle shell', '', false],
  ['zombie with status flags', '200 100 Z+ /bin/sleep', false],
  ['sleeping background child', '200 100 S /bin/sleep', true],
  ['stopped child', '200 100 T /bin/sleep', true],
  ['zombie alongside a stopped task', '200 100 Z /bin/sleep\n201 100 T /bin/sleep', true],
  ['unrelated process', '200 999 S /bin/sleep', false],
])('detects running work: %s', async (_name, children, expected) => {
  mocks.exec.mockResolvedValue({ stdout: `100 1 Ss /bin/zsh\n${children}\n` })
  expect(await hasRunningJob(100, '/bin/zsh')).toBe(expected)
})

it('still detects an exec-replaced shell even if its only child is a zombie', async () => {
  mocks.exec.mockResolvedValue({ stdout: '100 1 S /bin/sleep\n200 100 Z /bin/sleep\n' })
  expect(await hasRunningJob(100, '/bin/zsh')).toBe(true)
})

it('rejects malformed output and failed inspection rather than reporting idle', async () => {
  mocks.exec.mockResolvedValueOnce({ stdout: '100 1 /bin/zsh\n' })
  await expect(hasRunningJob(100, '/bin/zsh')).rejects.toThrow('无法识别终端进程状态。')
  mocks.exec.mockResolvedValueOnce({ stdout: '200 1 S /bin/sleep\n' })
  await expect(hasRunningJob(100, '/bin/zsh')).rejects.toThrow('无法读取终端进程状态。')
  mocks.exec.mockRejectedValueOnce(new Error('ps timed out'))
  await expect(hasRunningJob(100, '/bin/zsh')).rejects.toThrow('ps timed out')
})

it.each([false, true])(
  'signals owned PIDs without killpg and preserves permission errors: %s',
  async (denied) => {
    const snapshot = '100 1 100 Ss\n200 100 200 S\n300 1 100 S\n400 200 400 S\n999 1 999 S\n'
    mocks.exec.mockResolvedValueOnce({ stdout: snapshot }).mockResolvedValue({
      stdout: snapshot.replaceAll(/\bS\w*/g, 'Z'),
    })
    const error = Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
    const kill = vi.spyOn(process, 'kill').mockImplementation((pid) => {
      if (pid < 0 || denied) throw error
      return true
    })
    if (denied) {
      await expect(stopProcessTree(100)).rejects.toBe(error)
      expect(kill).toHaveBeenCalledExactlyOnceWith(400, 'SIGHUP')
    } else {
      await stopProcessTree(100)
      expect(kill.mock.calls).toEqual([400, 300, 200, 100].map((pid) => [pid, 'SIGHUP']))
    }
  },
)

it.each([false, true])(
  'escalates surviving descendants and rejects incomplete cleanup: %s',
  async (stuck) => {
    let forced = false
    mocks.exec.mockImplementation(async () => ({
      stdout: !forced || stuck ? '100 1 100 Z\n200 1 200 S\n' : '100 1 100 Z\n200 1 200 Z\n',
    }))
    mocks.exec.mockResolvedValueOnce({ stdout: '100 1 100 Ss\n200 100 200 S\n' })
    const kill = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 'SIGKILL') forced = true
      return true
    })
    const result = stopProcessTree(100)
    const assertion = stuck
      ? expect(result).rejects.toThrow('终端进程 100 或子进程无法结束，请重试。')
      : expect(result).resolves.toBeUndefined()
    await assertion
    expect(kill.mock.calls).toEqual([
      [200, 'SIGHUP'],
      [100, 'SIGHUP'],
      [200, 'SIGKILL'],
    ])
  },
)
