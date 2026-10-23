# xterm 补丁

`@xterm/xterm@6.1.0-beta.315`：参考 Orca 的行中输入法预编辑修复，在浮层内补绘光标后的原文，避免选字期间遮挡已有文字。

- 仅修改 `CompositionHelper` 的显示逻辑，不修改终端缓冲区或输入提交逻辑。
- 同步更新 TypeScript 源码、ESM/CJS 产物和 source map；通过 `pnpm-workspace.yaml` 的 `patchedDependencies` 应用。
- 保留空格、右边界裁剪、预编辑候选窗口定位，以及终端重绘时的后文刷新。
- 升级 xterm 时重新检查上游是否已修复，并适配或移除此补丁。
