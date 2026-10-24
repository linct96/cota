import { z } from 'zod'
import { parseArguments } from '../../../shared/open-with'
import {
  SHORTCUT_DEFINITIONS,
  shortcutConflicts,
  validateShortcutBinding,
} from '../../../shared/shortcuts'
import { worktreeBranchSegment } from '../../../shared/worktree-names'

import { setupFileLines, worktreeSetupSchema } from '../../../shared/worktree-setup'

export const worktreeSetupFormSchema = z.object({
  command: worktreeSetupSchema.shape.command,
  copyFiles: z
    .string()
    .max(110000, '复制文件配置过长。')
    .superRefine((value, context) => {
      const result = worktreeSetupSchema.shape.copyFiles.safeParse(setupFileLines(value))
      if (!result.success)
        context.addIssue({ code: 'custom', message: result.error.issues[0].message })
    }),
})

const absolutePathPattern = /^(?:\/|[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i

export const commitMessageFormSchema = z.object({
  message: z
    .string()
    .max(20_000, '提交信息最多 20,000 字符。')
    .refine((value) => !!value.trim(), '请输入提交信息。')
    .refine((value) => !value.includes('\0'), '提交信息不能包含空字符。'),
})

export const commitMessageSettingsSchema = z.object({
  prompt: z
    .string()
    .max(4_000, '自定义提示词最多 4,000 字符。')
    .refine((value) => !value.includes('\0'), '提示词不能包含空字符。'),
})

export const shellFormSchema = z.object({
  name: z
    .string()
    .max(80, '名称最多 80 字符。')
    .regex(/^[^\0\r\n]*$/, '名称不能包含换行或空字符。'),
  path: z
    .string()
    .max(4096, '路径最多 4096 字符。')
    .refine(
      (value) => absolutePathPattern.test(value.trim()),
      '请输入 Shell 可执行文件的绝对路径。',
    )
    .refine((value) => !value.includes('\0'), '路径不能包含空字符。'),
})

export const scrollbackFormSchema = z.object({
  scrollback: z.string().refine((value) => {
    const count = Number(value)
    return Number.isInteger(count) && count >= 1000 && count <= 20000
  }, '请输入 1,000 至 20,000 之间的整数。'),
})

export const openerFormSchema = z.object({
  name: z
    .string()
    .max(80, '名称最多 80 字符。')
    .refine((value) => !!value.trim(), '请输入应用程序名称。')
    .regex(/^[^\0\r\n]*$/, '名称不能包含换行或空字符。'),
  command: z
    .string()
    .max(4096, '启动命令最多 4096 字符。')
    .regex(/^[^\0\r\n]*$/, '启动命令不能包含换行或空字符。')
    .refine(
      (value) => absolutePathPattern.test(value.trim()) || /^[\w.+-]+$/.test(value.trim()),
      '请输入命令名或可执行文件绝对路径，参数请单独填写。',
    ),
  arguments: z
    .string()
    .max(4096, '启动参数最多 4096 字符。')
    .refine((value) => !value.includes('\0'), '启动参数不能包含空字符。')
    .superRefine((value, context) => {
      try {
        parseArguments(value)
      } catch (cause) {
        context.addIssue({
          code: 'custom',
          message: cause instanceof Error ? cause.message : '启动参数格式无效。',
        })
      }
    }),
})

export const quickCommandFormSchema = z
  .object({
    scope: z.enum(['project', 'global']),
    projectPath: z.string(),
    name: z
      .string()
      .max(80, '名称最多 80 字符。')
      .refine((value) => !!value.trim(), '命令名称不能为空。')
      .regex(/^[^\0\r\n]*$/, '名称不能包含换行或空字符。'),
    command: z
      .string()
      .max(8192, '命令最多 8192 字符。')
      .refine((value) => !!value.trim(), 'Shell 命令不能为空。')
      // oxlint-disable-next-line no-control-regex -- Allow line breaks and tabs, not terminal escape sequences.
      .regex(/^[^\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/, '命令不能包含控制字符。'),
  })
  .superRefine((value, context) => {
    if (value.scope === 'project' && !value.projectPath.trim()) {
      context.addIssue({ code: 'custom', path: ['projectPath'], message: '请选择项目。' })
    }
  })

export function shortcutSettingsFormSchema(platform: string) {
  return z
    .object({ bindings: z.record(z.string(), z.string()) })
    .superRefine(({ bindings }, context) => {
      for (const [id, binding] of Object.entries(bindings)) {
        try {
          validateShortcutBinding(binding, platform)
        } catch (cause) {
          context.addIssue({
            code: 'custom',
            path: ['bindings', id],
            message: cause instanceof Error ? cause.message : '快捷键无效。',
          })
        }
      }
      for (const group of shortcutConflicts(bindings, platform)) {
        for (const id of group) {
          const labels = group
            .filter((key) => key !== id)
            .map((key) => `“${SHORTCUT_DEFINITIONS.find(([id]) => id === key)![1]}”`)
          context.addIssue({
            code: 'custom',
            path: ['bindings', id],
            message: `与${labels.join('、')}的快捷键冲突。`,
          })
        }
      }
    })
}

export const workspaceFormSchema = z.object({
  name: z
    .string()
    .refine((value) => !!value.trim(), '请输入工作区名称。')
    .refine((value) => value.trim().length <= 1024, '名称最多 1024 字符。'),
})

export const worktreeFormSchema = z.object({
  name: z
    .string()
    .max(1024, '名称最多 1024 字符。')
    .regex(/^[^\0\r\n/]*$/, '名称不能包含斜杠、换行或空字符。')
    .refine((value) => !!worktreeBranchSegment(value), '名称需包含字母、数字或下划线。'),
  baseRef: z
    .string()
    .refine((value) => !!value.trim(), '请选择基础引用。')
    .max(1024, '基础引用最多 1024 字符。')
    .regex(/^[^\0\r\n]*$/, '基础引用不能包含换行或空字符。'),
})
