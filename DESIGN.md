---
name: Cota
description: 基于 shadcn/ui (base-mira + neutral) 构建的本地终端优先、支持多 CLI Coding Agent 与 Git Worktree 的桌面工作台。
colors:
  background: 'oklch(1 0 0)'
  foreground: 'oklch(0.145 0 0)'
  primary: 'oklch(0.205 0 0)'
  primary-foreground: 'oklch(0.985 0 0)'
  secondary: 'oklch(0.97 0 0)'
  secondary-foreground: 'oklch(0.205 0 0)'
  muted: 'oklch(0.97 0 0)'
  muted-foreground: 'oklch(0.556 0 0)'
  app-muted-foreground: 'oklch(0.488 0 0)'
  text-normal: 'oklch(0.371 0 0)'
  text-subtle: 'oklch(0.535 0 0)'
  accent: 'oklch(0.97 0 0)'
  accent-foreground: 'oklch(0.205 0 0)'
  border: 'oklch(0.922 0 0)'
  input: 'oklch(0.922 0 0)'
  ring: 'oklch(0.708 0 0)'
  sidebar: 'oklch(0.985 0 0)'
  sidebar-foreground: 'oklch(0.145 0 0)'
  sidebar-accent: 'oklch(0.97 0 0)'
  sidebar-accent-foreground: 'oklch(0.205 0 0)'
  destructive: 'oklch(0.577 0.245 27.325)'
  warning: '#a16207'
  success: '#166534'
  dot-status-working: '#38bdf8'
  dot-status-attention: '#ca8a04'
  dot-status-completed: '#299f51'
typography:
  root:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '16px'
    fontWeight: 400
    lineHeight: 1.5
  headline:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '1.125rem'
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '0.875rem'
    fontWeight: 600
    lineHeight: 1.4285
  body:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '0.625rem'
    fontWeight: 500
    lineHeight: 1.4
rounded:
  xs: '4px'
  sm: '6px'
  md: '8px'
  lg: '10px'
  xl: '14px'
  2xl: '18px'
  pill: '9999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  row-compact: '28px'
  titlebar: '44px'
  nav-rail: '48px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 8px'
    height: '28px'
  button-secondary:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.secondary-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 8px'
    height: '28px'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.app-muted-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 8px'
    height: '28px'
  input-default:
    backgroundColor: 'transparent'
    textColor: '{colors.foreground}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: '2px 8px'
    height: '28px'
  card-surface:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: '16px'
  badge-pill:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.secondary-foreground}'
    typography: '{typography.caption}'
    rounded: '{rounded.pill}'
    padding: '2px 8px'
    height: '20px'
---

# Design System: Cota

## Overview

**Creative North Star: "The Precision Workbench"**

Cota 基于 **`shadcn/ui`（`base-mira` 风格 + `neutral` 中性灰阶）** Token 体系构建，定位为仪器级精度的桌面开发工作台。应用外壳主动退居为无色相的结构底座，将视觉焦点完全让渡给实时 PTY 终端、Git Diff 审阅视图与 Coding Agent 状态信号。每一处界面均针对长达数小时的高强度编码场景调校：通过零饱和度 OKLCH 灰阶明度差建立空间层级，并以紧凑的 `28px`（`h-7`）交互行高与利落的 `1px` 分割线在有限视口内实现高信息密度与低视觉噪点。

Cota 明确拒绝霓虹渐变、AI 发光边框、大面积毛玻璃弥散阴影以及无功能意义的装饰色块。色彩与动效在系统中被视作稀缺的机器状态信号——当界面上出现高饱和色彩或脉冲动画（如天蓝色的 Agent 运行波纹 `--dot-status-working`、琥珀色的待确认圆点 `--dot-status-attention`、或绿/红 Diff 行统计）时，必然对应着需要开发者感知或介入的真实运行状态。

**Key Characteristics:**

