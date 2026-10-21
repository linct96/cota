import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js'
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js'
import workerUrl from 'monaco-editor/esm/vs/editor/editor.worker.js?worker&url'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from './ui/button'

// A same-origin module worker works under the existing CSP, without CDN or blob scripts.
globalThis.MonacoEnvironment = { getWorker: () => new Worker(workerUrl, { type: 'module' }) }
const views = new Map<string, monaco.editor.IDiffEditorViewState>()

export default function GitDiffEditor({
  identity,
  path,
  original,
  modified,
  sideBySide,
}: {
  identity: string
  path: string
  original: string
  modified: string
  sideBySide: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const models = useRef<{
    original: monaco.editor.ITextModel
    modified: monaco.editor.ITextModel
  } | null>(null)
  const content = useRef({ original, modified })
  content.current = { original, modified }

  useEffect(() => {
    if (!host.current) return
    const tokens = getComputedStyle(document.documentElement)
    monaco.editor.defineTheme('cota-diff', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': tokens.getPropertyValue('--source-control-editor-background').trim(),
        'diffEditor.insertedLineBackground': tokens
          .getPropertyValue('--source-control-diff-added')
          .trim(),
        'diffEditor.removedLineBackground': tokens
          .getPropertyValue('--source-control-diff-removed')
          .trim(),
      },
    })
    const editor = monaco.editor.createDiffEditor(host.current, {
      theme: 'cota-diff',
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: sideBySide,
      useInlineViewWhenSpaceIsLimited: true,
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
    const name = path.split('/').at(-1) || path
    const language =
      monaco.languages
        .getLanguages()
        .find(
          (language) =>
            language.filenames?.includes(name) ||
            language.extensions?.some((extension) => name.endsWith(extension)),
        )?.id || 'plaintext'
    // shortcut: JSON uses JS highlighting; use a dedicated tokenizer if JSON editing is added.
    const syntax = /\.jsonc?$/.test(name) ? 'javascript' : language
    const originalModel = monaco.editor.createModel(content.current.original, syntax)
    const modifiedModel = monaco.editor.createModel(content.current.modified, syntax)
    models.current = { original: originalModel, modified: modifiedModel }
    editor.setModel(models.current)
    instance.current = editor
    let restored = false
    const subscription = editor.onDidUpdateDiff(() => {
      if (restored) return
      restored = true
      const saved = views.get(identity)
      if (saved) editor.restoreViewState(saved)
      else editor.revealFirstDiff()
    })
    return () => {
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
  }, [identity, path])

  useEffect(() => {
    const current = models.current
    if (!current) return
    if (current.original.getValue() !== original) current.original.setValue(original)
    if (current.modified.getValue() !== modified) current.modified.setValue(modified)
  }, [original, modified])
  useEffect(() => {
    instance.current?.updateOptions({ renderSideBySide: sideBySide })
  }, [sideBySide])

  return (
    <div className="git-diff-editor flex min-h-0 flex-1 flex-col">
      <div className="git-diff-navigation flex shrink-0 items-center justify-end gap-1 px-3 py-1">
        <Button
          variant="ghost"
          size="icon-sm"
          className="git-diff-previous"
          title="上一个变更"
          aria-label="上一个变更"
          onClick={() => instance.current?.goToDiff('previous')}
        >
          <ChevronUp className="git-diff-previous-icon" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="git-diff-next"
          title="下一个变更"
          aria-label="下一个变更"
          onClick={() => instance.current?.goToDiff('next')}
        >
          <ChevronDown className="git-diff-next-icon" />
        </Button>
      </div>
      <div ref={host} className="git-diff-monaco min-h-0 flex-1 select-text" />
    </div>
  )
}
