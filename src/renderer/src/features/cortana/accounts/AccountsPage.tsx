import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import { isSortable } from '@dnd-kit/react/sortable'
import { Accessibility, DragDropManager, PointerActivationConstraints } from '@dnd-kit/dom'
import type { DragDropManagerInput } from '@dnd-kit/dom'
import { RestrictToVerticalAxis } from '@dnd-kit/abstract/modifiers'
import { LogIn, Plus, RefreshCw, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { ACCOUNT_PRODUCTS } from '../../../../../shared/accounts'
import type { AccountProduct, AccountProfile, AccountStatus } from '../../../../../shared/accounts'
import { unwrap } from '../../../../../shared/contracts'
import { useDialogState } from '@/hooks/use-dialog-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
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
import { useCortana } from '@/features/cortana/cortana-store'
import { AddAccountDialog, RenameAccountDialog } from './AccountDialogs'
import { AccountRow } from './AccountRow'

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

type Confirmation = { kind: 'switch' | 'delete'; account: AccountProfile }
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
  const [importSkipped, setImportSkipped] = useState(false)
  const [busy, setBusy] = useState<string>()
  const busyRef = useRef(false)
  const request = useRef(0)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<AccountProfile>()
  const [confirmation, setConfirmation, confirmationDialog] = useDialogState<Confirmation>()
  const cancelButton = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [dragManager] = useState(() => new DragDropManager(dragOptions))

  useEffect(() => {
    setAgentSwitchBlocked(!!busy || addOpen || !!editing || !!confirmation)
    return () => setAgentSwitchBlocked(false)
  }, [busy, addOpen, editing, confirmation, setAgentSwitchBlocked])

  const loadStatus = useCallback(async () => {
    const version = ++request.current
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

  const reload = useCallback(() => {
    setLoading(true)
    return loadStatus()
  }, [loadStatus])

  useEffect(() => {
    const pendingRequest = request
    // oxlint-disable-next-line react/set-state-in-effect -- Mount fetch reads external IPC data; loading is already initialized.
    void loadStatus()
    return () => {
      pendingRequest.current++
    }
  }, [loadStatus])

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

  function importCurrent() {
    return perform('import-current', async () => {
      const count = unwrap(await window.desktop.accounts.importCurrent(product))
      toast.success(`已同步 ${count} 个账号。`)
    })
  }

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
    if (!confirmationDialog.open || !confirmation || busyRef.current) return
    if (confirmation.kind === 'switch') {
      await switchAccount(confirmation.account, true)
      return
    }
    const done = await perform(
      'delete',
      async () => unwrap(await window.desktop.accounts.remove(confirmation.account.id)),
      '账号已删除。',
    )
    if (done) setConfirmation(undefined)
  }

  async function reorder(id: string, targetIndex: number) {
    if (!status || sortingDisabled || targetIndex < 0 || targetIndex >= orderedProfiles.length)
      return
    const target = orderedProfiles[targetIndex]
    const movable = status.profiles.filter((profile) => !profile.isActive)
    const from = movable.findIndex((profile) => profile.id === id)
    const to = movable.findIndex((profile) => profile.id === target.id)
    if (from < 0 || to < 0 || from === to) return
    movable.splice(to, 0, movable.splice(from, 1)[0])
    let position = 0
    const nextProfiles = status.profiles.map((profile) =>
      profile.isActive ? profile : movable[position++],
    )
    // Commit the drag library's DOM order before a fast IPC failure can batch away the rollback.
    flushSync(() => setStatus({ ...status, profiles: nextProfiles }))
    const done = await perform('reorder', async () =>
      unwrap(
        await window.desktop.accounts.reorder(
          product,
          nextProfiles.map((profile) => profile.id),
        ),
      ),
    )
    if (!done) setStatus(status)
  }

  const orderedProfiles = [...(status?.profiles ?? [])].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive),
  )
  const sortingDisabled =
    loading ||
    !!busy ||
    addOpen ||
    !!editing ||
    !!confirmation ||
    orderedProfiles.filter((account) => !account.isActive).length < 2
  const showImportPrompt = status?.authState === 'unmanaged' && !importSkipped

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
      aria-busy={loading || !!busy}
    >
      <header className="accounts-header flex shrink-0 flex-wrap items-center justify-between gap-3 p-5">
        <div className="accounts-heading flex min-w-0 items-center gap-2">
          <h2 className="accounts-title text-lg font-semibold">账号管理</h2>
          {status && (
            <Badge
              className="accounts-count tabular-nums"
              variant="secondary"
              aria-label={`${status.profiles.length} 个账号`}
            >
              {status.profiles.length}
            </Badge>
          )}
        </div>
        <div className="accounts-actions flex flex-wrap items-center gap-2">
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
                      disabled={!!busy || loading}
                      onClick={() => setImportSkipped(true)}
                    >
                      暂时跳过
                    </Button>
                    <Button
                      className="accounts-import-accept"
                      variant="outline"
                      size="sm"
                      disabled={!!busy || loading}
                      onClick={() => void importCurrent()}
                    >
                      <LogIn
                        className="accounts-import-icon"
                        data-icon="inline-start"
                        aria-hidden="true"
                      />
                      {busy === 'import-current' ? '导入中…' : '导入凭据'}
                    </Button>
                  </div>
                </Alert>
              )}
              {orderedProfiles.length ? (
                <DragDropProvider
                  manager={dragManager}
                  {...dragOptions}
                  onDragEnd={({ canceled, operation }) => {
                    if (canceled || !operation.target || !isSortable(operation.source)) return
                    void reorder(String(operation.source.id), operation.source.index)
                  }}
                >
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
                        busy={busy}
                        disabled={!!busy || loading}
                        sortingDisabled={sortingDisabled}
                        onSwitch={() => void switchAccount(account)}
                        onRename={() => setEditing(account)}
                        onRefresh={() =>
                          void perform(
                            `refresh:${account.id}`,
                            async () => unwrap(await window.desktop.accounts.refresh(account.id)),
                            account.product === 'claude' ? '登录令牌已更新。' : '额度已刷新。',
                          )
                        }
                        onDelete={() => setConfirmation({ kind: 'delete', account })}
                      />
                    ))}
                  </ul>
                </DragDropProvider>
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
        {...confirmationDialog}
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
              disabled={!!busy}
              onClick={() => setConfirmation(undefined)}
            >
              取消
            </Button>
            <Button
              className="account-confirm-submit"
              variant="destructive"
              disabled={!!busy}
              onClick={() => void confirm()}
            >
              {busy ? '处理中…' : confirmation?.kind === 'switch' ? '确认切换' : '删除账号'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
