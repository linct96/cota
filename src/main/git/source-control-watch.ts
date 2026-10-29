import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import type { GitWatchEvent } from '../../shared/contracts'
import type { GitBranchChange } from '../../shared/git-branches'
import { GitService } from './git-worktrees'
import { runGit } from './git-runner'
import { terminalId } from '../validation'

export class SourceControlWatches {
  private readonly subscriptions = new Map<string, () => void>()
  private readonly git = new GitService()
  private readonly watched = new Map<
    string,
    {
      watcher: FSWatcher
      listeners: Set<{
        change: (file: string | null, event: 'rename' | 'change') => void
        fail: () => void
      }>
    }
  >()
  private readonly changes = new Map<
    string,
    { cwd: string; kinds: Set<GitBranchChange>; timer: ReturnType<typeof setTimeout> }
  >()

  constructor(
    private readonly watchDirectory: typeof watch = watch,
    private readonly referencesChanged: (
      cwd: string,
      changes: GitBranchChange[],
      commonDir: string,
    ) => void = () => {},
  ) {}

  private queueChange(cwd: string, commonDir: string, kind: GitBranchChange): void {
    const pending = this.changes.get(commonDir)
    if (pending) {
      pending.kinds.add(kind)
      return
    }
    const change = {
      cwd,
      kinds: new Set([kind]),
      timer: setTimeout(() => {
        this.changes.delete(commonDir)
        this.referencesChanged(cwd, [...change.kinds], commonDir)
      }, 150),
    }
    this.changes.set(commonDir, change)
  }

