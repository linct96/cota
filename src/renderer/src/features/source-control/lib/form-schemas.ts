import { z } from 'zod'

export const createBranchFormSchema = z.object({
  name: z
    .string()
    .trim()
    .max(1013, '分支名最多 1,013 字符。')
    .refine((value) => !!value, '请输入分支名。')
    .refine((value) => !value.startsWith('-'), '分支名不能以 - 开头。')
    .refine((value) => value !== 'HEAD', '分支名不能为 HEAD。')
    // oxlint-disable-next-line no-control-regex -- Git forbids control characters in reference names.
    .regex(/^[^\x00-\x20\x7f~^:?*[\]\\]*$/, '分支名不能包含空格、控制字符或 ~ ^ : ? * [ \\。')
    .refine(
      (value) =>
        !value.includes('..') &&
        !value.includes('@{') &&
        !value.endsWith('.') &&
        value
          .split('/')
          .every((part) => !!part && !part.startsWith('.') && !part.endsWith('.lock')),
      '分支名不能包含 ..、@{、空路径段、以 . 开头或以 .lock 结尾的路径段，也不能以 . 结尾。',
    ),
})

export const commitMessageFormSchema = z.object({
  message: z
    .string()
    .max(20_000, '提交信息最多 20,000 字符。')
    .refine((value) => !!value.trim(), '请输入提交信息。')
    .refine((value) => !value.includes('\0'), '提交信息不能包含空字符。'),
})
