import type { editor } from 'monaco-editor'
import { errorDetails } from './error-details'

type TextModel = Pick<editor.ITextModel, 'dispose' | 'isDisposed' | 'isAttachedToEditor'>

export class DiffEditorResources {
  editor?: Pick<editor.IStandaloneDiffEditor, 'dispose'>
  models: TextModel[] = []
  cleanups: (() => void)[] = []
  disposed = false

  constructor(
    private readonly reportError: (error: unknown) => void = (error) =>
      console.warn('[monaco] Diff 资源清理失败', errorDetails(error)),
  ) {}

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const attempt = (action: () => void) => {
      try {
        action()
      } catch (error) {
        this.reportError(error)
      }
    }
    for (const cleanup of this.cleanups.splice(0)) attempt(cleanup)
    const widget = this.editor
    this.editor = undefined
    if (widget) attempt(() => widget.dispose())
    const models = this.models.splice(0)
    // Monaco may still be detaching its panes during React cleanup.
    if (models.length)
      setTimeout(() => {
        for (const model of models)
          attempt(() => {
            if (model.isDisposed()) return
            if (model.isAttachedToEditor()) {
              throw new Error('Diff 文本模型仍被编辑器引用，跳过释放。')
            }
            model.dispose()
          })
      }, 0)
  }
}
