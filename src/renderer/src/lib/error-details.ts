export function errorDetails(error: unknown, seen = new Set<unknown>()): string {
  if (!(error instanceof Error)) return String(error)
  if (seen.has(error)) return '[循环错误引用]'
  seen.add(error)
  const details = [error.stack || `${error.name}: ${error.message}`]
  if (error instanceof AggregateError) {
    for (const inner of error.errors) details.push(errorDetails(inner, seen))
  }
  if (error.cause !== undefined) details.push(`Caused by: ${errorDetails(error.cause, seen)}`)
  return details.join('\n\n')
}
