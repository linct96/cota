import { afterEach, expect, it, vi } from 'vitest'
import { DiffEditorResources } from '../src/renderer/src/lib/diff-editor-resources'
import { scheduleGitDiff } from '../src/renderer/src/lib/git-diff-loader'
import { errorDetails } from '../src/renderer/src/lib/error-details'

afterEach(() => vi.useRealTimers())

it('isolates cleanup failures, disposes once, and releases only detached models after widget teardown', () => {
  vi.useFakeTimers()
  const failure = new AggregateError(
    [new Error('inner disposal failed')],
    'Encountered errors while disposing of store',
  )
  const report = vi.fn()
  const order: string[] = []
  const resources = new DiffEditorResources(report)
  resources.cleanups.push(() => {
    order.push('cleanup')
    throw failure
  })
  resources.editor = {
    dispose: () => {
      order.push('editor')
      throw failure
    },
  }
  const model = (name: string, attached = false) => ({
    isDisposed: () => false,
    isAttachedToEditor: () => attached,
    dispose: vi.fn(() => {
      order.push(name)
      if (name === 'original') throw failure
    }),
  })
  const original = model('original')
  const modified = model('modified')
  const attached = model('attached', true)
  resources.models.push(original, modified, attached)
  expect(() => {
    resources.dispose()
    resources.dispose()
  }).not.toThrow()
  expect(order).toEqual(['cleanup', 'editor'])
  vi.runAllTimers()
  expect(order).toEqual(['cleanup', 'editor', 'original', 'modified'])
  expect(attached.dispose).not.toHaveBeenCalled()
  expect(report).toHaveBeenCalledTimes(4)
  expect(resources.models).toEqual([])
})

it('rolls back resources acquired before editor initialization fails', () => {
  vi.useFakeTimers()
  const resources = new DiffEditorResources()
  const widget = { dispose: vi.fn() }
  const original = { dispose: vi.fn(), isDisposed: () => false, isAttachedToEditor: () => false }
  try {
    resources.editor = widget
    resources.models.push(original)
    throw new Error('second model creation failed')
  } catch {
    resources.dispose()
  }
  vi.runAllTimers()
  expect(widget.dispose).toHaveBeenCalledOnce()
  expect(original.dispose).toHaveBeenCalledOnce()
})

it('cancels queued reads without starting IPC and keeps an aborted in-flight read in its slot until settled', async () => {
  let release!: () => void
  const firstController = new AbortController()
  const queuedController = new AbortController()
  const lastController = new AbortController()
  const firstLoad = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  const queuedLoad = vi.fn(async () => 'stale')
  const lastLoad = vi.fn(async () => 'current')
  const first = scheduleGitDiff(firstLoad, firstController.signal)
  const firstRejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
  const queued = scheduleGitDiff(queuedLoad, queuedController.signal)
  const queuedRejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
  const last = scheduleGitDiff(lastLoad, lastController.signal)
  await vi.waitFor(() => expect(firstLoad).toHaveBeenCalledOnce())
  queuedController.abort()
  firstController.abort()
  await Promise.all([firstRejected, queuedRejected])
  expect(queuedLoad).not.toHaveBeenCalled()
  expect(lastLoad).not.toHaveBeenCalled()
  release()
  await expect(last).resolves.toBe('current')
  const failed = scheduleGitDiff(async () => {
    throw new Error('read failed')
  }, new AbortController().signal)
  const following = scheduleGitDiff(async () => 'recovered', new AbortController().signal)
  await expect(failed).rejects.toThrow('read failed')
  await expect(following).resolves.toBe('recovered')
})

it('retains nested aggregate errors, causes and stacks without looping on circular causes', () => {
  const cause = new Error('root cause')
  const inner = new Error('inner disposal failed', { cause })
  const error = new AggregateError([inner], 'Encountered errors while disposing of store')
  cause.cause = error
  const details = errorDetails(error)
  expect(details).toContain('Encountered errors while disposing of store')
  expect(details).toContain('inner disposal failed')
  expect(details).toContain('root cause')
  expect(details).toContain('[循环错误引用]')
  expect(details).toContain('git-diff-lifecycle.test.ts')
})