- 基于 `shadcn/ui`（`style: "base-mira"`, `baseColor: "neutral"`），在 `src/renderer/src/styles.css` 中保持 1:1 原生 CSS 变量命名对齐。
- 采用“外框套内嵌画布（Frame-in-Frame）”桌面壳体结构：沉降式外框底座（`bg-muted`：亮色 `oklch(0.97 0 0)` / 暗色 `oklch(0.269 0 0)`）包裹左上大圆角（`18px`）主画布（`bg-background`）。
- 零色相 OKLCH 中性灰阶基底（`oklch(L 0 0)`），配合带业务域前缀的语义状态色（`--dot-status-*`、`--source-control-*`、`--file-icon-*`）。
- 仪器级紧凑信息密度：标准按钮、输入框与树列表行高统一为 `28px`，核心界面字号 `12px`，所有动态数字强制启用 `tabular-nums` 等宽对齐。
- 悬停/聚焦渐进式披露次级操作按钮，并对非聚焦分屏终端施加 `0.8` 透明度降噪（`--terminal-pane-inactive-content-opacity`）。

## Colors

Cota 在 `src/renderer/src/styles.css` 中采用双层色彩架构：**第一层**完整保留 `shadcn/ui` `base-mira`（`neutral`）原生 OKLCH 灰阶变量；**第二层**为独立于预设更新的业务域扩展变量。

### Primary

- **`primary`**（亮色 `oklch(0.205 0 0)` / 暗色 `oklch(0.922 0 0)`）与 **`primary-foreground`**（亮色 `oklch(0.985 0 0)` / 暗色 `oklch(0.205 0 0)`）：用于主提交按钮、活动分栏下划线指示器及单选/复选框强调色。当用户在外观设置中自定义 `--primary` 时，系统通过 WCAG 相对亮度公式自动计算并切换 `#000000` 或 `#ffffff` 作为 `--primary-foreground`。

### Secondary

- **`dot-status-working`**（`#38bdf8`）：指示正在执行的 CLI Agent（`running` 状态），配合双层错峰扩散波纹动效。
- **`dot-status-attention`**（亮色 `#ca8a04` / 暗色 `#fbbf24`）与 **`warning`**（亮色 `#a16207` / 暗色 `#fbbf24`）：指示等待人工输入或确认的 Agent（`needs-input` 状态）及警告徽章。
- **`dot-status-completed`**（亮色 `#299f51` / 暗色 `#35c264`）与 **`success`**（亮色 `#166534` / 暗色 `#86efac`）：指示已完成的 Agent 回合（`completed` / `succeeded`）、就绪状态徽章及 Git 新增行统计（`--source-control-stat-added`）。
- **`destructive`**（亮色 `oklch(0.577 0.245 27.325)` / 暗色 `oklch(0.704 0.191 22.216)`）：指示执行失败的 Agent、表单校验错误、破坏性操作（删除工作树/项目/进程）及 Git 删除行统计（`--source-control-stat-removed`）。

### Neutral

- **`background`**（亮色 `oklch(1 0 0)` / 暗色 `oklch(0.145 0 0)`）：内嵌主工作区画布（`--surface-canvas`）、卡片、Monaco Diff 编辑器与右侧工具面板背景。
- **`muted`** 与 **`secondary`**（亮色 `oklch(0.97 0 0)` / 暗色 `oklch(0.269 0 0)`）：外层窗口底座、`44px` 顶部状态栏、`48px` 左侧主导航栏及次要按钮填充色。
- **`accent`**（亮色 `oklch(0.97 0 0)` / 暗色 `oklch(0.269 0 0)`）与 **`accent-foreground`**（亮色 `oklch(0.205 0 0)` / 暗色 `oklch(0.985 0 0)`）：文件树、Git 变更列表与分支选择器的选中/高亮行背景。
- **`sidebar`**（亮色 `oklch(0.985 0 0)` / 暗色 `oklch(0.205 0 0)`）与 **`sidebar-accent`**（亮色 `oklch(0.97 0 0)` / 暗色 `oklch(0.269 0 0)`）：左侧项目与 Worktree 侧栏表面及激活/悬停高亮色。
- **`foreground`**（亮色 `oklch(0.145 0 0)` / 暗色 `oklch(0.985 0 0)`）：最高对比度主文本色，用于当前活动标签、弹窗标题及聚焦列表项。
- **`text-normal`**（亮色 `oklch(0.371 0 0)` / 暗色 `oklch(0.87 0 0)`）：业务扩展正文色，用于文件树条目、Diff 路径与常规说明文本。
- **`app-muted-foreground`**（亮色 `oklch(0.488 0 0)` / 暗色复用 `var(--muted-foreground)` `oklch(0.708 0 0)`）：业务扩展次级前景色，用于静息态导航图标、非活动工作区条目及统计数字（在亮色模式下比 `base-mira` 默认的 `muted-foreground` `oklch(0.556 0 0)` 略深，以保证小尺寸图标清晰度）。
- **`text-subtle`**（亮色 `oklch(0.535 0 0)` / 暗色 `oklch(0.627 0 0)`）：弱化文本色，用于 `.gitignore` 忽略的文件名（配合斜体显示）。
- **`border`**（亮色 `oklch(0.922 0 0)` / 暗色 `oklch(1 0 0 / 10%)`）与 **`input`**（亮色 `oklch(0.922 0 0)` / 暗色 `oklch(1 0 0 / 15%)`）：`1px` 面板结构分割线与表单输入框描边。
- **`ring`**（亮色 `oklch(0.708 0 0)` / 暗色 `oklch(0.556 0 0)`）：键盘焦点环与面板拖拽分割线激活态指示色。

