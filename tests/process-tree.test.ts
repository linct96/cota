import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { hasRunningJob, stopProcessTree } from '../src/main/system/process-tree'
import { nativeWindowsProcesses } from '../src/main/system/windows-process-snapshot'
import { powershell } from '../src/main/system/platform'

it('kills a real owned process tree, including a background child', async () => {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const { spawn } = require('node:child_process')
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    console.log(child.pid)
    setInterval(() => {}, 1000)
  `,
    ],
    {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const exited = once(child, 'exit')
  const [data] = await once(child.stdout!, 'data')
  const grandchild = Number(data.toString().trim())
  try {
    if (process.platform === 'win32') {
      const rows = nativeWindowsProcesses()
      expect(rows.find((row) => row.pid === child.pid)).toMatchObject({
        command: 'node.exe',
        started: expect.stringMatching(/^\d{4}-.*Z$/),
      })
      expect(rows.find((row) => row.pid === grandchild)?.parent).toBe(child.pid)
      const { stdout } = await promisify(execFile)(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${child.pid}').CreationDate.ToUniversalTime().ToString('o')`,
        ],
        { windowsHide: true, timeout: 3000 },
      )
      expect(rows.find((row) => row.pid === child.pid)?.started).toBe(stdout.trim())
    }
    expect(await hasRunningJob(child.pid!, process.execPath)).toBe(true)
    await stopProcessTree(child.pid!)
    await exited
    expect(() => process.kill(child.pid!, 0)).toThrow()
    expect(() => process.kill(grandchild, 0)).toThrow()
  } finally {
    try {
      if (process.platform === 'win32') {
        for (const pid of [grandchild, child.pid!]) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {
            /* Already cleaned up. */
          }
        }
      } else process.kill(-child.pid!, 'SIGKILL')
    } catch {
      /* Already cleaned up. */
    }
  }
})

it.skipIf(process.platform === 'win32')(
  'recognizes an idle shell and a program replacing the shell with exec',
  async () => {
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
  },
)
