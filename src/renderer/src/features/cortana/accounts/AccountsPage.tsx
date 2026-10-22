import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  LogIn,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ACCOUNT_PRODUCTS,
  type AccountProduct,
  type AccountProfile,
  type AccountStatus,
  type AccountUsageWindow,
} from '../../../../../shared/accounts'
import { unwrap } from '../../../../../shared/contracts'
import { cn } from '../../../lib/utils'
import { Alert, AlertDescription } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '../../../components/ui/empty'
import { Input } from '../../../components/ui/input'
import { useCortana } from '../cortana-store'
import { AddAccountDialog, RenameAccountDialog } from './AccountDialogs'

type Confirmation = { kind: 'switch' | 'delete'; account: AccountProfile } | { kind: 'import' }
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '账号操作失败，请稍后重试。'

export function AccountsPage() {
  const product = useCortana((state) => state.activeProduct)
  return <ProductAccountsPage key={product} product={product} />
}

function ProductAccountsPage({ product }: { product: AccountProduct }) {
  const setAgentSwitchBlocked = useCortana((state) => state.setAgentSwitchBlocked)
  const [status, setStatus] = useState<AccountStatus>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string>()
  const busyRef = useRef(false)
  const request = useRef(0)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<AccountProfile>()
  const [confirmation, setConfirmation] = useState<Confirmation>()
  const cancelButton = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    setAgentSwitchBlocked(!!busy || addOpen || !!editing || !!confirmation)
    return () => setAgentSwitchBlocked(false)
  }, [busy, addOpen, editing, confirmation, setAgentSwitchBlocked])

  const reload = useCallback(async () => {
    const version = ++request.current
    setLoading(true)
    try {
      const next = unwrap(await window.desktop.accounts.list(product))
      if (version === request.current) {
        setStatus(next)
        setError(undefined)
      }
    } catch (cause) {
      if (version === request.current) setError(errorText(cause))
    } finally {
      if (version === request.current) setLoading(false)
    }
  }, [product])

  useEffect(() => {
    setStatus(undefined)
    void reload()
    return () => {
      request.current++
    }
  }, [reload])

  const perform = useCallback(
    async (label: string, action: () => Promise<unknown>, notice?: string) => {
      if (busyRef.current) return false
      busyRef.current = true
      setBusy(label)
      setError(undefined)
      try {
        await action()
        await reload()
        if (notice) toast.success(notice)
        return true
      } catch (cause) {
        setError(errorText(cause))
        return false
      } finally {
        busyRef.current = false
        setBusy(undefined)
      }
    },
    [reload],
  )

  const added = useCallback(() => {
    setAddOpen(false)
    void reload()
    toast.success('账号已保存。')
  }, [reload])
  const renamed = useCallback(() => {
    setEditing(undefined)
    void reload()
  }, [reload])

  async function switchAccount(account: AccountProfile, force = false) {
    if (status?.authState === 'unmanaged' && !force) {
      setConfirmation({ kind: 'switch', account })
      return
    }
    const done = await perform(
      `switch:${account.id}`,
      async () => unwrap(await window.desktop.accounts.switch({ id: account.id, force })),
      '账号已切换。正在运行的 CLI 可能需要重新启动以使用新登录。',
    )
    if (done) setConfirmation(undefined)
  }

  async function confirm() {
    if (!confirmation || busyRef.current) return
    if (confirmation.kind === 'switch') {
      await switchAccount(confirmation.account, true)
      return
    }
    const done =
      confirmation.kind === 'delete'
        ? await perform(
            'delete',
            async () => unwrap(await window.desktop.accounts.remove(confirmation.account.id)),
            '账号已删除。',
          )
        : await perform('import-cortana', async () => {
            const count = unwrap(await window.desktop.accounts.importCortana())
            toast.success(count ? `已从 Cortana 导入 ${count} 个账号。` : '没有需要导入的新账号。')
          })
    if (done) setConfirmation(undefined)
  }

  async function move(account: AccountProfile, delta: number) {
    if (!status) return
    const ids = status.profiles.map((profile) => profile.id)
    const index = ids.indexOf(account.id)
    const next = index + delta
    if (next < 0 || next >= ids.length) return
    ;[ids[index], ids[next]] = [ids[next], ids[index]]
    await perform('reorder', async () =>
      unwrap(await window.desktop.accounts.reorder(product, ids)),
    )
  }

  const query = search.trim().toLowerCase()
  const profiles =
    status?.profiles.filter((account) =>
      [account.alias, account.email, account.apiBaseUrl, account.planType].some((value) =>
        value?.toLowerCase().includes(query),
      ),
    ) ?? []
  const active = status?.profiles.filter((account) => account.isActive) ?? []

  return (
    <section
      className="accounts-page flex min-h-0 flex-1 flex-col"
      aria-label="账号管理"
      aria-busy={loading || !!busy}
    >
      <header className="accounts-header flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div className="accounts-heading flex min-w-0 flex-col gap-1">
          <h2 className="accounts-title text-sm font-medium">账号管理</h2>
          <p className="accounts-description text-xs text-app-muted-foreground">
            管理本机 CLI 账号与登录状态
          </p>
        </div>
        <div className="accounts-actions flex flex-wrap items-center gap-2">
          {status?.cortanaAvailable && (
            <Button
              className="accounts-import-cortana"
              variant="outline"
              disabled={!!busy || loading}
              onClick={() => setConfirmation({ kind: 'import' })}
            >
              <Download
                className="accounts-import-icon"
                data-icon="inline-start"
                aria-hidden="true"
              />
              导入 Cortana
            </Button>
          )}
          <Button
            className="accounts-add-button"
            disabled={!!busy || loading}
            onClick={() => setAddOpen(true)}
          >
            <Plus className="accounts-add-icon" data-icon="inline-start" aria-hidden="true" />
            添加账号
          </Button>
        </div>
      </header>
      <div className="accounts-scroll-area flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {error && (
          <Alert className="accounts-error" variant="destructive">
            <AlertDescription className="accounts-error-message flex flex-wrap items-center justify-between gap-2">
              <span className="accounts-error-text">{error}</span>
              <Button
                className="accounts-error-retry"
                variant="outline"
                size="sm"
                disabled={!!busy || loading}
                onClick={() => void reload()}
              >
                重新加载
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {loading && !status ? (
          <Empty className="accounts-loading">
            <EmptyHeader className="accounts-loading-header">
              <RefreshCw className="accounts-loading-icon size-4 animate-spin" aria-hidden="true" />
              <EmptyTitle className="accounts-loading-title">正在加载账号…</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          status && (
            <>
              <Card className="accounts-current-card gap-3 p-4 shadow-none">
                <div className="accounts-current-heading flex flex-wrap items-center justify-between gap-3">
                  <div className="accounts-current-summary flex min-w-0 flex-col gap-1">
                    <div className="accounts-current-label-row flex items-center gap-2">
                      <span className="accounts-current-label text-xs text-app-muted-foreground">
                        当前登录
                      </span>
                      <Badge className="accounts-current-state" variant="secondary">
                        {status.authState === 'managed'
                          ? '已保存'
                          : status.authState === 'missing'
                            ? '未登录'
                            : '未保存'}
                      </Badge>
                    </div>
                    <p className="accounts-current-name truncate text-sm font-medium">
                      {active.length
                        ? active.map((account) => account.alias).join('、')
                        : status.authState === 'missing'
                          ? `尚未登录 ${ACCOUNT_PRODUCTS[product].name}`
                          : '检测到其他登录状态'}
                    </p>
                  </div>
                  <Button
                    className="accounts-import-current"
                    variant="outline"
                    disabled={!!busy || status.authState === 'missing'}
                    onClick={() =>
                      void perform('import-current', async () => {
                        const count = unwrap(await window.desktop.accounts.importCurrent(product))
                        toast.success(`已同步 ${count} 个账号。`)
                      })
                    }
                  >
                    <LogIn
                      className="accounts-import-current-icon"
                      data-icon="inline-start"
                      aria-hidden="true"
                    />
                    导入当前登录
                  </Button>
                </div>
                <p className="accounts-auth-message text-xs text-app-muted-foreground">
                  {status.authMessage}
                </p>
                <p
                  className="accounts-auth-path break-all text-xs text-app-muted-foreground"
                  title={status.authPath}
                >
                  {status.authPath}
                </p>
              </Card>
              <div className="accounts-list-toolbar flex flex-wrap items-center justify-between gap-2">
                <h3 className="accounts-list-title text-xs font-medium">
                  已保存账号（{status.profiles.length}）
                </h3>
                <div className="accounts-list-tools flex items-center gap-2">
                  <div className="accounts-search relative">
                    <Search
                      className="accounts-search-icon pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-app-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      className="accounts-search-input w-40 pl-7 sm:w-48"
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="搜索账号"
                      aria-label="搜索已保存账号"
                    />
                  </div>
                  <Button
                    className="accounts-reload-button"
                    variant="outline"
                    size="icon"
                    aria-label="刷新账号列表"
                    title="刷新账号列表"
                    disabled={loading || !!busy}
                    onClick={() => void reload()}
                  >
                    <RefreshCw
                      className={cn('accounts-reload-icon', loading && 'animate-spin')}
                      aria-hidden="true"
                    />
                  </Button>
                </div>
              </div>
              {profiles.length ? (
                <ul
                  className="accounts-list flex flex-col divide-y rounded-lg border"
                  aria-label="已保存账号"
                >
                  {profiles.map((account) => (
                    <li
                      key={account.id}
                      className="account-row flex flex-wrap items-center gap-3 p-3"
                    >
                      <div className="account-row-details flex min-w-0 flex-1 flex-col gap-1">
                        <div className="account-row-heading flex flex-wrap items-center gap-2">
                          <span className="account-row-name max-w-full truncate text-xs font-medium">
                            {account.alias}
                          </span>
                          {account.isActive && (
                            <Badge className="account-active-badge" variant="secondary">
                              <Check className="account-active-icon" aria-hidden="true" />
                              当前
                            </Badge>
                          )}
                          <Badge className="account-type-badge" variant="outline">
                            {account.accountType === 'relay' ? 'API' : 'OAuth'}
                          </Badge>
                          {account.planType && (
                            <Badge className="account-plan-badge" variant="outline">
                              {account.planType}
                            </Badge>
                          )}
                        </div>
                        <p className="account-row-identity truncate text-xs text-app-muted-foreground">
                          {account.email ||
                            account.apiBaseUrl ||
                            (account.providerKey ? `${account.providerKey} · ` : '') +
                              account.accountId.slice(0, 20)}
                        </p>
                        {account.needsReauthorization && (
                          <p className="account-reauthorization-message text-xs text-destructive">
                            登录已失效，请重新授权。
                          </p>
                        )}
                        {account.switchUnavailable && (
                          <p className="account-unavailable-message text-xs text-app-muted-foreground">
                            {account.switchUnavailable}
                          </p>
                        )}
                        {account.usageUpdatedAt && (
                          <p className="account-usage-updated text-xs text-app-muted-foreground">
                            {account.product === 'claude' ? '令牌更新' : '额度更新'}：
                            {new Date(account.usageUpdatedAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <div className="account-row-usage flex flex-col gap-1 text-right">
                        <UsageWindow window={account.usagePrimary} fallback="额度" />
                        <UsageWindow window={account.usageSecondary} fallback="额度" />
                      </div>
                      <div className="account-row-actions flex items-center gap-1">
                        <Button
                          className="account-switch-button"
                          variant="outline"
                          size="sm"
                          disabled={!!busy || account.isActive || !!account.switchUnavailable}
                          onClick={() => void switchAccount(account)}
                        >
                          {busy === `switch:${account.id}`
                            ? '切换中…'
                            : account.isActive
                              ? '使用中'
                              : '切换'}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                className="account-menu-button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`管理 ${account.alias}`}
                                disabled={!!busy}
                              />
                            }
                          >
                            <MoreHorizontal className="account-menu-icon" aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="account-menu-content" align="end">
                            <DropdownMenuGroup className="account-menu-group">
                              <DropdownMenuItem
                                className="account-rename-menu-item"
                                onClick={() => setEditing(account)}
                              >
                                <Pencil className="account-rename-icon" aria-hidden="true" />
                                重命名
                              </DropdownMenuItem>
                              {account.accountType === 'oauth' && (
                                <DropdownMenuItem
                                  className="account-refresh-menu-item"
                                  onClick={() =>
                                    void perform(
                                      `refresh:${account.id}`,
                                      async () =>
                                        unwrap(await window.desktop.accounts.refresh(account.id)),
                                      account.product === 'claude'
                                        ? '登录令牌已更新。'
                                        : '额度已刷新。',
                                    )
                                  }
                                >
                                  <RefreshCw className="account-refresh-icon" aria-hidden="true" />
                                  {account.product === 'claude' ? '更新登录令牌' : '刷新额度'}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                className="account-move-up-menu-item"
                                disabled={!!query || status.profiles[0]?.id === account.id}
                                onClick={() => void move(account, -1)}
                              >
                                <ArrowUp className="account-move-up-icon" aria-hidden="true" />
                                上移
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="account-move-down-menu-item"
                                disabled={!!query || status.profiles.at(-1)?.id === account.id}
                                onClick={() => void move(account, 1)}
                              >
                                <ArrowDown className="account-move-down-icon" aria-hidden="true" />
                                下移
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="account-delete-menu-item"
                                variant="destructive"
                                onClick={() => setConfirmation({ kind: 'delete', account })}
                              >
                                <Trash2 className="account-delete-icon" aria-hidden="true" />
                                删除
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty className="accounts-empty border py-12">
                  <EmptyHeader className="accounts-empty-header">
                    <EmptyMedia className="accounts-empty-media" variant="icon">
                      <UsersRound className="accounts-empty-icon" aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle className="accounts-empty-title">
                      {query ? '未找到匹配的账号' : '还没有保存账号'}
                    </EmptyTitle>
                    <EmptyDescription className="accounts-empty-description">
                      {query
                        ? '尝试其他名称、邮箱或 API 地址。'
                        : '添加一个账号，或导入当前 CLI 的登录状态。'}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </>
          )
        )}
      </div>
      {addOpen && (
        <AddAccountDialog product={product} onClose={() => setAddOpen(false)} onSaved={added} />
      )}
      {editing && (
        <RenameAccountDialog
          account={editing}
          onClose={() => setEditing(undefined)}
          onSaved={renamed}
        />
      )}
      <Dialog
        open={!!confirmation}
        onOpenChange={(open, details) => {
          if (!open) {
            if (busyRef.current) details.cancel()
            else setConfirmation(undefined)
          }
        }}
      >
        <DialogContent
          className="account-confirm-dialog"
          initialFocus={cancelButton}
          showCloseButton={false}
        >
          <DialogHeader className="account-confirm-header">
            <DialogTitle className="account-confirm-title">
              {confirmation?.kind === 'import'
                ? '导入 Cortana 账号？'
                : confirmation?.kind === 'switch'
                  ? '切换并覆盖当前登录？'
                  : '删除已保存账号？'}
            </DialogTitle>
            <DialogDescription className="account-confirm-description">
              {confirmation?.kind === 'import'
                ? '将本机 Cortana 中尚未导入的账号复制到 Cota，保留名称和排序。重复账号会跳过，原数据库不会修改。'
                : confirmation?.kind === 'switch'
                  ? `当前登录尚未保存。切换到「${confirmation.account.alias}」会替换 CLI 的当前认证信息。你也可以取消并先导入当前登录。`
                  : confirmation?.kind === 'delete'
                    ? `删除「${confirmation.account.alias}」只会移除 Cota 保存的账号，CLI 当前登录不会退出。`
                    : ''}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <Alert className="account-confirm-error" variant="destructive">
              <AlertDescription className="account-confirm-error-message">{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="account-confirm-footer">
            <Button
              className="account-confirm-cancel"
              ref={cancelButton}
              variant="outline"
              disabled={!!busy}
              onClick={() => setConfirmation(undefined)}
            >
              取消
            </Button>
            <Button
              className="account-confirm-submit"
              variant={confirmation?.kind === 'import' ? 'default' : 'destructive'}
              disabled={!!busy}
              onClick={() => void confirm()}
            >
              {busy
                ? '处理中…'
                : confirmation?.kind === 'import'
                  ? '导入账号'
                  : confirmation?.kind === 'switch'
                    ? '确认切换'
                    : '删除账号'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function UsageWindow({
  window,
  fallback,
}: {
  window: AccountUsageWindow | null
  fallback: string
}) {
  if (!window) return null
  const label =
    window.windowMinutes === 300 ? '5 小时' : window.windowMinutes === 10080 ? '每周' : fallback
  return (
    <span
      className="account-usage-window text-xs text-app-muted-foreground"
      title={window.resetsAt ? `重置：${new Date(window.resetsAt).toLocaleString()}` : undefined}
    >
      {label}剩余{' '}
      <span className="account-usage-value font-medium tabular-nums text-foreground">
        {Math.round(Math.min(100, Math.max(0, 100 - window.usedPercent)))}%
      </span>
    </span>
  )
}
