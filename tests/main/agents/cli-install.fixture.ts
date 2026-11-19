import { mocks, root } from '../../helpers/cli-environment.fixture'
import { vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentCliManagement } from '../../../src/main/agents/cli/management'
import { AgentCliInstallTerminals } from '../../../src/main/agents/cli/install-terminal'
import { AgentCliCacheStore } from '../../../src/main/agents/cli/cache'
import { DEFAULT_CONFIG } from '../../../src/shared/contracts'

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
  const cacheFile = join(root, 'cota', 'cache', 'agent-cli.json')
  const store = new AgentCliCacheStore(cacheFile)
  const publish = vi.fn()
  const agents = new AgentCliManagement(store, publish)
  await agents.initialize(DEFAULT_CONFIG.preferences)
  const cache = agents.read()
  for (const entry of Object.values(cache.entries)) entry.pathEnv = join(root, 'bin')
  await store.save(cache)
  const restored = new AgentCliCacheStore(cacheFile)
  const restarted = new AgentCliManagement(restored, publish)
  await restarted.initialize(DEFAULT_CONFIG.preferences)
  const launch = vi.fn((command) => {
    try {
      return Promise.resolve(command.args)
    } catch (cause) {
      return Promise.reject(cause)
    }
  })
  return { cacheFile, restored, restarted, launch, publish }
}
export function installTerminal(separateChildren = false) {
  const createChild = () => {
    const installChild = new EventEmitter()
    const write = vi.fn()
    const resize = vi.fn()
    const pause = vi.fn()
    const resume = vi.fn()
    const pty = {
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
    }
    return { installChild, write, resize, pause, resume, pty }
  }
  const first = createChild()
  const children: ReturnType<typeof createChild>[] = []
  mocks.ptySpawn.mockImplementation(() => {
    const child = separateChildren && children.length ? createChild() : first
    if (separateChildren) child.pty.pid += children.length
    children.push(child)
    return child.pty
  })
  const progress = vi.fn()
  const terminals = new AgentCliInstallTerminals(progress)
  return { ...first, children, progress, terminals }
}