  async start(
    value: unknown,
    resolvePath: () => Promise<string>,
    notify: (event: GitWatchEvent) => void,
    metadataOnly = false,
  ): Promise<boolean> {
    const id = terminalId(value)
    if (this.subscriptions.has(id) || this.subscriptions.size >= 128)
      throw new Error('Git 监听请求过多。')
    let closed = false
    let commonDir: string | undefined
    let cwd: string | undefined
    let checking = false
    let lastChecked = -Infinity
    let lastNotified = -Infinity
    let timer: ReturnType<typeof setTimeout> | undefined
    let notification: ReturnType<typeof setTimeout> | undefined
    const watchers: (() => void)[] = []
    const files = new Set<string>()
    const close = () => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      clearTimeout(notification)
      files.clear()
      for (const release of watchers) release()
      this.subscriptions.delete(id)
    }
    this.subscriptions.set(id, close)
    const fail = () => {
      if (closed) return
      if (cwd && commonDir) this.queueChange(cwd, commonDir, 'unknown')
      close()
      notify('unavailable')
    }
    const changed = (kind?: GitBranchChange) => {
      if (kind && cwd && commonDir) this.queueChange(cwd, commonDir, kind)
      if (closed || notification !== undefined) return
      notification = setTimeout(
        () => {
          notification = undefined
          if (!closed) {
            lastNotified = Date.now()
            notify('change')
          }
        },
        Math.max(150, lastNotified + 3000 - Date.now()),
      )
    }
    const add = (
      path: string,
      recursive: boolean,
      listener: (file: string | null, event: 'rename' | 'change') => void,
    ) => {
      const key = JSON.stringify([path, recursive])
      let shared = this.watched.get(key)
      if (!shared) {
        const listeners = new Set<{ change: typeof listener; fail: () => void }>()
        const watcher = this.watchDirectory(
          path,
          { recursive, persistent: false },
          (event, file) => {
            for (const consumer of [...listeners]) consumer.change(file, event)
          },
        )
        shared = { watcher, listeners }
        this.watched.set(key, shared)
        const failed = () => {
          for (const consumer of [...listeners]) consumer.fail()
        }
        watcher.on('error', failed)
        watcher.on('close', failed)
      }
      const consumer = {
        change: (file: string | null, event: 'rename' | 'change') => {
          if (!closed) listener(file, event)
        },
        fail,
      }
      shared.listeners.add(consumer)
      const owned = shared
      watchers.push(() => {
        owned.listeners.delete(consumer)
        if (!owned.listeners.size) {
          this.watched.delete(key)
          owned.watcher.close()
        }
      })
    }
    try {
      cwd = await resolvePath()
      if (closed) return false
      const repository = await this.git.requireRepository(cwd)
      const gitDir = normalize(
        (await runGit(cwd, ['rev-parse', '--absolute-git-dir'])).replace(/\n$/, ''),
      )
      if (closed) return false
      const { rootPath, repoCommonDir } = repository
      commonDir = repoCommonDir
      const scheduleFiles = () => {
        if (closed || checking || timer !== undefined || !files.size) return
        timer = setTimeout(
          () => {
            timer = undefined
            void checkFiles()
          },
          Math.max(150, lastChecked + 3000 - Date.now()),
        )
      }
      const checkFiles = async () => {
        const batch = [...files]
        files.clear()
        checking = true
        try {
          // Bound command arguments; an overflow conservatively invalidates the status.
          if (batch.length > 128 || batch.includes('')) {
            changed()
            return
          }
          let ignored: string[] = []
          try {
            ignored = (await runGit(rootPath, ['check-ignore', '-z', '--', ...batch])).split('\0')
          } catch (error) {
            if ((error as Error & { cause?: { code?: number } }).cause?.code !== 1) throw error
          }
          const excluded = new Set(ignored)
          if (batch.some((file) => !excluded.has(file))) changed()
        } catch {
          fail()
        } finally {
          checking = false
          lastChecked = Date.now()
          scheduleFiles()
        }
      }
      if (!metadataOnly)
        add(rootPath, true, (file) => {
          const path = process.platform === 'win32' ? file?.replaceAll('\\', '/') : file
          if (path?.split('/').includes('.git')) return
          // Unknown names and event bursts must invalidate rather than silently lose changes.
          if (files.size < 129) files.add(path || '')
          scheduleFiles()
        })
      const metadata = new Set([
        'HEAD',
        'index',
        'packed-refs',
        'config',
        'config.worktree',
        'shallow',
        'MERGE_HEAD',
        'CHERRY_PICK_HEAD',
        'REVERT_HEAD',
        'BISECT_LOG',
        'refs',
        'worktrees',
        'reftable',
        'info',
        'rebase-merge',
        'rebase-apply',
        'sequencer',
      ])
      for (const directory of new Set([gitDir, repoCommonDir])) {
        add(directory, false, (file, event) => {
          if (!file || metadata.has(file)) {
            const kind: GitBranchChange | undefined = !file
              ? 'unknown'
              : file === 'config' || file === 'config.worktree'
                ? 'config'
                : file === 'HEAD'
                  ? 'head'
                  : file === 'worktrees'
                    ? 'worktrees'
                    : ['refs', 'packed-refs', 'reftable', 'info', 'shallow'].includes(file)
                      ? 'refs'
                      : undefined
            changed(kind)
          }
          // Directory watches can stay attached to an old inode after atomic replacement.
          if (
            event === 'rename' &&
            (file === 'refs' || file === 'reftable' || file === 'info' || file === 'worktrees')
          )
            fail()
        })
        for (const name of ['refs', 'reftable', 'info', 'worktrees']) {
          const path = join(directory, name)
          try {
            if ((await stat(path)).isDirectory()) {
              if (closed) return false
              add(path, true, (file) => {
                if (file?.endsWith('.lock')) return
                const metadataFile = file?.replaceAll('\\', '/').split('/').at(-1)
                if (
                  name !== 'worktrees' ||
                  !metadataFile ||
                  ['HEAD', 'config.worktree', 'gitdir', 'commondir'].includes(metadataFile)
                )
                  changed(
                    name === 'worktrees'
                      ? metadataFile === 'config.worktree'
                        ? 'config'
                        : 'worktrees'
                      : 'refs',
                  )
              })
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
        }
        if (closed) return false
      }
      return true
    } catch {
      close()
      return false
    }
  }

  stop(value: unknown): void {
    this.subscriptions.get(terminalId(value))?.()
  }

  close(): void {
    for (const close of [...this.subscriptions.values()]) close()
    for (const change of this.changes.values()) clearTimeout(change.timer)
    this.changes.clear()
  }
}
