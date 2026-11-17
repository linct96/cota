import { createHash, createHmac, randomBytes } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import type { AccountProduct } from '../../shared/accounts'
import type { CredentialKind, OAuthEntry, StoredAccount } from './schema'
import {
  applyAccountFiles,
  json,
  jwtClaims,
  object,
  parseObject,
  readOptional,
  text,
  withPiAuthLock,
} from './files'
import type { AccountFileChange } from './files'

export const GROK_AUTH_KEY = 'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828'
export const GROK_API_KEY = 'xai::api_key'
export const PI_OAUTH_PROVIDERS = ['openai', 'openai-codex', 'xai'] as const
export const CLAUDE_SCOPE =
  'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
export const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex')

export type { CredentialKind } from './schema'

export function wrapCredential(kind: CredentialKind, auth: Record<string, unknown>): string {
  return json({ kind, auth })
}

export function unwrapCredential(value: unknown): {
  kind: CredentialKind | undefined
  auth: Record<string, unknown>
} {
  const root = typeof value === 'string' ? parseObject(value) : object(value)
  if (
    typeof root.kind === 'string' &&
    root.auth !== null &&
    typeof root.auth === 'object' &&
    !Array.isArray(root.auth)
  ) {
    return { kind: root.kind as CredentialKind, auth: object(root.auth) }
  }
  return { kind: undefined, auth: root }
}

function withoutKind(auth: Record<string, unknown>): Record<string, unknown> {
  const { kind: _kind, ...rest } = auth
  return rest
}

export function unwrapPiAuth(
  auth: Record<string, unknown>,
  providerKey = '',
): { providerKey: string; entry: Record<string, unknown> } {
  const candidate =
    (providerKey && Object.keys(object(auth[providerKey])).length > 0 ? providerKey : '') ||
    PI_OAUTH_PROVIDERS.find((key) => object(auth[key]).type === 'oauth') ||
    PI_OAUTH_PROVIDERS.find((key) => Object.keys(object(auth[key])).length > 0) ||
    Object.keys(auth).find((key) => Object.keys(object(auth[key])).length > 0) ||
    ''
  if (candidate) return { providerKey: candidate, entry: object(auth[candidate]) }
  const resolved =
    providerKey ||
    text(auth.providerKey) ||
    (text(auth.clientId) ? 'openai' : text(auth.accountId) ? 'openai-codex' : 'xai')
  return { providerKey: resolved, entry: auth }
}

export function deriveCredentialMeta(
  entry: Pick<OAuthEntry, 'kind' | 'auth'>,
): Pick<StoredAccount, 'product' | 'providerKey' | 'accountType' | 'accountId'> {
  const { kind, auth } = entry
  if (kind === 'codex') {
    if (text(auth.OPENAI_API_KEY) || auth.auth_mode === 'apikey')
      return { product: 'codex', providerKey: '', accountType: 'relay', accountId: '' }
    const tokens = object(auth.tokens)
    const idClaims = jwtClaims(tokens.id_token)
    const accessClaims = jwtClaims(tokens.access_token)
    const identityClaims = {
      ...object(accessClaims['https://api.openai.com/auth']),
      ...object(idClaims['https://api.openai.com/auth']),
    }
    return {
      product: 'codex',
      providerKey: '',
      accountType: 'oauth',
      accountId: text(tokens.account_id) || text(identityClaims.chatgpt_account_id),
    }
  }
  if (kind === 'claude') {
    const env = object(auth.env)
    const oauthBlock = object(auth.claudeAiOauth)
    const oauthToken = text(env.CLAUDE_CODE_OAUTH_TOKEN) || text(oauthBlock.accessToken)
    const relayToken = text(env.ANTHROPIC_AUTH_TOKEN) || text(env.ANTHROPIC_API_KEY)
    if (relayToken && !oauthToken)
      return { product: 'claude', providerKey: '', accountType: 'relay', accountId: '' }
    return {
      product: 'claude',
      providerKey: '',
      accountType: 'oauth',
      accountId: text(auth.accountId) || (oauthToken ? fingerprint(oauthToken) : ''),
    }
  }
  if (kind === 'pi') {
    const { providerKey, entry: piEntry } = unwrapPiAuth(auth)
    const access = text(piEntry.access)
    const claims = jwtClaims(access)
    return {
      product: 'pi',
      providerKey,
      accountType: 'oauth',
      accountId:
        providerKey === 'openai'
          ? text(claims.sub)
          : text(piEntry.accountId) || text(claims.sub) || (access ? fingerprint(access) : ''),
    }
  }
  const { entryKey, entry: grokEntry } = unwrapGrokAuth(auth)
  if (entryKey === GROK_API_KEY || grokEntry.auth_mode === 'api_key')
    return { product: 'grok', providerKey: '', accountType: 'relay', accountId: '' }
  const access = text(grokEntry.key)
  const claims = jwtClaims(access)
  return {
    product: 'grok',
    providerKey: '',
    accountType: 'oauth',
    accountId: text(grokEntry.user_id) || text(claims.sub) || (access ? fingerprint(access) : ''),
  }
}

