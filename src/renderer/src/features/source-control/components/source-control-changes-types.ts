import { type RefObject } from 'react'
import type { ProjectWorkspace } from '../../../../../shared/contracts'
import { type GitMutation, type GitReferences } from '../../../../../shared/source-control'
import type { useCommitMessageGeneration } from '@/features/source-control/hooks/use-commit-message-generation'

export interface SourceControlChangesPanelProps {
  workspace: ProjectWorkspace
  pending: boolean
  syncing: boolean
  references?: GitReferences
  generation: ReturnType<typeof useCommitMessageGeneration>
  writing: RefObject<boolean>
  mutate: (input: GitMutation) => Promise<boolean>
  onError: (message: string) => void
}
