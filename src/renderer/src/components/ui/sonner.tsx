import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useSyncExternalStore } from 'react'
import { observeDocumentTheme } from '../../lib/theme'

export function Toaster(props: ToasterProps) {
  const dark = useSyncExternalStore(observeDocumentTheme, () =>
    document.documentElement.classList.contains('dark'),
  )
  return (
    <Sonner
      theme={dark ? 'dark' : 'light'}
      className="app-toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as CSSProperties
      }
      {...props}
    />
  )
}
