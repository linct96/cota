import { useEffect, useEffectEvent, useRef } from 'react'
import { configureMonacoTheme, languageForPath, monaco } from '../lib/monaco'

const views = new Map<string, monaco.editor.ICodeEditorViewState>()

export default function FilePreviewEditor({
  identity,
  path,
  text,
}: {
  identity: string
  path: string
  text: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const initialText = useEffectEvent(() => text)
  useEffect(() => {
    if (!host.current) return
    configureMonacoTheme()
    const model = monaco.editor.createModel(initialText(), languageForPath(path))
    const editor = monaco.editor.create(host.current, {
      theme: 'cota-editor',
      model,
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false,
      links: false,
      padding: { top: 12 },
      ariaLabel: `${path}，只读文件预览`,
    })
    const saved = views.get(identity)
    if (saved) editor.restoreViewState(saved)
    instance.current = editor
    return () => {
      const view = editor.saveViewState()
      if (view) {
        views.delete(identity)
        views.set(identity, view)
        if (views.size > 100) views.delete(views.keys().next().value!)
      }
      instance.current = null
      editor.dispose()
      model.dispose()
    }
  }, [identity, path])
  useEffect(() => {
    const editor = instance.current
    const model = editor?.getModel()
    if (!editor || !model || model.getValue() === text) return
    const view = editor.saveViewState()
    model.setValue(text)
    if (view) editor.restoreViewState(view)
  }, [text])
  return <div ref={host} className="file-preview-monaco min-h-0 flex-1 select-text" />
}
