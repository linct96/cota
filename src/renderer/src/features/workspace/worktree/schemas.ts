import { z } from 'zod'
import { worktreeBranchSegment } from '../../../../../shared/worktree-names'
import { setupFileLines, worktreeSetupSchema } from '../../../../../shared/worktree-setup'

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
