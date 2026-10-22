export { cn } from 'cn'

export function shortenPath(path: string): string {
  const parts = path.replace(/^\/(?:Users|home)\/[^/]+/, '~').split('/')
  const last = parts.reduce((last, part, index) => (part ? index : last), -1)
  return parts
    .map((part, index) =>
      index === last || part === '~' || part.endsWith(':')
        ? part
        : [...part].slice(0, part.startsWith('.') ? 2 : 1).join(''),
    )
    .join('/')
}
