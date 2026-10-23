const pending = new Set<() => void>()
let reading = false

function drain(): void {
  if (reading) return
  const next = pending.values().next().value
  if (!next) return
  pending.delete(next)
  reading = true
  next()
}

// Bound IPC backlog without weakening the main process's repository lock.
// shortcut: Electron invoke cannot abort an active read; only queued reads are cancelled.
export function scheduleGitDiff<T>(load: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      pending.delete(run)
      reject(signal.reason)
    }
    const run = () => {
      void Promise.resolve()
        .then(() => {
          signal.throwIfAborted()
          return load()
        })
        .then(resolve, reject)
        .finally(() => {
          signal.removeEventListener('abort', abort)
          reading = false
          drain()
        })
    }
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    pending.add(run)
    queueMicrotask(drain)
  })
}
