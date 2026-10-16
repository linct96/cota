# button

2026-10-16 · merge（对照官方 base-mira golden pair；CLI 因既有 Zod 冲突不可用）· 已迁移。

## Changed

- `src/renderer/src/components/ui/button.tsx`：用 Base UI Button 替代 Radix Slot / 原生按钮组合，采用 `render` 组合 API，保留 Mira variants、尺寸及业务 className。
- `src/renderer/src/App.tsx`、`src/renderer/src/components/ui/dialog.tsx`：触发器及关闭按钮改用 `render`，避免嵌套按钮。
- 上述文件扫描 `radix-ui|@radix-ui` 无匹配。

## Left alone

`src/renderer/src/styles.css` 的设计 token 及其余按钮调用；未扩展组件 API。

## Behavior changes

Base UI Button 默认 `type="button"`；设置保存入口已显式使用 `type="submit"`，其余入口不依赖隐式提交。

## Verify by hand

- 已在浏览器检查项目菜单和设置关闭按钮操作，关闭按钮为 24px 且无嵌套 button。
- 自动化覆盖表单提交、禁用态及保存失败重试。原生 Electron 交互未复测。
