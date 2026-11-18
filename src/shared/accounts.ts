import { z } from 'zod'
import type { Result } from './contracts'

export const ACCOUNT_PRODUCTS = {
  codex: { name: 'Codex', description: 'ChatGPT 登录与 API 账号' },
  claude: { name: 'Claude Code', description: 'OAuth 登录与中转账号' },
  pi: { name: 'Pi', description: '本地 OAuth 与 OpenAI API 账号' },
  grok: { name: 'Grok', description: 'Grok CLI 登录与 API 账号' },
} as const

export const accountProductSchema = z.enum(['codex', 'claude', 'pi', 'grok'])
export type AccountProduct = z.infer<typeof accountProductSchema>
export const accountIdSchema = z.string().min(1).max(200)

export const ACTIVE_USAGE_REFRESH_MINUTES = [1, 2, 5, 10] as const
export const INACTIVE_USAGE_REFRESH_MINUTES = [5, 10, 30, 60] as const
export const usageRefreshSettingsSchema = z.object({
  enabled: z.boolean(),
  activeIntervalMinutes: z
    .number()
    .refine((value) => (ACTIVE_USAGE_REFRESH_MINUTES as readonly number[]).includes(value)),
  inactiveIntervalMinutes: z
    .number()
    .refine((value) => (INACTIVE_USAGE_REFRESH_MINUTES as readonly number[]).includes(value)),
})
export type UsageRefreshSettings = z.infer<typeof usageRefreshSettingsSchema>
export const DEFAULT_USAGE_REFRESH_SETTINGS: UsageRefreshSettings = {
  enabled: true,
  activeIntervalMinutes: 5,
  inactiveIntervalMinutes: 30,
}
const aliasSchema = z
  .string()
  .trim()
  .max(80, '名称最多 80 字符。')
  .regex(/^[^\0\r\n]*$/, '名称不能包含换行。')
export const piOpenAIApiKeySchema = z
  .string()
  .min(1, '请输入 API Key。')
  .max(16384, 'API Key 过长。')
  .refine((value) => !/[\s\0]/.test(value), 'API Key 不能包含空白字符。')
  .refine(
    (value) => !value.startsWith('!') && !value.includes('$'),
    '仅支持直接填写 API Key，不支持命令或环境变量引用。',
  )
export const OPENAI_API_URL = 'https://api.openai.com/v1'
export const piProviderIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,79}$/, 'Provider ID 仅支持小写字母、数字、短横线和下划线。')
  .refine(
    (value) =>
      !['openai', 'openai-codex', 'xai', '__proto__', 'constructor', 'prototype'].includes(value),
    '请使用独立的 Provider ID。',
  )
export const apiBaseUrlSchema = z
  .string()
  .trim()
  .max(4096)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
    } catch {
      return false
    }
  }, '请输入有效的 HTTP(S) API 地址。')
export const piApiSchema = z.enum(['openai-responses', 'openai-completions'])
export const accountFormSchema = z
  .object({
    alias: aliasSchema,
    mode: z.enum(['credential', 'relay', 'api_key', 'provider']),
    credential: z.string().max(1024 * 1024, '认证信息过长。'),
    apiBaseUrl: z.string().max(4096),
    apiKey: z.string().max(16384),
    providerKey: z.string().max(80).optional(),
    api: piApiSchema.optional(),
    modelIds: z.string().max(16384).optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === 'credential' && !value.credential.trim())
      context.addIssue({ code: 'custom', path: ['credential'], message: '请粘贴认证信息。' })
    if (value.mode === 'provider') {
      for (const [name, result] of [
        ['providerKey', piProviderIdSchema.safeParse(value.providerKey)],
        ['api', piApiSchema.safeParse(value.api)],
      ] as const) {
        if (!result.success)
          context.addIssue({
            code: 'custom',
            path: [name],
            message: result.error.issues[0]?.message || '必填项。',
          })
      }
      if (
        !value.modelIds?.trim() ||
        value.modelIds
          .trim()
          .split(/[,\n]/)
          .some((id) => !id.trim() || /\s/.test(id.trim()) || id.includes('\0'))
      )
        context.addIssue({
          code: 'custom',
          path: ['modelIds'],
          message: '请输入模型 ID，多个模型用换行或逗号分隔。',
        })
    }
    if (value.mode === 'api_key' || value.mode === 'provider') {
      const result = piOpenAIApiKeySchema.safeParse(value.apiKey.trim())
      if (!result.success)
        for (const issue of result.error.issues)
          context.addIssue({ code: 'custom', path: ['apiKey'], message: issue.message })
    }
    if (value.mode === 'provider' || value.mode === 'api_key') {
      const result = apiBaseUrlSchema.safeParse(
        value.apiBaseUrl || (value.mode === 'api_key' ? OPENAI_API_URL : ''),
      )
      if (!result.success)
        context.addIssue({
          code: 'custom',
          path: ['apiBaseUrl'],
          message: '请输入有效的 HTTP(S) API 地址。',
        })
    }
    if (value.mode === 'relay') {
      try {
        const url = new URL(value.apiBaseUrl.trim())
        if (
          !['https:', 'http:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error()
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['apiBaseUrl'],
          message: '请输入有效的 HTTP(S) API 地址。',
        })
      }
      if (!value.apiKey.trim() || /[\r\n\0]/.test(value.apiKey))
        context.addIssue({ code: 'custom', path: ['apiKey'], message: '请输入有效的 API Key。' })
    }
  })
