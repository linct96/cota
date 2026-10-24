import { useEffect, useRef, useState } from 'react'
import { unwrap, type WorkspaceTarget } from '../../../shared/contracts'
import type { WorktreeSetupSnapshot } from '../../../shared/worktree-setup'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

const STATUS_LABELS = {
  running: '正在初始化',
  succeeded: '初始化完成',
  failed: '初始化失败',
  interrupted: '初始化已中断',
}

export function WorktreeSetupDialog({
  target,
  initialError,
  close,
  configure,
}: {
  target: WorkspaceTarget
  initialError?: string
  close(): void
  configure(): void
}) {
  const [snapshot, setSnapshot] = useState<WorktreeSetupSnapshot>()
  const [error, setError] = useState(initialError)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const result = unwrap(await window.desktop.inspectWorktreeSetup(target))
        if (!disposed) {
          setSnapshot(result)
          if (result.running) timer = setTimeout(() => void read(), 1000)
        }
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : String(failure))
      }
    }
    void read()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [target, refresh])
  const configured =
    !!snapshot && (!!snapshot.definition.command || snapshot.definition.copyFiles.length > 0)
  const act = async (stop: boolean) => {
    if (pending.current || !snapshot) return
    pending.current = true
    setBusy(true)
    setError(undefined)
    try {
      if (stop) unwrap(await window.desktop.stopWorktreeSetup(target))
      else unwrap(await window.desktop.startWorktreeSetup(target, snapshot.definition))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      pending.current = false
      setBusy(false)
      setRefresh((value) => value + 1)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (pending.current) details.cancel()
        else if (!open) close()
      }}
    >
      <DialogContent
        className="worktree-setup-dialog max-h-[85vh] overflow-y-auto"
        showCloseButton={false}
      >
        <DialogHeader className="worktree-setup-header">
          <DialogTitle className="worktree-setup-title">工作树初始化</DialogTitle>
          <DialogDescription className="worktree-setup-description">
            初始化失败会保留目录与已完成的修改；重新打开工作区不会自动执行。
          </DialogDescription>
        </DialogHeader>
        <output className="worktree-setup-status text-sm">
          {snapshot
            ? snapshot.running
              ? '正在初始化或清理进程'
              : snapshot.run
                ? STATUS_LABELS[snapshot.run.status]
                : configured
                  ? '尚未初始化'
                  : '尚未配置初始化'
            : '正在读取初始化状态…'}
        </output>
        {snapshot?.run && (
          <ScrollArea
            className="worktree-setup-log-scroll h-64 rounded-md border bg-muted"
            render={
              <section className="worktree-setup-log-region" aria-label="最近一次初始化日志" />
            }
          >
            <pre className="worktree-setup-log whitespace-pre-wrap break-all p-3 font-mono text-xs">
              {snapshot.run.log || '等待命令输出…'}
            </pre>
          </ScrollArea>
        )}
        {snapshot?.run && (
          <p className="worktree-setup-log-hint text-xs text-muted-foreground">
            仅保留最近一次运行和末尾 65,536 字符日志。日志可能包含命令输出的敏感信息，请勿直接分享。
          </p>
        )}
        {error && (
          <p className="worktree-setup-error text-sm text-destructive break-words" role="alert">
            {error}
          </p>
        )}
        <DialogFooter className="worktree-setup-footer flex-wrap">
          <Button
            className="worktree-setup-close"
            variant="outline"
            disabled={busy}
            onClick={close}
          >
            关闭
          </Button>
          {error && (
            <Button
              className="worktree-setup-refresh"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError(undefined)
                setRefresh((value) => value + 1)
              }}
            >
              刷新状态
            </Button>
          )}
          {snapshot && !snapshot.running && (
            <Button
              className="worktree-setup-configure"
              variant="outline"
              disabled={busy}
              onClick={configure}
            >
              修改配置
            </Button>
          )}
          {snapshot?.running ? (
            <Button
              className="worktree-setup-stop"
              variant="destructive"
              disabled={busy}
              onClick={() => void act(true)}
            >
              {busy ? '正在处理…' : '停止初始化'}
            </Button>
          ) : (
            <Button
              className="worktree-setup-run"
              disabled={busy || !configured}
              onClick={() => void act(false)}
            >
              {busy
                ? '等待确认…'
                : snapshot?.run
                  ? snapshot.run.status === 'succeeded'
                    ? '再次初始化'
                    : '重试初始化'
                  : '执行初始化'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
