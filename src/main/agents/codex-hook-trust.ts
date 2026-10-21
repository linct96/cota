import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { resolveCommand } from '../system/shell'

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

// Use Codex's own hashes and TOML writer, like its /hooks UI; never start a thread or run hooks.
export async function trustCodexHooks(
  executable: string,
  env: Record<string, string>,
  config: string,
  command: string,
  events: string[],
  persist: (write: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const cwd = dirname(config)
  const configPath = resolve(cwd, 'config.toml')
  const launch = await resolveCommand(executable, ['app-server'], { ...env, CODEX_HOME: cwd })
  const child = spawn(launch.executable, launch.args, {
    cwd,
    env: launch.env,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  let pending:
    | { id: number; resolve: (value: unknown) => void; reject: (error: Error) => void }
    | undefined
  let failure: Error | undefined
  let buffer = ''
  let received = 0
  let id = 0
  const fail = (message: string) => {
    failure = new Error(message)
    pending?.reject(failure)
    pending = undefined
  }
  const timeout = setTimeout(() => fail('Codex 信任操作超时。'), 15_000)
  child.on('error', () => fail('无法启动 Codex 信任接口。'))
  child.on('exit', () => fail('Codex 信任接口提前退出。'))
  child.stdin.on('error', () => fail('Codex 信任接口连接中断。'))
  child.stdout.on('error', () => fail('Codex 信任接口连接中断。'))
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    received += Buffer.byteLength(chunk)
    if (received > 1024 * 1024) return fail('Codex 信任接口响应过大。')
    buffer += chunk
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!line.trim()) continue
      try {
        const response: unknown = JSON.parse(line)
        if (!object(response)) throw new Error()
        if (response.id !== pending?.id || !pending) continue
        const current = pending
        pending = undefined
        if (response.error) current.reject(new Error('Codex 拒绝了信任请求或不支持此接口。'))
        else if ('result' in response) current.resolve(response.result)
        else current.reject(new Error('Codex 信任接口响应无效。'))
      } catch {
        fail('Codex 信任接口响应无效。')
      }
    }
  })
  const request = (method: string, params: unknown): Promise<unknown> => {
    if (failure) return Promise.reject(failure)
    return new Promise((resolve, reject) => {
      pending = { id: ++id, resolve, reject }
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    })
  }
  try {
    await request('initialize', {
      clientInfo: { name: 'cota', version: '0.1.0' },
      capabilities: {},
    })
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)
    const result = await request('hooks/list', { cwds: [cwd] })
    if (!object(result) || !Array.isArray(result.data)) throw new Error('无法读取 Codex Hooks。')
    const entry = result.data.find((value: unknown) => object(value) && value.cwd === cwd)
    if (
      !object(entry) ||
      !Array.isArray(entry.hooks) ||
      !Array.isArray(entry.errors) ||
      entry.errors.length
    )
      throw new Error('Codex Hooks 配置不可用。')
    // hooks.json uses PascalCase; app-server serializes event names as camelCase.
    const wireEvents = events.map((event) => event[0].toLowerCase() + event.slice(1))
    const hooks = entry.hooks.filter(
      (hook: unknown): hook is Record<string, unknown> =>
        object(hook) &&
        hook.sourcePath === config &&
        hook.source === 'user' &&
        hook.pluginId === null &&
        hook.isManaged === false &&
        hook.handlerType === 'command' &&
        hook.command === command &&
        hook.matcher === null &&
        hook.timeoutSec === 2 &&
        hook.async === false &&
        hook.statusMessage === null &&
        hook.additionalContextLimit === null &&
        wireEvents.includes(String(hook.eventName)),
    )
    if (
      hooks.length !== events.length ||
      new Set(hooks.map((hook) => hook.eventName)).size !== events.length ||
      new Set(hooks.map((hook) => hook.key)).size !== events.length ||
      hooks.some(
        (hook) =>
          typeof hook.key !== 'string' ||
          !hook.key ||
          hook.key.length > 4096 ||
          typeof hook.currentHash !== 'string' ||
          !hook.currentHash ||
          hook.currentHash.length > 2048,
      )
    )
      throw new Error('无法核对本次安装的 Cota Hooks；未授予信任。')
    if (hooks.every((hook) => hook.trustStatus === 'trusted')) return
    const snapshot = await request('config/read', { includeLayers: true })
    if (!object(snapshot) || !Array.isArray(snapshot.layers))
      throw new Error('无法读取 Codex 配置版本。')
    const layer = snapshot.layers.find(
      (value: unknown) =>
        object(value) &&
        object(value.name) &&
        value.name.type === 'user' &&
        value.name.file === configPath,
    )
    if (layer !== undefined && (!object(layer) || typeof layer.version !== 'string'))
      throw new Error('Codex 配置版本无效。')
    await persist(async () => {
      const written = await request('config/batchWrite', {
        filePath: configPath,
        expectedVersion: object(layer) ? layer.version : undefined,
        edits: [
          {
            keyPath: 'hooks.state',
            value: Object.fromEntries(
              hooks.map((hook) => [hook.key, { trusted_hash: hook.currentHash }]),
            ),
            mergeStrategy: 'upsert',
          },
        ],
      })
      if (!object(written) || written.status !== 'ok' || written.filePath !== configPath)
        throw new Error('Codex 未确认信任写入成功，或设置被管理策略覆盖。')
    })
  } finally {
    clearTimeout(timeout)
    child.stdin.destroy()
    child.kill('SIGTERM')
    if (child.exitCode === null) {
      const kill = setTimeout(() => child.kill('SIGKILL'), 1000)
      kill.unref()
      child.once('exit', () => clearTimeout(kill))
    }
  }
}
