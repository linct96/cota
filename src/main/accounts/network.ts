import type { AccountProduct, AccountUsageWindow } from '../../shared/accounts'
import type { StoredAccount } from './store'
import { json, jwtClaims, object, parseObject, text } from './files'
import { CLAUDE_SCOPE } from './credentials'

export const OAUTH_CONFIG = {
  codex: {
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authorize: 'https://auth.openai.com/oauth/authorize',
    token: 'https://auth.openai.com/oauth/token',
    scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
    port: 1455,
    path: '/auth/callback',
  },
  claude: {
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    authorize: 'https://claude.ai/oauth/authorize',
    token: 'https://api.anthropic.com/v1/oauth/token',
    scope: CLAUDE_SCOPE,
    port: 54545,
    path: '/callback',
  },
} as const
export const GROK_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828'
export const GROK_SCOPE =
  'openid profile email offline_access grok-cli:access api:access conversations:read conversations:write workspaces:read workspaces:write'

export class AccountNetworkError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function requestJSON(
  url: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(30000),
      redirect: 'error',
    })
  } catch {
    throw new Error('账号服务连接失败，请检查网络后重试。')
  }
  if (!response.ok) {
    // Do not forward upstream bodies: they can echo credentials or request details.
    throw new AccountNetworkError(
      response.status === 401 || response.status === 403
        ? `账号认证失败（HTTP ${response.status}），请重新授权或稍后重试。`
        : `账号服务请求失败（HTTP ${response.status}）。`,
      response.status,
    )
  }
  try {
    return parseObject(await response.text(), '账号服务响应')
  } catch {
    throw new Error('账号服务返回了无效数据。')
  }
}

async function tokenRequest(product: 'codex' | 'claude', fields: Record<string, string | number>) {
  const payload = { client_id: OAUTH_CONFIG[product].clientId, ...fields }
  const token = await requestJSON(
    OAUTH_CONFIG[product].token,
    product === 'claude'
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        }
      : {
          method: 'POST',
          body: new URLSearchParams({
            ...Object.fromEntries(
              Object.entries(payload).map(([key, value]) => [key, String(value)]),
            ),
          }),
        },
  )
  const normalized = {
    ...token,
    access_token: token.access_token || token.accessToken,
    refresh_token: token.refresh_token || token.refreshToken,
    expires_in: token.expires_in || token.expiresIn,
    id_token: token.id_token || token.idToken,
  }
  if (!text(normalized.access_token)) throw new Error('授权服务未返回 access_token。')
  return normalized
}

export async function exchangeCode(
  product: 'codex' | 'claude',
  code: string,
  state: string,
  verifier: string,
  callback: string,
) {
  const token = await tokenRequest(product, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: callback,
    code_verifier: verifier,
    ...(product === 'claude' ? { state } : {}),
  })
  return authFromToken(product, token)
}

export async function authFromToken(
  product: AccountProduct,
  token: Record<string, unknown>,
  previous: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const access = text(token.access_token)
  const refresh = text(token.refresh_token)
  if (!access) throw new Error('授权服务未返回有效的登录令牌。')
  if (product === 'codex') {
    const tokens = object(previous.tokens)
    const id = text(token.id_token) || text(tokens.id_token)
    const claims = jwtClaims(id || access)
    const authClaims = object(claims['https://api.openai.com/auth'])
    return {
      ...previous,
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        ...tokens,
        access_token: access,
        refresh_token: refresh || text(tokens.refresh_token),
        id_token: id,
        account_id: text(authClaims.chatgpt_account_id) || text(tokens.account_id),
      },
      last_refresh: new Date().toISOString(),
    }
  }
  if (product === 'claude') {
    if (!refresh && !text(previous.refreshToken)) throw new Error('Claude 授权未返回可续期凭据。')
    // Match Cortana: use the long-lived CLI token, not the short-lived browser access token.
    const cli = await tokenRequest('claude', {
      grant_type: 'refresh_token',
      refresh_token: refresh || text(previous.refreshToken),
      expires_in: 31536000,
      scope: CLAUDE_SCOPE,
    })
    return {
      ...previous,
      kind: 'claude_oauth',
      cliToken: text(cli.access_token),
      refreshToken: text(cli.refresh_token) || refresh || text(previous.refreshToken),
      cliTokenExpiresAt: Date.now() + (Number(cli.expires_in) || 31536000) * 1000,
      accountId: text(object(token.account).uuid) || text(previous.accountId),
      email:
        text(object(token.account).email_address || object(token.account).emailAddress) ||
        text(previous.email),
      scopes: CLAUDE_SCOPE,
      source: 'oauth',
    }
  }
  const claims = jwtClaims(text(token.id_token) || access)
  return {
    ...previous,
    key: access,
    refresh_token: refresh || text(previous.refresh_token),
    auth_mode: 'oidc',
    oidc_issuer: 'https://auth.x.ai',
    oidc_client_id: GROK_CLIENT_ID,
    user_id: text(claims.sub) || text(previous.user_id),
    email: text(claims.email) || text(previous.email),
    coding_data_retention_opt_out: true,
    create_time: new Date().toISOString(),
    expires_at: new Date(Date.now() + (Number(token.expires_in) || 3600) * 1000).toISOString(),
  }
}

