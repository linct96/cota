# dropdown-menu

2026-10-16 · merge（对照官方 base-mira golden pair；CLI 因既有 Zod 冲突不可用）· 已迁移。

## Changed

- `src/renderer/src/components/ui/dropdown-menu.tsx`：Base UI Menu Root / Trigger / Group / Positioner / Popup / Item 替代 Radix；迁移定位变量、锚点隐藏和状态样式，保留现有紧凑外观。
- `src/renderer/src/App.tsx`：Trigger 改用 `render`；展开态使用 `data-popup-open`；删除项目改用 `onClick`。保留非模态菜单、自动避让和异步取消/失败后的回焦。
- `tests/project-menu.test.tsx`：等待异步焦点就绪；覆盖 Portal、键盘、外部关闭及确认/取消删除。
- 上述文件扫描 `radix-ui|@radix-ui` 无匹配。

## Left alone

删除 IPC、项目/终端清理和原生确认框；项目列表及按钮的现有 token。

## Behavior changes


## Verify by hand

- 浏览器已验证 900×400 视口底部项目菜单向上翻转、右对齐、无裁切、展开按钮保持可见。
- 已验证 ArrowDown / Enter、模拟取消删除后项目保留且回焦触发器。
- 原生 Electron 确认框未复测。
