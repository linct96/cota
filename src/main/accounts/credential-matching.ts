import {
  credentialIdentity,
  fingerprint,
  unwrapCredential,
  unwrapGrokAuth,
  unwrapPiAuth,
  wrapCredential,
} from './credential-data'
import type { CredentialDetails } from './credential-data'
import { json, object, text } from './files'
import { piConfigMetadata, savedPiConfig } from './pi-config'
import type { StoredAccount } from './schema'

function accessFingerprint(rawAuth: string): string {
  const { auth } = unwrapCredential(rawAuth)
  const env = object(auth.env)
  const claudeAccess =
    text(env.CLAUDE_CODE_OAUTH_TOKEN) ||
    text(env.ANTHROPIC_AUTH_TOKEN) ||
    text(env.ANTHROPIC_API_KEY)
  const piAccess =
    text(unwrapPiAuth(auth).entry.key) ||
    text(object(auth.openai).key) ||
    text(object(auth.openai).access) ||
    text(object(auth['openai-codex']).access) ||
    text(object(auth.xai).access) ||
    text(auth.access)
  const grokAccess = text(unwrapGrokAuth(auth).entry.key)
  return fingerprint(
    text(object(auth.tokens).access_token) ||
      text(auth.OPENAI_API_KEY) ||
      claudeAccess ||
      piAccess ||
      grokAccess,
  )
}

function storedIdentity(account: StoredAccount): string | undefined {
  try {
    return credentialIdentity(account)
  } catch {
    // Incompatible imported credentials must remain available for rename and removal.
    return undefined
  }
}

export function matches(account: StoredAccount, current: CredentialDetails): boolean {
  if (account.accountType !== current.accountType || account.providerKey !== current.providerKey)
    return false
  const identity = storedIdentity(account)
  if (identity === undefined) return false
  if (account.product === 'pi' && account.providerKey === 'openai')
    return (
      identity === current.identity &&
      (!account.accountId || !current.accountId || account.accountId === current.accountId)
    )
  return (
    identity === current.identity ||
    (account.accountType === 'oauth' &&
      accessFingerprint(account.auth) === accessFingerprint(current.auth))
  )
}

export function mergeCurrent(account: StoredAccount, credential: CredentialDetails): StoredAccount {
  const original = unwrapCredential(account.auth)
  const incoming = unwrapCredential(credential.auth)
  if (account.product === 'pi') {
    const key = account.providerKey || credential.providerKey
    const mergedEntry = {
      ...unwrapPiAuth(original.auth, key).entry,
      ...unwrapPiAuth(incoming.auth, key).entry,
    }
    return {
      ...account,
      email: credential.email || account.email,
      planType: credential.planType || account.planType,
      auth: wrapCredential('pi', {
        [key]: mergedEntry,
        ...piConfigMetadata(savedPiConfig(incoming.auth, key)),
      }),
      updatedAt: Date.now(),
    }
  }
  if (account.product === 'grok') {
    const origGrok = unwrapGrokAuth(original.auth)
    const nextGrok = unwrapGrokAuth(incoming.auth)
    const entryKey = nextGrok.entryKey || origGrok.entryKey
    return {
      ...account,
      email: credential.email || account.email,
      planType: credential.planType || account.planType,
      auth: wrapCredential('grok', { [entryKey]: { ...origGrok.entry, ...nextGrok.entry } }),
      updatedAt: Date.now(),
    }
  }
  const merged = { ...original.auth, ...incoming.auth }
  if (account.product === 'claude') {
    merged.env = { ...object(original.auth.env), ...object(incoming.auth.env) }
  }
  for (const key of ['refreshToken', 'cliTokenExpiresAt', 'accountId', 'email'])
    if (!incoming.auth[key] && original.auth[key]) merged[key] = original.auth[key]
  const kind = incoming.kind ?? original.kind
  return {
    ...account,
    email: credential.email || account.email,
    planType: credential.planType || account.planType,
    auth: kind ? wrapCredential(kind, merged) : json(merged),
    updatedAt: Date.now(),
  }
}

export function refreshTokenKey(account: StoredAccount): string {
  if (account.accountType !== 'oauth' || account.product === 'claude') return ''
  const { auth } = unwrapCredential(account.auth)
  const openai =
    account.product === 'codex' ||
    (account.product === 'pi' && ['openai', 'openai-codex'].includes(account.providerKey))
  const token =
    account.product === 'codex'
      ? text(object(auth.tokens).refresh_token)
      : account.product === 'pi'
        ? text(unwrapPiAuth(auth, account.providerKey).entry.refresh)
        : text(unwrapGrokAuth(auth).entry.refresh_token)
  return token ? `${openai ? 'openai' : 'xai'}:${token}` : ''
}

export function credentialsDiffer(account: StoredAccount, current: CredentialDetails): boolean {
  return (
    accessFingerprint(account.auth) !== accessFingerprint(current.auth) ||
    refreshTokenKey(account) !== refreshTokenKey({ ...account, auth: current.auth })
  )
}
