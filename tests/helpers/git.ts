import { spawnSync } from 'node:child_process'

const probe = spawnSync('git', ['--version'], { timeout: 5000, stdio: 'ignore' })
export const gitAvailable = probe.status === 0

if (!gitAvailable) {
  const missingGit = probe.error && 'code' in probe.error && probe.error.code === 'ENOENT'
  if (process.env.CI || !missingGit)
    throw new Error('Git integration tests require an executable Git on PATH.', {
      cause: probe.error,
    })
  console.warn(
    'Git is not installed: skipping real Git integration tests; pure/mock tests still run.',
  )
}
