export { cn } from 'cn'

export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

export function abbreviateHomePath(path: string): string {
  const normalize = (value: string) =>
    window.desktop.platform === 'win32' ? value.replace(/\\/g, '/').toLowerCase() : value
  const home = window.desktop.system.homeDirectory.replace(/[\\/]+$/, '')
  if (!home) return path
  const normalizedHome = normalize(home)
  const normalizedPath = normalize(path)
  if (normalizedPath === normalizedHome) return '~'
  return normalizedPath.startsWith(`${normalizedHome}/`) ? `~${path.slice(home.length)}` : path
}

export function compactPath(path: string): string {
  const parts = abbreviateHomePath(path).split('/')
  const last = parts.reduce((last, part, index) => (part ? index : last), -1)
  return parts
    .map((part, index) =>
      index === last || part === '~' || part.endsWith(':')
        ? part
        : [...part].slice(0, part.startsWith('.') ? 2 : 1).join(''),
    )
    .join('/')
}
