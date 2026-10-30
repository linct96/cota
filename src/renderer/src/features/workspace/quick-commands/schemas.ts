import { z } from 'zod'

export const quickCommandFormSchema = z
  .object({
    mode: z.enum(['task', 'service']),
    port: z.string(),
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
    if (
      value.mode === 'service' &&
      value.port.trim() &&
      value.port.trim() !== 'auto' &&
      (!/^\d+$/.test(value.port.trim()) || Number(value.port) < 1024 || Number(value.port) > 65535)
    )
      context.addIssue({
        code: 'custom',
        path: ['port'],
        message: '请输入 auto 或 1024–65535 的端口，留空则不分配。',
      })
    if (value.scope === 'project' && !value.projectPath.trim()) {
      context.addIssue({ code: 'custom', path: ['projectPath'], message: '请选择项目。' })
    }
  })
