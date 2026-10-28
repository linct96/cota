const relativeTime = new Intl.RelativeTimeFormat('en', { style: 'narrow' })
const units = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1],
] as const

export function formatRelativeTime(date: string, now = Date.now()): string {
  const seconds = (Date.parse(date) - now) / 1000
  if (!Number.isFinite(seconds)) return '时间未知'
  for (const [unit, duration] of units) {
    if (Math.abs(seconds) >= duration)
      return relativeTime.format(Math.trunc(seconds / duration), unit)
  }
  return 'just now'
}
