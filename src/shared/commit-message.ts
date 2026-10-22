import type { WorkspaceTarget } from './contracts'

export interface CommitMessageRequest extends WorkspaceTarget {
  requestId: string
  indexVersion: string
}

export type CommitMessageResult =
  | { canceled: true }
  | { canceled: false; message: string; indexVersion: string; branch: string | null }

export interface CommitMessageContext {
  rootPath: string
  branch: string | null
  indexVersion: string
  summary: string
  patch: string
}