// Keep validation identical at the form and IPC boundaries, including cross-field rules.
export const accountInputSchema = z
  .object({ product: accountProductSchema })
  .and(accountFormSchema)
  .refine((value) => !['api_key', 'provider'].includes(value.mode) || value.product === 'pi', {
    message: '此添加方式仅支持 Pi API 账号。',
    path: ['mode'],
  })
export type AddAccountInput = z.infer<typeof accountInputSchema>
export const renameAccountSchema = z.object({
  id: accountIdSchema,
  alias: aliasSchema.min(1, '请输入账号名称。'),
})
export const switchAccountSchema = z.object({
  id: accountIdSchema,
  force: z.boolean().default(false),
  authRevision: z.string().min(1).max(128).optional(),
})

export interface AccountSwitchResult {
  restartRequired: boolean
}

export interface AccountUsageWindow {
  usedPercent: number
  windowMinutes: number | null
  resetsAt: number | null
}

export interface AccountProfile {
  id: string
  product: AccountProduct
  providerKey: string
  accountType: 'oauth' | 'relay'
  alias: string
  email: string
  accountId: string
  planType: string
  apiBaseUrl: string | null
  usagePrimary: AccountUsageWindow | null
  usageSecondary: AccountUsageWindow | null
  usageUpdatedAt: number | null
  updatedAt: number
  lastUsedAt: number | null
  isActive: boolean
  needsReauthorization: boolean
  switchUnavailable?: string
}

export function supportsAutomaticUsageRefresh(
  account: Pick<AccountProfile, 'accountType' | 'product' | 'providerKey'>,
): boolean {
  return (
    account.accountType === 'oauth' &&
    (account.product === 'codex' ||
      account.product === 'grok' ||
      (account.product === 'pi' && ['openai-codex', 'xai'].includes(account.providerKey)))
  )
}

export interface AccountStatus {
  profiles: AccountProfile[]
  authPath: string
  authState: 'managed' | 'unmanaged' | 'missing'
  authMessage: string
  authRevision?: string
}

export interface AccountUsageRefreshStatus {
  id: string
  product: AccountProduct
  refreshing: boolean
  error?: string
}

export interface AccountOAuthProgress {
  product: AccountProduct
  stage: 'waiting' | 'exchanging' | 'success' | 'error' | 'cancelled'
  message: string
}

export interface AccountsAPI {
  list: (product: AccountProduct) => Promise<Result<AccountStatus>>
  add: (input: AddAccountInput) => Promise<Result<void>>
  importCurrent: (product: AccountProduct) => Promise<Result<number>>
  switch: (input: z.input<typeof switchAccountSchema>) => Promise<Result<AccountSwitchResult>>
  deactivate: (id: string) => Promise<Result<void>>
  rename: (input: z.infer<typeof renameAccountSchema>) => Promise<Result<void>>
  remove: (id: string) => Promise<Result<void>>
  refresh: (id: string) => Promise<Result<void>>
  usageRefreshStatuses: () => Promise<Result<AccountUsageRefreshStatus[]>>
  onUsageRefresh: (listener: (status: AccountUsageRefreshStatus) => void) => () => void
  reorder: (product: AccountProduct, ids: string[]) => Promise<Result<void>>
  startOAuth: (product: AccountProduct, alias: string) => Promise<Result<void>>
  cancelOAuth: () => Promise<Result<void>>
  onOAuth: (listener: (progress: AccountOAuthProgress) => void) => () => void
}
