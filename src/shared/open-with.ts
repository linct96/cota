// Parse arguments without evaluating shell expansions, substitutions, or operators.
export function parseArguments(value: string): string[] {
  const args: string[] = []
  let argument = ''
  let quote = ''
  let started = false
  for (let index = 0; index < value.length; index++) {
    const char = value[index]
    if (char === '\\' && quote !== "'") {
      const next = value[index + 1]
      if (next === undefined) throw new Error('启动参数不能以未转义的反斜杠结尾。')
      if (!quote || ['"', '\\', '$', '`'].includes(next)) {
        argument += next
        index++
      } else argument += char
      started = true
    } else if (quote) {
      if (char === quote) quote = ''
      else argument += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) args.push(argument)
      argument = ''
      started = false
    } else {
      argument += char
      started = true
    }
  }
  if (quote) throw new Error('启动参数中的引号未闭合。')
  if (started) args.push(argument)
  return args
}
