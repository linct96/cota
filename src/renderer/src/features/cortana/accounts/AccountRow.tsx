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
import {
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
  deleting,
  renaming,
  refreshing,
  refreshError,
  operationError,
  sortingDisabled,
  onSwitch,
  onRename,
  onRefresh,
  onDelete,
}: {
  account: AccountProfile
  index: number
  now: number
  switching: boolean
  deleting: boolean
  renaming: boolean
  refreshing: boolean
  refreshError?: string
  operationError?: string
  sortingDisabled: boolean
  onSwitch: () => void
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

  return (
    <li
      ref={ref}
      className="account-row flex min-h-17 items-center gap-3 px-2 py-3"
      data-busy={refreshing || switching || deleting || renaming || undefined}
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
          {refreshing && (
            <output className="account-refresh-status inline-flex shrink-0">
              <LoaderCircle
                className="account-refresh-spinner size-3.5 motion-safe:animate-spin"
                aria-hidden="true"
              />
              <span className="account-refresh-status-label sr-only">
                {account.product === 'claude' ? '正在更新登录令牌' : '正在刷新额度'}
              </span>
            </output>
          )}
          {(renaming || deleting) && (
            <output className="account-operation-status inline-flex shrink-0">
              <LoaderCircle
                className="account-operation-spinner size-3.5 motion-safe:animate-spin"
                aria-hidden="true"
              />
              <span className="account-operation-status-label sr-only">
                {deleting ? '正在删除账号' : '正在保存名称'}
              </span>
            </output>
          )}
          {(refreshError || operationError) && (
            <Badge
              className="account-operation-error"
              variant="destructive"
              title={operationError || refreshError}
              aria-label={`操作失败：${operationError || refreshError}`}
            >
              操作失败
            </Badge>
          )}
          {account.needsReauthorization && (
            <Badge className="account-expired-badge" variant="destructive">
              已过期
            </Badge>
          )}
          {account.accountType === 'relay' ? (
            <Badge className="account-plan-badge" variant="outline">
              API
            </Badge>
          ) : (
            account.planType && (
              <Badge className="account-plan-badge" variant="outline">
                {planLabel(account.planType)}
              </Badge>
            )
          )}
          {account.isActive && <Badge className="account-active-badge">使用中</Badge>}
        </div>
        <AccountMeta account={account} now={now} />
      </div>
      <div className="account-row-actions flex min-w-10 shrink-0 justify-end gap-1">
        {!account.isActive && (
          <Tooltip>
            <TooltipTrigger render={<span className="account-switch-trigger inline-flex" />}>
              <Button
                className="account-switch-button"
                size="icon-lg"
                aria-label={`切换 ${account.alias}`}
                disabled={switching || deleting || !!account.switchUnavailable}
                onClick={onSwitch}
              >
                {switching ? (
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
                disabled={deleting}
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
    </li>
  )
}

function AccountMeta({ account, now }: { account: AccountProfile; now: number }) {
  const items: { key: string; label: string; destructive?: boolean }[] = []
  if (account.accountType === 'relay') {
    if (account.apiBaseUrl) items.push({ key: 'api', label: account.apiBaseUrl })
  } else if (account.product === 'claude') {
    if (account.email) items.push({ key: 'email', label: account.email })
    if (account.needsReauthorization) items.push({ key: 'reauthorize', label: '需重新授权' })
  } else {
    if (account.email) items.push({ key: 'email', label: account.email })
    const dualQuota = supportsDualQuota(account)
    for (const [index, window] of [account.usagePrimary, account.usageSecondary].entries()) {
      if (!window) continue
      const remaining = remainingQuotaPercent(window.usedPercent)
      const windowTag = formatWindowLabel(
        window,
        dualQuota ? (index === 0 ? '5h' : '7d') : undefined,
      )
      const prefix = windowTag ? `${windowTag} ` : ''
      const resetSuffix =
        window.resetsAt !== null ? ` (${formatResetTime(window.resetsAt, now)})` : ''
      items.push({
        key: `usage-${index}`,
        label: `${prefix}${remaining}% 剩余${resetSuffix}`,
        destructive: remaining <= 10,
      })
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
