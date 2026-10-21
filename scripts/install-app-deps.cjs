const { existsSync } = require('node:fs')
const { dirname, join } = require('node:path')
const { spawnSync } = require('node:child_process')

// node-pty 1.1 ships Node-API binaries for Windows; rebuilding them needlessly requires MSVC.
if (process.platform === 'win32') {
  const root = dirname(require.resolve('node-pty/package.json'))
  const prebuilt = join(root, 'prebuilds', `win32-${process.arch}`)
  for (const name of [
    'conpty.node',
    'conpty_console_list.node',
    'conpty/conpty.dll',
    'conpty/OpenConsole.exe',
  ]) {
    if (!existsSync(join(prebuilt, name))) throw new Error(`Missing node-pty prebuild: ${name}`)
  }
  require('koffi') // Verify that the process-snapshot Node-API prebuild is installed too.
  console.log(`Using node-pty Windows ${process.arch} Node-API prebuilds`)
} else {
  const cli = require.resolve('electron-builder/cli.js')
  const result = spawnSync(process.execPath, [cli, 'install-app-deps'], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
