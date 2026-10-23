import { z } from 'zod'

export const interfaceColorSchema = z
  .string()
  .regex(/^#[\da-f]{6}$/i, '请输入 #RRGGBB 格式的颜色。')
  .transform((value) => value.toLowerCase())

const colorOverridesSchema = z.object({
  primary: interfaceColorSchema.optional(),
  background: interfaceColorSchema.optional(),
  foreground: interfaceColorSchema.optional(),
})

export const interfaceColorsSchema = z.object({
  light: colorOverridesSchema.default({}),
  dark: colorOverridesSchema.default({}),
})

export type InterfaceColors = z.infer<typeof interfaceColorsSchema>
export type InterfaceColorRole = keyof InterfaceColors['light']
export const DEFAULT_INTERFACE_COLORS: InterfaceColors = { light: {}, dark: {} }
