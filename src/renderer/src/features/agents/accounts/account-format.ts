import type { AccountProfile, AccountUsageWindow } from '../../../../../shared/accounts'

export const LOW_QUOTA_THRESHOLD = 15

/** Computes remaining quota percentage rounded to an integer in [0, 100]. */
export function remainingQuotaPercent(usedPercent: number): number {
  return Math.round(Math.max(0, Math.min(100, 100 - usedPercent)))
}

/** Computes remaining window time percentage in [0, 100] (moves right-to-left), or null when unavailable. */
export function windowTimeProgress(
  window: AccountUsageWindow | null,
  defaultMinutes: number,
  now = Date.now(),
): number | null {
  if (!window || window.resetsAt === null) return null
  const minutes =
    window.windowMinutes && window.windowMinutes > 0 ? window.windowMinutes : defaultMinutes
  const totalMs = minutes * 60_000
  if (totalMs <= 0) return null
  const remainingMs = Math.max(0, window.resetsAt - now)
  const remainingPercent = (remainingMs / totalMs) * 100
  return Math.min(100, Math.max(0, Math.round(remainingPercent * 10) / 10))
}

function resetParts(value: number, now = Date.now()) {
  const totalMinutes = Math.max(0, Math.ceil((value - now) / 60_000))
  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60
  return { days, hours, minutes }
}

/** Formats full reset countdown copy for account list rows. */
export function formatResetTime(value: number, now = Date.now()): string {
  const { days, hours, minutes } = resetParts(value, now)
  if (days) return `${days}d ${hours}h 后重置`
  if (hours) return `${hours}h ${minutes}m 后重置`
  return `${minutes}m 后重置`
}

/** Formats compact reset countdown for the top quota telemetry bar. */
export function formatCompactResetTime(value: number, now = Date.now()): string {
  const { days, hours, minutes } = resetParts(value, now)
  if (days) return `${days}d${hours}h`
  if (hours) return `${hours}h${minutes}m`
  return `${minutes}m`
}

/** Formats compact reset countdown with imminent flag for account list rows. */
export function formatResetCountdown(
  value: number,
  now = Date.now(),
): { text: string; imminent: boolean } {
  if (value <= now) return { text: '即将重置', imminent: true }
  return { text: formatCompactResetTime(value, now), imminent: false }
}

/** Normalizes subscription plan names for display badges. */
export function planLabel(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('ultra')) return 'Ultra'
  if (normalized.includes('pro')) return 'Pro'
  if (normalized.includes('free')) return 'Free'
  if (normalized === 'plus') return 'Plus'
  if (normalized === 'team') return 'Team'
  return value.trim()
}

/** Formats a rate-limit window duration such as 5h or 7d, returning null when unavailable. */
export function formatWindowLabel(
  window: AccountUsageWindow | null,
  fallback?: string,
): string | null {
  const minutes = window?.windowMinutes
  if (minutes && minutes > 0) {
    if (minutes % 1_440 === 0) return `${minutes / 1_440}d`
    if (minutes % 60 === 0) return `${minutes / 60}h`
    return `${minutes}m`
  }
  return fallback ?? null
}

/** Whether the account uses dual 5h/7d rate-limit windows. */
export function supportsDualQuota(account: AccountProfile): boolean {
  return (
    account.accountType === 'oauth' &&
    (account.product === 'codex' ||
      (account.product === 'pi' && account.providerKey === 'openai-codex'))
  )
}
