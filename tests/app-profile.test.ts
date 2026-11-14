import { beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { hostDirectory } from '../src/main/host/host-client'
import type * as FsModule from 'node:fs'
import type * as OsModule from 'node:os'

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  app: {
    isPackaged: false,
    getPath: vi.fn(),
    setName: vi.fn(),
    setPath: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => false),
    quit: vi.fn(),
  },
}))
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof FsModule>()),
  mkdirSync: mocks.mkdir,
}))
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof OsModule>()),
  homedir: () => '/home/cota-test',
}))
vi.mock('electron', () => ({ app: mocks.app }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.app.getPath.mockReturnValue('/profiles')
})

describe('application profile isolation', () => {
  it('separates development configuration and runtime data before acquiring the single-instance lock', async () => {
    mocks.app.isPackaged = false
    await import('../src/main/index')

    const configDirectory = join('/home/cota-test', '.cota-dev')
    const profile = join('/profiles', 'Cota Dev')
    expect(mocks.mkdir.mock.calls).toEqual([
      [configDirectory, { recursive: true, mode: 0o700 }],
      [profile, { recursive: true, mode: 0o700 }],
    ])
    expect(mocks.app.getPath).toHaveBeenCalledExactlyOnceWith('appData')
    expect(mocks.app.setName).toHaveBeenCalledExactlyOnceWith('Cota Dev')
    expect(mocks.app.setPath.mock.calls).toEqual([
      ['userData', profile],
      ['sessionData', profile],
    ])
    expect(mocks.mkdir.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.app.setPath.mock.invocationCallOrder[0],
    )
    expect(mocks.app.setPath.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.app.requestSingleInstanceLock.mock.invocationCallOrder[0],
    )
    expect(hostDirectory(profile)).not.toBe(hostDirectory(join('/profiles', 'cota')))
    expect(mocks.app.quit).toHaveBeenCalledOnce()
  })

  it('keeps production configuration in home and leaves runtime paths at their defaults', async () => {
    mocks.app.isPackaged = true
    await import('../src/main/index')

    expect(mocks.mkdir).toHaveBeenCalledExactlyOnceWith(join('/home/cota-test', '.cota'), {
      recursive: true,
      mode: 0o700,
    })
    expect(mocks.app.getPath).not.toHaveBeenCalled()
    expect(mocks.app.setPath).not.toHaveBeenCalled()
    expect(mocks.app.setName).not.toHaveBeenCalled()
    expect(mocks.mkdir.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.app.requestSingleInstanceLock.mock.invocationCallOrder[0],
    )
    expect(mocks.app.requestSingleInstanceLock).toHaveBeenCalledOnce()
    expect(mocks.app.quit).toHaveBeenCalledOnce()
  })
})
