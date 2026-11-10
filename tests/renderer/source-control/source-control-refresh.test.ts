import { describe, expect, it, vi } from 'vitest'
import { createSourceControlRefreshQueue } from '../../../src/renderer/src/features/source-control/lib/source-control-refresh'

describe('Source control refresh queue', () => {
  it('coalesces Git refreshes and retains trailing signals across reads and writes', async () => {
    vi.useFakeTimers()
    let visible = true
    let writing = false
    let finish!: () => void
    const read = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const queue = createSourceControlRefreshQueue(read, () => visible && !writing)
    try {
      queue.request()
      queue.request()
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(1)
      queue.request()
      queue.request()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(read).toHaveBeenCalledTimes(1)
      finish()
      await vi.advanceTimersByTimeAsync(2999)
      expect(read).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(read).toHaveBeenCalledTimes(2)
      finish()
      await vi.advanceTimersByTimeAsync(3000)

      writing = true
      queue.request()
      queue.request()
      await vi.advanceTimersByTimeAsync(5000)
      expect(read).toHaveBeenCalledTimes(2)
      writing = false
      queue.flush()
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(3)
      finish()
      await vi.advanceTimersByTimeAsync(0)

      queue.request()
      visible = false
      await vi.advanceTimersByTimeAsync(5000)
      expect(read).toHaveBeenCalledTimes(3)
      visible = true
      queue.request()
      await vi.advanceTimersByTimeAsync(0)
      expect(read).toHaveBeenCalledTimes(4)
      queue.request()
      queue.cancel()
      finish()
      await vi.advanceTimersByTimeAsync(5000)
      expect(read).toHaveBeenCalledTimes(4)

      queue.request()
      queue.cancel()
      await vi.advanceTimersByTimeAsync(5000)
      expect(read).toHaveBeenCalledTimes(4)
      read.mockRejectedValueOnce(new Error('Git unavailable'))
      queue.request()
      await vi.advanceTimersByTimeAsync(0)
      queue.request()
      await vi.advanceTimersByTimeAsync(3000)
      expect(read).toHaveBeenCalledTimes(6)
      finish()
      await vi.advanceTimersByTimeAsync(0)
    } finally {
      queue.cancel()
      vi.useRealTimers()
    }
  })
})
