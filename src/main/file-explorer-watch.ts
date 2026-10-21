import { watch, type FSWatcher } from 'node:fs'
import { lstat } from 'node:fs/promises'
import type { FileWatchEvent } from '../shared/file-explorer'
import { FileExplorerService, explorerPath } from './file-explorer'
import { terminalId } from './validation'

export class FileExplorerWatches {
  private readonly subscriptions = new Map<string, () => void>()
  private readonly files = new FileExplorerService()

  constructor(private readonly watchDirectory: typeof watch = watch) {}

  async start(
    value: unknown,
    values: unknown,
    resolveRoot: () => Promise<string>,
    notify: (event: FileWatchEvent) => void,
  ): Promise<boolean> {
    const id = terminalId(value)
    if (!Array.isArray(values) || !values.length || values.length > 128)
      throw new Error('最多监听 128 个已展开目录，请折叠部分目录后刷新。')
    const paths = [...new Set(values.map(explorerPath))]
    if (this.subscriptions.has(id) || this.subscriptions.size >= 4)
      throw new Error('文件监听请求过多。')
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const watchers: FSWatcher[] = []
    const dirty = new Set<string>()
    const identities = new Map<string, { ino: number; dev: number }>()
    const close = () => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      for (const watcher of watchers) watcher.close()
      this.subscriptions.delete(id)
    }
    this.subscriptions.set(id, close)
    const fail = () => {
      if (closed) return
      close()
      notify({ kind: 'unavailable', error: '文件监听已中断，请手动刷新以重新连接。' })
    }
    try {
      const root = await resolveRoot()
      for (const path of paths) {
        if (closed) return false
        const target = await this.files.location(root, path, false)
        const before = await lstat(target)
        if (!before.isDirectory()) throw new Error('监听目标不是目录。')
        identities.set(path, before)
        if (closed) return false
        const watcher = this.watchDirectory(target, { persistent: false }, (_event, filename) => {
          if (closed) return
          if (filename === null || filename?.toString() === '.gitignore') {
            for (const watched of paths) dirty.add(watched)
          } else dirty.add(path)
          if (timer !== undefined) return
          timer = setTimeout(async () => {
            timer = undefined
            const changed = [...dirty]
            dirty.clear()
            try {
              // Some platforms keep watching the old inode after a directory is replaced.
              for (const path of changed) {
                const current = await this.files.location(root, path, false)
                const info = await lstat(current)
                const expected = identities.get(path)!
                if (info.ino !== expected.ino || info.dev !== expected.dev) {
                  fail()
                  return
                }
              }
              if (!closed) notify({ kind: 'change', paths: changed })
            } catch {
              fail()
            }
          }, 200)
        })
        watchers.push(watcher)
        watcher.on('error', fail)
        watcher.on('close', fail)
        await this.files.location(root, path, false)
        const after = await lstat(target)
        if (before.ino !== after.ino || before.dev !== after.dev)
          throw new Error('监听目录已改变。')
      }
      return !closed
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
