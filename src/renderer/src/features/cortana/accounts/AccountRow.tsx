import { Fragment } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { Claude, Grok, OpenAI } from '@lobehub/icons'
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Ellipsis,
  GripVertical,
  LoaderCircle,
  LogOut,
  Pencil,
  RefreshCw,
  RotateCw,
  Trash2,
} from 'lucide-react'
import type { AccountProfile } from '../../../../../shared/accounts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  LOW_QUOTA_THRESHOLD,
  formatResetCountdown,
  formatResetTime,
  formatWindowLabel,
  planLabel,
  remainingQuotaPercent,
  supportsDualQuota,
} from './account-format'

const PRODUCT_ICONS = { claude: Claude, codex: OpenAI, grok: Grok, pi: OpenAI }

export function AccountRow({
  account,
  index,
  now,
  switching,
  deactivating,
  deleting,
  renaming,
  refreshing,
  refreshError,
  operationError,
  sortingDisabled,
  onSwitch,
  onDeactivate,
  onRename,
  onRefresh,
  onDelete,
}: {
  account: AccountProfile
  index: number
  now: number
  switching: boolean
  deactivating: boolean
  deleting: boolean
  renaming: boolean
  refreshing: boolean
  refreshError?: string
  operationError?: string
  sortingDisabled: boolean
  onSwitch: () => void
  onDeactivate: () => void
  onRename: () => void
  onRefresh: () => void
  onDelete: () => void
}) {
  const { ref, handleRef, isDragging, isDropping } = useSortable({
    id: account.id,
    index,
    disabled: sortingDisabled,
    data: { title: account.alias },
    transition: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? null
      : { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', idle: true },
  })
  const Icon =
    account.product === 'pi' && account.providerKey === 'xai'
      ? Grok
      : PRODUCT_ICONS[account.product]
  const siwc = account.product === 'pi' && account.providerKey === 'openai'
  const canRefresh = account.accountType === 'oauth' && !siwc
  const rowError = operationError || refreshError
  const canRetryRefresh = !!refreshError && !operationError && canRefresh
  const supportsQuota = account.accountType !== 'relay' && account.product !== 'claude' && !siwc
  const hasRightQuota =
    !!rowError ||
    (supportsQuota &&
      (!!account.usagePrimary ||
        !!account.usageSecondary ||
        !account.usageUpdatedAt ||
        (account.product === 'grok' && !account.usagePrimary)))
  const showAvatarRing = refreshing || renaming || deleting
  const statusAnnouncement = [
    refreshing && (account.product === 'claude' ? '正在更新登录令牌' : '正在刷新额度'),
    renaming && '正在保存名称',
    deleting && '正在删除账号',
  ]
    .filter(Boolean)
    .join('，')

  return (
    <li
      ref={ref}
      className="account-row flex min-h-17 items-center gap-3 px-2 py-3"
      data-busy={switching || deactivating || undefined}
      data-dragging={isDragging || undefined}
      data-dropping={isDropping || undefined}
    >
      <button
        ref={handleRef}
        className="account-drag-handle shrink-0 touch-none cursor-grab active:cursor-grabbing"
        type="button"
        aria-label={`拖动 ${account.alias} 排序`}
        disabled={sortingDisabled}
      >
        <GripVertical className="account-drag-icon" size={18} aria-hidden="true" />
      </button>
      <div
        className="account-avatar relative grid size-9 shrink-0 place-items-center"
        aria-hidden="true"
      >
        {showAvatarRing && (
          <span
            className="account-avatar-ring pointer-events-none absolute -inset-0.5 motion-safe:animate-spin"
            data-variant={deleting ? 'destructive' : undefined}
          />
        )}
        {account.accountType === 'oauth' ? (
          <Icon className="account-provider-icon size-5" />
        ) : (
          <span className="account-avatar-initial">
            {(account.alias || account.email || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <div className="account-row-content flex min-w-0 flex-1 items-center gap-5">
        <div className="account-row-body min-w-0 flex-1">
          {statusAnnouncement && (
            <output className="account-row-status sr-only">{statusAnnouncement}</output>
          )}
          <div className="account-row-heading mb-0.5 flex min-w-0 items-center gap-2">
            <strong
              className="account-row-name min-w-0 truncate [unicode-bidi:plaintext]"
              title={account.alias}
            >
              {account.alias}
            </strong>
            {account.needsReauthorization && (
              <Badge className="account-expired-badge shrink-0" variant="destructive">
                已过期
              </Badge>
            )}
            {siwc && (
              <Badge className="account-provider-badge shrink-0" variant="outline">
                SIWC
              </Badge>
            )}
            {account.accountType === 'relay' ? (
              <Badge className="account-plan-badge shrink-0" variant="outline">
                API
              </Badge>
            ) : (
              account.planType && (
                <Badge className="account-plan-badge shrink-0" variant="outline">
                  {planLabel(account.planType)}
                </Badge>
              )
            )}
            {account.isActive && <Badge className="account-active-badge shrink-0">使用中</Badge>}
          </div>
          <AccountMeta account={account} />
        </div>
        <div
          className="account-row-right flex shrink-0 items-center gap-4.5"
          data-has-quota={hasRightQuota || undefined}
        >
          <AccountQuotaBlock
            account={account}
            now={now}
            error={rowError}
            supportsQuota={supportsQuota}
            canRetryRefresh={canRetryRefresh}
            refreshing={refreshing}
            deleting={deleting}
            onRefresh={onRefresh}
          />
          {hasRightQuota && (
            <Separator orientation="vertical" className="account-row-separator h-5 shrink-0" />
          )}
          <div className="account-row-actions flex shrink-0 items-center justify-end gap-1">
            <div className="account-row-primary-action flex justify-end">
              {!account.isActive ? (
                account.needsReauthorization && canRefresh && !account.switchUnavailable ? (
                  <Button
                    className="account-reauthorize-button"
                    variant="outline"
                    size="default"
                    aria-label={`更新 ${account.alias} 登录令牌`}
                    aria-busy={refreshing}
                    disabled={refreshing || deleting}
                    onClick={onRefresh}
                  >
                    <RefreshCw
                      className={
                        refreshing
                          ? 'account-reauthorize-icon motion-safe:animate-spin'
                          : 'account-reauthorize-icon'
                      }
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                    更新
                  </Button>
                ) : account.switchUnavailable ? (
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="account-switch-trigger inline-flex" />}
                    >
                      <Button
                        className="account-switch-button"
                        variant="outline"
                        size="default"
                        aria-label={`切换 ${account.alias}`}
                        focusableWhenDisabled
                        disabled
                      >
                        <ArrowLeftRight
                          className="account-switch-icon"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />
                        切换
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="account-switch-tooltip">
                      {account.switchUnavailable}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Button
                    className="account-switch-button"
                    variant="outline"
                    size="default"
                    aria-label={`切换 ${account.alias}`}
                    disabled={switching || deleting}
                    onClick={onSwitch}
                  >
                    {switching ? (
                      <LoaderCircle
                        className="account-switch-icon motion-safe:animate-spin"
                        data-icon="inline-start"
                        aria-hidden="true"
                      />
                    ) : (
                      <ArrowLeftRight
                        className="account-switch-icon"
                        data-icon="inline-start"
                        aria-hidden="true"
                      />
                    )}
                    切换
                  </Button>
                )
              ) : account.product === 'pi' ? (
                <Button
                  className="account-deactivate-button"
                  variant="outline"
                  size="default"
                  aria-label={`停用 ${account.alias}`}
                  aria-busy={deactivating}
                  disabled={switching || deactivating || deleting}
                  onClick={onDeactivate}
                >
                  {deactivating ? (
                    <LoaderCircle
                      className="account-deactivate-icon motion-safe:animate-spin"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                  ) : (
                    <LogOut
                      className="account-deactivate-icon"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                  )}
                  停用
                </Button>
              ) : (
                <span className="account-row-active-indicator inline-flex items-center gap-1">
                  <Check className="account-row-active-icon size-3 shrink-0" aria-hidden="true" />
                  <span>当前</span>
                </span>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    className="account-menu-button"
                    variant="ghost"
                    size="icon"
                    aria-label={`管理 ${account.alias}`}
                    disabled={deactivating || deleting}
                  />
                }
              >
                <Ellipsis className="account-menu-icon" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="account-menu-content" align="end">
                <DropdownMenuGroup className="account-menu-group">
                  <DropdownMenuItem className="account-rename-menu-item" onClick={onRename}>
                    <Pencil className="account-rename-icon" aria-hidden="true" />
                    重命名
                  </DropdownMenuItem>
                  {canRefresh && (
                    <DropdownMenuItem
                      className="account-refresh-menu-item"
                      disabled={refreshing || deleting}
                      aria-busy={refreshing}
                      onClick={onRefresh}
                    >
                      <RefreshCw className="account-refresh-icon" aria-hidden="true" />
                      {account.product === 'claude' ? '更新登录令牌' : '刷新额度'}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="account-delete-menu-item"
                    variant="destructive"
                    onClick={onDelete}
                  >
                    <Trash2 className="account-delete-icon" aria-hidden="true" />
                    删除
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </li>
  )
}

function AccountMeta({ account }: { account: AccountProfile }) {
  const items: { key: string; label: string }[] = []
  if (account.accountType === 'relay') {
    if (account.apiBaseUrl) items.push({ key: 'api', label: account.apiBaseUrl })
  } else if (account.product === 'claude') {
    if (account.email) items.push({ key: 'email', label: account.email })
    if (account.needsReauthorization) items.push({ key: 'reauthorize', label: '需重新授权' })
  } else if (account.email) {
    items.push({ key: 'email', label: account.email })
  }

  if (!items.length) return null
  return (
    <div className="account-row-meta mt-1.5 flex min-w-0 flex-wrap items-center gap-y-1">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 && (
            <Separator orientation="vertical" className="account-meta-separator mx-2 h-3" />
          )}
          <span className="account-meta-item min-w-0 truncate tabular-nums" title={item.label}>
            {item.label}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

function AccountQuotaBlock({
  account,
  now,
  error,
  supportsQuota,
  canRetryRefresh,
  refreshing,
  deleting,
  onRefresh,
}: {
  account: AccountProfile
  now: number
  error?: string
  supportsQuota: boolean
  canRetryRefresh: boolean
  refreshing: boolean
  deleting: boolean
  onRefresh: () => void
}) {
  const dualQuota = supportsDualQuota(account)
  const windows = supportsQuota
    ? [account.usagePrimary, account.usageSecondary]
        .map((window, index) => {
          if (!window) return null
          const remaining = remainingQuotaPercent(window.usedPercent)
          const windowLabel =
            formatWindowLabel(window, dualQuota ? (index === 0 ? '5h' : '7d') : undefined) ?? '额度'
          const reset = window.resetsAt !== null ? formatResetCountdown(window.resetsAt, now) : null
          const resetTitle =
            window.resetsAt !== null
              ? reset?.imminent
                ? '即将重置'
                : formatResetTime(window.resetsAt, now)
              : undefined
          return {
            key: `usage-${index}`,
            windowLabel,
            remaining,
            reset,
            resetTitle,
            low: remaining <= LOW_QUOTA_THRESHOLD,
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    : []

  if (error) {
    return (
      <div className="account-row-error-box flex min-w-0 flex-col items-end gap-0.5">
        <div className="account-row-error-header flex items-center gap-1.5">
          <AlertTriangle className="account-row-error-icon size-3 shrink-0" aria-hidden="true" />
          <p className="account-row-error line-clamp-1 wrap-break-word" title={error}>
            {error}
          </p>
          {canRetryRefresh && (
            <Button
              className="account-row-retry-button"
              variant="ghost"
              size="xs"
              disabled={refreshing || deleting}
              onClick={onRefresh}
            >
              重试
            </Button>
          )}
        </div>
        {windows.length > 0 && (
          <span className="account-row-cached-quota tabular-nums">
            上次：{windows.map((item) => `${item.windowLabel} ${item.remaining}%`).join(' · ')}
          </span>
        )}
      </div>
    )
  }

  if (!supportsQuota) return null

  if (windows.length) {
    return (
      <div className="account-row-quota-list flex flex-col">
        {windows.map((item) => (
          <div key={item.key} className="account-row-quota-item">
            <span className="account-row-quota-label">{item.windowLabel}</span>
            <div className="account-row-quota-bar" aria-hidden="true">
              <div
                className="account-row-quota-bar-fill"
                data-low={item.low || undefined}
                style={{ width: `${item.remaining}%` }}
              />
            </div>
            <span
              className="account-row-quota-percent tabular-nums"
              data-low={item.low || undefined}
              aria-label={`${item.windowLabel} 剩余 ${item.remaining}%`}
            >
              {item.remaining}%
            </span>
            {item.reset ? (
              <span
                className="account-row-quota-reset inline-flex items-center justify-start gap-1 tabular-nums"
                data-imminent={item.reset.imminent || undefined}
                title={item.resetTitle}
              >
                <RotateCw
                  className="account-row-quota-reset-icon size-2.5 shrink-0"
                  aria-hidden="true"
                />
                <span>{item.reset.text}</span>
                {!item.reset.imminent && <span className="sr-only">后重置</span>}
              </span>
            ) : (
              <span className="account-row-quota-reset-placeholder" aria-hidden="true" />
            )}
          </div>
        ))}
      </div>
    )
  }

  const emptyLabel = !account.usageUpdatedAt
    ? '额度未查询'
    : account.product === 'grok' && !account.usagePrimary
      ? '官方未返回额度百分比'
      : ''
  if (!emptyLabel) return null

  return <span className="account-row-quota-empty truncate">{emptyLabel}</span>
}
