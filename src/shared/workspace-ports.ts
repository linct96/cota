import type { WorkspaceTarget } from './contracts'

// Host-only identity; never exposed to the renderer as an authority for process actions.
export interface TerminalProcessRoot extends WorkspaceTarget {
  terminalId: string
  cwd: string
  pid: number
  started: string
}

export interface PortWorkspace extends WorkspaceTarget {
  name: string
  cwd: string
}

export interface WorkspacePort {
  id: string
  pid: number
  processName: string
  address: string
  port: number
  connectAddress: string
  httpUrl?: string
  owner?: WorkspaceTarget & { terminalId?: string; evidence: 'terminal' | 'cwd' }
}

export interface WorkspacePortSnapshot {
  scannedAt: number
  ports: WorkspacePort[]
  warnings: string[]
}

export interface PortScanContext {
  workspaces: PortWorkspace[]
  roots: TerminalProcessRoot[]
}
