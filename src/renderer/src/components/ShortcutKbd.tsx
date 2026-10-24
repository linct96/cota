import { formatShortcut } from '../../../shared/shortcuts'
import { Kbd, KbdGroup } from './ui/kbd'

export function ShortcutKbd({ binding }: { binding: string }) {
  if (!binding) return null

  return (
    <KbdGroup className="shortcut-keys">
      {formatShortcut(binding, window.desktop.platform)
        .split('+')
        .map((key) => (
          <Kbd key={key} className="shortcut-key">
            {key}
          </Kbd>
        ))}
    </KbdGroup>
  )
}
