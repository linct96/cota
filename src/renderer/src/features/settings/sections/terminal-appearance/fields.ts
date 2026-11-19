import { SYSTEM_DEFAULT_TERMINAL_FONT } from '../../../../../../shared/terminal-appearance'

export const FONT_OPTIONS = [
  SYSTEM_DEFAULT_TERMINAL_FONT,
  'Menlo',
  'Monaco',
  'Consolas',
  'Cascadia Code',
  'JetBrains Mono',
  'Fira Code',
  'SF Mono',
  'monospace',
]

export const APPEARANCE_GROUPS = [
  { name: 'theme', label: '终端主题' },
  { name: 'typography', label: '字体与背景' },
  { name: 'cursor', label: '光标与鼠标' },
] as const

export const NUMBER_FIELDS = [
  {
    name: 'fontWeight',
    label: '常规字重',
    description: '范围 100–900。',
    min: 100,
    max: 900,
    step: 100,
    group: 'typography',
  },
  {
    name: 'fontWeightBold',
    label: '粗体字重',
    description: '范围 100–900。',
    min: 100,
    max: 900,
    step: 100,
    group: 'typography',
  },
  {
    name: 'lineHeight',
    label: '行高',
    description: '范围 1–3。',
    min: 1,
    max: 3,
    step: 0.05,
    group: 'typography',
  },
  {
    name: 'letterSpacing',
    label: '字符间距',
    description: '范围 -2–10 px。',
    min: -2,
    max: 10,
    step: 0.1,
    group: 'typography',
  },
  {
    name: 'cursorOpacity',
    label: '光标不透明度',
    description: '范围 0–1。',
    min: 0,
    max: 1,
    step: 0.05,
    group: 'cursor',
  },
] as const

export const BACKGROUND_NUMBER_FIELDS = [
  {
    name: 'backgroundOpacity',
    label: '背景透明度',
    description: '范围 0–1。',
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    name: 'paddingX',
    label: '水平内边距',
    description: '范围 0–128 px。',
    min: 0,
    max: 128,
    step: 1,
  },
  {
    name: 'paddingY',
    label: '垂直内边距',
    description: '范围 0–128 px。',
    min: 0,
    max: 128,
    step: 1,
  },
] as const

export const ENUM_FIELDS = [
  {
    name: 'ligatures',
    label: '字体连字',
    group: 'typography',
    options: [
      ['auto', '自动'],
      ['on', '开启'],
      ['off', '关闭'],
    ],
  },
  {
    name: 'cursorStyle',
    label: '光标形状',
    group: 'cursor',
    options: [
      ['bar', '竖线'],
      ['block', '方块'],
      ['underline', '下划线'],
    ],
  },
] as const

export const SWITCH_FIELDS = [
  { name: 'cursorBlink', label: '光标闪烁', group: 'cursor' },
  { name: 'mouseHideWhileTyping', label: '输入时隐藏鼠标指针', group: 'cursor' },
] as const

export type AppearanceGroup = (typeof APPEARANCE_GROUPS)[number]
