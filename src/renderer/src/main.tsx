import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

if (import.meta.env.DEV) {
  void import('react-grab')
}

// Terminal views own external PTY resources; do not double-mount them in development.
createRoot(document.getElementById('root')!).render(<App />)