### Named Rules

**The Mira Preset Integrity Rule.** 严禁篡改或重命名 `base-mira` 原生语义变量（`background`、`foreground`、`primary`、`secondary`、`muted`、`accent`、`destructive`、`border`、`input`、`ring`、`sidebar-*`）；当原生变量已覆盖对应语义时，禁止另造同义别名。

**The Scoped Token Naming Rule.** 所有新增业务自定义 CSS 变量必须遵循 `<domain>-<element>-<role/state>`（kebab-case）命名规范——如 `--dot-status-*`、`--source-control-*`、`--terminal-*`、`--file-icon-*`、`--window-*`——统一放置在 `src/renderer/src/styles.css` 的业务扩展区块中，并在需要 Tailwind 工具类时注册到 `@theme inline`。

**The Dynamic Mixture Rule.** 悬停与叠加表面统一通过 `color-mix(in oklab/oklch, ...)` 基于 `var(--foreground)` 或 `var(--input)` 动态混合生成（如 `--muted-hover`、`--accent-hover`、`--background-hover`、`--terminal-tab-hover`），避免硬编码固定色阶，确保亮色、暗色及用户自定义主题下对比度自动适配。

**The Signal-Only Chroma Rule.** 高饱和色彩仅限用于运行态信号：Agent 状态点（`--dot-status-*`）、Git Diff 增删统计（`--source-control-*`）、校验告警（`--destructive`、`--warning`、`--success`）及文件类型图标（`--file-icon-*`）。

## Typography

**Display Font:** `'Inter Variable'`, sans-serif (`--font-sans`)
**Body Font:** `'Inter Variable'`, sans-serif (`--font-sans`)
**Label/Mono Font:** 界面标签使用 `'Inter Variable'`；PTY 终端、行内代码、命令预览与 Monaco Diff 视图使用等宽字体栈（`var(--font-mono)`）。

**Character:** 干净、克制的现代无衬线字体比例，针对高密度桌面界面调校；全局应用外壳启用 `user-select: none` 防止拖拽误选，并在所有计数器、端口号、时间戳与统计列强制启用 `tabular-nums`。

### Hierarchy

- **Headline**（`600` 字重，`1.125rem` / `18px`，`1.4` 行高）：设置页分节大标题及 `.typeset` 文档排版标题。
- **Title**（`600` 字重，`0.875rem` / `14px`，`1.4285` 行高）：侧栏顶部标题（如 `项目`）、模态框标题及空状态主标题（`500` 字重）。
- **Body**（`400` 字重，`0.75rem` / `12px`，`1.625` 行高）：标准界面正文、设置项描述、文件树与工作树列表项。
- **Label**（`500` 字重，`0.75rem` / `12px`，`1.5` 行高）：按钮文案、工作区标签标题、表单字段标签与菜单项。
- **Caption**（`500` 字重，`0.625rem` / `10px`，`1.4` 行高，辅以 `--text-2xs: 0.6875rem` / `11px`）：紧凑状态徽章、Git 行增删统计（`tabular-nums`）与快捷键提示。

### Named Rules

