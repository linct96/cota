import { useEffect, useEffectEvent, useImperativeHandle, useRef, type Ref } from 'react'
import { configureMonacoTheme, languageForPath, monaco } from '../lib/monaco'
const views = new Map<string, monaco.editor.IDiffEditorViewState>()

export type GitDiffEditorHandle = {
  goToDiff: (direction: 'previous' | 'next') => void
  collapseUnchangedRegions: () => void
}

export default function GitDiffEditor({
  ref,
  identity,
  path,
  original,
  modified,
  sideBySide,
  wordWrap,
  showWhitespace,
  onStatsChange,
}: {
  ref?: Ref<GitDiffEditorHandle>
  identity: string
  path: string
  original: string
  modified: string
  sideBySide: boolean
  wordWrap: boolean
  showWhitespace: boolean
  onStatsChange: (stats: { additions: number; deletions: number }) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const models = useRef<{
    original: monaco.editor.ITextModel
    modified: monaco.editor.ITextModel
  } | null>(null)
  const initialContent = useEffectEvent(() => ({ original, modified }))
  const initialOptions = useEffectEvent(() => ({ sideBySide, wordWrap, showWhitespace }))

  useImperativeHandle(
    ref,
    () => ({
      goToDiff: (direction) => instance.current?.goToDiff(direction),
      collapseUnchangedRegions: () => {
        // Disabling hidden regions resets their expansion state through Monaco's public options.
        instance.current?.updateOptions({ hideUnchangedRegions: { enabled: false } })
        instance.current?.updateOptions({ hideUnchangedRegions: { enabled: true } })
      },
    }),
    [],
  )

  useEffect(() => {
    if (!host.current) return
    const container = host.current
    // Monaco makes descendants visible explicitly; opacity hides the entire subtree without resizing.
    container.style.visibility = 'hidden'
    container.style.opacity = '0'
    container.inert = true
    configureMonacoTheme()
    const { sideBySide, wordWrap, showWhitespace } = initialOptions()
    const content = initialContent()
    const editor = monaco.editor.createDiffEditor(container, {
      theme: 'cota-editor',
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: sideBySide,
      diffWordWrap: wordWrap ? 'on' : 'off',
      renderWhitespace: showWhitespace ? 'all' : 'none',
      useInlineViewWhenSpaceIsLimited: false,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
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
    editor.getOriginalEditor().updateOptions({ lineNumbers: sideBySide ? 'on' : 'off' })
    const syntax = languageForPath(path)
    const originalModel = monaco.editor.createModel(content.original, syntax)
    const modifiedModel = monaco.editor.createModel(content.modified, syntax)
    models.current = { original: originalModel, modified: modifiedModel }
    editor.setModel(models.current)
    instance.current = editor
    let restored = false
    let revealFrame: number | undefined
    const subscription = editor.onDidUpdateDiff(() => {
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
      if (restored || !changes) return
      restored = true
      const saved = views.get(identity)
      if (saved) editor.restoreViewState(saved)
      else editor.revealFirstDiff()
      revealFrame = requestAnimationFrame(() => {
        editor.getOriginalEditor().render(true)
        editor.getModifiedEditor().render(true)
        container.style.visibility = 'visible'
        container.style.opacity = '1'
        container.inert = false
      })
    })
    return () => {
      if (revealFrame !== undefined) cancelAnimationFrame(revealFrame)
      container.style.visibility = 'hidden'
      container.style.opacity = '0'
      container.inert = true
      const saved = editor.saveViewState()
      if (saved) {
        views.delete(identity)
        views.set(identity, saved)
        if (views.size > 100) views.delete(views.keys().next().value!)
      }
      subscription.dispose()
      instance.current = null
      models.current = null
      editor.dispose()
      originalModel.dispose()
      modifiedModel.dispose()
    }
  }, [identity, path, onStatsChange])

  useEffect(() => {
    const current = models.current
    if (!current) return
    if (current.original.getValue() !== original) current.original.setValue(original)
    if (current.modified.getValue() !== modified) current.modified.setValue(modified)
  }, [original, modified])
  useEffect(() => {
    instance.current?.updateOptions({
      renderSideBySide: sideBySide,
      diffWordWrap: wordWrap ? 'on' : 'off',
      renderWhitespace: showWhitespace ? 'all' : 'none',
    })
    instance.current?.getOriginalEditor().updateOptions({ lineNumbers: sideBySide ? 'on' : 'off' })
  }, [sideBySide, wordWrap, showWhitespace])

  return <div ref={host} className="git-diff-monaco min-h-0 flex-1 select-text" />
}
