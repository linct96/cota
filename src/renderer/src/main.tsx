import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from './router'
import './styles.css'

if (import.meta.env.DEV) {
  void import('react-grab')
}

// Terminal views own external PTY resources; do not double-mount them in development.
const router = createAppRouter()
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />)
