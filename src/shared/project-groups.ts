import { z } from 'zod'

export const projectGroupNameSchema = z
  .string()
  .trim()
  .min(1, '请输入分组名称。')
  .max(80, '分组名称不能超过 80 个字符。')
  .refine((name) => name !== '未分组', '请使用其他分组名称。')

const groupIdSchema = z.uuid()
export const projectGroupingSchema = z
  .object({
    groups: z
      .array(
        z.object({
          id: groupIdSchema,
          name: projectGroupNameSchema,
          projects: z.array(z.string().min(1).max(32768)).max(20),
          collapsed: z.boolean(),
        }),
      )
      .max(100),
  })
  .superRefine((value, context) => {
    const ids = new Set<string>()
    const names = new Set<string>()
    const projects = new Set<string>()
    for (const group of value.groups) {
      if (ids.has(group.id) || names.has(group.name))
        context.addIssue({ code: 'custom', message: '项目分组存在重复名称、标识或项目。' })
      ids.add(group.id)
      names.add(group.name)
      for (const path of group.projects) {
        if (projects.has(path))
          context.addIssue({ code: 'custom', message: '项目只能属于一个分组。' })
        projects.add(path)
      }
    }
  })

export const projectGroupingChangeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create'),
    name: projectGroupNameSchema,
    projectPath: z.string().min(1).max(32768).optional(),
  }),
  z.object({ type: z.literal('rename'), id: groupIdSchema, name: projectGroupNameSchema }),
  z.object({ type: z.literal('remove'), id: groupIdSchema }),
  z.object({
    type: z.literal('move'),
    projectPath: z.string().min(1).max(32768),
    groupId: groupIdSchema.nullable(),
  }),
  z.object({
    type: z.literal('collapse'),
    id: groupIdSchema,
    collapsed: z.boolean(),
  }),
])

export type ProjectGrouping = z.infer<typeof projectGroupingSchema>
export type ProjectGroup = ProjectGrouping['groups'][number]
export type ProjectGroupingChange = z.infer<typeof projectGroupingChangeSchema>

export function pruneProjectGrouping(
  grouping: ProjectGrouping,
  projects: string[],
): ProjectGrouping {
  return {
    ...grouping,
    groups: grouping.groups.map((group) => ({
      ...group,
      projects: group.projects.filter((path) => projects.includes(path)),
    })),
  }
}
