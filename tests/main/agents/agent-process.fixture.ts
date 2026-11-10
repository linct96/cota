import { parseAgentProcesses } from '../../../src/main/agents/runtime/process-observation'

const rows = parseAgentProcesses(
  '98765 1 98765 60000 S Mon Oct 19 10:00:00 2026\n60000 98765 60000 60000 S Mon Oct 19 10:01:00 2026\n60001 60000 60001 -1 S Mon Oct 19 10:01:01 2026',
)
const codexRows = parseAgentProcesses(
  '98765 1 98765 60000 S Mon Oct 19 10:00:00 2026 /bin/fish\n60000 98765 60000 60000 S Mon Oct 19 10:01:00 2026 /tmp/工具 path/codex\n60001 60000 60001 -1 S Mon Oct 19 10:01:01 2026 Electron',
)
const backgroundRows = [
  ...codexRows.map((row) => (row.pid === 60000 ? { ...row, command: '/usr/bin/node' } : row)),
  { ...codexRows[1], pid: 60002, parent: 60001, command: '/bin/claude' },
  {
    ...codexRows[1],
    pid: 60003,
    parent: 60001,
    command: '/usr/bin/node',
    provider: 'pi' as const,
  },
]

export { rows, codexRows, backgroundRows }
