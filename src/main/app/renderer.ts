import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import type { ConfirmationRequest } from '../../shared/contracts'

export class AppRenderer {
  ready = false
  quitting = false
  visibleTerminal: string | undefined
  pendingAgentFocus: { terminalId: string; launchId: string } | undefined
  private pendingConfirmation: { id: string; resolve(confirmed: boolean): void } | undefined

  constructor(private readonly getWindow: () => BrowserWindow | undefined) {}

  get confirming(): boolean {
    return this.pendingConfirmation !== undefined
  }

  send(channel: string, value: unknown): void {
    const window = this.getWindow()
    if (window && !window.webContents.isDestroyed()) window.webContents.send(channel, value)
  }

  warn(message: string): void {
    console.warn(message)
    if (this.ready && !this.quitting) this.send('app:warning', message)
  }

  sendAgentFocus(): void {
    const window = this.getWindow()
    if (!this.ready || !this.pendingAgentFocus || !window || window.webContents.isDestroyed())
      return
    window.webContents.send('agent:focus', this.pendingAgentFocus)
    this.pendingAgentFocus = undefined
  }

  settleConfirmation(confirmed: boolean): void {
    const pending = this.pendingConfirmation
    this.pendingConfirmation = undefined
    pending?.resolve(confirmed)
  }

  reply(id: unknown, confirmed: unknown): void {
    if (typeof id !== 'string' || typeof confirmed !== 'boolean') throw new Error('确认参数无效。')
    if (this.pendingConfirmation?.id !== id) throw new Error('确认请求已失效。')
    this.settleConfirmation(confirmed)
  }

  confirm(request: Omit<ConfirmationRequest, 'id'>): Promise<boolean> {
    const window = this.getWindow()
    if (
      this.quitting ||
      !this.ready ||
      !window ||
      window.webContents.isDestroyed() ||
      this.pendingConfirmation
    )
      return Promise.resolve(false)
    const id = randomUUID()
    return new Promise<boolean>((resolve) => {
      this.pendingConfirmation = { id, resolve }
      try {
        if (window.isMinimized()) window.restore()
        window.show()
        window.focus()
        window.webContents.send('app:confirm', { ...request, id })
      } catch {
        this.settleConfirmation(false)
      }
    })
  }

  reset(): void {
    this.ready = false
    this.visibleTerminal = undefined
    this.settleConfirmation(false)
  }
}