**The Compact Scale Rule.** 遵循 `shadcn/ui` `base-mira` 桌面规范，高频操作控件、标签与树节点默认采用 `12px`（`text-xs/relaxed`），为终端回滚缓冲区与文件树保留最大垂直空间。

**The Tabular Telemetry Rule.** 所有动态数值（Git `+add / -del` 统计、监听端口号、PID、服务计数、扫描时间、配额百分比）必须声明 `font-variant-numeric: tabular-nums`，杜绝实时刷新时产生水平抖动。

**The Bidirectional Path Rule.** 所有文件名、相对路径、工作区名与分支名必须设置 `unicode-bidi: plaintext` 与 `truncate`，防止中英文、斜杠与特殊符号混排时发生截断顺序错乱。

## Layout

Cota 采用固定视口（`100vw × 100vh`，`overflow: hidden`）的四区桌面应用外壳架构：

1. **顶部状态与标签栏（`--app-titlebar-height: 44px`）：** 兼作 Electron 窗口拖拽区（`-webkit-app-region: drag`）。在 macOS（`data-platform="darwin"`）下自动预留左侧 `96px` 原生红绿灯内边距；在 Windows（`data-platform="win32"`）下自动预留右侧 `138px`（`3 × 46px`）自定义窗口控制按钮避让区。
2. **左侧主导航栏（`--app-navigation-width: 48px`）：** 极窄垂直图标栏，顶部放置主视图切换（`首页`、`Cortana`），底部放置 `设置`。
3. **内嵌主工作区画布（`flex-1`）：** 通过左上角 `18px` 圆角（`rounded-tl-2xl`）与 `1px` 顶/左边框（`border-border`）嵌入外壳。内部通过水平 `ResizablePanelGroup` 划分为三个可折叠区域：
   - **左侧项目与 Worktree 侧栏：** 默认宽度 `240px`（`min: 200px`，`max: 400px`，可折叠至 `0px`），采用 `bg-muted/40 text-app-muted-foreground` 次级灰阶。
   - **中央主舞台（`min: 200px`，`flex-1`）：** 承载递归分屏终端（`TerminalWorkspace`）、文件预览（`FilePreview`）或变更审阅（`SourceControlDiff`）。切换到文件/Diff 预览或二级页面（`/settings`、`/cortana/accounts`）时，仅通过 CSS `hidden` 隐藏终端容器，保持底层 `xterm` 实例与 WebGL 上下文常驻挂载。
   - **右侧工具面板：** 关闭时为 `0px`，展开后支持 `240px` 至 `65%` 宽度调节，承载 `FileExplorer`（文件）与 `SourceControlPanel`（Git）。
4. **列表行高与渲染优化：** 文件树行、Git 变更文件行与全量变更触发器统一固定为 `28px` 高度，并启用 `content-visibility: auto; contain-intrinsic-size: auto 28px` 保障大型仓库滚动流畅。

## Elevation & Depth

Cota 主要依靠 **阶梯式 OKLCH 灰阶分层与 `1px` 结构细边框（`border-border`）** 表达空间深度，而非弥散投影。外框壳体（`bg-muted`）处于底层平面，项目侧栏（`bg-muted/40`）处于中层过渡平面，内嵌主画布与卡片（`bg-background`）处于顶层操作平面。

### Shadow Vocabulary

- **激活控件微抬升**（`var(--shadow-xs)`）：仅用于激活态分段标签（`.right-panel-files-tab[data-active]`、`.workspace-tab[aria-selected="true"]`）与激活态 Agent 快捷定位按钮（`.project-item-agent-button[data-active="true"]`），使其从浅灰槽位中轻微浮起。
- **卡片细线环**（`ring-1 ring-foreground/10`）：`base-mira` 的 `Card` 组件使用 `1px` 的 `10%` 前景色细环替代传统卡片投影。
- **非聚焦分屏终端降噪**（`--terminal-pane-inactive-overlay` `3%` 遮罩 + `--terminal-pane-inactive-content-opacity: 0.8`）：在多终端分屏下自然弱化非活动面板，无需额外描边或阴影即可凸显当前焦点终端。

### Named Rules

**The Flat-At-Rest Rule.** 面板、卡片与列表行在静息态下一律保持零阴影（Flat at rest），空间边界完全由 `oklch` 背景明度差与 `1px` `border-border` 界定。

