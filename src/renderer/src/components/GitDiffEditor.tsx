import { useEffect, useEffectEvent, useImperativeHandle, useRef, type Ref } from 'react'
import { configureMonacoTheme, languageForPath, monaco } from '../lib/monaco'
import { cn } from '../lib/utils'
import { DiffEditorResources } from '../lib/diff-editor-resources'
const views = new Map<string, monaco.editor.IDiffEditorViewState>()

export type GitDiffEditorHandle = {
  goToDiff: (direction: 'previous' | 'next') => void
  collapseUnchangedRegions: () => void
}

export default function GitDiffEditor({
  ref,
  identity,
  embedded = false,
  initialHeight = 128,
  path,
  original,
  modified,
  sideBySide,
  wordWrap,
  showWhitespace,
  onStatsChange,
  onError,
}: {
  ref?: Ref<GitDiffEditorHandle>
  identity: string
  embedded?: boolean
  initialHeight?: number
  path: string
  original: string
  modified: string
  sideBySide: boolean
  wordWrap: boolean
  showWhitespace: boolean
  onStatsChange: (stats: { additions: number; deletions: number }) => void
  onError: (error: unknown) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const models = useRef<{
    original: monaco.editor.ITextModel
    modified: monaco.editor.ITextModel
  } | null>(null)
  const initialContent = useEffectEvent(() => ({ original, modified, height: initialHeight }))
  const initialOptions = useEffectEvent(() => ({ sideBySide, wordWrap, showWhitespace }))

  useImperativeHandle(
    ref,
    () => ({
      goToDiff: (direction) => {
        try {
          instance.current?.goToDiff(direction)
        } catch (error) {
          onError(error)
        }
      },
      collapseUnchangedRegions: () => {
        try {
          // Disabling hidden regions resets their expansion state through Monaco's public options.
          instance.current?.updateOptions({ hideUnchangedRegions: { enabled: false } })
          instance.current?.updateOptions({ hideUnchangedRegions: { enabled: true } })
        } catch (error) {
          onError(error)
        }
      },
    }),
    [onError],
  )

  useEffect(() => {
    if (!host.current) return
    const container = host.current
    const resources = new DiffEditorResources()
    let revealFrame: number | undefined
    let sizeFrame: number | undefined
    let layoutEditor: (() => void) | undefined
    resources.cleanups.push(() => {
      if (revealFrame !== undefined) cancelAnimationFrame(revealFrame)
      if (sizeFrame !== undefined) cancelAnimationFrame(sizeFrame)
      instance.current = null
      models.current = null
      container.style.visibility = 'hidden'
      container.style.opacity = '0'
      container.inert = true
    })
    const runSafely = (action: () => void) => {
      if (resources.disposed) return
      try {
        action()
      } catch (error) {
        resources.dispose()
        onError(error)
      }
    }
    const mountEditor = () => {
      // Hidden panels retain existing editors but never create new ones at zero width.
      if (resources.disposed || resources.editor || (embedded && !container.clientWidth)) return
      try {
        const viewIdentity = embedded ? `document:${identity}` : identity
        const content = initialContent()
        if (embedded && !container.style.height) container.style.height = `${content.height}px`
        // Monaco makes descendants visible explicitly; opacity hides the entire subtree without resizing.
        container.style.visibility = 'hidden'
        container.style.opacity = '0'
        container.inert = true
        configureMonacoTheme()
        const { sideBySide, wordWrap, showWhitespace } = initialOptions()
        const editor = monaco.editor.createDiffEditor(container, {
          theme: 'cota-editor',
          readOnly: true,
          originalEditable: false,
          automaticLayout: !embedded,
          renderSideBySide: sideBySide,
          diffWordWrap: wordWrap ? 'on' : 'off',
          renderWhitespace: showWhitespace ? 'all' : 'none',
          useInlineViewWhenSpaceIsLimited: false,
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          scrollbar: embedded ? { vertical: 'hidden', alwaysConsumeMouseWheel: false } : undefined,
          stickyScroll: embedded ? { enabled: false } : undefined,
          hideUnchangedRegions: { enabled: true },
          ignoreTrimWhitespace: false,
          maxComputationTime: 2000,
          renderOverviewRuler: false,
          links: false,
          accessibilityVerbose: true,
          originalAriaLabel: '更改前，只读',
          modifiedAriaLabel: '更改后，只读',
          padding: { top: 12 },
        })
        resources.editor = editor
        editor.getOriginalEditor().updateOptions({ lineNumbers: sideBySide ? 'on' : 'off' })
        const syntax = languageForPath(path)
        const originalModel = monaco.editor.createModel(content.original, syntax)
        resources.models.push(originalModel)
        const modifiedModel = monaco.editor.createModel(content.modified, syntax)
        resources.models.push(modifiedModel)
        models.current = { original: originalModel, modified: modifiedModel }
        editor.setModel(models.current)
        instance.current = editor
        resources.cleanups.push(() => {
          const saved = editor.saveViewState()
          if (saved) {
            views.delete(viewIdentity)
            views.set(viewIdentity, saved)
            if (views.size > 100) views.delete(views.keys().next().value!)
          }
        })
        let restored = false
        let layoutWidth = container.clientWidth
        let layoutHeight = container.clientHeight
        // shortcut: visible files use full-height Monaco; use row virtualization if large diffs get slow.
        const layoutContent = () => {
          if (resources.disposed || !embedded || !restored || sizeFrame !== undefined) return
          sizeFrame = requestAnimationFrame(() =>
            runSafely(() => {
              sizeFrame = undefined
              const width = container.clientWidth
              // A collapsed panel must not relayout Monaco to zero width and invalidate wrapping.
              if (!width) return
              const height = Math.max(
                editor.getOriginalEditor().getContentHeight(),
                editor.getModifiedEditor().getContentHeight(),
              )
              if (width === layoutWidth && height === layoutHeight) return
              layoutWidth = width
              layoutHeight = height
              container.style.height = `${height}px`
              editor.layout({ width, height })
            }),
          )
        }
        layoutEditor = layoutContent
        if (embedded) {
          for (const pane of [editor.getOriginalEditor(), editor.getModifiedEditor()]) {
            const subscription = pane.onDidContentSizeChange(layoutContent)
            resources.cleanups.push(() => subscription.dispose())
          }
        }
        const subscription = editor.onDidUpdateDiff(() =>
          runSafely(() => {
            const changes = editor.getLineChanges()
            if (changes) {
              onStatsChange(
                changes.reduce(
                  (stats, change) => ({
                    additions:
                      stats.additions +
                      (change.modifiedEndLineNumber === 0
                        ? 0
                        : change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1),
                    deletions:
                      stats.deletions +
                      (change.originalEndLineNumber === 0
                        ? 0
                        : change.originalEndLineNumber - change.originalStartLineNumber + 1),
                  }),
                  { additions: 0, deletions: 0 },
                ),
              )
            }
            if (!changes) return
            if (restored) {
              layoutContent()
              return
            }
            restored = true
            const saved = views.get(viewIdentity)
            if (saved) editor.restoreViewState(saved)
            else if (!embedded) editor.revealFirstDiff()
            if (embedded) {
              editor.getOriginalEditor().setScrollTop(0)
              editor.getModifiedEditor().setScrollTop(0)
            }
            layoutContent()
            revealFrame = requestAnimationFrame(() =>
              runSafely(() => {
                editor.getOriginalEditor().render(true)
                editor.getModifiedEditor().render(true)
                container.style.visibility = 'visible'
                container.style.opacity = '1'
                container.inert = false
              }),
            )
          }),
        )
        resources.cleanups.push(() => subscription.dispose())
      } catch (error) {
        resources.dispose()
        onError(error)
      }
    }
    const observer = embedded
      ? new ResizeObserver(() =>
          runSafely(() => {
            mountEditor()
            layoutEditor?.()
          }),
        )
      : undefined
    resources.cleanups.push(() => observer?.disconnect())
    observer?.observe(container)
    mountEditor()
    return () => resources.dispose()
  }, [identity, path, onStatsChange, onError, embedded])

  useEffect(() => {
    const current = models.current
    if (!current) return
    try {
      if (current.original.getValue() !== original) current.original.setValue(original)
      if (current.modified.getValue() !== modified) current.modified.setValue(modified)
    } catch (error) {
      onError(error)
    }
  }, [original, modified, onError])
  useEffect(() => {
    try {
      instance.current?.updateOptions({
        renderSideBySide: sideBySide,
        diffWordWrap: wordWrap ? 'on' : 'off',
        renderWhitespace: showWhitespace ? 'all' : 'none',
      })
      instance.current
        ?.getOriginalEditor()
        .updateOptions({ lineNumbers: sideBySide ? 'on' : 'off' })
    } catch (error) {
      onError(error)
    }
  }, [sideBySide, wordWrap, showWhitespace, onError])

  return (
    <div
      ref={host}
      className={cn('git-diff-monaco min-h-0 select-text', embedded ? 'w-full shrink-0' : 'flex-1')}
      onWheelCapture={(event) => {
        // Let the document scroll vertically; keep Monaco's horizontal wheel handling.
        if (embedded && !event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.stopPropagation()
        }
      }}
    />
  )
}
