// Windows uses node-pty's shipped Node-API binaries; macOS retains its native rebuild.
module.exports = {
  extends: './electron-builder.yml',
  npmRebuild: process.platform !== 'win32',
}