export function unwrapGrokAuth(auth: Record<string, unknown>): {
  entryKey: string
  entry: Record<string, unknown>
} {
  if (Object.keys(object(auth[GROK_API_KEY])).length > 0)
    return { entryKey: GROK_API_KEY, entry: object(auth[GROK_API_KEY]) }
  if (Object.keys(object(auth[GROK_AUTH_KEY])).length > 0)
    return { entryKey: GROK_AUTH_KEY, entry: object(auth[GROK_AUTH_KEY]) }
  const entryKey =
    auth.auth_mode === 'api_key' || text(auth.XAI_API_KEY) ? GROK_API_KEY : GROK_AUTH_KEY
  return { entryKey, entry: auth }
}

export interface CredentialDetails {
  auth: string
  accountType: 'oauth' | 'relay'
  providerKey: string
  apiBaseUrl: string | null
  accountId: string
  name: string
  email: string
  planType: string
  identity: string
}

function jwtName(claims: Record<string, unknown>): string {
  return text(claims.name) || text(object(claims['https://api.openai.com/profile']).name)
}

export function normalizeCredential(
  product: AccountProduct,
  value: unknown,
  providerKey = '',
): CredentialDetails {
  const { kind: inputKind, auth: rawAuth } = unwrapCredential(value)
  const auth = withoutKind(rawAuth)
  let access = ''
  let accountId = ''
  let name = ''
  let email = ''
  let planType = ''
  let apiBaseUrl: string | null = null
  let accountType: 'oauth' | 'relay' = 'oauth'
  let identity = ''
  let kind: CredentialKind
  let payload = auth
  if (product === 'codex') {
    if (inputKind !== undefined && inputKind !== 'codex')
      throw new Error('Codex 认证信息格式无效。')
    kind = 'codex'
    const tokens = object(auth.tokens)
    const apiKey = text(auth.OPENAI_API_KEY)
    if (apiKey || auth.auth_mode === 'apikey') {
      if (!apiKey) throw new Error('Codex API 凭据缺少 OPENAI_API_KEY。')
      accountType = 'relay'
      access = apiKey
      apiBaseUrl = text(auth.apiBaseUrl) || null
      identity = `${apiBaseUrl || ''}:${fingerprint(access)}`
      payload = { ...auth, auth_mode: 'apikey', OPENAI_API_KEY: access }
    } else {
      access = text(tokens.access_token)
      const idClaims = jwtClaims(tokens.id_token)
      const accessClaims = jwtClaims(access)
      const identityClaims = {
        ...object(accessClaims['https://api.openai.com/auth']),
        ...object(idClaims['https://api.openai.com/auth']),
      }
      accountId = text(tokens.account_id) || text(identityClaims.chatgpt_account_id)
      name = jwtName(idClaims) || jwtName(accessClaims)
      email =
        text(idClaims.email) || text(object(accessClaims['https://api.openai.com/profile']).email)
      planType = text(identityClaims.chatgpt_plan_type)
      identity = `${accountId}:${text(identityClaims.chatgpt_user_id) || email}`
      if (!access || !accountId) throw new Error('Codex 认证信息缺少 access_token 或 account_id。')
    }
  } else if (product === 'claude') {
    if (inputKind !== undefined && inputKind !== 'claude')
      throw new Error('Claude 认证信息格式无效。')
    kind = 'claude'
    const env = object(auth.env)
    const oauthBlock = object(auth.claudeAiOauth)
    const oauthToken = text(env.CLAUDE_CODE_OAUTH_TOKEN) || text(oauthBlock.accessToken)
    const relayToken = text(env.ANTHROPIC_AUTH_TOKEN) || text(env.ANTHROPIC_API_KEY)
    if (oauthToken && relayToken)
      throw new Error('Claude 同时存在 OAuth 与 API 凭据，请确认后再导入。')
    if (relayToken) {
      accountType = 'relay'
      access = relayToken
      apiBaseUrl = text(env.ANTHROPIC_BASE_URL) || null
      const nextEnv: Record<string, unknown> = { ...env }
      if (text(env.ANTHROPIC_AUTH_TOKEN)) nextEnv.ANTHROPIC_AUTH_TOKEN = relayToken
      else nextEnv.ANTHROPIC_API_KEY = relayToken
      if (apiBaseUrl) nextEnv.ANTHROPIC_BASE_URL = apiBaseUrl
      payload = { ...auth, env: nextEnv }
      identity = `${apiBaseUrl || ''}:${fingerprint(access)}`
    } else if (oauthToken) {
      access = oauthToken
      const scopes =
        text(env.CLAUDE_CODE_OAUTH_SCOPES) ||
        (Array.isArray(oauthBlock.scopes)
          ? oauthBlock.scopes
              .map((item) => text(item))
              .filter(Boolean)
              .join(' ')
          : '') ||
        CLAUDE_SCOPE
      const refreshToken = text(auth.refreshToken) || text(oauthBlock.refreshToken)
      const expiresAt =
        typeof auth.cliTokenExpiresAt === 'number'
          ? auth.cliTokenExpiresAt
          : typeof oauthBlock.expiresAt === 'number'
            ? oauthBlock.expiresAt
            : undefined
      accountId = text(auth.accountId) || fingerprint(access)
      email = text(auth.email)
      identity = fingerprint(access)
      payload = {
        env: { ...env, CLAUDE_CODE_OAUTH_TOKEN: oauthToken, CLAUDE_CODE_OAUTH_SCOPES: scopes },
        ...(refreshToken ? { refreshToken } : {}),
        ...(expiresAt !== undefined ? { cliTokenExpiresAt: expiresAt } : {}),
        ...(text(auth.accountId) ? { accountId: text(auth.accountId) } : {}),
        ...(email ? { email } : {}),
        ...(text(auth.source) ? { source: text(auth.source) } : {}),
      }
    } else {
      throw new Error('Claude 认证信息格式无效。')
    }
  } else if (product === 'pi') {
    if (inputKind !== undefined && inputKind !== 'pi') throw new Error('Pi 认证信息格式无效。')
    const { providerKey: resolvedKey, entry } = unwrapPiAuth(auth, providerKey)
    if (
      entry.type !== 'oauth' ||
      !text(entry.access) ||
      !text(entry.refresh) ||
      typeof entry.expires !== 'number' ||
      !Number.isFinite(entry.expires)
    )
      throw new Error('Pi 认证信息须包含 type、access、refresh 和 expires。')
    providerKey = resolvedKey
    if (!(PI_OAUTH_PROVIDERS as readonly string[]).includes(providerKey))
      throw new Error('目前支持 Pi 的 OpenAI、OpenAI Codex 和 xAI OAuth 账号。')
    kind = 'pi'
    access = text(entry.access)
    const claims = jwtClaims(access)
    const authClaims = object(claims['https://api.openai.com/auth'])
    if (
      providerKey === 'openai' &&
      (!text(entry.clientId) ||
        !Array.isArray(entry.scopes) ||
        !entry.scopes.every((scope) => typeof scope === 'string') ||
        !entry.scopes.includes('chatgpt.tokens.use.direct'))
    )
      throw new Error('Pi OpenAI SIWC 凭据缺少客户端或 ChatGPT 授权范围。')
    accountId =
      providerKey === 'openai'
        ? text(claims.sub)
        : text(entry.accountId) || text(claims.sub) || fingerprint(access)
    name =
      text(entry.name) ||
      jwtName(claims) ||
      [text(entry.first_name), text(entry.last_name)].filter(Boolean).join(' ')
    email =
      text(entry.email) ||
      text(claims.email) ||
      text(object(claims['https://api.openai.com/profile']).email)
    planType = providerKey === 'openai-codex' ? text(authClaims.chatgpt_plan_type) : ''
    identity =
      providerKey === 'openai'
        ? `${providerKey}:${text(entry.clientId)}`
        : `${providerKey}:${accountId}:${email}`
    payload = { [providerKey]: entry }
  } else {
    if (inputKind !== undefined && inputKind !== 'grok') throw new Error('Grok 认证信息格式无效。')
    kind = 'grok'
    const { entryKey, entry } = unwrapGrokAuth(auth)
    if (entryKey === GROK_API_KEY || entry.auth_mode === 'api_key') {
      access = text(entry.key) || text(entry.XAI_API_KEY)
      if (!access) throw new Error('Grok API 凭据缺少有效的 key。')
      accountType = 'relay'
      apiBaseUrl = text(entry.apiBaseUrl) || text(entry.base_url) || null
      identity = `${apiBaseUrl || ''}:${fingerprint(access)}`
      payload = { [GROK_API_KEY]: { key: access, auth_mode: 'api_key' } }
    } else {
      access = text(entry.key)
      if (entry.auth_mode !== 'oidc' || !access)
        throw new Error('Grok 认证信息缺少有效的 OIDC key。')
      const claims = jwtClaims(access)
      accountId = text(entry.user_id) || text(claims.sub) || fingerprint(access)
      name =
        [text(entry.first_name), text(entry.last_name)].filter(Boolean).join(' ') || jwtName(claims)
      email = text(entry.email) || text(claims.email)
      identity = accountId
      payload = { [GROK_AUTH_KEY]: entry }
    }
  }
  return {
    auth: wrapCredential(kind, payload),
    accountType,
    providerKey,
    apiBaseUrl,
    accountId,
    name,
    email,
    planType,
    identity,
  }
}

