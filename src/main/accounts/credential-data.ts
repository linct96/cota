import { createHash } from 'node:crypto'
import { piOpenAIApiKeySchema } from '../../shared/accounts'
import type { AccountProduct } from '../../shared/accounts'
import type { CredentialKind, OAuthEntry, StoredAccount } from './schema'
import { json, jwtClaims, object, parseObject, text } from './files'
import {
  PI_DEFAULT_URLS,
  piConfigMetadata,
  piProviderConfig,
  savedPiConfig,
  stablePiConfig,
} from './pi-config'

export const GROK_AUTH_KEY = 'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828'
export const GROK_API_KEY = 'xai::api_key'
const PI_OAUTH_PROVIDERS = ['openai', 'openai-codex', 'xai'] as const
export const CLAUDE_SCOPE =
  'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
export const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex')

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
    (auth.type === 'api_key' || text(auth.clientId)
      ? 'openai'
      : text(auth.accountId)
        ? 'openai-codex'
        : 'xai')
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
    if (piEntry.type === 'api_key')
      return { product: 'pi', providerKey, accountType: 'relay', accountId: '' }
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
    if (entry.type === 'api_key') {
      if (['openai-codex', 'xai'].includes(resolvedKey))
        throw new Error('此 Pi Provider 仅支持 OAuth。')
      const config = savedPiConfig(auth, resolvedKey)
      if (entry.env !== undefined)
        throw new Error('暂不支持带环境变量配置的 Pi API Key，请直接填写 Key。')
      const result = piOpenAIApiKeySchema.safeParse(entry.key)
      if (!result.success) throw new Error(result.error.issues[0]?.message || 'API Key 无效。')
      return {
        auth: wrapCredential('pi', {
          [resolvedKey]: { type: 'api_key', key: result.data },
          ...piConfigMetadata(config),
        }),
        accountType: 'relay',
        providerKey: resolvedKey,
        apiBaseUrl: text(config.baseUrl) || PI_DEFAULT_URLS.get(resolvedKey) || null,
        accountId: '',
        name: text(config.name),
        email: '',
        planType: '',
        identity: `${resolvedKey}:api_key:${fingerprint(stablePiConfig(config))}:${fingerprint(result.data)}`,
      }
    }
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
    const config = savedPiConfig(auth, providerKey)
    if (PI_DEFAULT_URLS.has(providerKey) && config.baseUrl)
      throw new Error('OpenAI OAuth 存在非官方端点覆盖，请先在 Pi 中确认配置。')
    payload = { [providerKey]: entry, ...piConfigMetadata(config) }
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
  if (account.product === 'pi')
    return normalizeCredential('pi', account.auth, account.providerKey).identity
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

export function piProviders(models: Record<string, unknown>): Record<string, unknown> {
  if (
    models.providers !== undefined &&
    (models.providers === null ||
      typeof models.providers !== 'object' ||
      Array.isArray(models.providers))
  )
    throw new Error('Pi models.json 的 providers 必须是 JSON 对象。')
  return object(models.providers)
}

function readPiCredential(
  root: Record<string, unknown>,
  providers: Record<string, unknown>,
  key: string,
): CredentialDetails | undefined {
  const rawConfig = Object.hasOwn(providers, key) ? providers[key] : undefined
  const config = object(rawConfig)
  const known = (PI_OAUTH_PROVIDERS as readonly string[]).includes(key)
  if (!known && !Object.keys(config).length) return undefined
  const entry = Object.hasOwn(root, key)
    ? root[key]
    : config.apiKey !== undefined
      ? { type: 'api_key', key: config.apiKey }
      : undefined
  if (entry === undefined || (!known && object(entry).type !== 'api_key')) return undefined
  const providerConfig = key === 'xai' ? {} : piProviderConfig(rawConfig, key)
  return normalizeCredential('pi', { [key]: entry, ...piConfigMetadata(providerConfig) }, key)
}

export function assertPiTargetSupported(
  root: Record<string, unknown>,
  providers: Record<string, unknown>,
  key: string,
): void {
  if (
    (Object.hasOwn(root, key) || Object.hasOwn(object(providers[key]), 'apiKey')) &&
    !readPiCredential(root, providers, key)
  )
    throw new Error('无法识别目标 Pi Provider 的现有凭据，请先在 Pi 中确认。')
}

export function readPiCredentials(
  root: Record<string, unknown>,
  models: Record<string, unknown>,
  skipUnsupported = false,
): CredentialDetails[] {
  const providers = piProviders(models)
  const entries: CredentialDetails[] = []
  for (const key of new Set([...Object.keys(root), ...Object.keys(providers)])) {
    try {
      const entry = readPiCredential(root, providers, key)
      if (entry) entries.push(entry)
    } catch (error) {
      if (!skipUnsupported) throw error
    }
  }
  return entries
}
