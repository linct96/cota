import { Menu } from 'electron'
import { COTA_SHORTCUTS, shortcutBinding } from '../../shared/shortcuts'
import type { ShortcutBindings } from '../../shared/shortcuts'
import type { Shortcut } from '../../shared/contracts'

export function installMenu(
  appName: string,
  bindings: ShortcutBindings,
  sendShortcut: (shortcut: Shortcut) => void,
  stopAllAndQuit: () => void,
): void {
  const accelerator = (id: string) => shortcutBinding(bindings, id, process.platform) || undefined
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: appName,
          submenu: [
            { role: 'about' },
            {
              label: 'Settings',
              accelerator: accelerator('settings'),
              click: () => sendShortcut('settings'),
            },
            { role: 'quit', label: '退出 Cota（保留终端会话）' },
            { label: '结束全部任务并退出', click: stopAllAndQuit },
            // Hidden menu items keep application and native editing shortcuts registered.
            ...COTA_SHORTCUTS.flatMap(([id, label]) => {
              if (id === 'settings') return []
              return [
                {
                  label,
                  visible: false,
                  accelerator: accelerator(id),
                  click: () => sendShortcut(id as Shortcut),
                },
              ]
            }),
            ...(
              [
                'undo',
                'redo',
                'cut',
                'copy',
                'paste',
                'selectAll',
                'hide',
                'hideOthers',
                'unhide',
                'minimize',
                'zoom',
              ] as const
            ).map((role) => ({ role, visible: false })),
          ],
        },
      ]),
    )
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: appName,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          {
            label: 'Settings',
            accelerator: accelerator('settings'),
            click: () => sendShortcut('settings'),
          },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit', label: '退出 Cota（保留终端会话）' },
          { label: '结束全部任务并退出', click: stopAllAndQuit },
        ],
      },
      {
        label: 'File',
        submenu: [
          {
            label: 'Open Folder',
            accelerator: accelerator('open-folder'),
            click: () => sendShortcut('open-folder'),
          },
          {
            label: 'New Terminal',
            accelerator: accelerator('new-terminal'),
            click: () => sendShortcut('new-terminal'),
          },
          {
            label: 'Split Terminal Right',
            accelerator: accelerator('split-terminal'),
            click: () => sendShortcut('split-terminal'),
          },
          {
            label: 'Split Terminal Down',
            accelerator: accelerator('split-terminal-down'),
            click: () => sendShortcut('split-terminal-down'),
          },
          {
            label: 'Reopen Closed Tab',
            accelerator: accelerator('reopen-tab'),
            click: () => sendShortcut('reopen-tab'),
          },
          {
            label: 'Close Terminal / Window',
            accelerator: accelerator('close-terminal'),
            click: () => sendShortcut('close-terminal'),
          },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          {
            label: 'Toggle Right Panel',
            accelerator: accelerator('toggle-right-panel'),
            click: () => sendShortcut('toggle-right-panel'),
          },
        ],
      },
      {
        label: 'Terminal',
        submenu: Array.from({ length: 9 }, (_, i) => ({
          label: `Select Terminal ${i + 1}`,
          accelerator: accelerator(`tab-${i + 1}`),
          click: () => sendShortcut(`tab-${i + 1}`),
        })),
      },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
    ]),
  )
}