export function relayCredential(
  product: AccountProduct,
  apiKey: string,
  apiBaseUrl: string,
): CredentialDetails {
  if (!['codex', 'claude', 'grok'].includes(product))
    throw new Error('当前可为 Codex、Claude Code 和 Grok 添加 API 账号。')
  apiBaseUrl = apiBaseUrl.replace(/\/+$/, '')
  const auth =
    product === 'codex'
      ? wrapCredential('codex', { auth_mode: 'apikey', OPENAI_API_KEY: apiKey })
      : product === 'claude'
        ? wrapCredential('claude', {
            env: { ANTHROPIC_AUTH_TOKEN: apiKey, ANTHROPIC_BASE_URL: apiBaseUrl },
          })
        : wrapCredential('grok', { [GROK_API_KEY]: { key: apiKey, auth_mode: 'api_key' } })
  return {
    auth,
    accountType: 'relay',
    providerKey: '',
    apiBaseUrl,
    accountId: '',
    name: '',
    email: '',
    planType: '',
    identity: `${apiBaseUrl}:${fingerprint(apiKey)}`,
  }
}

export function credentialIdentity(
  account: Pick<StoredAccount, 'product' | 'auth' | 'accountType' | 'providerKey' | 'apiBaseUrl'>,
): string {
  const { auth } = unwrapCredential(account.auth)
  if (account.accountType === 'relay') {
    const env = object(auth.env)
    const grokEntry = unwrapGrokAuth(auth).entry
    const key =
      account.product === 'codex'
        ? text(auth.OPENAI_API_KEY)
        : account.product === 'claude'
          ? text(env.ANTHROPIC_AUTH_TOKEN) || text(env.ANTHROPIC_API_KEY)
          : text(grokEntry.key) || text(grokEntry.XAI_API_KEY)
    return `${account.apiBaseUrl}:${fingerprint(key)}`
  }
  return normalizeCredential(account.product, account.auth, account.providerKey).identity
}

