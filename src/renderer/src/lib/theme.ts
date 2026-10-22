import type { ThemePreference } from '../../../shared/contracts'

export function applyDocumentTheme(theme: ThemePreference): void {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.classList.toggle('light', !dark)
}

export function observeDocumentTheme(listener: () => void): () => void {
  let previous = document.documentElement.classList.contains('dark')
  const observer = new MutationObserver(() => {
    const dark = document.documentElement.classList.contains('dark')
    if (dark === previous) return
    previous = dark
    listener()
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}
