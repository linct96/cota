import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  AGENT_PROVIDERS,
  type AgentAvailability,
  type AgentProvider,
  type Preferences,
} from '../../shared/contracts'
import { agentProvider } from '../validation'
import { findExecutable, loginShellEnvironment, resolveCommand } from '../system/shell'

export async function resolveAgent(
  provider: AgentProvider,
  settings: Preferences,
): Promise<{
  executable: string
  args: string[]
  env: Record<string, string>
  cliExecutable?: string
}> {
  const definition = AGENT_PROVIDERS[agentProvider(provider)]
  const env = await loginShellEnvironment(settings)
  const executable = await findExecutable(definition.command, env)
  const args: string[] = []
  if (provider === 'codex') {
    const version = await agentVersion(executable, env)
    const minor = /^0\.(\d+)\./.exec(version || '')
    if (minor && Number(minor[1]) >= 156) args.push('--no-daemon')
  }
  return { ...(await resolveCommand(executable, args, env)), cliExecutable: executable }
}

async function agentVersion(executable: string, env: Record<string, string>) {
  try {
    const command = await resolveCommand(executable, ['--version'], env)
    const { stdout } = await promisify(execFile)(command.executable, command.args, {
      cwd: homedir(),
      env: command.env,
      windowsHide: true,
      timeout: 3000,
      maxBuffer: 64 * 1024,
    })
    return /\b\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?\b/.exec(stdout)?.[0]
  } catch {
    // An unknown version never prevents basic CLI startup.
    return undefined
  }
}

export async function agentCapability(
  provider: AgentProvider,
  command: Awaited<ReturnType<typeof resolveAgent>>,
): Promise<'full' | 'partial'> {
  const version = await agentVersion(command.cliExecutable || command.executable, command.env)
  const numbers = /^(\d+)\.(\d+)\.(\d+)/
    .exec(version || '')
    ?.slice(1)
    .map(Number)
  const supported =
    numbers &&
    (provider === 'pi'
      ? numbers[0] === 1 && (numbers[1] > 3 || (numbers[1] === 3 && numbers[2] >= 0))
      : provider === 'claude'
        ? numbers[0] === 2 && (numbers[1] > 1 || (numbers[1] === 1 && numbers[2] >= 196))
        : numbers[0] === 0 && numbers[1] >= 124)
  if (!supported)
    throw new Error(
      'CLI 版本未知或不在适配范围；支持 Pi 1.3+、Claude Code 2.1.196+、Codex 0.124+（同主版本）。',
    )
  const directory = __dirname.replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked')
  const adapter = join(directory, provider === 'pi' ? 'pi-extension.js' : 'agent-hook.js')
  await access(adapter)
  return provider === 'pi' ? 'full' : 'partial'
}

export async function detectAgents(
  settings: Preferences,
  provider?: AgentProvider,
): Promise<AgentAvailability[]> {
  const env = await loginShellEnvironment(settings)
  const providers =
    provider === undefined ? (Object.keys(AGENT_PROVIDERS) as AgentProvider[]) : [provider]
  return Promise.all(
    providers.map(async (provider) => {
      try {
        const executable = await findExecutable(AGENT_PROVIDERS[provider].command, env)
        const version = await agentVersion(executable, env)
        return { provider, executable, version }
      } catch (error) {
        return { provider, error: error instanceof Error ? error.message : String(error) }
      }
    }),
  )
}
