import { z } from 'zod'

export const workspaceFormSchema = z.object({
  name: z
    .string()
    .refine((value) => !!value.trim(), '请输入工作区名称。')
    .refine((value) => value.trim().length <= 1024, '名称最多 1024 字符。'),
})
