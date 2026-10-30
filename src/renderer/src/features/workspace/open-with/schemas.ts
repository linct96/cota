import { z } from 'zod'
import { parseArguments } from '../../../../../shared/open-with'
import { absolutePathPattern } from '../../../lib/path-validation'

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