**The Invisible Handle Rule.** 面板拖拽分割线（`.ui-resizable-handle`）在静息态下透明隐形（拥有 `8px` 热区），仅在指针悬停、拖拽或键盘聚焦时点亮为 `2px` 的 `--panel-separator-hover`（`var(--accent-hover)`）或 `--panel-separator-active`（`var(--ring)`）指示线。

## Shapes

所有圆角均由 `base-mira` 基准变量 `--radius: 0.625rem`（`10px`）通过 `@theme inline` 比例系数派生：

- **工作区画布左上外圆角（`18px` / `--radius-2xl: calc(var(--radius) * 1.8)`）：** 仅用于主工作区容器左上角（`rounded-tl-2xl`），形成标志性的内嵌画布转折。
- **卡片与弹窗容器（`10px` / `--radius-lg: var(--radius)`）：** 用于设置卡片（`Card`）、模态框（`Dialog` / `AlertDialog`）与弹出菜单（`DropdownMenu` / `ContextMenu`）。
- **标准交互控件与列表行（`8px` / `--radius-md: calc(var(--radius) * 0.8)`）：** 用于 `28px` 标准按钮（`Button`）、输入框（`Input`）、工作区标签、项目文件夹行与 Git 文件行。
- **紧凑微控件与按键帽（`6px` / `--radius-sm: calc(var(--radius) * 0.6)`）：** 用于 `xs` 按钮（`h-5`）、分屏头部 `icon-xs` 按钮（`rounded-sm`）及带 `2px` 底边立体厚度的 `<kbd>` 快捷键标签。
- **胶囊徽章与滚动条（`9999px` / `rounded-full`）：** 用于 `Badge` 组件、`6px` `.dot-status` 状态圆点，以及全局与 `xterm` 视口的 macOS 风格圆角滚动条滑块。

## Components

Cota 的组件遵循 **“干脆、紧凑、仪器级手感（Crisp, compact, and instrument-grade）”** 原则：基于 `@base-ui/react` 与 `shadcn/ui`（`base-mira`）原语构建，具备即时背景反馈、`1px` 按压微位移与零布局抖动。

### Buttons

- **尺寸与圆角：** 默认高度 `28px`（`h-7`，`px-2`，`rounded-md`，`12px` 字号，`14px` 图标）。微操作使用 `xs`（`20px` 高，`rounded-sm`）或 `sm`（`24px` 高）；主导航栏图标使用 `icon-xl`（`36px × 36px`，`20px` 图标）。
- **Primary (`default`)：** `bg-primary text-primary-foreground hover:bg-primary/80`。
- **Secondary & Outline：** `secondary` 使用 `bg-secondary text-secondary-foreground` 并在悬停时混入 `5%` `--foreground`；`outline` 使用 `border-border hover:not-disabled:bg-input/50 dark:bg-input/30`。
- **Navigation & Project 变体：** 专为顶栏、侧栏设计，静息态为透明背景配 `text-app-muted-foreground`，悬停显露 `bg-muted-hover` 或 `bg-accent`，激活态（`data-[active="true"]`）切换为 `bg-foreground/6 text-foreground` 或 `bg-accent text-accent-foreground`。
- **按压与焦点反馈：** 非菜单触发器按钮按下时产生 `1px` 向下物理微位移（`active:not-aria-[haspopup]:translate-y-px`）；键盘聚焦显示 `2px` 焦点环（`focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30`）。

### Chips / Badges

- **样式：** 胶囊形（`rounded-full`），`20px` 高度（`h-5`），`px-2`，`10px`（`text-[0.625rem]`）中等字重。
- **语义变体：** 除 `default`、`secondary`、`outline` 外，提供 `10%` 浅底语义变体（`warning`、`success`、`destructive`），用于标识 Worktree 锁定/异常状态与账号标签。

### Cards / Containers

- **圆角与边界：** `10px`（`rounded-lg`），采用 `bg-background text-card-foreground` 搭配 `ring-1 ring-foreground/10` 细线外环，无投影。
- **内边距：** 默认 `16px`（`--card-spacing: --spacing(4)`），`size="sm"` 时收敛为 `12px`（`--spacing(3)`）。

### Inputs / Fields

