import { useCallback, useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useSourceControl } from './source-control-store'
import { unwrap } from '../../../shared/contracts'
import {
  branchReferences,
  type GitBranchTarget,
  type GitBranchSnapshot,
} from '../../../shared/git-branches'

type WorkspaceBranches = {
  repositoryId?: string
  remotes: string[]
  loading: boolean
  stale: boolean
  error?: string
  currentBranch?: string | null
  watching?: boolean
}
interface GitBranchesState {
  repositories: Record<string, GitBranchSnapshot>
  workspaces: Record<string, WorkspaceBranches>
}
type Subscription = {
  target: GitBranchTarget
  id: string
  users: number
  request?: Promise<void>
  again: boolean
  force: boolean
  lastAttempt: number
}
const subscriptions = new Map<string, Subscription>()
let stopNotifications: (() => void) | undefined
export const branchViewKey = (target: GitBranchTarget) =>
  `${target.projectPath}\0${target.workspaceId || ''}`
const keyOf = branchViewKey
let stopRecovery: (() => void) | undefined

export const useGitBranchesStore = create<GitBranchesState>(() => ({
  repositories: {},
  workspaces: {},
}))

export function refreshGitBranches(target: GitBranchTarget, force = false): Promise<void> {
  const key = keyOf(target)
  const subscription = subscriptions.get(key)
  if (!subscription) return Promise.resolve()
  if (subscription.request) {
    subscription.again = true
    subscription.force ||= force
    return subscription.request
  }
  useGitBranchesStore.setState((state) => ({
    workspaces: {
      ...state.workspaces,
      [key]: {
        ...state.workspaces[key],
        remotes: state.workspaces[key]?.remotes || [],
        loading: true,
        stale: true,
        error: undefined,
      },
    },
  }))
  subscription.lastAttempt = Date.now()
  const current = () => subscriptions.get(key) === subscription
  subscription.request = window.desktop
    .gitBranches(target, subscription.id, force)
    .then((result) => {
      if (
        current() &&
        !result.ok &&
        result.code &&
        [
          'INVALID_INPUT',
          'NOT_GIT_REPO',
          'UNSUPPORTED_REPOSITORY',
          'REPOSITORY_UNAVAILABLE',
        ].includes(result.code)
      )
        useGitBranchesStore.setState((state) => ({
          workspaces: { ...state.workspaces, [key]: { remotes: [], loading: true, stale: true } },
        }))
      return unwrap(result)
    })
    .then((view) => {
      if (!current()) return
      useGitBranchesStore.setState((state) => {
        const previous = state.repositories[view.snapshot.repositoryId]
        const workspaces = {
          ...state.workspaces,
          [key]: {
            repositoryId: view.snapshot.repositoryId,
            remotes: view.remotes,
            currentBranch: view.currentBranch,
            watching: view.watching,
            loading: false,
            stale: view.stale || subscription.again,
          },
        }
        const repositories =
          previous && previous.revision >= view.snapshot.revision
            ? state.repositories
            : { ...state.repositories, [view.snapshot.repositoryId]: view.snapshot }
        const used = new Set(Object.values(workspaces).map((workspace) => workspace.repositoryId))
        return {
          workspaces,
          repositories: Object.fromEntries(
            Object.entries(repositories).filter(([id]) => used.has(id)),
          ),
        }
      })
      subscription.again ||= view.stale
    })
    .catch((cause) => {
      if (current())
        useGitBranchesStore.setState((state) => ({
          workspaces: {
            ...state.workspaces,
            [key]: {
              ...state.workspaces[key],
              loading: false,
              stale: true,
              error: cause instanceof Error ? cause.message : '分支读取失败，请刷新。',
            },
          },
        }))
    })
    .finally(() => {
      subscription.request = undefined
      if (!current()) return
      if (subscription.again && !document.hidden) {
        const force = subscription.force
        subscription.again = false
        subscription.force = false
        void refreshGitBranches(target, force)
      }
    })
  return subscription.request
}

