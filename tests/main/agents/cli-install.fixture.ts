import { mocks, root } from '../../helpers/cli-environment.fixture'
import { vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentCliManagement } from '../../../src/main/agents/cli/management'
import { AgentCliInstallTerminals } from '../../../src/main/agents/cli/install-terminal'
import { ConfigStore } from '../../../src/main/settings/config-store'

export async function cliManagement() {
  for (const provider of ['pi', 'codex', 'claude'])
    await writeFile(join(root, 'bin', provider), '#!/bin/sh\n', { mode: 0o700 })
  mocks.login.mockImplementation((_file: string, args: string[]) => {
    try {
      return Promise.resolve({
        stdout: args[0] === '--version' ? '0.159.0' : `\0${join(root, 'bin')}\0`,
      })
    } catch (cause) {
      return Promise.reject(cause)
    }
  })
  const configFile = join(root, 'config.json')
  const config = new ConfigStore(configFile)
  await config.load()
  const publish = vi.fn()
  const agents = new AgentCliManagement(config, publish)
  await agents.initialize()
  await config.saveAgentClis({ ...agents.read(), pathEnv: join(root, 'bin') })
  const restored = new ConfigStore(configFile)
  await restored.load()
  const restarted = new AgentCliManagement(restored, publish)
  await restarted.initialize()
  const launch = vi.fn((command) => {
    try {
      return Promise.resolve(command.args)
    } catch (cause) {
      return Promise.reject(cause)
    }
  })
  return { configFile, restored, restarted, launch }
}
export function installTerminal() {
  const installChild = new EventEmitter()
  const write = vi.fn()
  const resize = vi.fn()
  const pause = vi.fn()
  const resume = vi.fn()
  mocks.ptySpawn.mockReturnValue({
    pid: 12345,
    write,
    resize,
    pause,
    resume,
    onData: (listener: (data: string) => void) => {
      installChild.on('data', listener)
      return { dispose: () => installChild.off('data', listener) }
    },
    onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
      installChild.on('exit', listener)
      return { dispose: () => installChild.off('exit', listener) }
    },
  })
  const progress = vi.fn()
  const terminals = new AgentCliInstallTerminals(progress)
  return { installChild, write, resize, pause, resume, progress, terminals }
}
