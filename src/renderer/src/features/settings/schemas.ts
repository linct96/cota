import { z } from 'zod'
import {
  SHORTCUT_DEFINITIONS,
  shortcutConflicts,
  validateShortcutBinding,
} from '../../../../shared/shortcuts'
import { absolutePathPattern } from '../../lib/path-validation'

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
            .map(
              (key) => `“${SHORTCUT_DEFINITIONS.find(([candidateId]) => candidateId === key)![1]}”`,
            )
          context.addIssue({
            code: 'custom',
            path: ['bindings', id],
            message: `与${labels.join('、')}的快捷键冲突。`,
          })
        }
      }
    })
}
