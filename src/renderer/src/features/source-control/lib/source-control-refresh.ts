export function createSourceControlRefreshQueue(read: () => Promise<void>, canRead: () => boolean) {
  let pending = false
  let running = false
  let lastFinished = -Infinity
  let timer: ReturnType<typeof setTimeout> | undefined

  function schedule() {
    if (!pending || running || timer !== undefined || !canRead()) return
    timer = setTimeout(
      () => {
        timer = undefined
        if (!canRead()) return
        pending = false
        running = true
        void read()
          .catch(() => {
            // The reader reports errors; a failed read must not stall the queue.
          })
          .finally(() => {
            running = false
            lastFinished = Date.now()
            schedule()
          })
      },
      Math.max(0, lastFinished + 3000 - Date.now()),
    )
  }

  return {
    request() {
      pending = true
      schedule()
    },
    flush: schedule,
    cancel() {
      pending = false
      clearTimeout(timer)
      timer = undefined
    },
  }
}
