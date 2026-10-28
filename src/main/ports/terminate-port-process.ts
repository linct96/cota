import type { WorkspacePort } from '../../shared/workspace-ports'
import { macProcessIdentity } from '../system/mac-process-identity'
import { terminateWindowsProcess } from '../system/windows-process-snapshot'

export function terminatePortProcess(port: WorkspacePort): void {
  if (!Number.isSafeInteger(port.pid) || port.pid <= 1 || port.pid === process.pid)
    throw new Error('不允许终止此进程。')
  // The caller supplies a newly scanned row, never a renderer-provided PID or identity.
  const expected: unknown = JSON.parse(port.id)[4]
  if (typeof expected !== 'string' || !expected)
    throw new Error('无法确认监听进程身份，请刷新后重试。')
  if (process.platform === 'win32') {
    terminateWindowsProcess(port.pid, expected)
    return
  }
  if (process.platform !== 'darwin') throw new Error('关闭端口目前仅支持 macOS 和 Windows。')
  const current = macProcessIdentity(port.pid)
  if (!current || current.started !== expected)
    throw new Error('监听进程已退出或身份已变化，请刷新后重试。')
  if (current.system || current.uid !== process.getuid!())
    throw new Error('只能终止当前用户的非系统进程。')
  // macOS signals by PID; keep the microsecond identity check and signal synchronous.
  process.kill(port.pid, 'SIGKILL')
}
