import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'
import type { AccountProduct } from '../../shared/accounts'
import type { StoredAccount } from './store'
import {
  applyAccountFiles,
  json,
  jwtClaims,
  object,
  parseObject,
  readOptional,
  text,
  withPiAuthLock,
  type AccountFileChange,
} from './files'

export const GROK_AUTH_KEY = 'https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828'
export const CLAUDE_SCOPE =
  'user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload'
export const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex')

export interface CredentialDetails {
  auth: string
  accountType: 'oauth' | 'relay'
  providerKey: string
  apiBaseUrl: string | null
  accountId: string
  email: string
  planType: string
  identity: string
}

export function normalizeCredential(
  product: AccountProduct,
  value: unknown,
  providerKey = '',
): CredentialDetails {
  const auth = object(value)
  let access = ''
  let accountId = ''
  let email = ''
  let planType = ''
  let apiBaseUrl: string | null = null
  let accountType: 'oauth' | 'relay' = 'oauth'
  let identity = ''
  if (product === 'codex') {
    const tokens = object(auth.tokens)
    access = text(tokens.access_token)
    const idClaims = jwtClaims(tokens.id_token)
    const accessClaims = jwtClaims(access)
    const identityClaims = {
      ...object(accessClaims['https://api.openai.com/auth']),
      ...object(idClaims['https://api.openai.com/auth']),
    }
    accountId = text(tokens.account_id) || text(identityClaims.chatgpt_account_id)
    email =
      text(idClaims.email) || text(object(accessClaims['https://api.openai.com/profile']).email)
    planType = text(identityClaims.chatgpt_plan_type)
    identity = `${accountId}:${text(identityClaims.chatgpt_user_id) || email}`
    if (!access || !accountId) throw new Error('Codex 认证信息缺少 access_token 或 account_id。')
  } else if (product === 'claude') {
    if (auth.kind === 'claude_relay') {
      access = text(auth.authToken)
      accountType = 'relay'
      apiBaseUrl = text(auth.apiBaseUrl) || null
    } else {
      access = text(auth.cliToken)
      if (auth.kind !== 'claude_oauth') throw new Error('Claude 认证信息格式无效。')
    }
    if (!access) throw new Error('Claude 认证信息缺少登录令牌。')
    accountId = text(auth.accountId) || fingerprint(access)
    email = text(auth.email)
    identity = fingerprint(access)
  } else if (product === 'pi') {
    if (
      auth.type !== 'oauth' ||
      !text(auth.access) ||
      !text(auth.refresh) ||
      typeof auth.expires !== 'number' ||
      !Number.isFinite(auth.expires)
    )
      throw new Error('Pi 认证信息须包含 type、access、refresh 和 expires。')
    access = text(auth.access)
    providerKey ||= text(auth.providerKey) || (text(auth.accountId) ? 'openai-codex' : 'xai')
    if (!['openai-codex', 'xai'].includes(providerKey))
      throw new Error('目前支持 Pi 的 OpenAI Codex 和 xAI OAuth 账号。')
    const claims = jwtClaims(access)
    accountId = text(auth.accountId) || text(claims.sub) || fingerprint(access)
    email =
      text(auth.email) ||
      text(claims.email) ||
      text(object(claims['https://api.openai.com/profile']).email)
    identity = `${providerKey}:${accountId}:${email}`
  } else if (product === 'grok') {
    access = text(auth.key)
    if (auth.auth_mode !== 'oidc' || !access) throw new Error('Grok 认证信息缺少有效的 OIDC key。')
    const claims = jwtClaims(access)
    accountId = text(auth.user_id) || text(claims.sub) || fingerprint(access)
    email = text(auth.email) || text(claims.email)
    identity = accountId
  }
  return {
    auth: json(auth),
    accountType,
    providerKey,
    apiBaseUrl,
    accountId,
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
  if (!['codex', 'claude'].includes(product))
    throw new Error('当前可为 Codex 和 Claude Code 添加中转账号。')
  apiBaseUrl = apiBaseUrl.replace(/\/+$/, '')
  return {
    auth: json(
      product === 'codex'
        ? { OPENAI_API_KEY: apiKey }
        : { kind: 'claude_relay', authToken: apiKey, source: 'cota' },
    ),
    accountType: 'relay',
    providerKey: '',
    apiBaseUrl,
    accountId: '',
    email: '',
    planType: '',
    identity: `${apiBaseUrl}:${fingerprint(apiKey)}`,
  }
}

export function credentialIdentity(
  account: Pick<StoredAccount, 'product' | 'auth' | 'accountType' | 'providerKey' | 'apiBaseUrl'>,
): string {
  const auth = parseObject(account.auth)
  if (account.accountType === 'relay') {
    const key =
      text(auth.OPENAI_API_KEY) || text(auth.authToken) || text(auth.apiKey) || text(auth.key)
    return `${account.apiBaseUrl}:${fingerprint(key)}`
  }
  return normalizeCredential(account.product, auth, account.providerKey).identity
}

export class AccountCredentials {
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
            kind: 'claude_oauth',
            cliToken: oauth,
            scopes: text(env.CLAUDE_CODE_OAUTH_SCOPES) || CLAUDE_SCOPE,
            source: 'settings_import',
          }),
        ]
      if (key)
        return [
          relayCredential(
            'claude',
            key,
            text(env.ANTHROPIC_BASE_URL) || 'https://api.anthropic.com',
          ),
        ]
      return []
    }
    if (product === 'pi') {
      return Object.entries(root)
        .filter(([, value]) => object(value).type === 'oauth')
        .filter(([provider]) => ['openai-codex', 'xai'].includes(provider))
        .map(([provider, value]) => normalizeCredential('pi', value, provider))
    }
    const config = await this.toml(join(this.authPath('grok'), '..', 'config.toml'))
    if (
      object(config.value.auth).preferred_method === 'api_key' ||
      object(config.value.endpoints).models_base_url
    )
      throw new Error('当前 Grok 使用自定义 API 配置，切换 OAuth 会替换认证方式。')
    return root[GROK_AUTH_KEY] ? [normalizeCredential('grok', root[GROK_AUTH_KEY])] : []
  }

  async apply(account: StoredAccount): Promise<() => Promise<void>> {
    if (account.product === 'pi') {
      const restore = await withPiAuthLock(this.authPath('pi'), (assertLocked) =>
        this.applyUnlocked(account, assertLocked),
      )
      return () => withPiAuthLock(this.authPath('pi'), restore)
    }
    return this.applyUnlocked(account)
  }

  private async applyUnlocked(
    account: StoredAccount,
    assertLocked?: () => void,
  ): Promise<(assertRestoreLocked?: () => void) => Promise<void>> {
    const { product } = account
    const auth = parseObject(account.auth)
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
        delete config.value.model_provider
      }
      changes.push({ path: configPath, before: config.content, after: stringifyToml(config.value) })
      changes.push({ path, before, after: json(auth) })
    } else if (product === 'claude') {
      const env = object(root.env)
      for (const key of [
        'CLAUDE_CODE_OAUTH_TOKEN',
        'CLAUDE_CODE_OAUTH_SCOPES',
        'ANTHROPIC_API_KEY',
        'ANTHROPIC_AUTH_TOKEN',
        'ANTHROPIC_BASE_URL',
      ])
        delete env[key]
      if (account.accountType === 'relay') {
        env.ANTHROPIC_AUTH_TOKEN = text(auth.authToken)
        env.ANTHROPIC_BASE_URL = account.apiBaseUrl!
      } else {
        env.CLAUDE_CODE_OAUTH_TOKEN = text(auth.cliToken)
        env.CLAUDE_CODE_OAUTH_SCOPES = text(auth.scopes) || CLAUDE_SCOPE
      }
      changes.push({ path, before, after: json({ ...root, env }) })
    } else if (product === 'pi') {
      changes.push({ path, before, after: json({ ...root, [account.providerKey]: auth }) })
    } else {
      const configPath = join(path, '..', 'config.toml')
      const config = await this.toml(configPath)
      const authentication = object(config.value.auth)
      delete authentication.preferred_method
      config.value.auth = authentication
      const endpoints = object(config.value.endpoints)
      delete endpoints.models_base_url
      config.value.endpoints = endpoints
      changes.push({ path: configPath, before: config.content, after: stringifyToml(config.value) })
      changes.push({ path, before, after: json({ ...root, [GROK_AUTH_KEY]: auth }) })
    }
    await applyAccountFiles(changes, assertLocked)
    return async (assertRestoreLocked) => {
      const reversed: AccountFileChange[] = []
      for (const change of changes) {
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
