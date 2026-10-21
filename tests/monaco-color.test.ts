import { expect, it } from 'vitest'
// @ts-expect-error Monaco's internal token parser has no declaration file.
import { TokenTheme } from 'monaco-editor/esm/vs/editor/common/languages/supports/tokenization.js'
import { monacoColor } from '../src/renderer/src/lib/monaco-color'

it('expands minified CSS colors into colors accepted by the Monaco token parser', () => {
  expect(() => TokenTheme.createFromRawTokenTheme([{ token: '', background: '#fff' }], [])).toThrow(
    'Illegal value for token color: #fff',
  )
  for (const [input, expected] of [
    [' #fff ', '#ffffff'],
    ['#abc', '#aabbcc'],
    ['#FfFa', '#FFffFFaa'],
    ['#0000', '#00000000'],
    ['#edf9ef', '#edf9ef'],
    ['#ffffff80', '#ffffff80'],
  ]) {
    const color = monacoColor(input)
    expect(color).toBe(expected)
    expect(() =>
      TokenTheme.createFromRawTokenTheme([{ token: '', background: color }], []),
    ).not.toThrow()
  }
})
