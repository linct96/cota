import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { expect, it } from 'vitest'
import { stopProcessTree } from '../src/main/process-tree'

it('kills a real owned process tree, including a background child', async () => {
  const child = spawn('/bin/zsh', ['-c', 'sleep 120 & echo $!; wait'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(child, 'exit')
  const [data] = await once(child.stdout!, 'data')
  const grandchild = Number(data.toString().trim())
  try {
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
