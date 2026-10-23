import { AppWindow, FolderOpen } from 'lucide-react'
import { siVisualstudiocode, siZedindustries } from 'simple-icons'
import type { WorkspaceOpener } from '../../../shared/contracts'
import { cn } from '../lib/utils'

export type PresetOpener = WorkspaceOpener

export { PRESET_OPENERS } from '../../../shared/open-with'

export function OpenerIcon({
  command,
  id,
  className,
}: Pick<WorkspaceOpener, 'name' | 'command'> & { id?: string; className?: string }) {
  const executable = command
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(exe|cmd|bat)$/i, '')
  const icon = ['zed', 'zeditor'].includes(executable || '')
    ? siZedindustries
    : executable === 'code'
      ? siVisualstudiocode
      : undefined
  const iconClass = cn('open-with-app-icon size-4 shrink-0', className)
  if (id === 'system-file-manager' || (id === 'finder' && executable === 'open'))
    return window.desktop.platform === 'darwin' ? (
      // Tabler Icons' brand-finder (MIT); see THIRD_PARTY_NOTICES.md.
      <svg
        className={iconClass}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path
          className="finder-icon-frame"
          d="M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1l0 -14"
        />
        <path className="finder-icon-eyes" d="M7 8v1 M17 8v1" />
        <path
          className="finder-icon-profile"
          d="M12.5 4c-.654 1.486 -1.26 3.443 -1.5 9h2.5c-.19 2.867 .094 5.024 .5 7"
        />
        <path className="finder-icon-smile" d="M7 15.5c3.667 2 6.333 2 10 0" />
      </svg>
    ) : (
      <FolderOpen className={iconClass} aria-hidden="true" />
    )
  return icon ? (
    <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path className="open-with-app-icon-path" d={icon.path} />
    </svg>
  ) : (
    <AppWindow className={iconClass} aria-hidden="true" />
  )
}
