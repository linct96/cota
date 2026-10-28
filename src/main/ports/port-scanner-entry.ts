import { parentPort, workerData } from 'node:worker_threads'
import type { PortScanContext } from '../../shared/workspace-ports'
import { scanLocalPorts } from './local-ports'

void scanLocalPorts(workerData as PortScanContext).then(
  (snapshot) => parentPort?.postMessage({ ok: true, value: snapshot }),
  (error: unknown) =>
    parentPort?.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : '端口扫描失败。',
    }),
)
