import { useSourceControl } from '../source-control-store'
import { gitFileKey } from '../../../../shared/source-control'
import { unwrap } from '../../../../shared/contracts'
import type { StateCreator } from 'zustand'
import type { WorkspaceState } from './types'

export const createPreferencesActions: StateCreator<
  WorkspaceState,
  [],
  [],
  Pick<WorkspaceState, 'refreshWorkspaceOpeners' | 'savePreferences'>
> = (set, get) => {
  let openersRequest = 0
  return {
    async refreshWorkspaceOpeners() {
      const request = ++openersRequest
      const openers = unwrap(await window.desktop.listWorkspaceOpeners())
      if (request === openersRequest) set({ workspaceOpeners: openers })
    },

    async savePreferences(value) {
      const saved = unwrap(await window.desktop.savePreferences(value))
      const openersChanged =
        JSON.stringify(saved.openWith) !== JSON.stringify(get().preferences.openWith)
      set({ preferences: saved })
      if (!saved.reusePreviewTabs) {
        const sourceControl = useSourceControl.getState()
        for (const [id, session] of Object.entries(sourceControl.sessions)) {
          const { file, selection } = session
          if (!file && !selection) continue
          sourceControl.update(id, {
            tabOrder: session.tabOrder.map((key) =>
              key === 'preview' ? (file ? `file:${file}` : `diff:${gitFileKey(selection!)}`) : key,
            ),
            pinnedFiles: file ? [...session.pinnedFiles, file] : session.pinnedFiles,
            pinnedDiffs: selection ? [...session.pinnedDiffs, selection] : session.pinnedDiffs,
            activePinnedFile: session.preview ? file : session.activePinnedFile,
            activePinnedDiff: session.preview ? selection : session.activePinnedDiff,
            file: undefined,
            selection: undefined,
            preview: false,
          })
        }
      }
      if (openersChanged) void get().refreshWorkspaceOpeners().catch(console.warn)
    },
  }
}
