import { AppWindow, FolderOpen } from 'lucide-react'
import { siVisualstudiocode, siZedindustries } from 'simple-icons'
import type { WorkspaceOpener } from '../../../shared/contracts'
import { cn } from '../lib/utils'

export type PresetOpener = WorkspaceOpener

export const PRESET_OPENERS: PresetOpener[] = [
  { id: 'zed', name: 'Zed', command: 'zed', arguments: '{path}' },
  { id: 'vscode', name: 'VS Code', command: 'code', arguments: '{path}' },
]

export function OpenerIcon({
  command,
  id,
  className,
}: Pick<WorkspaceOpener, 'name' | 'command'> & { id?: string; className?: string }) {
  const executable = command.split('/').pop()
  const icon =
    executable === 'zed' ? siZedindustries : executable === 'code' ? siVisualstudiocode : undefined
  const iconClass = cn('open-with-app-icon size-4 shrink-0', className)
  if (id === 'finder' && executable === 'open')
    return <FolderOpen className={iconClass} aria-hidden="true" />
  return icon ? (
    <svg className={iconClass} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path className="open-with-app-icon-path" d={icon.path} />
    </svg>
  ) : (
    <AppWindow className={iconClass} aria-hidden="true" />
  )
}
