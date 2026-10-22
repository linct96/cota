import { useEffect, useRef, useState } from 'react'
import { unwrap, type WorkspaceTarget } from '../../../shared/contracts'
import { useSourceControl } from './source-control-store'

export function useCommitMessageGeneration(target: WorkspaceTarget) {
  const [state, setState] = useState<'idle' | 'running' | 'stopping'>('idle')
  const [feedback, setFeedback] = useState<{ message: string; error: boolean }>()
  const current = useRef<{ id: string; canceled: boolean } | undefined>(undefined)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const request = current.current
      if (!request) return
      request.canceled = true
      void window.desktop
        .cancelCommitMessage({ ...target, requestId: request.id })
        .then(unwrap)
        .catch((error) => console.warn('无法停止提交信息生成。', error))
    }
  }, [target])

  async function cancel() {
    const request = current.current
    if (!request) return
    request.canceled = true
    if (mounted.current) setState('stopping')
    try {
      unwrap(await window.desktop.cancelCommitMessage({ ...target, requestId: request.id }))
    } catch (error) {
      if (mounted.current && current.current === request)
        setFeedback({
          message: error instanceof Error ? error.message : '停止生成失败，请重试。',
          error: true,
        })
      throw error
    }
  }

  async function generate(indexVersion: string, apply: (message: string) => void) {
    if (current.current || !mounted.current) return
    const request = { id: crypto.randomUUID(), canceled: false }
    current.current = request
    const before = useSourceControl.getState().sessions[target.workspaceId]
    const revision = before?.draftRevision ?? 0
    setState('running')
    setFeedback(undefined)
    const isCurrent = () => mounted.current && current.current === request && !request.canceled
    try {
      const result = unwrap(
        await window.desktop.generateCommitMessage({
          ...target,
          requestId: request.id,
          indexVersion,
        }),
      )
      if (!isCurrent() || result.canceled) return
      const status = unwrap(await window.desktop.gitStatus(target))
      if (!isCurrent()) return
      useSourceControl.getState().update(target.workspaceId, { status, refreshed: Date.now() })
      if (
        status.indexVersion !== result.indexVersion ||
        status.branch !== result.branch ||
        status.rootPath !== before?.status?.rootPath
      )
        throw new Error('暂存区、HEAD 或分支已改变，请审阅最新改动后重新生成。')
      const session = useSourceControl.getState().sessions[target.workspaceId]
      if (!session || session.draftRevision !== revision) {
        setFeedback({ message: '生成期间提交信息已被编辑，已保留你的输入。', error: false })
        return
      }
      apply(result.message)
    } catch (error) {
      if (isCurrent())
        setFeedback({
          message: error instanceof Error ? error.message : '生成失败，请重试或手动填写。',
          error: true,
        })
    } finally {
      if (current.current === request) {
        current.current = undefined
        if (mounted.current) setState('idle')
      }
    }
  }

  return { state, feedback, generate, cancel }
}