- **样式：** `28px` 高度（`h-7`），`8px` 圆角（`rounded-md`），`border-input bg-input/20 dark:bg-input/30`，水平内边距 `8px`，`12px` 字号。
- **焦点与表单校验：** 聚焦切换为 `border-ring` 与 `ring-2 ring-ring/30`；校验失败（`aria-invalid="true"` / `data-invalid`）切换为 `border-destructive` 与 `ring-destructive/20`，并在下方就近渲染 `FieldError`。

### Navigation & Workspace Tabs

- **左侧图标主导航：** `48px` 宽，当前页面图标自动从 `regular` 切换为 `fill` 实心权重（`data-active="true"`）。
- **工作区与终端标签栏：** 静息标签透明融入 `44px` 顶栏，悬停显现 `--terminal-tab-hover`，选中态（`aria-selected="true"`）切换为实心 `var(--background)` 并附带 `shadow-xs`。预览态标签标题使用斜体（`font-style: italic`），双击或按 `Enter` 固定。标签右侧关闭按钮叠加线性渐变遮罩（`mask-image: linear-gradient(to right, transparent, black 55%)`），并在键盘方向键切换时自动调用 `scrollIntoView({ block: 'nearest', inline: 'nearest' })`。

### DotStatus & Agent Pills (Signature Component)

- **DotStatus (`.dot-status`)：** `6px × 6px` 语义状态指示器，贯穿于项目工作区行、Agent 快捷按钮与终端标签。`empty` 为 `1px` 空心圆环，`idle` 为中性灰实心点，`running` 为天蓝色双层扩散波纹（`dot-status-ripple`，`1.6s cubic-bezier(0, 0.2, 0.8, 1) infinite`），`needs-input` 为琥珀黄，`completed` 为翠绿，`failed` 为亮红。
- **项目行 Agent 快捷栏 (`.project-item-agents`)：** 嵌套在工作区条目下方，展示当前工作区所有活跃 CLI Agent（`Codex`、`Claude Code`、`Pi`、`Grok`）的品牌图标按钮，右下角叠加带背景镂空环的微型 `DotStatus`。

## Do's and Don'ts

### Do:

- **Do** 优先使用 `shadcn/ui` `base-mira` 原生语义变量（`bg-background`、`bg-muted`、`text-foreground`、`text-muted-foreground`、`border-border`、`bg-sidebar-accent`）构建所有常规界面与控件。
- **Do** 在 `src/renderer/src/styles.css` 中新增业务自定义 Token 时，严格遵循 `<domain>-<element>-<state/role>` 命名（如 `--dot-status-*`、`--source-control-*`、`--terminal-*`、`--file-icon-*`），并按需在 `@theme inline` 中映射。
- **Do** 优先复用 `shadcn/ui` 与 `@base-ui/react` 组件（`Button`、`FieldGroup`、`Field`、`Dialog`、`Tabs`、`Collapsible`、`Empty`），并为 JSX 元素赋予语义清晰的模块级 `className`（如 `project-folder-row`、`workspace-toolbar-actions`）。
- **Do** 保持文件树与变更列表行高为 `28px` 且开启 `content-visibility: auto`，将行内次级操作按钮设为默认隐藏、仅在 `:hover` 或 `:focus-within` 时显露。
- **Do** 在顶栏交互控件、展开的下拉/右键菜单以及 Portal 弹窗遮罩上显式声明 `-webkit-app-region: no-drag`，避免 Electron 拖拽区吞噬点击事件。

### Don't:

- **Don't** 在已有 `base-mira` 原生变量（如 `background`、`muted`、`secondary`）可满足语义时，重复发明同义变量别名。
- **Don't** 在工作区面板或卡片上引入装饰性渐变、霓虹发光边框、毛玻璃模糊（`backdrop-filter: blur`）或多层弥散阴影。
- **Don't** 在组件 JSX 中硬编码 Hex 色值或 Tailwind 默认色板类（如 `bg-slate-100`、`text-zinc-500`），必须绑定语义化 Token。
- **Don't** 在切换文件预览、Git Diff 或二级路由（`/settings`、`/cortana`）时卸载 `TerminalWorkspace` DOM 树，必须使用 CSS `hidden` 切换可见性以保留终端缓冲区与 WebGL 上下文。
