# dialog

2026-10-16 · merge（对照官方 base-mira golden pair；CLI 因既有 Zod 冲突不可用）· 已迁移。

## Changed

- `src/renderer/src/components/ui/dialog.tsx`：Radix Content / Overlay 改为 Base UI Popup / Backdrop，关闭按钮改用 `render`，更新 open / closed 状态选择器，保留 Mira 样式。
- `src/renderer/src/components/Settings.tsx`：保存期间通过 `onOpenChange` 的 `eventDetails.cancel()` 阻止关闭，取代 Radix 专属事件。
- `tests/settings-dialog.test.tsx`：覆盖 Portal、标题关联、Escape 焦点恢复、外部点击、保存防关闭及失败重试。
- 上述文件扫描 `radix-ui|@radix-ui` 无匹配。

## Left alone

设置字段校验、保存 IPC、设计 token、原生终端/项目确认框均保持原样。

## Behavior changes


## Verify by hand

- 浏览器已验证 Escape 关闭后回焦设置入口，保存期间 Escape / 外部点击 / X 均不关闭，模拟失败后可取消。
- Inter、12px 正文、384px 面板、24px 关闭按钮保持。截图 API 超时，未做像素对比。
- 原生 Electron 设置持久化未复测。
