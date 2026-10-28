import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from './router'
import { ConfirmationDialog } from './components/ConfirmationDialog'
import { Toaster } from './components/ui/sonner'
import './styles.css'
import { useWorkspace } from './store'
import { unwrap } from '../../shared/contracts'
import { applyDocumentTheme } from './lib/theme'
import { playNotificationSound } from './lib/notification-sound'

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const updateTheme = () => {
  const state = useWorkspace.getState()
  applyDocumentTheme(
    state.ready ? state.preferences.theme : window.desktop.initialAppearance.theme,
    state.ready
      ? state.preferences.interfaceColors
      : window.desktop.initialAppearance.interfaceColors,
  )
  document.documentElement.classList.toggle(
    'window-blur',
    window.desktop.initialAppearance.windowBlur,
  )
}
updateTheme()
systemTheme.addEventListener('change', updateTheme)
const stopTheme = useWorkspace.subscribe((state, previous) => {
  if (
    state.ready !== previous.ready ||
    state.preferences.theme !== previous.preferences.theme ||
    state.preferences.interfaceColors !== previous.preferences.interfaceColors
  )
    updateTheme()
})
const stopNotificationSound = window.desktop.onNotificationSound(playNotificationSound)
const stopWarnings = window.desktop.onWarning((message) =>
  toast.warning(message, { id: `app-warning:${message}` }),
)
import.meta.hot?.dispose(() => {
  stopWarnings()
  stopNotificationSound()
  stopTheme()
  systemTheme.removeEventListener('change', updateTheme)
})

if (import.meta.env.DEV) {
  document.documentElement.classList.add('dev-text-selection')
  const copyText = (event: KeyboardEvent) => {
    if (
      !(window.desktop.platform === 'darwin' ? event.metaKey : event.ctrlKey) ||
      event.altKey ||
      event.shiftKey ||
      event.key.toLowerCase() !== 'c' ||
      !(event.target instanceof Element) ||
      event.target.closest('.xterm, input, textarea, [contenteditable]')
    )
      return
    const text = window.getSelection()?.toString()
    if (!text) return
    event.preventDefault()
    void window.desktop.writeClipboard(text).then(unwrap).catch(console.error)
  }
  document.addEventListener('keydown', copyText)
  import.meta.hot?.dispose(() => {
    document.removeEventListener('keydown', copyText)
    document.documentElement.classList.remove('dev-text-selection')
  })
  void import('react-grab')
}

// Terminal views own external PTY resources; do not double-mount them in development.
const router = createAppRouter()
createRoot(document.getElementById('root')!).render(
  <>
    {/* Confirmation stays available when a route error replaces the application. */}
    <ConfirmationDialog />
    <Toaster
      closeButton
      containerAriaLabel="操作结果提示"
      toastOptions={{ duration: 6000, closeButtonAriaLabel: '关闭提示' }}
    />
    <RouterProvider router={router} />
  </>,
)