export async function refreshPastedCodex(value: string): Promise<Record<string, unknown>> {
  const previous = value.trim().startsWith('{') ? parseObject(value) : {}
  const refresh = value.trim().startsWith('{')
    ? text(object(previous.tokens).refresh_token)
    : value.trim()
  if (!refresh || /\s/.test(refresh)) throw new Error('请输入完整 auth.json 或 refresh_token。')
  return authFromToken(
    'codex',
    await tokenRequest('codex', { grant_type: 'refresh_token', refresh_token: refresh }),
    { ...previous, tokens: { ...object(previous.tokens), refresh_token: refresh } },
  )
}

export async function refreshCredential(
  account: StoredAccount,
  force = false,
): Promise<StoredAccount> {
  if (account.accountType === 'relay') return account
  const auth = parseObject(account.auth)
  const product = account.product
  let refresh = ''
  let expiry = Infinity
  if (product === 'codex') {
    const tokens = object(auth.tokens)
    refresh = text(tokens.refresh_token)
    expiry = Number(jwtClaims(tokens.access_token).exp || 0) * 1000
  } else if (product === 'claude') {
    refresh = text(auth.refreshToken)
    expiry = typeof auth.cliTokenExpiresAt === 'number' ? auth.cliTokenExpiresAt : Infinity
  } else if (product === 'pi') {
    refresh = text(auth.refresh)
    expiry = Number(auth.expires)
  } else {
    refresh = text(auth.refresh_token)
    expiry = Date.parse(text(auth.expires_at)) || 0
  }
  const buffer = product === 'claude' ? 7 * 86400000 : 15 * 60000
  if (!force && expiry > Date.now() + buffer) return account
  if (!refresh) {
    if (expiry <= Date.now() || force) throw new Error('此账号没有可续期凭据，请重新授权。')
    return account
  }
  let token: Record<string, unknown>
  if (product === 'grok' || (product === 'pi' && account.providerKey === 'xai')) {
    token = await requestJSON('https://auth.x.ai/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id: GROK_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refresh,
      }),
    })
  } else {
    token = await tokenRequest(product === 'pi' ? 'codex' : product, {
      grant_type: 'refresh_token',
      refresh_token: refresh,
      ...(product === 'claude' ? { expires_in: 31536000, scope: CLAUDE_SCOPE } : {}),
    })
  }
  if (!text(token.access_token)) throw new Error('刷新认证失败，服务未返回登录令牌。')
  let next: Record<string, unknown>
  if (product === 'pi')
    next = {
      ...auth,
      access: text(token.access_token),
      refresh: text(token.refresh_token) || refresh,
      expires: Date.now() + (Number(token.expires_in) || 3600) * 1000,
    }
  else if (product === 'claude')
    next = {
      ...auth,
      cliToken: text(token.access_token),
      refreshToken: text(token.refresh_token) || refresh,
      cliTokenExpiresAt: Date.now() + (Number(token.expires_in) || 31536000) * 1000,
    }
  else next = await authFromToken(product, token, auth)
  return { ...account, auth: json(next), needsReauthorization: false, updatedAt: Date.now() }
}

function usageWindow(value: unknown): AccountUsageWindow | null {
  const window = object(value)
  if (typeof window.used_percent !== 'number' || !Number.isFinite(window.used_percent)) return null
  return {
    usedPercent: Math.min(100, Math.max(0, window.used_percent)),
    windowMinutes:
      Number(window.limit_window_seconds) > 0
        ? Math.ceil(Number(window.limit_window_seconds) / 60)
        : null,
    resetsAt: Number(window.reset_at) > 0 ? Number(window.reset_at) * 1000 : null,
  }
}

export async function refreshAccountUsage(account: StoredAccount): Promise<StoredAccount> {
  const auth = parseObject(account.auth)
  if (account.product === 'claude') return { ...account, usageUpdatedAt: Date.now() }
  if (
    account.product === 'codex' ||
    (account.product === 'pi' && account.providerKey === 'openai-codex')
  ) {
    const token =
      account.product === 'pi' ? text(auth.access) : text(object(auth.tokens).access_token)
    const usage = await requestJSON('https://chatgpt.com/backend-api/wham/usage', {
      headers: {
        Authorization: `Bearer ${token}`,
        'ChatGPT-Account-ID': account.accountId,
        'User-Agent': 'codex_cli_rs',
        Accept: 'application/json',
      },
    })
    const rate = object(usage.rate_limit)
    if (
      !rate.primary_window &&
      !rate.secondary_window &&
      rate.allowed === undefined &&
      !usage.credits
    )
      throw new Error('服务响应缺少可识别的额度信息。')
    return {
      ...account,
      planType: text(usage.plan_type) || account.planType,
      usagePrimary: usageWindow(rate.primary_window),
      usageSecondary: usageWindow(rate.secondary_window),
      usageUpdatedAt: Date.now(),
    }
  }
  const token = account.product === 'pi' ? text(auth.access) : text(auth.key)
  const usage = await requestJSON('https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const config = object(usage.config)
  const percent = config.creditUsagePercent ?? config.credit_usage_percent
  if (typeof percent !== 'number') throw new Error('服务未返回 Grok 额度信息。')
  const period = object(config.currentPeriod || config.current_period)
  return {
    ...account,
    planType: text(usage.subscriptionTier || usage.subscription_tier) || account.planType,
    usagePrimary: {
      usedPercent: Math.min(100, Math.max(0, percent)),
      windowMinutes: null,
      resetsAt: Date.parse(text(period.end)) || null,
    },
    usageSecondary: null,
    usageUpdatedAt: Date.now(),
  }
}
