import { Fragment } from 'react'
import { useSortable } from '@dnd-kit/react/sortable'
import { Claude, Grok, OpenAI } from '@lobehub/icons'
import {
  ArrowLeftRight,
  Ellipsis,
  GripVertical,
  LoaderCircle,
  Pencil,
  RefreshCw,
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

const PRODUCT_ICONS = { claude: Claude, codex: OpenAI, grok: Grok, pi: OpenAI }

export function AccountRow({
  account,
  index,
  busy,
  disabled,
  sortingDisabled,
  onSwitch,
  onRename,
  onRefresh,
  onDelete,
}: {
  account: AccountProfile
  index: number
  busy?: string
  disabled: boolean
  sortingDisabled: boolean
  onSwitch: () => void
  onRename: () => void
  onRefresh: () => void
  onDelete: () => void
}) {
  const { ref, handleRef, isDragging, isDropping } = useSortable({
    id: account.id,
    index,
    disabled: sortingDisabled || account.isActive,
    data: { title: account.alias },
    transition: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? null
      : { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', idle: true },
  })
  const Icon =
    account.product === 'pi' && account.providerKey === 'xai'
      ? Grok
      : PRODUCT_ICONS[account.product]

  return (
    <li
      ref={ref}
      className="account-row flex h-17 items-center gap-3 px-2 py-3"
      data-active={account.isActive}
      data-busy={busy?.endsWith(`:${account.id}`) || undefined}
      data-dragging={isDragging || undefined}
      data-dropping={isDropping || undefined}
    >
      <button
        ref={handleRef}
        className="account-drag-handle shrink-0 touch-none cursor-grab active:cursor-grabbing"
        type="button"
        aria-label={`拖动 ${account.alias} 排序`}
        disabled={sortingDisabled || account.isActive}
      >
        <GripVertical className="account-drag-icon" size={18} aria-hidden="true" />
      </button>
      <div className="account-avatar grid size-9 shrink-0 place-items-center" aria-hidden="true">
        {account.accountType === 'oauth' ? (
          <Icon className="account-provider-icon size-5" />
        ) : (
          <span className="account-avatar-initial">
            {(account.alias || account.email || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
      </div>
      <div className="account-row-body min-w-0 flex-1">
        <div className="account-row-heading mb-0.5 flex min-w-0 items-center gap-2">
          <strong
            className="account-row-name truncate [unicode-bidi:plaintext]"
            title={account.alias}
          >
            {account.alias}
          </strong>
          {account.needsReauthorization && (
            <Badge className="account-expired-badge" variant="destructive">
              已过期
            </Badge>
          )}
          {account.planType && (
            <Badge className="account-plan-badge" variant="outline">
              {planLabel(account.planType)}
            </Badge>
          )}
          {account.isActive && <Badge className="account-active-badge">使用中</Badge>}
        </div>
        <AccountMeta account={account} />
      </div>
      <div className="account-row-actions flex min-w-10 shrink-0 justify-end gap-1">
        {!account.isActive && (
          <Tooltip>
            <TooltipTrigger render={<span className="account-switch-trigger inline-flex" />}>
              <Button
                className="account-switch-button"
                size="icon-lg"
                aria-label={`切换 ${account.alias}`}
                disabled={disabled || !!account.switchUnavailable}
                onClick={onSwitch}
              >
                {busy === `switch:${account.id}` ? (
                  <LoaderCircle className="account-switch-icon animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowLeftRight className="account-switch-icon" aria-hidden="true" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="account-switch-tooltip">
              {account.switchUnavailable || '切换'}
            </TooltipContent>
          </Tooltip>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className="account-menu-button"
                variant="ghost"
                size="icon-lg"
                aria-label={`管理 ${account.alias}`}
                disabled={disabled}
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
              {account.accountType === 'oauth' && (
                <DropdownMenuItem className="account-refresh-menu-item" onClick={onRefresh}>
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
    </li>
  )
}

function AccountMeta({ account }: { account: AccountProfile }) {
  const items: { key: string; label: string; destructive?: boolean }[] = []
  if (account.accountType === 'relay') {
    if (account.apiBaseUrl) items.push({ key: 'api', label: account.apiBaseUrl })
  } else if (account.product === 'claude') {
    if (account.email) items.push({ key: 'email', label: account.email })
    if (account.needsReauthorization) items.push({ key: 'reauthorize', label: '需重新授权' })
  } else {
    if ((account.product === 'grok' || account.product === 'pi') && account.email)
      items.push({ key: 'email', label: account.email })
    for (const [index, window] of [account.usagePrimary, account.usageSecondary].entries()) {
      if (!window) continue
      const remaining = Math.round(Math.max(0, Math.min(100, 100 - window.usedPercent)))
      items.push({
        key: `usage-${index}`,
        label: `${remaining}% 剩余`,
        destructive: remaining <= 10,
      })
      if (window.resetsAt !== null)
        items.push({ key: `reset-${index}`, label: formatResetTime(window.resetsAt) })
    }
    if (!account.usageUpdatedAt) items.push({ key: 'empty', label: '额度未查询' })
    else if (account.product === 'grok' && !account.usagePrimary)
      items.push({ key: 'unavailable', label: '官方未返回额度百分比' })
  }

  return (
    <div className="account-row-meta mt-1.5 flex min-w-0 flex-wrap items-center gap-y-1">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 && (
            <Separator orientation="vertical" className="account-meta-separator mx-2 h-3" />
          )}
          <span
            className="account-meta-item min-w-0 truncate tabular-nums"
            data-destructive={item.destructive || undefined}
            title={item.label}
          >
            {item.label}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

function formatResetTime(value: number) {
  const totalMinutes = Math.max(0, Math.ceil((value - Date.now()) / 60_000))
  const days = Math.floor(totalMinutes / 1_440)
  const hours = Math.floor((totalMinutes % 1_440) / 60)
  const minutes = totalMinutes % 60
  if (days) return `${days}d ${hours}h 后重置`
  if (hours) return `${hours}h ${minutes}m 后重置`
  return `${minutes}m 后重置`
}

function planLabel(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('ultra')) return 'Ultra'
  if (normalized.includes('pro')) return 'Pro'
  if (normalized.includes('free')) return 'Free'
  if (normalized === 'plus') return 'Plus'
  if (normalized === 'team') return 'Team'
  return value.trim()
}
