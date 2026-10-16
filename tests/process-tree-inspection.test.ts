import { beforeEach, expect, it, vi } from 'vitest'
import { hasRunningJob } from '../src/main/process-tree'

const mocks = vi.hoisted(() => ({ exec: vi.fn() }))
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util')
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.exec }) }
})

beforeEach(() => mocks.exec.mockReset())

it.each([
  ['idle shell', '', false],
  ['zombie child', '200 100 Z /bin/sleep', false],
  ['zombie with status flags', '200 100 Z+ /bin/sleep', false],
  ['running child', '200 100 R /bin/sleep', true],
  ['sleeping background child', '200 100 S /bin/sleep', true],
  ['stopped child', '200 100 T /bin/sleep', true],
  ['zombie alongside a stopped task', '200 100 Z /bin/sleep\n201 100 T /bin/sleep', true],
  ['unrelated process', '200 999 S /bin/sleep', false],
])('detects running work: %s', async (_name, children, expected) => {
  mocks.exec.mockResolvedValue({ stdout: `100 1 Ss /bin/zsh\n${children}\n` })
  expect(await hasRunningJob(100, '/bin/zsh')).toBe(expected)
  expect(mocks.exec).toHaveBeenCalledWith('/bin/ps', ['-axo', 'pid=,ppid=,stat=,comm='], {
    timeout: 2000,
    maxBuffer: 4 * 1024 * 1024,
  })
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
