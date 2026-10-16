import type { Preferences } from '../shared/contracts'
import { executable } from './validation'

export async function resolveShell(settings: Preferences): Promise<string> {
  if (settings.shellPath) return executable(settings.shellPath)
  const candidate = process.env.SHELL
  if (candidate) {
    try {
      return await executable(candidate)
    } catch {
      /* Fall back to the macOS default. */
    }
  }
  return executable('/bin/zsh')
}

export function shellEnvironment(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      !key.startsWith('ELECTRON_') &&
      key !== 'NODE_OPTIONS' &&
      key !== 'NODE_CHANNEL_FD'
    )
      env[key] = value
  }
  return { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Cota' }
}
