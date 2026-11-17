import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import { isSortable } from '@dnd-kit/react/sortable'
import { Accessibility, DragDropManager, PointerActivationConstraints } from '@dnd-kit/dom'
import type { DragDropManagerInput } from '@dnd-kit/dom'
import { RestrictToVerticalAxis } from '@dnd-kit/abstract/modifiers'
import { LoaderCircle, LogIn, Plus, RefreshCw, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { ACCOUNT_PRODUCTS } from '../../../../../shared/accounts'
import type { AccountProduct, AccountProfile, AccountStatus } from '../../../../../shared/accounts'
import { unwrap } from '../../../../../shared/contracts'
import { useDialogState } from '@/hooks/use-dialog-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { oauthActive, useCortana } from '@/features/cortana/cortana-store'
import { AddAccountDialog, RenameAccountDialog } from './AccountDialogs'
import { AccountQuotaSummary } from './AccountQuotaSummary'
import { AccountRow } from './AccountRow'
import { supportsDualQuota } from './account-format'

const dragOptions: DragDropManagerInput = {
  modifiers: [RestrictToVerticalAxis],
  sensors: [
    PointerSensor.configure({
      activationConstraints: [new PointerActivationConstraints.Distance({ value: 6 })],
    }),
    KeyboardSensor,
  ],
  plugins: (defaults) => [
    ...defaults.filter((plugin) => plugin !== Accessibility),
    Accessibility.configure({
      screenReaderInstructions: {
        draggable:
          '按空格或回车拿起账号，使用上下方向键调整位置，再按空格或回车放下，按 Escape 取消。',
      },
      announcements: {
        dragstart: ({ operation }) => `已拿起 ${operation.source?.data.title}。`,
        dragover: ({ operation }) =>
          isSortable(operation.source)
            ? `${operation.source.data.title}，第 ${operation.source.index + 1} 个位置。`
            : undefined,
        dragend: ({ canceled }) => (canceled ? '已取消排序。' : '已放下账号。'),
      },
    } satisfies ConstructorParameters<typeof Accessibility>[1]),
  ],
}

type Confirmation =
  | { kind: 'switch'; account: AccountProfile; authRevision: string }
  | { kind: 'delete'; account: AccountProfile }
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '账号操作失败，请稍后重试。'

function useNowMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const sync = () => setNow(Date.now())
    let timer = document.visibilityState === 'hidden' ? undefined : window.setInterval(sync, 60_000)
    const onVisibilityChange = () => {
      window.clearInterval(timer)
      if (document.visibilityState === 'hidden') {
        timer = undefined
        return
      }
      sync()
      timer = window.setInterval(sync, 60_000)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])
  return now
}

export function AccountsPage() {
  const product = useCortana((state) => state.activeProduct)
  const now = useNowMinute()
  return <ProductAccountsPage key={product} product={product} now={now} />
}

