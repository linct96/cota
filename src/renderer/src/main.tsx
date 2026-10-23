import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from './router'
import { ConfirmationDialog } from './components/ConfirmationDialog'
import './styles.css'
import { useWorkspace } from './store'
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
import.meta.hot?.dispose(() => {
  stopNotificationSound()
  stopTheme()
  systemTheme.removeEventListener('change', updateTheme)
})

if (import.meta.env.DEV) {
  void import('react-grab')
}

// Terminal views own external PTY resources; do not double-mount them in development.
const router = createAppRouter()
createRoot(document.getElementById('root')!).render(
  <>
    {/* Confirmation stays available when a route error replaces the application. */}
    <ConfirmationDialog />
    <RouterProvider router={router} />
  </>,
)