export function retainGitBranches(target: GitBranchTarget): () => void {
  const key = keyOf(target)
  let subscription = subscriptions.get(key)
  if (subscription) subscription.users++
  else {
    subscription = {
      target,
      id: crypto.randomUUID(),
      users: 1,
      again: false,
      force: false,
      lastAttempt: 0,
    }
    subscriptions.set(key, subscription)
    stopNotifications ||= window.desktop.onGitBranchesChanged((repositoryId) => {
      for (const [key, subscription] of subscriptions) {
        if (useGitBranchesStore.getState().workspaces[key]?.repositoryId !== repositoryId) continue
        useGitBranchesStore.setState((state) => ({
          workspaces: { ...state.workspaces, [key]: { ...state.workspaces[key], stale: true } },
        }))
        if (!document.hidden) void refreshGitBranches(subscription.target)
      }
    })
    if (!stopRecovery) {
      const refreshVisible = (onlyDue: boolean) => {
        if (document.hidden) return
        const forced = new Set<string>()
        for (const [key, subscription] of subscriptions) {
          const view = useGitBranchesStore.getState().workspaces[key]
          if (
            onlyDue &&
            Date.now() - subscription.lastAttempt < (view?.watching === false ? 5000 : 60000)
          )
            continue
          const force = !view?.repositoryId || !forced.has(view.repositoryId)
          if (view?.repositoryId) forced.add(view.repositoryId)
          void refreshGitBranches(subscription.target, force)
        }
      }
      const recover = () => refreshVisible(false)
      const timer = setInterval(() => refreshVisible(true), 5000)
      window.addEventListener('focus', recover)
      document.addEventListener('visibilitychange', recover)
      stopRecovery = () => {
        clearInterval(timer)
        window.removeEventListener('focus', recover)
        document.removeEventListener('visibilitychange', recover)
      }
    }
    if (!document.hidden) void refreshGitBranches(target)
  }
  const retained = subscription
  return () => {
    if (subscriptions.get(key) !== retained || --retained.users > 0) return
    subscriptions.delete(key)
    void window.desktop.releaseGitBranches(retained.id).catch(() => {})
    useGitBranchesStore.setState((state) => {
      const workspaces = { ...state.workspaces }
      delete workspaces[key]
      const used = new Set(Object.values(workspaces).map((view) => view.repositoryId))
      const repositories = Object.fromEntries(
        Object.entries(state.repositories).filter(([id]) => used.has(id)),
      )
      return { workspaces, repositories }
    })
    if (!subscriptions.size) {
      stopNotifications?.()
      stopNotifications = undefined
      stopRecovery?.()
      stopRecovery = undefined
    }
  }
}

export function useGitBranches(target: GitBranchTarget, active: boolean) {
  const currentBranch = useSourceControl((state) =>
    target.workspaceId ? state.sessions[target.workspaceId]?.status?.branch : undefined,
  )
  const workspace = useGitBranchesStore((state) => state.workspaces[keyOf(target)])
  const snapshot = useGitBranchesStore((state) =>
    workspace?.repositoryId ? state.repositories[workspace.repositoryId] : undefined,
  )
  useEffect(() => {
    if (active) return retainGitBranches(target)
  }, [target, active])
  const remotes = workspace?.remotes
  const references = useMemo(
    () => (snapshot && remotes ? branchReferences(snapshot, remotes) : undefined),
    [snapshot, remotes],
  )
  const refresh = useCallback(
    (force = true) => {
      void refreshGitBranches(target, force)
    },
    [target],
  )
  return {
    references,
    currentBranch: target.workspaceId ? currentBranch : workspace?.currentBranch,
    refresh,
    error: workspace?.error,
    loading: workspace?.loading,
    stale: workspace?.stale,
  }
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const subscription of subscriptions.values())
      void window.desktop.releaseGitBranches(subscription.id).catch(() => {})
    subscriptions.clear()
    stopNotifications?.()
    stopRecovery?.()
  })
