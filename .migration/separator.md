# separator

2026-10-16 · merge（对照官方 base-mira golden pair）· 已迁移。

## Changed

- `src/renderer/src/components/ui/separator.tsx`：使用 Base UI Separator，移除 Radix `Root` 与 `decorative` 属性，保留 orientation 样式。
- `src/renderer/src/App.tsx`：为现有纯装饰分隔线显式添加 `aria-hidden="true"`。
- 上述文件扫描 `radix-ui|@radix-ui` 无匹配。

## Left alone

标题栏布局、Electron 红绿灯避让、分隔线尺寸和颜色 token。

## Behavior changes


## Verify by hand

- 浏览器已确认标题栏仍显示分隔线；类型检查及构建通过。
- 未做屏幕阅读器实机检查。
