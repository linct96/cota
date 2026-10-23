import { powerSaveBlocker } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import type { AgentUpdate } from '../../shared/contracts'

export class AgentSleepPrevention {
  private enabled = false
  private disconnected = false
  private entries = new Map<string, { revision: number; working: boolean }>()
  private blockerId: number | undefined
  private child: ChildProcess | undefined
  private macFailed = false

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.refresh()
  }

  receive(event: AgentUpdate): void {
    if (event.type === 'disconnected') {
      // Host does not reconnect in-process; a pending startup snapshot must not revive its state.
      this.disconnected = true
      this.entries.clear()
      this.refresh()
      return
    }
    if (this.disconnected) return
    const id = event.type === 'state' ? event.session.terminalId : event.terminalId
    const revision = event.type === 'state' ? event.session.revision : event.revision
    if ((this.entries.get(id)?.revision ?? -1) >= revision) return
    const session = event.type === 'state' ? event.session : undefined
    this.entries.set(id, {
      revision,
      working:
        !!session &&
        session.runtimeState === 'running' &&
        session.observability !== 'unavailable' &&
        session.eventSource !== 'process' &&
        (session.activityState === 'working' || (session.workingChildren ?? 0) > 0),
    })
    this.refresh()
  }

  refresh(): void {
    if (!this.enabled || ![...this.entries.values()].some((entry) => entry.working)) {
      this.stopChild()
      this.stopBlocker()
      this.macFailed = false
      return
    }
    if (process.platform === 'darwin' && !this.macFailed) {
      if (this.child) return
      try {
        const child = spawn('/usr/bin/caffeinate', ['-i', '-s', '-w', String(process.pid)], {
          stdio: 'ignore',
          windowsHide: true,
          shell: false,
        })
        this.child = child
        const failed = () => {
          if (this.child !== child) return
          this.macFailed = true
          this.stopChild()
          console.warn('macOS 防休眠进程不可用，改用 Electron 防止自动休眠。')
          this.refresh()
        }
        child.on('error', failed)
        child.once('exit', failed)
        child.once('spawn', () => {
          if (this.child === child) this.stopBlocker()
        })
        return
      } catch {
        this.macFailed = true
        console.warn('无法启动 macOS 防休眠进程，改用 Electron 防止自动休眠。')
      }
    }
    try {
      if (this.blockerId !== undefined && powerSaveBlocker.isStarted(this.blockerId)) return
      this.blockerId = powerSaveBlocker.start('prevent-app-suspension')
    } catch (error) {
      console.warn('无法阻止系统自动休眠：', error)
    }
  }

  dispose(): void {
    this.enabled = false
    this.entries.clear()
    this.refresh()
  }

  private stopChild(): void {
    const child = this.child
    if (!child) return
    try {
      if (
        child.pid === undefined ||
        child.exitCode !== null ||
        child.signalCode !== null ||
        child.kill()
      )
        this.child = undefined
    } catch (error) {
      console.warn('无法释放 macOS 防休眠进程：', error)
    }
  }

  private stopBlocker(): void {
    if (this.blockerId === undefined) return
    try {
      powerSaveBlocker.stop(this.blockerId)
      this.blockerId = undefined
    } catch (error) {
      console.warn('无法释放系统防休眠请求：', error)
    }
  }
}
