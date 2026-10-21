import { watch, type FSWatcher } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import type { GitWatchEvent } from '../shared/contracts'
import { GitService } from './git-worktrees'
import { runGit } from './git-runner'
import { terminalId } from './validation'

export class SourceControlWatches {
  private readonly subscriptions = new Map<string, () => void>()
  private readonly git = new GitService()

  constructor(private readonly watchDirectory: typeof watch = watch) {}

  async start(
    value: unknown,
    resolvePath: () => Promise<string>,
    notify: (event: GitWatchEvent) => void,
  ): Promise<boolean> {
    const id = terminalId(value)
    if (this.subscriptions.has(id) || this.subscriptions.size >= 8)
      throw new Error('Git 监听请求过多。')
    let closed = false
    let checking = false
    let lastChecked = -Infinity
    let lastNotified = -Infinity
    let timer: ReturnType<typeof setTimeout> | undefined
    let notification: ReturnType<typeof setTimeout> | undefined
    const watchers: FSWatcher[] = []
    const files = new Set<string>()
    const close = () => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      clearTimeout(notification)
      files.clear()
      for (const watcher of watchers) watcher.close()
      this.subscriptions.delete(id)
    }
    this.subscriptions.set(id, close)
    const fail = () => {
      if (closed) return
      close()
      notify('unavailable')
    }
    const changed = () => {
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
      const watcher = this.watchDirectory(path, { recursive, persistent: false }, (event, file) => {
        if (!closed) listener(file, event)
      })
      watchers.push(watcher)
      watcher.on('error', fail)
      watcher.on('close', fail)
    }
    try {
      const cwd = await resolvePath()
      if (closed) return false
      const repository = await this.git.requireRepository(cwd)
      const gitDir = normalize(
        (await runGit(cwd, ['rev-parse', '--absolute-git-dir'])).replace(/\n$/, ''),
      )
      if (closed) return false
      const { rootPath, repoCommonDir } = repository
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
        'reftable',
        'info',
        'rebase-merge',
        'rebase-apply',
        'sequencer',
      ])
      for (const directory of new Set([gitDir, repoCommonDir])) {
        add(directory, false, (file, event) => {
          if (!file || metadata.has(file)) changed()
          // Directory watches can stay attached to an old inode after atomic replacement.
          if (event === 'rename' && (file === 'refs' || file === 'reftable' || file === 'info'))
            fail()
        })
        for (const name of ['refs', 'reftable', 'info']) {
          const path = join(directory, name)
          try {
            if ((await stat(path)).isDirectory()) {
              if (closed) return false
              add(path, true, (file) => {
                if (!file?.endsWith('.lock')) changed()
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
    for (const close of this.subscriptions.values()) close()
  }
}
