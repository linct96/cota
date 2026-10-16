import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { hasRunningJob, stopProcessTree } from '../src/main/process-tree'

it('kills a real owned process tree, including a background child', async () => {
  const child = spawn('/bin/zsh', ['-c', 'sleep 120 & echo $!; wait'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(child, 'exit')
  const [data] = await once(child.stdout!, 'data')
  const grandchild = Number(data.toString().trim())
  try {
    expect(await hasRunningJob(child.pid!, '/bin/zsh')).toBe(true)
    await stopProcessTree(child.pid!)
    await exited
    expect(() => process.kill(child.pid!, 0)).toThrow()
    expect(() => process.kill(grandchild, 0)).toThrow()
  } finally {
    try {
      process.kill(-child.pid!, 'SIGKILL')
    } catch {
      /* Already cleaned up. */
    }
  }
})

it('recognizes an idle shell and a program replacing the shell with exec', async () => {
  const child = spawn('/bin/zsh', ['-f'], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = once(child, 'exit')
  try {
    const ready = once(child.stdout!, 'data')
    child.stdin!.write('echo READY\n')
    await ready
    expect(await hasRunningJob(child.pid!, '/bin/zsh')).toBe(false)
    child.stdin!.write('exec /bin/sleep 120\n')
    await expect.poll(() => hasRunningJob(child.pid!, '/bin/zsh')).toBe(true)
  } finally {
    await stopProcessTree(child.pid!)
    await exited
  }
})
