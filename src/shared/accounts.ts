import { z } from 'zod'

export const ACCOUNT_PRODUCTS = {
  codex: { name: 'Codex', description: 'ChatGPT 登录与 API 账号' },
  claude: { name: 'Claude Code', description: 'OAuth 登录与中转账号' },
  pi: { name: 'Pi', description: '本地 OAuth 账号' },
  grok: { name: 'Grok', description: 'Grok CLI 登录账号' },
} as const

export const accountProductSchema = z.enum(['codex', 'claude', 'pi', 'grok'])
export type AccountProduct = z.infer<typeof accountProductSchema>
export const accountIdSchema = z.string().min(1).max(200)
const aliasSchema = z
  .string()
  .trim()
  .max(80, '名称最多 80 字符。')
  .regex(/^[^\0\r\n]*$/, '名称不能包含换行。')
export const accountFormSchema = z
  .object({
    alias: aliasSchema,
    mode: z.enum(['credential', 'relay']),
    credential: z.string().max(1024 * 1024, '认证信息过长。'),
    apiBaseUrl: z.string().max(4096),
    apiKey: z.string().max(16384),
  })
  .superRefine((value, context) => {
    if (value.mode === 'credential' && !value.credential.trim())
      context.addIssue({ code: 'custom', path: ['credential'], message: '请粘贴认证信息。' })
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
export const accountInputSchema = z.object({ product: accountProductSchema }).and(accountFormSchema)
export type AddAccountInput = z.infer<typeof accountInputSchema>
export const renameAccountSchema = z.object({
  id: accountIdSchema,
  alias: aliasSchema.min(1, '请输入账号名称。'),
})
export const switchAccountSchema = z.object({
  id: accountIdSchema,
  force: z.boolean().default(false),
})

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

export interface AccountStatus {
  profiles: AccountProfile[]
  authPath: string
  authState: 'managed' | 'unmanaged' | 'missing'
  authMessage: string
  cortanaAvailable: boolean
}

export interface AccountOAuthProgress {
  product: AccountProduct
  stage: 'waiting' | 'exchanging' | 'success' | 'error' | 'cancelled'
  message: string
}

export interface AccountsAPI {
  list(product: AccountProduct): Promise<import('./contracts').Result<AccountStatus>>
  add(input: AddAccountInput): Promise<import('./contracts').Result<void>>
  importCurrent(product: AccountProduct): Promise<import('./contracts').Result<number>>
  importCortana(): Promise<import('./contracts').Result<number>>
  switch(input: z.input<typeof switchAccountSchema>): Promise<import('./contracts').Result<void>>
  rename(input: z.infer<typeof renameAccountSchema>): Promise<import('./contracts').Result<void>>
  remove(id: string): Promise<import('./contracts').Result<void>>
  refresh(id: string): Promise<import('./contracts').Result<void>>
  reorder(product: AccountProduct, ids: string[]): Promise<import('./contracts').Result<void>>
  startOAuth(product: AccountProduct, alias: string): Promise<import('./contracts').Result<void>>
  cancelOAuth(): Promise<import('./contracts').Result<void>>
  onOAuth(listener: (progress: AccountOAuthProgress) => void): () => void
}
