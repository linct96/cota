# project

2026-10-16 · whole-project merge · 已切换为 Base UI，保留 Mira。

## Changed

- `components.json`：`radix-mira` → `base-mira`。
- `package.json` / `pnpm-lock.yaml`：新增 `@base-ui/react@^1.9.0`，移除 `radix-ui` 和全部直接 `@radix-ui/*` 依赖。
- Button、Dialog、DropdownMenu、Separator 及 App / Settings 调用同步迁移；各组件细节见同目录报告。
- `docs/技术方案.md`：更新 UI 技术选型。
- `tests/project-menu.test.tsx` / `tests/settings-dialog.test.tsx`：覆盖迁移相关交互。
- `src/renderer/src`、依赖清单和锁文件扫描 `radix-ui|@radix-ui` 无匹配：0 wrappers remain on Radix。

## Left alone

既有未提交的终端面板/布局改动原样保留。Input 是原生样式封装，终端标签与 xterm 不是 Radix 组件；未改动。设计 token、主进程和数据协议不变；未提交代码。

## Behavior changes

Base UI Button 默认不隐式提交表单；现有保存按钮显式指定 submit，无调用方受影响。依赖交换后 renderer JS 从 1330.84kB 变为 1516.81kB（未压缩构建输出；未做性能测量）。

## Verify by hand

- 52 项测试、typecheck、lint、build 及格式检查通过；浏览器 mock 桥验证菜单定位、键盘和焦点、设置保存防关闭。
- 截图工具超时，未做像素对比或 Electron 原生确认框/真实持久化复测。
- 后续已修复 CLI：`pnpm-workspace.yaml` 将 `shadcn>zod` 固定为兼容的 3.25.76，消除 MCP SDK 的 peer 冲突；根目录新增继承 `tsconfig.web.json` 的 `tsconfig.json`，供 CLI 解析路径别名。`shadcn info --json`、`shadcn docs button`、`shadcn add button --dry-run` 均通过，未覆盖现有组件。
