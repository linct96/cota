import type { HostingProvider, HostingRepository } from '../../shared/code-hosting'
import { hostingHostSchema } from '../../shared/code-hosting'

export function parseHostingRemote(
  value: string,
  provider?: HostingProvider,
  hostOverride?: string,
): HostingRepository | null {
  try {
    let host: string
    let path: string
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
      const url = new URL(value)
      if (!['https:', 'http:', 'ssh:'].includes(url.protocol) || url.search || url.hash) return null
      host = url.protocol === 'ssh:' ? url.hostname : url.host
      path = url.pathname.replace(/^\//, '')
    } else {
      const ssh = /^(?:[^@\s/:]+@)?([^\s/:]+):(.+)$/.exec(value)
      if (!ssh) return null
      host = ssh[1]
      path = ssh[2]
    }
    host = hostingHostSchema.parse(hostOverride || host)
    path = path.replace(/\.git\/?$/, '').replace(/\/$/, '')
    const segments = path.split('/').map(decodeURIComponent)
    if (
      segments.length < 2 ||
      segments.some(
        (segment) => !/^[a-zA-Z0-9_.-]+$/.test(segment) || segment === '.' || segment === '..',
      )
    )
      return null
    const selected =
      provider || (host === 'github.com' ? 'github' : host === 'gitlab.com' ? 'gitlab' : undefined)
    if (!selected || (selected === 'github' && segments.length !== 2)) return null
    return { provider: selected, host, path: segments.join('/') }
  } catch {
    return null
  }
}
