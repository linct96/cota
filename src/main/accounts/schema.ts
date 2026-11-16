import { z } from 'zod'
import { accountIdSchema, accountProductSchema } from '../../shared/accounts'
import type { AccountProfile } from '../../shared/accounts'

const usageWindowSchema = z.strictObject({
  usedPercent: z.number().finite(),
  windowMinutes: z.number().finite().nullable(),
  resetsAt: z.number().finite().nullable(),
})

const providerFields = {
  id: accountIdSchema,
  alias: z.string().min(1),
  email: z.string(),
  planType: z.string(),
  apiBaseUrl: z.string().nullable(),
  usagePrimary: usageWindowSchema.nullable(),
  usageSecondary: usageWindowSchema.nullable(),
  usageUpdatedAt: z.number().finite().nullable(),
  updatedAt: z.number().finite(),
  lastUsedAt: z.number().finite().nullable(),
  sortOrder: z.number().int(),
  needsReauthorization: z.boolean(),
  switchUnavailable: z.string().optional(),
}

export interface StoredAccount extends Omit<AccountProfile, 'isActive'> {
  auth: string
  sortOrder: number
}

export const storedAccountSchema = z.strictObject({
  ...providerFields,
  product: accountProductSchema,
  providerKey: z.string(),
  accountType: z.enum(['oauth', 'relay']),
  accountId: z.string(),
  auth: z.string().max(1024 * 1024),
})

export const providersFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  accounts: z
    .array(z.strictObject(providerFields))
    .max(10_000)
    .superRefine((accounts, ctx) => {
      const ids = new Set<string>()
      for (const [index, account] of accounts.entries()) {
        if (ids.has(account.id))
          ctx.addIssue({
            code: 'custom',
            message: '账号 ID 重复。',
            path: [index, 'id'],
          })
        ids.add(account.id)
      }
    }),
})

export const credentialKindSchema = z.enum(['codex', 'claude', 'pi', 'grok'])
export type CredentialKind = z.infer<typeof credentialKindSchema>

export const oauthEntrySchema = z.strictObject({
  id: accountIdSchema,
  kind: credentialKindSchema,
  auth: z.record(z.string(), z.unknown()),
})

// auth.json stores plaintext OAuth tokens and API keys as a JSON array of { id, kind, auth }.
export const oauthFileSchema = z
  .array(oauthEntrySchema)
  .max(10_000)
  .superRefine((entries, ctx) => {
    const ids = new Set<string>()
    for (const [index, entry] of entries.entries()) {
      if (ids.has(entry.id))
        ctx.addIssue({
          code: 'custom',
          message: '账号凭据 ID 重复。',
          path: [index, 'id'],
        })
      ids.add(entry.id)
    }
  })

export type ProvidersFile = z.infer<typeof providersFileSchema>
export type OAuthEntry = z.infer<typeof oauthEntrySchema>
export type OAuthFile = z.infer<typeof oauthFileSchema>
