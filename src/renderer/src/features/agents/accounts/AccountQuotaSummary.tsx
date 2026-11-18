import { OpenAI } from '@lobehub/icons'
import type { AccountProfile, AccountUsageWindow } from '../../../../../shared/accounts'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  LOW_QUOTA_THRESHOLD,
  formatCompactResetTime,
  formatWindowLabel,
  planLabel,
  remainingQuotaPercent,
  windowTimeProgress,
} from './account-format'

const BLOCK_COUNT = 28
const FIVE_HOURS_MINUTES = 300
const SEVEN_DAYS_MINUTES = 10_080

type CellState = 'full' | 'half' | 'empty' | 'unknown'

function computeCellStates(percent: number | null): CellState[] {
  if (percent === null) return Array.from({ length: BLOCK_COUNT }, () => 'unknown')
  const exact = (Math.max(0, Math.min(100, percent)) / 100) * BLOCK_COUNT
  const fullCount = Math.floor(exact)
  const remainder = exact - fullCount
  return Array.from({ length: BLOCK_COUNT }, (_, index) => {
    if (index < fullCount) return 'full'
    if (index === fullCount && remainder >= 0.35) return 'half'
    return 'empty'
  })
}

/** Displays the active account's 5h and 7d quota as terminal block progress bars. */
export function AccountQuotaSummary({ account, now }: { account: AccountProfile; now: number }) {
  const primaryRemaining = account.usagePrimary
    ? remainingQuotaPercent(account.usagePrimary.usedPercent)
    : null
  const secondaryRemaining = account.usageSecondary
    ? remainingQuotaPercent(account.usageSecondary.usedPercent)
    : null
  const lowQuota =
    (primaryRemaining !== null && primaryRemaining <= LOW_QUOTA_THRESHOLD) ||
    (secondaryRemaining !== null && secondaryRemaining <= LOW_QUOTA_THRESHOLD)

  return (
    <section
      className="account-quota-summary flex items-center gap-4 px-3.5 py-2.5"
      aria-label={`当前账号额度：${account.alias}`}
      data-low={lowQuota || undefined}
    >
      <div className="account-quota-identity flex w-60 shrink-0 items-center gap-3 border-r pr-4">
        {/* shortcut: dual-quota summaries only support OpenAI accounts; share provider icons if expanded. */}
        <div className="account-quota-avatar account-avatar grid size-9 shrink-0 place-items-center">
          <OpenAI className="account-quota-provider-icon size-5" aria-label="OpenAI" />
        </div>
        <div className="account-quota-profile flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="account-quota-heading flex min-w-0 items-center gap-1.5">
            <strong
              className="account-quota-name truncate [unicode-bidi:plaintext]"
              title={account.alias}
            >
              {account.alias}
            </strong>
            {account.planType && (
              <Badge className="account-quota-plan shrink-0" variant="outline">
                {planLabel(account.planType)}
              </Badge>
            )}
          </div>
          {account.email && (
            <span className="account-quota-email truncate tabular-nums" title={account.email}>
              {account.email}
            </span>
          )}
        </div>
      </div>

      <div className="account-quota-meters flex min-w-0 flex-1 flex-col gap-1.5">
        <QuotaWindowRow
          label={formatWindowLabel(account.usagePrimary, '5h') ?? '5h'}
          window={account.usagePrimary}
          defaultMinutes={FIVE_HOURS_MINUTES}
          markerPosition="top"
          now={now}
        />
        <QuotaWindowRow
          label={formatWindowLabel(account.usageSecondary, '7d') ?? '7d'}
          window={account.usageSecondary}
          defaultMinutes={SEVEN_DAYS_MINUTES}
          markerPosition="bottom"
          now={now}
        />
      </div>
    </section>
  )
}

function QuotaWindowRow({
  label,
  window,
  defaultMinutes,
  markerPosition,
  now,
}: {
  label: string
  window: AccountUsageWindow | null
  defaultMinutes: number
  markerPosition: 'top' | 'bottom'
  now: number
}) {
  const remaining = window ? remainingQuotaPercent(window.usedPercent) : null
  const timeProgress = windowTimeProgress(window, defaultMinutes, now)
  const cells = computeCellStates(remaining)
  const resetText =
    window && window.resetsAt !== null ? formatCompactResetTime(window.resetsAt, now) : '--'

  const timeLane = (
    <div className="account-quota-time-lane" data-pos={markerPosition}>
      {timeProgress !== null && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="account-quota-time-marker"
                style={{ left: `${timeProgress}%` }}
                aria-label={`${label} 剩余时间 ${Math.round(timeProgress)}%`}
              />
            }
          >
            <TimeTriangle direction={markerPosition === 'top' ? 'down' : 'up'} />
          </TooltipTrigger>
          <TooltipContent className="account-quota-time-tooltip">
            {`${label} 剩余时间 ${Math.round(timeProgress)}%`}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )

  return (
    <div className="account-quota-row grid items-center gap-2.5" data-marker={markerPosition}>
      <progress
        className="sr-only"
        max={100}
        value={remaining ?? undefined}
        aria-label={`${label} 剩余额度`}
      />
      <span className="account-quota-label">{label}</span>

      <div className="account-quota-track-slot flex min-w-0 flex-col">
        {markerPosition === 'top' && timeLane}
        <div className="account-quota-track" aria-hidden="true">
          {cells.map((cellState, index) => (
            <span key={index} className="account-quota-cell" data-state={cellState} />
          ))}
        </div>
        {markerPosition === 'bottom' && timeLane}
      </div>

      <div className="account-quota-readout flex items-baseline justify-end gap-2 tabular-nums">
        <span className="account-quota-percent">
          {remaining === null ? '--%' : `${remaining}%`}
        </span>
        <span className="account-quota-reset">{resetText}</span>
      </div>
    </div>
  )
}

function TimeTriangle({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true">
      <polygon points={direction === 'down' ? '0,0 8,0 4,5' : '4,0 8,5 0,5'} fill="currentColor" />
    </svg>
  )
}
