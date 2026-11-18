import { createHmac, randomBytes } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import type { AccountProduct } from '../../shared/accounts'
import type { StoredAccount } from './schema'
import {
  CLAUDE_SCOPE,
  GROK_API_KEY,
  GROK_AUTH_KEY,
  assertPiTargetSupported,
  normalizeCredential,
  piProviders,
  readPiCredentials,
  relayCredential,
  unwrapCredential,
  unwrapGrokAuth,
  unwrapPiAuth,
} from './credential-data'
import type { CredentialDetails } from './credential-data'
import {
  applyAccountFiles,
  json,
  object,
  parseObject,
  readOptional,
  text,
  withPiAuthLock,
} from './files'
import type { AccountFileChange } from './files'
import { PI_DEFAULT_URLS, piProviderConfig, savedPiConfig, stablePiConfig } from './pi-config'

export class AccountCredentials {
  private readonly revisionKey = randomBytes(32)

  constructor(
    private readonly home: string,
    private readonly codexHome: () => string,
  ) {}

  authPath(product: AccountProduct): string {
    switch (product) {
      case 'codex':
        return join(this.codexHome(), 'auth.json')
      case 'claude':
        return join(this.home, '.claude', 'settings.json')
      case 'pi':
        return join(this.piHome(), 'auth.json')
      case 'grok':
        return join(process.env.GROK_HOME || join(this.home, '.grok'), 'auth.json')
    }
  }

  private revisionOf(changes: Pick<AccountFileChange, 'path' | 'before'>[]): string {
    return createHmac('sha256', this.revisionKey)
      .update(JSON.stringify(changes.map(({ path, before }) => [path, before])))
      .digest('base64url')
  }

  async revision(product: AccountProduct): Promise<string> {
    const path = this.authPath(product)
    const paths =
      product === 'codex'
        ? [join(this.codexHome(), 'config.toml'), path]
        : product === 'grok'
          ? [join(path, '..', 'config.toml'), path]
          : product === 'pi'
            ? [join(path, '..', 'models.json'), path]
            : [path]
    const changes = await Promise.all(
      paths.map(async (file) => ({ path: file, before: await readOptional(file) })),
    )
    return this.revisionOf(changes)
  }

  private piHome(): string {
    const configured = process.env.PI_CODING_AGENT_DIR
    return configured?.startsWith('~')
      ? join(this.home, configured.slice(1))
      : configured || join(this.home, '.pi', 'agent')
  }

  async current(product: AccountProduct): Promise<CredentialDetails[]> {
    const path = this.authPath(product)
    const content = await readOptional(path)
    const root = content === null ? {} : parseObject(content, path)
    if (product === 'codex') {
      const config = await this.toml(join(this.codexHome(), 'config.toml'))
      const provider = object(
        object(config.value.model_providers)[text(config.value.model_provider)],
      )
      const apiKey = text(provider.experimental_bearer_token) || text(root.OPENAI_API_KEY)
      if (config.value.model_provider && !apiKey)
        throw new Error('当前 Codex 使用外部模型服务，请先导入其 API 账号或确认覆盖。')
      if (apiKey) {
        const baseUrl = text(provider.base_url) || 'https://api.openai.com/v1'
        return [relayCredential('codex', apiKey, baseUrl)]
      }
      return Object.keys(root).length ? [normalizeCredential(product, root)] : []
    }
    if (product === 'claude') {
      const env = object(root.env)
      const oauth = text(env.CLAUDE_CODE_OAUTH_TOKEN)
      const key = text(env.ANTHROPIC_AUTH_TOKEN) || text(env.ANTHROPIC_API_KEY)
      if (oauth && key) throw new Error('Claude 同时存在 OAuth 与 API 凭据，请确认后再切换。')
      if (oauth)
        return [
          normalizeCredential('claude', {
            kind: 'claude',
            auth: {
              env: {
                CLAUDE_CODE_OAUTH_TOKEN: oauth,
                CLAUDE_CODE_OAUTH_SCOPES: text(env.CLAUDE_CODE_OAUTH_SCOPES) || CLAUDE_SCOPE,
              },
              source: 'settings_import',
            },
          }),
        ]
      if (key) {
        const baseUrl = text(env.ANTHROPIC_BASE_URL) || 'https://api.anthropic.com'
        return [
          normalizeCredential('claude', {
            kind: 'claude',
            auth: {
              env: {
                ...(text(env.ANTHROPIC_AUTH_TOKEN)
                  ? { ANTHROPIC_AUTH_TOKEN: key }
                  : { ANTHROPIC_API_KEY: key }),
                ANTHROPIC_BASE_URL: baseUrl,
              },
            },
          }),
        ]
      }
      return []
    }
    if (product === 'pi') {
      const modelsPath = join(path, '..', 'models.json')
      const models = await readOptional(modelsPath)
      return readPiCredentials(root, models === null ? {} : parseObject(models, modelsPath), true)
    }
    const config = await this.toml(join(this.authPath('grok'), '..', 'config.toml'))
    const preferredMethod =
      text(object(config.value.auth).preferred_method) ||
      text(object(config.value.grok_com_config).preferred_method)
    const modelsBaseUrl = text(object(config.value.endpoints).models_base_url)
    const apiEntry = object(root[GROK_API_KEY])
    const apiKey = text(apiEntry.key) || text(root.XAI_API_KEY)
    if (preferredMethod === 'api_key' || modelsBaseUrl || apiKey) {
      if (apiKey) return [relayCredential('grok', apiKey, modelsBaseUrl || 'https://api.x.ai/v1')]
      throw new Error('当前 Grok 使用自定义 API 配置，切换 OAuth 会替换认证方式。')
    }
    return root[GROK_AUTH_KEY] ? [normalizeCredential('grok', root[GROK_AUTH_KEY])] : []
  }

