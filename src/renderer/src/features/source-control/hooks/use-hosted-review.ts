import { useEffect, useMemo, useRef, useState } from 'react'
import { unwrap, type ProjectWorkspace } from '../../../../../shared/contracts'
import { type HostingSnapshot } from '../../../../../shared/code-hosting'
import type { GitStatus } from '../../../../../shared/source-control'
import { useSourceControl } from '@/state/source-control-store'
import { useLoadingIndicator } from '@/hooks/use-loading-indicator'

export function useHostedReview({
  workspace,
  active,
  status,
  pending,
}: {
  workspace: ProjectWorkspace
  active: boolean
  status?: GitStatus
  pending: boolean
}) {
  const target = useMemo(
    () => ({ projectPath: workspace.projectPath, workspaceId: workspace.id }),
    [workspace.projectPath, workspace.id],
  )
  const hosting = useSourceControl((state) => state.sessions[workspace.id]?.hosting)
  const refreshHostingContext = useSourceControl((state) => state.refreshHostingContext)
  const context = hosting?.context
  const identity = JSON.stringify([target, status?.branch, status?.head, status?.tracking, context])
  const [result, setResult] = useState<{
    identity: string
    snapshot?: HostingSnapshot
    error?: string
  }>()
  const [inspecting, setInspecting] = useState(false)
  const loading = active && (inspecting || !hosting || (hosting.loading && !context))
  const refreshLoading = useLoadingIndicator(loading)
  const [action, setAction] = useState(false)
  const [actionError, setActionError] = useState<string>()
  const epoch = useRef(0)
  const busy = useRef(false)
  const lastRead = useRef<{ identity: string; at: number } | undefined>(undefined)
  const refresh = useRef<() => Promise<void>>(async () => {})
  const data = result?.identity === identity ? result : undefined
  const snapshot = data?.snapshot
  const label = context?.source ? (context.source.provider === 'gitlab' ? 'MR' : 'PR') : 'PR/MR'
  const disabled = pending || loading || action || !active

  useEffect(() => {
    // A cached result can be reused after an interrupted background refresh.
    // oxlint-disable-next-line react/set-state-in-effect
    setInspecting(false)
    const version = ++epoch.current
    let reading = false
    const fresh = () =>
      lastRead.current?.identity === identity && Date.now() - lastRead.current.at < 60000
    async function read(force = false) {
      if (reading || busy.current || pending || !active || document.hidden || (!force && fresh()))
        return
      if (!context || context.reason) {
        setInspecting(false)
        return
      }
      reading = true
      setInspecting(true)
      try {
        const snapshot = unwrap(await window.desktop.codeHosting.inspect(target))
        if (version === epoch.current) {
          lastRead.current = { identity, at: Date.now() }
          setResult({ identity, snapshot })
        }
      } catch (cause) {
        if (version === epoch.current)
          setResult((previous) => ({
            identity,
            snapshot: previous?.identity === identity ? previous.snapshot : undefined,
            error: cause instanceof Error ? cause.message : '代码托管读取失败，请刷新。',
          }))
      } finally {
        reading = false
        if (version === epoch.current) setInspecting(false)
      }
    }
    const reload = async (force = false) => {
      if (reading || busy.current || pending || !active || document.hidden || (!force && fresh()))
        return
      void refreshHostingContext(target)
      await read(force)
    }
    refresh.current = () => reload(true)
    if (!active) return
    const onFocus = () => void reload()
    void read()
    const timer = setInterval(onFocus, 60000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      epoch.current = version + 1
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [target, identity, context, active, pending, refreshHostingContext])

  async function run(operation: () => Promise<void>) {
    if (busy.current || disabled) return
    busy.current = true
    setAction(true)
    setActionError(undefined)
    const version = epoch.current
    try {
      await operation()
    } catch (cause) {
      if (version === epoch.current)
        setActionError(cause instanceof Error ? cause.message : '操作失败，请重试。')
    } finally {
      busy.current = false
      setAction(false)
    }
  }

  return {
    target,
    hosting,
    context,
    data,
    snapshot,
    label,
    loading,
    refreshLoading,
    action,
    actionError,
    disabled,
    refresh,
    run,
  }
}