function assertPiOAuthReplaceable(root: Record<string, unknown>, providerKey: string): void {
  if (providerKey === 'openai' && object(root.openai).type === 'api_key')
    throw new Error('Pi 当前 OpenAI 使用 API Key，请先在 Pi 中处理，Cota 不会覆盖该凭据。')
}

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
      return Object.entries(root)
        .filter(([, value]) => object(value).type === 'oauth')
        .filter(([provider]) => (PI_OAUTH_PROVIDERS as readonly string[]).includes(provider))
        .map(([provider, value]) => normalizeCredential('pi', value, provider))
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

  async assertPiOAuthReplaceable(providerKey: string): Promise<void> {
    const path = this.authPath('pi')
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return undefined
    })
    if (stat?.isSymbolicLink()) throw new Error('Pi 认证文件是符号链接，无法安全修改认证信息。')
    const content = await readOptional(path)
    assertPiOAuthReplaceable(content === null ? {} : parseObject(content, path), providerKey)
  }

  async deactivatePi(
    providerKey: string,
    expectedRevision: string,
    assertLocked: () => void,
  ): Promise<void> {
    await this.assertPiOAuthReplaceable(providerKey)
    const path = this.authPath('pi')
    const before = await readOptional(path)
    if (this.revisionOf([{ path, before }]) !== expectedRevision)
      throw new Error('当前 Pi 登录已变化，请刷新后重试。')
    const root = before === null ? {} : parseObject(before, path)
    if (object(root[providerKey]).type !== 'oauth')
      throw new Error('当前 Pi 登录已变化，请刷新后重试。')
    delete root[providerKey]
    await applyAccountFiles([{ path, before, after: json(root) }], assertLocked, () =>
      this.assertPiOAuthReplaceable(providerKey),
    )
  }

  async apply(
    account: StoredAccount,
    expectedRevision?: string,
    piLock?: () => void,
  ): Promise<() => Promise<void>> {
    if (account.product === 'pi') {
      if (piLock) {
        const restore = await this.applyUnlocked(account, piLock, expectedRevision)
        return () => restore(piLock)
      }
      const restore = await this.withPiLock((assertLocked) =>
        this.applyUnlocked(account, assertLocked, expectedRevision),
      )
      return () => this.withPiLock(restore)
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
  ): Promise<(assertRestoreLocked?: () => void) => Promise<void>> {
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
      if (account.providerKey === 'openai') await this.assertPiOAuthReplaceable(account.providerKey)
      const { entry } = unwrapPiAuth(auth, account.providerKey)
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
    const written = authOnly ? changes.filter((change) => change.path === path) : changes
    const verifyBeforeWrite =
      authOnly && expectedRevision
        ? async () => {
            if ((await this.revision(product)) !== expectedRevision)
              throw new Error('当前 CLI 登录已变化，请刷新并重新确认切换。')
          }
        : undefined
    await applyAccountFiles(written, assertLocked, verifyBeforeWrite)
    return async (assertRestoreLocked) => {
      const reversed: AccountFileChange[] = []
      for (const change of written) {
        reversed.push({ path: change.path, before: change.after, after: change.before })
      }
      await applyAccountFiles(reversed, assertRestoreLocked)
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
