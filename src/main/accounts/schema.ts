import { z } from 'zod'
import { accountIdSchema, accountProductSchema } from '../../shared/accounts'

const usageWindowSchema = z.strictObject({
  usedPercent: z.number().finite(),
  windowMinutes: z.number().finite().nullable(),
  resetsAt: z.number().finite().nullable(),
})

const accountFields = {
  id: accountIdSchema,
  product: accountProductSchema,
  providerKey: z.string(),
  accountType: z.enum(['oauth', 'relay']),
  alias: z.string().min(1),
  email: z.string(),
  accountId: z.string(),
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

export const storedAccountSchema = z.strictObject({
  ...accountFields,
  auth: z.string().max(1024 * 1024),
})

const encryptedCredentialSchema = z.strictObject({
  scheme: z.literal('electron-safeStorage'),
  encoding: z.literal('base64'),
  data: z
    .string()
    .min(4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
})

export const providersFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  accounts: z
    .array(z.strictObject({ ...accountFields, authEncrypted: encryptedCredentialSchema }))
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

export type ProvidersFile = z.infer<typeof providersFileSchema>
