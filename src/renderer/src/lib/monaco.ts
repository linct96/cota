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

// A same-origin module worker works under the existing CSP, without CDN or blob scripts.
globalThis.MonacoEnvironment = { getWorker: () => new Worker(workerUrl, { type: 'module' }) }

export function configureMonacoTheme(): void {
  const tokens = getComputedStyle(document.documentElement)
  monaco.editor.defineTheme('cota-editor', {
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
}

export function languageForPath(path: string): string {
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
  return /\.jsonc?$/.test(name) ? 'javascript' : language
}

export { monaco }
