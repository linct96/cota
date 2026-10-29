// Test-only entrypoint: establish isolation before importing any application module.
const assert = require('node:assert/strict')
const {
  readFileSync,
  realpathSync,
  openSync,
  closeSync,
  appendFileSync,
  writeFileSync,
} = require('node:fs')
const { join, resolve } = require('node:path')
const { homedir } = require('node:os')
const { app, dialog, session, shell, ipcMain } = require('electron')
const childProcess = require('node:child_process')

const root = realpathSync(process.env.COTA_E2E_ROOT)
assert.match(root, /^\/private\/tmp\/cota-e2e-[^/]+$/)
assert.equal(readFileSync(join(root, '.e2e'), 'utf8'), root)
assert.equal(realpathSync(homedir()), join(root, 'home'))
assert.equal(process.env.GIT_CONFIG_GLOBAL, join(root, 'home', '.gitconfig'))
assert.equal(process.env.CODEX_HOME, join(root, 'home', '.codex'))
assert.equal(process.env.PI_CODING_AGENT_DIR, join(root, 'home', '.pi', 'agent'))
assert.equal(process.env.GROK_HOME, join(root, 'home', '.grok'))
assert.ok(!app.isPackaged)
assert.ok(!app.commandLine.hasSwitch('no-sandbox'))
app.setPath('home', join(root, 'home'))
app.setPath('appData', join(root, 'profile'))
app.setPath('userData', join(root, 'profile', 'Cota Dev'))
app.setPath('sessionData', join(root, 'profile', 'Cota Dev'))
app.setPath('logs', join(root, 'logs'))
app.setPath('crashDumps', join(root, 'crashes'))

const blocked = (kind, value) => {
  appendFileSync(join(root, 'boundaries.log'), `${kind}: ${value}\n`)
  throw new Error(`E2E 不允许 ${kind}: ${value}`)
}
for (const name of ['showOpenDialog', 'showSaveDialog', 'showMessageBox']) {
  dialog[name] = async () => blocked('unexpected native dialog', name)
}
shell.openExternal = async (url) => blocked('openExternal', url)
app.on('session-created', (created) => {
  created.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      appendFileSync(join(root, 'boundaries.log'), `blocked network: ${details.url}\n`)
      callback({ cancel: true })
    },
  )
})
ipcMain.on('e2e:security', (event, security) => {
  assert.equal(event.senderFrame, event.sender.mainFrame)
  writeFileSync(join(root, 'security.json'), JSON.stringify(security), { mode: 0o600 })
})
// Register before the application creates its window; the product preload remains unchanged.
void app.whenReady().then(() => {
  session.defaultSession.registerPreloadScript({
    type: 'frame',
    filePath: resolve(__dirname, 'security.cjs'),
  })
})

const entry = resolve(__dirname, '../out/main/index.js')
const hostEntry = resolve(__dirname, '../out/main/host.js')
const spawn = childProcess.spawn
childProcess.spawn = function (command, args, options) {
  if (command === process.execPath && args?.[0] === hostEntry) {
    const log = openSync(join(root, 'host.log'), 'a', 0o600)
    try {
      return spawn(command, args, { ...options, stdio: ['ignore', log, log] })
    } finally {
      closeSync(log)
    }
  }
  return spawn(command, args, options)
}
require(entry)
