import { spawnSync } from 'node:child_process'

const probe = spawnSync('git', ['--version'], { timeout: 5000, stdio: 'ignore' })
export const gitAvailable = probe.status === 0

if (!gitAvailable) {
  if (process.env.CI || (probe.error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT')
    throw new Error('Git integration tests require an executable Git on PATH.', {
      cause: probe.error,
    })
  console.warn(
    'Git is not installed: skipping real Git integration tests; pure/mock tests still run.',
  )
}
