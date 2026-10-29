// Observe the real preload realm without exposing any new renderer capability.
const { ipcRenderer } = require('electron')
if (process.isMainFrame) {
  ipcRenderer.send('e2e:security', {
    sandboxed: process.sandboxed,
    contextIsolated: process.contextIsolated,
  })
}
