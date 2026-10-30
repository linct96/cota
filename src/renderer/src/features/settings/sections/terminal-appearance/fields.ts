export const FONT_SUGGESTIONS = [
  'Consolas',
  'Cascadia Code',
  'JetBrains Mono',
  'Fira Code',
  'Menlo',
  'Monaco',
  'monospace',
]

export const APPEARANCE_GROUPS = [
  { name: 'typography', label: '字体' },
  { name: 'cursor', label: '光标与鼠标' },
  { name: 'background', label: '背景与留白' },
  { name: 'theme', label: '配色' },
] as const

export const NUMBER_FIELDS = [
  { name: 'fontSize', label: '字号', min: 8, max: 48, step: 1, group: 'typography' },
  { name: 'fontWeight', label: '常规字重', min: 100, max: 900, step: 100, group: 'typography' },
  { name: 'fontWeightBold', label: '粗体字重', min: 100, max: 900, step: 100, group: 'typography' },
  { name: 'lineHeight', label: '行高', min: 1, max: 3, step: 0.05, group: 'typography' },
  {
    name: 'letterSpacing',
    label: '字符间距（px）',
    min: -2,
    max: 10,
    step: 0.1,
    group: 'typography',
  },
  { name: 'cursorOpacity', label: '光标不透明度', min: 0, max: 1, step: 0.05, group: 'cursor' },
  {
    name: 'backgroundOpacity',
    label: '背景透明度',
    min: 0,
    max: 1,
    step: 0.05,
    group: 'background',
  },
  { name: 'paddingX', label: '水平内边距（px）', min: 0, max: 128, step: 1, group: 'background' },
  { name: 'paddingY', label: '垂直内边距（px）', min: 0, max: 128, step: 1, group: 'background' },
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
  { name: 'separateLightTheme', label: '浅色模式使用独立配色', group: 'theme' },
  { name: 'cursorBlink', label: '光标闪烁', group: 'cursor' },
  { name: 'windowBlur', label: '窗口背景模糊（重启后生效）', group: 'background' },
  { name: 'mouseHideWhileTyping', label: '输入时隐藏鼠标指针', group: 'cursor' },
] as const
export const COLOR_LABELS = [
  '前景',
  '背景',
  '光标',
  '光标下文字',
  '选区背景',
  '选区文字',
  '黑',
  '红',
  '绿',
  '黄',
  '蓝',
  '品红',
  '青',
  '白',
  '亮黑',
  '亮红',
  '亮绿',
  '亮黄',
  '亮蓝',
  '亮品红',
  '亮青',
  '亮白',
]

export type AppearanceGroup = (typeof APPEARANCE_GROUPS)[number]
