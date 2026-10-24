import { z } from 'zod'

export const worktreeSetupSchema = z.object({
  command: z
    .string()
    .trim()
    .max(16384, '初始化命令不能超过 16,384 字符。')
    .refine((value) => !value.includes('\0'), '命令包含无效字符。'),
  copyFiles: z
    .array(
      z
        .string()
        .max(1024)
        .refine((value) => {
          const parts = value.split('/')
          return (
            !!value &&
            // eslint-disable-next-line no-control-regex -- Reject control characters at the filesystem boundary.
            !/[\\:\u0000-\u001f\u007f]/.test(value) &&
            parts.every(
              (part) =>
                !!part &&
                !/[ .]$/.test(part) &&
                !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) &&
                !['.git', 'node_modules'].includes(part.toLowerCase()),
            )
          )
        }, '请使用项目内的相对文件路径；不支持目录、符号链接、.git 或 node_modules。'),
    )
    .max(100, '最多复制 100 个文件。'),
})

export type WorktreeSetupConfig = z.infer<typeof worktreeSetupSchema>

export interface WorktreeSetupRun {
  status: 'running' | 'succeeded' | 'failed' | 'interrupted'
  startedAt: string
  finishedAt?: string
  log: string
  definition: WorktreeSetupConfig
}

export interface WorktreeSetupSnapshot {
  running: boolean
  definition: WorktreeSetupConfig
  run?: WorktreeSetupRun
}

export function setupFileLines(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ]
}