function ProductAccountsPage({ product, now }: { product: AccountProduct; now: number }) {
  const refreshAccount = useCortana((state) => state.refreshAccount)
  const perform = useCortana((state) => state.perform)
  const reorderAccounts = useCortana((state) => state.reorder)
  const refreshing = useCortana((state) => state.refreshing)
  const refreshErrors = useCortana((state) => state.refreshErrors)
  const usageRefreshStatuses = useCortana((state) => state.usageRefreshStatuses)
  const pending = useCortana((state) => state.pending)
  const operationErrors = useCortana((state) => state.operationErrors)
  const pendingOrder = useCortana((state) => state.pendingOrders[product])
  const statusVersion = useCortana((state) => state.statusVersions[product] ?? 0)
  const oauthProgress = useCortana((state) => state.oauthProgress)
  const [status, setStatus] = useState<AccountStatus>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [importSkipped, setImportSkipped] = useState(false)
  const request = useRef(0)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<AccountProfile>()
  const [confirmation, setConfirmation, confirmationDialog] = useDialogState<Confirmation>()
  const cancelButton = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [dragManager] = useState(() => new DragDropManager(dragOptions))

  const loadStatus = useCallback(
    async (preserveError = false) => {
      const version = ++request.current
      const operationVersion = useCortana.getState().statusVersions[product] ?? 0
      const current = () =>
        version === request.current &&
        operationVersion === (useCortana.getState().statusVersions[product] ?? 0)
      try {
        const next = unwrap(await window.desktop.accounts.list(product))
        if (current()) {
          setStatus(next)
          useCortana.getState().acknowledgeOrder(product)
          if (!preserveError) setError(undefined)
        }
      } catch (cause) {
        if (current()) {
          useCortana.getState().acknowledgeOrder(product)
          setError(errorText(cause))
        }
      } finally {
        if (current()) setLoading(false)
      }
    },
    [product],
  )

  const reload = useCallback(() => {
    if (!status) setLoading(true)
    return loadStatus()
  }, [loadStatus, status])

  useEffect(() => {
    const pendingRequest = request
    // oxlint-disable-next-line react/set-state-in-effect -- Mount fetch reads external IPC data; loading is already initialized.
    void loadStatus(true)
    return () => {
      pendingRequest.current++
    }
  }, [loadStatus, statusVersion])

  function importCurrent() {
    void perform(product, `import:${product}`, ACCOUNT_PRODUCTS[product].name, async () => {
      const count = unwrap(await window.desktop.accounts.importCurrent(product))
      return `已同步 ${count} 个账号。`
    })
  }

  function queueSwitch(account: AccountProfile, authRevision?: string) {
    void perform(account.product, `switch:${account.id}`, account.alias, async () => {
      unwrap(
        await window.desktop.accounts.switch({
          id: account.id,
          force: !!authRevision,
          authRevision,
        }),
      )
      return '账号已切换。'
    })
  }

  function deactivateAccount(account: AccountProfile) {
    void perform(account.product, `deactivate:${account.id}`, account.alias, async () => {
      unwrap(await window.desktop.accounts.deactivate(account.id))
      return '账号已取消激活。'
    })
  }

  function switchAccount(account: AccountProfile) {
    if (status?.authState === 'unmanaged') {
      if (!status.authRevision) {
        toast.error('无法验证当前 CLI 登录，请刷新后重试。')
        return
      }
      setConfirmation({ kind: 'switch', account, authRevision: status.authRevision })
      return
    }
    queueSwitch(account)
  }

  function confirm() {
    if (!confirmationDialog.open || !confirmation) return
    const selected = confirmation
    setConfirmation(undefined)
    if (selected.kind === 'switch') {
      queueSwitch(selected.account, selected.authRevision)
    } else {
      void perform(
        selected.account.product,
        `delete:${selected.account.id}`,
        selected.account.alias,
        async () => {
          unwrap(await window.desktop.accounts.remove(selected.account.id))
          return '账号已删除。'
        },
      )
    }
  }

  function reorder(id: string, targetIndex: number) {
    if (!status || sortingDisabled || targetIndex < 0 || targetIndex >= orderedProfiles.length)
      return
    const nextProfiles = [...orderedProfiles]
    const from = nextProfiles.findIndex((profile) => profile.id === id)
    if (from < 0 || from === targetIndex) return
    nextProfiles.splice(targetIndex, 0, nextProfiles.splice(from, 1)[0])
    // Commit the drag library's DOM order before a fast IPC failure can roll it back.
    flushSync(
      () =>
        void reorderAccounts(
          product,
          nextProfiles.map((profile) => profile.id),
        ),
    )
  }

  const positions = new Map(pendingOrder?.map((id, index) => [id, index]))
  const orderedProfiles = pendingOrder
    ? [...(status?.profiles ?? [])].sort(
        (a, b) =>
          (positions.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (positions.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      )
    : (status?.profiles ?? [])
  const quotaAccounts = orderedProfiles.filter(
    (account) => account.isActive && supportsDualQuota(account),
  )
  const sortingDisabled = loading || !!pendingOrder || orderedProfiles.length < 2
  const showImportPrompt = status?.authState === 'unmanaged' && !importSkipped
  const adding =
    !!pending[`add:${product}`] ||
    (oauthActive(oauthProgress) && oauthProgress?.product === product)
  const addError = operationErrors[`add:${product}`]

  useLayoutEffect(() => {
    const cancel = () => {
      if (dragManager.dragOperation.status.dragging) dragManager.actions.stop({ canceled: true })
    }
    const checkDrop = (event: PointerEvent) => {
      const rect = listRef.current?.getBoundingClientRect()
      if (
        rect &&
        (event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom)
      )
        cancel()
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('pointerup', checkDrop, true)
    return () => {
      window.removeEventListener('blur', cancel)
      window.removeEventListener('pointerup', checkDrop, true)
      cancel()
    }
  }, [dragManager, status, sortingDisabled])

  return (
    <section
      className="accounts-page flex min-h-0 flex-1 flex-col"
      aria-label="账号管理"
      aria-busy={loading && !status}
    >
      <header className="accounts-header flex shrink-0 flex-wrap items-center justify-between gap-3 p-5">
        <h2 className="accounts-title text-lg font-semibold">账号管理</h2>
        <div className="accounts-actions flex flex-wrap items-center gap-2">
          <Button
            className="accounts-add-button"
            variant={addError && !adding ? 'destructive' : 'default'}
            aria-busy={adding}
            title={addError}
            onClick={() => setAddOpen(true)}
          >
            {adding ? (
              <LoaderCircle
                className="accounts-add-spinner motion-safe:animate-spin"
                data-icon="inline-start"
                aria-hidden="true"
              />
            ) : (
              <Plus className="accounts-add-icon" data-icon="inline-start" aria-hidden="true" />
            )}
            {addError && !adding ? '添加失败' : '添加账号'}
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
                disabled={loading}
                onClick={() => void reload()}
              >
                重新加载
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {/* The provider owns manager cleanup, so both must outlive the conditional list. */}
        <DragDropProvider
          manager={dragManager}
          {...dragOptions}
          onDragEnd={({ canceled, operation }) => {
            if (canceled || !operation.target || !isSortable(operation.source)) return
            reorder(String(operation.source.id), operation.source.index)
          }}
        >
          {loading && !status ? (
            <Empty className="accounts-loading">
              <EmptyHeader className="accounts-loading-header">
                <RefreshCw
                  className="accounts-loading-icon size-4 motion-safe:animate-spin"
                  aria-hidden="true"
                />
                <EmptyTitle className="accounts-loading-title">正在加载账号…</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            status && (
              <>
                {showImportPrompt && (
                  <Alert
                    className="accounts-import-prompt flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2"
                    role="note"
                  >
                    <AlertDescription className="accounts-import-message">
                      发现已有 {ACCOUNT_PRODUCTS[product].name} 登录凭据
                    </AlertDescription>
                    <div className="accounts-import-actions flex items-center gap-2">
                      <Button
                        className="accounts-import-skip"
                        variant="ghost"
                        size="sm"
                        onClick={() => setImportSkipped(true)}
                      >
                        暂时跳过
                      </Button>
                      <Button
                        className="accounts-import-accept"
                        variant="outline"
                        size="sm"
                        disabled={!!pending[`import:${product}`]}
                        onClick={importCurrent}
                      >
                        <LogIn
                          className="accounts-import-icon"
                          data-icon="inline-start"
                          aria-hidden="true"
                        />
                        {pending[`import:${product}`] ? '导入中…' : '导入凭据'}
                      </Button>
                    </div>
                  </Alert>
                )}
                {orderedProfiles.length ? (
                  <>
                    {quotaAccounts.map((account) => (
                      <AccountQuotaSummary key={account.id} account={account} now={now} />
                    ))}
                    <ul
                      ref={listRef}
                      className="accounts-list flex flex-col gap-3"
                      aria-label="已保存账号"
                    >
                      {orderedProfiles.map((account, index) => (
                        <AccountRow
                          key={account.id}
                          account={account}
                          index={index}
                          now={now}
                          switching={!!pending[`switch:${account.id}`]}
                          deactivating={!!pending[`deactivate:${account.id}`]}
                          deleting={!!pending[`delete:${account.id}`]}
                          renaming={!!pending[`rename:${account.id}`]}
                          refreshing={!!refreshing[account.id]}
                          refreshError={
                            refreshErrors[account.id] || usageRefreshStatuses[account.id]?.error
                          }
                          operationError={
                            operationErrors[`switch:${account.id}`] ||
                            operationErrors[`deactivate:${account.id}`] ||
                            operationErrors[`delete:${account.id}`] ||
                            operationErrors[`rename:${account.id}`]
                          }
                          sortingDisabled={sortingDisabled}
                          onSwitch={() => switchAccount(account)}
                          onDeactivate={() => deactivateAccount(account)}
                          onRename={() => setEditing(account)}
                          onRefresh={() => void refreshAccount(account)}
                          onDelete={() => setConfirmation({ kind: 'delete', account })}
                        />
                      ))}
                    </ul>
                  </>
                ) : (
                  <Empty className="accounts-empty flex-none py-16">
                    <EmptyHeader className="accounts-empty-header">
                      <EmptyMedia className="accounts-empty-media" variant="icon">
                        <UsersRound className="accounts-empty-icon" aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle className="accounts-empty-title">还没有保存账号</EmptyTitle>
                      <EmptyDescription className="accounts-empty-description">
                        添加一个账号，或导入当前 CLI 的登录状态。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </>
            )
          )}
        </DragDropProvider>
      </div>
      {addOpen && <AddAccountDialog product={product} onClose={() => setAddOpen(false)} />}
      {editing && <RenameAccountDialog account={editing} onClose={() => setEditing(undefined)} />}
      <Dialog
        {...confirmationDialog}
        onOpenChange={(open) => {
          if (!open) setConfirmation(undefined)
        }}
      >
        <DialogContent
          className="account-confirm-dialog"
          initialFocus={cancelButton}
          showCloseButton={false}
        >
          <DialogHeader className="account-confirm-header">
            <DialogTitle className="account-confirm-title">
              {confirmation?.kind === 'switch' ? '切换并覆盖当前登录？' : '删除已保存账号？'}
            </DialogTitle>
            <DialogDescription className="account-confirm-description">
              {confirmation?.kind === 'switch'
                ? `当前登录尚未保存。切换到「${confirmation.account.alias}」会替换 CLI 的当前认证信息。你也可以取消并先导入当前登录。`
                : `删除「${confirmation?.account.alias}」只会移除 Cota 保存的账号，CLI 当前登录不会退出。`}
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
              onClick={() => setConfirmation(undefined)}
            >
              取消
            </Button>
            <Button className="account-confirm-submit" variant="destructive" onClick={confirm}>
              {confirmation?.kind === 'switch' ? '确认切换' : '删除账号'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