  withPiLock<T>(action: (assertLocked: () => void) => Promise<T>): Promise<T> {
    return withPiAuthLock(this.authPath('pi'), action)
  }

  private async assertPiAuthFile(path: string): Promise<void> {
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return undefined
    })
    if (stat?.isSymbolicLink()) throw new Error('Pi 认证文件是符号链接，无法安全修改认证信息。')
  }

  async assertPiReplaceable(providerKey: string): Promise<void> {
    const path = this.authPath('pi')
    await this.assertPiAuthFile(path)
    const modelsPath = join(path, '..', 'models.json')
    const [auth, models] = await Promise.all([readOptional(path), readOptional(modelsPath)])
    assertPiTargetSupported(
      auth === null ? {} : parseObject(auth, path),
      piProviders(models === null ? {} : parseObject(models, modelsPath)),
      providerKey,
    )
  }

  async deactivatePi(
    providerKey: string,
    expectedRevision: string,
    assertLocked: () => void,
  ): Promise<void> {
    await this.assertPiReplaceable(providerKey)
    const path = this.authPath('pi')
    const before = await readOptional(path)
    const modelsPath = join(path, '..', 'models.json')
    const modelsBefore = await readOptional(modelsPath)
    const changes = [
      { path: modelsPath, before: modelsBefore, after: modelsBefore },
      { path, before, after: before },
    ]
    if (this.revisionOf(changes) !== expectedRevision)
      throw new Error('当前 Pi 登录已变化，请刷新后重试。')
    const root = before === null ? {} : parseObject(before, path)
    const modelsRoot = modelsBefore === null ? {} : parseObject(modelsBefore, modelsPath)
    const providers = piProviders(modelsRoot)
    assertPiTargetSupported(root, providers, providerKey)
    const provider = object(providers[providerKey])
    if (Object.hasOwn(provider, 'apiKey'))
      throw new Error('models.json 仍有备用 Key，请先激活已导入的账号以统一凭据存储，再取消激活。')
    if (!['oauth', 'api_key'].includes(text(object(root[providerKey]).type)))
      throw new Error('当前 Pi 登录已变化，请刷新后重试。')
    delete root[providerKey]
    changes[1].after = json(root)
    await applyAccountFiles(
      changes.filter((change) => change.before !== change.after),
      assertLocked,
      async () => {
        if ((await readOptional(modelsPath)) !== modelsBefore)
          throw new Error('Pi 模型配置已变化，请刷新后重试。')
        await this.assertPiAuthFile(path)
      },
    )
  }

  async apply(
    account: StoredAccount,
    expectedRevision?: string,
    piLock?: () => void,
  ): Promise<{ restore: () => Promise<void>; restartRequired: boolean }> {
    if (account.product === 'pi') {
      if (piLock) {
        const applied = await this.applyUnlocked(account, piLock, expectedRevision)
        return { ...applied, restore: () => applied.restore(piLock) }
      }
      const applied = await this.withPiLock((assertLocked) =>
        this.applyUnlocked(account, assertLocked, expectedRevision),
      )
      return { ...applied, restore: () => this.withPiLock(applied.restore) }
    }
    return this.applyUnlocked(account, undefined, expectedRevision)
  }

  async updateCurrent(
    account: StoredAccount,
    expectedRevision: string | undefined,
    piLock?: () => void,
  ): Promise<void> {
    if (!expectedRevision) throw new Error('无法验证当前 CLI 登录，请刷新后重试。')
    if (account.product === 'pi' && !piLock) {
      await this.withPiLock(async (assertLocked) => {
        await this.applyUnlocked(account, assertLocked, expectedRevision, true)
      })
    } else await this.applyUnlocked(account, piLock, expectedRevision, true)
  }

  private async applyUnlocked(
    account: StoredAccount,
    assertLocked?: () => void,
    expectedRevision?: string,
    authOnly = false,
  ): Promise<{
    restore: (assertRestoreLocked?: () => void) => Promise<void>
    restartRequired: boolean
  }> {
    const { product } = account
    const { auth } = unwrapCredential(account.auth)
    const path = this.authPath(product)
    const before = await readOptional(path)
    const root = before === null ? {} : parseObject(before, path)
    const changes: AccountFileChange[] = []
    if (product === 'codex') {
      const configPath = join(this.codexHome(), 'config.toml')
      const config = await this.toml(configPath)
      config.value.forced_login_method = account.accountType === 'relay' ? 'api' : 'chatgpt'
      if (account.accountType === 'relay') {
        const providers = object(config.value.model_providers)
        providers.cota = {
          name: 'Cota',
          base_url: account.apiBaseUrl!,
          experimental_bearer_token: text(auth.OPENAI_API_KEY),
          wire_api: 'responses',
        }
        config.value.model_provider = 'cota'
        config.value.model_providers = providers
      } else {
        // pi-lens-ignore: ts-delete-property -- Omit the relay override when restoring the default provider.
        delete config.value.model_provider
      }
      changes.push({ path: configPath, before: config.content, after: stringifyToml(config.value) })
      changes.push({ path, before, after: json(auth) })
    } else if (product === 'claude') {
      const env = object(root.env)
      const storedEnv = object(auth.env)
      for (const key of [
        'CLAUDE_CODE_OAUTH_TOKEN',
        'CLAUDE_CODE_OAUTH_SCOPES',
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
      ])
        delete env[key]
      if (account.accountType === 'relay') {
        const authToken = text(storedEnv.ANTHROPIC_AUTH_TOKEN)
        const apiKey = text(storedEnv.ANTHROPIC_API_KEY)
        if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken
        else if (apiKey) env.ANTHROPIC_API_KEY = apiKey
        env.ANTHROPIC_BASE_URL = text(storedEnv.ANTHROPIC_BASE_URL) || account.apiBaseUrl!
      } else {
        env.CLAUDE_CODE_OAUTH_TOKEN = text(storedEnv.CLAUDE_CODE_OAUTH_TOKEN)
        env.CLAUDE_CODE_OAUTH_SCOPES = text(storedEnv.CLAUDE_CODE_OAUTH_SCOPES) || CLAUDE_SCOPE
      }
      changes.push({ path, before, after: json({ ...root, env }) })
    } else if (product === 'pi') {
      await this.assertPiAuthFile(path)
      const normalized = unwrapCredential(
        normalizeCredential('pi', account.auth, account.providerKey).auth,
      )
      const { entry } = unwrapPiAuth(normalized.auth, account.providerKey)
      const modelsPath = join(path, '..', 'models.json')
      const stat = await lstat(modelsPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
        return undefined
      })
      if (stat?.isSymbolicLink()) throw new Error('Pi 模型配置是符号链接，无法安全修改。')
      const modelsBefore = await readOptional(modelsPath)
      const modelsRoot = modelsBefore === null ? {} : parseObject(modelsBefore, modelsPath)
      const providers = piProviders(modelsRoot)
      assertPiTargetSupported(root, providers, account.providerKey)
      const existing = providers[account.providerKey]
      let modelsAfter = modelsBefore
      if (
        !authOnly &&
        (account.accountType === 'relay' || PI_DEFAULT_URLS.has(account.providerKey))
      ) {
        if (existing !== undefined) piProviderConfig(existing, account.providerKey)
        const fallbackKey = object(existing).apiKey
        if (
          fallbackKey !== undefined &&
          root[account.providerKey] !== undefined &&
          (object(root[account.providerKey]).type !== 'api_key' ||
            object(root[account.providerKey]).key !== fallbackKey)
        )
          throw new Error(
            'models.json 的备用 Key 与当前凭据不一致，请先在 Pi 中确认，Cota 不会删除该凭据。',
          )
        const targetConfig = savedPiConfig(normalized.auth, account.providerKey)
        if (stablePiConfig(existing ?? {}) !== stablePiConfig(targetConfig)) {
          if (
            existing !== undefined &&
            root[account.providerKey] === undefined &&
            object(existing).apiKey === undefined
          )
            throw new Error('现有 Pi Provider 配置尚未绑定可导入的凭据，请先在 Pi 中确认后再切换。')
          if (Object.keys(targetConfig).length) providers[account.providerKey] = targetConfig
          else delete providers[account.providerKey]
          modelsAfter = json({ ...modelsRoot, providers })
        }
      }
      changes.push({ path: modelsPath, before: modelsBefore, after: modelsAfter })
      changes.push({
        path,
        before,
        after: json({ ...root, [account.providerKey]: entry }),
      })
    } else {
      const configPath = join(path, '..', 'config.toml')
      const config = await this.toml(configPath)
      const authentication = object(config.value.auth)
      const endpoints = object(config.value.endpoints)
      const { [GROK_AUTH_KEY]: _oauth, [GROK_API_KEY]: _api, ...restAuthRoot } = root
      const { entry } = unwrapGrokAuth(auth)
      if (account.accountType === 'relay') {
        authentication.preferred_method = 'api_key'
        endpoints.models_base_url = account.apiBaseUrl!
        changes.push({
          path: configPath,
          before: config.content,
          after: stringifyToml({ ...config.value, auth: authentication, endpoints }),
        })
        changes.push({
          path,
          before,
          after: json({
            ...restAuthRoot,
            [GROK_API_KEY]: {
              key: text(entry.key) || text(entry.XAI_API_KEY),
              auth_mode: 'api_key',
            },
          }),
        })
      } else {
        // pi-lens-ignore: ts-delete-property -- Remove the obsolete override from the serialized TOML config.
        delete authentication.preferred_method
        config.value.auth = authentication
        // pi-lens-ignore: ts-delete-property -- Remove the relay endpoint from the serialized TOML config.
        delete endpoints.models_base_url
        config.value.endpoints = endpoints
        changes.push({
          path: configPath,
          before: config.content,
          after: stringifyToml(config.value),
        })
        changes.push({
          path,
          before,
          after: json({ ...restAuthRoot, [GROK_AUTH_KEY]: entry }),
        })
      }
    }
    if (expectedRevision && this.revisionOf(changes) !== expectedRevision)
      throw new Error('当前 CLI 登录已变化，请刷新并重新确认切换。')
    const written = (authOnly ? changes.filter((change) => change.path === path) : changes).filter(
      (change) => change.before !== change.after,
    )
    const verifyBeforeWrite =
      authOnly && expectedRevision
        ? async () => {
            if ((await this.revision(product)) !== expectedRevision)
              throw new Error('当前 CLI 登录已变化，请刷新并重新确认切换。')
          }
        : product === 'pi'
          ? async () => {
              const modelChange = changes.find((change) => change.path !== path)
              if ((await readOptional(path)) !== before)
                throw new Error('Pi 认证文件已变化，请刷新后重试。')
              if (modelChange) {
                const content = await readOptional(modelChange.path)
                if (content !== modelChange.before && content !== modelChange.after)
                  throw new Error('Pi 模型配置已变化，请刷新后重试。')
              }
            }
          : undefined
    await applyAccountFiles(written, assertLocked, verifyBeforeWrite)
    return {
      // shortcut: running Pi can retain old routes with new credentials; coordinate runtime reload before supporting hot Provider changes.
      restartRequired: product === 'pi' && written.some((change) => change.path !== path),
      restore: async (assertRestoreLocked) => {
        const reversed: AccountFileChange[] = []
        for (const change of written) {
          reversed.push({ path: change.path, before: change.after, after: change.before })
        }
        await applyAccountFiles(reversed, assertRestoreLocked)
      },
    }
  }

  private async toml(path: string) {
    const content = await readOptional(path)
    try {
      return {
        content,
        value: (content ? parseToml(content, { integersAsBigInt: true }) : {}) as Record<
          string,
          unknown
        >,
      }
    } catch {
      throw new Error(`${path} 不是有效的 TOML，已停止操作。`)
    }
  }
}
