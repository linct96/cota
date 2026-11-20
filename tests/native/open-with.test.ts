import { mocks, root } from '../helpers/cli-environment.fixture'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { listWorkspaceOpeners, openWorkspaceWith } from '../../src/main/system/open-with'
import { isWindows } from '../../src/main/system/platform'
import * as shell from '../../src/main/system/shell'
import { DEFAULT_CONFIG } from '../../src/shared/contracts'

describe.skipIf(process.platform !== 'darwin' && !isWindows)('workspace program launching', () => {
  it('opens an explicitly configured file manager without shell evaluation', async () => {
    const command = isWindows
      ? join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe')
      : '/usr/bin/open'
    await openWorkspaceWith(root, {
      id: 'file-manager',
      name: isWindows ? 'Explorer' : 'Finder',
      command,
      arguments: isWindows ? '{path}' : '-a Finder {path}',
    })
    expect(mocks.spawn.mock.calls[0].slice(0, 2)).toEqual([
      command,
      isWindows ? [root] : ['-a', 'Finder', root],
    ])
  })

  it('finds the installed VS Code application when its CLI is absent', async () => {
    const application = isWindows
      ? join(root, 'Programs', 'Microsoft VS Code', 'Code.exe')
      : '/Applications/Visual Studio Code.app'
    if (isWindows) {
      vi.stubEnv('LOCALAPPDATA', root)
      vi.stubEnv('PATH', join(root, 'bin'))
      await mkdir(dirname(application), { recursive: true })
      await writeFile(application, '')
    } else {
      vi.spyOn(shell, 'findExecutable').mockRejectedValue(new Error('not on PATH'))
      mocks.applications.add(application)
    }

    const apps = listWorkspaceOpeners({
      ...DEFAULT_CONFIG.preferences,
      openWith: [{ id: 'vscode', name: 'VS Code', command: 'code', arguments: '{path}' }],
    })
    expect(apps).toContainEqual(expect.objectContaining({ id: 'vscode' }))
    await openWorkspaceWith(
      root,
      apps.find((entry) => entry.id === 'vscode')!,
    )
    expect(mocks.spawn.mock.calls.at(-1)!.slice(0, 2)).toEqual(
      isWindows
        ? [application, [root]]
        : ['/usr/bin/open', ['-a', application, root, '--args', root]],
    )
  })
})
