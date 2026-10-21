import type { IParser } from '@xterm/headless'

const param = (value: number | number[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) || 0

// Observe public parser hooks without replacing xterm's native Kitty handling.
export function createTerminalKeyboardState(parser: IParser) {
  let flags = 0
  let mainFlags = 0
  let altFlags = 0
  let alternate = false
  const mainStack: number[] = []
  const altStack: number[] = []
  const reset = () => {
    flags = mainFlags = altFlags = 0
    mainStack.length = altStack.length = 0
  }
  const subscriptions = [
    ...(['=', '>', '<'] as const).map((prefix) =>
      parser.registerCsiHandler({ prefix, final: 'u' }, (params) => {
        const value = param(params[0])
        const stack = alternate ? altStack : mainStack
        if (prefix === '>') {
          if (stack.length === 16) stack.shift()
          stack.push(flags)
          flags = value
        } else if (prefix === '<') {
          const count = Math.max(1, value)
          for (let i = 0; i < count && stack.length; i++) flags = stack.pop()!
          // Match xterm's exhausted-stack behavior, including the last pop.
          if (!stack.length) flags = 0
        } else {
          const mode = param(params[1]) || 1
          if (mode === 1) flags = value
          else if (mode === 2) flags |= value
          else if (mode === 3) flags &= ~value
        }
        return false
      }),
    ),
    ...(['h', 'l'] as const).map((final) =>
      parser.registerCsiHandler({ prefix: '?', final }, (params) => {
        for (const value of params) {
          if (![47, 1047, 1049].includes(param(value))) continue
          alternate = final === 'h'
          if (alternate) {
            mainFlags = flags
            flags = altFlags
          } else {
            altFlags = flags
            flags = mainFlags
          }
        }
        return false
      }),
    ),
    parser.registerCsiHandler({ intermediates: '!', final: 'p' }, () => {
      reset()
      return false
    }),
    parser.registerEscHandler({ final: 'c' }, () => {
      reset()
      alternate = false
      return false
    }),
  ]
  return {
    get flags() {
      return flags
    },
    snapshot(content: string) {
      // SerializeAddon omits Kitty state. Seed both stacks before it paints either screen.
      const restore = (stack: number[], savedFlags: number) =>
        '\x1b[<16u' +
        stack.map((frame) => `\x1b[=${frame}u\x1b[>0u`).join('') +
        `\x1b[=${savedFlags}u`
      return (
        restore(mainStack, mainFlags) +
        '\x1b[?47h' +
        restore(altStack, altFlags) +
        '\x1b[?47l' +
        content +
        `\x1b[=${flags}u`
      )
    },
    dispose() {
      for (const subscription of subscriptions) subscription.dispose()
    },
  }
}
