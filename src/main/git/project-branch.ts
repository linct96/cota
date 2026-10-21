import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { projectDirectory } from '../validation'

const execFileAsync = promisify(execFile)

export async function projectBranch(value: unknown): Promise<string | null> {
  const path = await projectDirectory(value)
  try {
    const { stdout } = await execFileAsync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd: path,
      env: {
        ...process.env,
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
        GIT_COMMON_DIR: undefined,
      },
      timeout: 2000,
      windowsHide: true,
      maxBuffer: 4096,
    })
    return stdout.trim() || null
  } catch {
    // Git is optional; non-repositories and detached HEAD have no branch subtitle.
    return null
  }
}
