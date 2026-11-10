import { mocks, root } from '../../helpers/cli-environment.fixture'
import { expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hookFiles } from '../../../src/main/agents/hooks/managed'

export function codexRpc(env: Record<string, string>) {
  const trustRecords = new Map([['user-trust', { trusted_hash: 'keep', enabled: false }]])
  const trustRequests: { method: string; params: any }[] = []
  const failure = {
    value: undefined as
      | 'unsupported'
      | 'policy'
      | 'foreign'
      | 'race'
      | 'invalid'
      | 'timeout'
      | undefined,
  }
  const rpcChildren: (EventEmitter & { kill: ReturnType<typeof vi.fn> })[] = []
  mocks.spawn.mockImplementation((_file, args, options) => {
    expect(args).toEqual(['app-server'])
    expect(options.env.CODEX_HOME).toBe(join(root, '.codex'))
    expect(options.stdio).toEqual(['pipe', 'pipe', 'ignore'])
    const stdout = new PassThrough()
    const rpc = Object.assign(new EventEmitter(), {
      stdout,
      exitCode: null as number | null,
      kill: vi.fn(() => {
        rpc.exitCode = 0
        rpc.emit('exit', 0)
        return true
      }),
      stdin: new Writable({
        write(chunk, _encoding, callback) {
          const request = JSON.parse(String(chunk))
          if (request.id === undefined) return callback()
          trustRequests.push(request)
          void (async () => {
            const paths = hookFiles('codex', env)
            const configPath = join(root, '.codex', 'config.toml')
            let result: unknown = {}
            if (request.method === 'hooks/list') {
              if (failure.value === 'timeout') return
              if (failure.value === 'invalid') {
                stdout.write('not JSON\n')
                return
              }
              if (failure.value === 'unsupported') {
                stdout.write(
                  `${JSON.stringify({ id: request.id, error: { message: 'secret' } })}\n`,
                )
                return
              }
              const data = JSON.parse(await readFile(paths.config, 'utf8'))
              const hooks = Object.entries(data.hooks).flatMap(([eventName, groups]) =>
                (
                  groups as { matcher?: string; hooks: { command: string; timeout: number }[] }[]
                ).flatMap((group, groupIndex) =>
                  group.hooks.map((hook, hookIndex) => {
                    const key = `${eventName}:${groupIndex}:${hookIndex}`
                    const currentHash = `native-hash/${key}`
                    return {
                      key,
                      currentHash,
                      eventName: eventName[0].toLowerCase() + eventName.slice(1),
                      command: hook.command,
                      timeoutSec: hook.timeout,
                      matcher: group.matcher ?? null,
                      handlerType: 'command',
                      async: false,
                      statusMessage: null,
                      additionalContextLimit: null,
                      pluginId: null as string | null,
                      isManaged: false,
                      sourcePath:
                        failure.value === 'foreign' ? '/foreign/hooks.json' : paths.config,
                      source: 'user',
                      trustStatus:
                        trustRecords.get(key)?.trusted_hash === currentHash
                          ? 'trusted'
                          : 'untrusted',
                    }
                  }),
                ),
              )
              // Same command from a plugin must never be included in the approval.
              hooks.push({
                ...hooks.find((hook) => hook.command === paths.command)!,
                key: 'plugin-hook',
                pluginId: 'other',
              })
              result = { data: [{ cwd: options.cwd, hooks, warnings: [], errors: [] }] }
            }
            if (request.method === 'config/read') {
              result = {
                layers: [{ name: { type: 'user', file: configPath }, version: 'native-version' }],
              }
              if (failure.value === 'race') await writeFile(configPath, '# concurrent edit\n')
            }
            if (request.method === 'config/batchWrite') {
              if (failure.value === 'policy') {
                stdout.write(
                  `${JSON.stringify({ id: request.id, error: { message: 'policy-secret' } })}\n`,
                )
                return
              }
              expect(request.params.filePath).toBe(configPath)
              expect(request.params.expectedVersion).toBe('native-version')
              expect(request.params.edits).toHaveLength(1)
              const edit = request.params.edits[0]
              expect(edit.keyPath).toBe('hooks.state')
              expect(edit.mergeStrategy).toBe('upsert')
              for (const [key, value] of Object.entries(edit.value)) {
                expect(key).not.toMatch(/user-trust|plugin-hook/)
                expect(Object.keys(value as object)).toEqual(['trusted_hash'])
                trustRecords.set(key, value as { trusted_hash: string; enabled: boolean })
              }
              const raw = await readFile(configPath, 'utf8').catch(() => '')
              await writeFile(configPath, `${raw}# native trust write\n`)
              result = { status: 'ok', filePath: configPath }
            }
            stdout.write(`${JSON.stringify({ id: request.id, result })}\n`)
          })().catch((error) => stdout.destroy(error))
          callback()
        },
      }),
    })
    rpcChildren.push(rpc)
    return rpc
  })
  return { trustRecords, trustRequests, rpcChildren, failure }
}

export async function userHookConfig(provider: 'codex' | 'claude', env: Record<string, string>) {
  const paths = hookFiles(provider, env)
  await mkdir(join(root, provider === 'codex' ? '.codex' : '.claude'), { recursive: true })
  const original = JSON.stringify({
    description: 'user settings',
    hooks: {
      Stop: [
        {
          matcher: '*',
          hooks: [
            { type: 'command', command: 'user-hook' },
            { type: 'command', command: paths.command, timeout: 1 },
          ],
        },
      ],
    },
  })
  await writeFile(paths.config, original)
  const trustConfig = join(root, '.codex', 'config.toml')
  const userToml = '# user settings\nnotify = ["keep-notify"]\n'
  if (provider === 'codex') {
    await writeFile(join(root, 'bin', 'codex'), '#!/bin/sh\n', { mode: 0o700 })
    await writeFile(trustConfig, userToml)
  }
  return { paths, original, trustConfig, userToml }
}
