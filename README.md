# 开发环境

在项目目录运行 `pnpm dev`（首次先执行 `pnpm install`），可与已安装的正式版同时运行。

- 开发版名称为 **Cota Dev**，数据目录为 `~/Library/Application Support/Cota Dev`；正式版继续使用原有数据目录。
- 配置、最近项目、工作区、缓存、单实例锁及 Terminal Host / 终端会话互相独立；退出任一版本不会清理另一版本的终端。
- 开发版首次使用独立的空白配置，不自动复制或迁移原有配置。
- 两边若打开同一个项目目录，仍会操作同一份文件；Shell 配置和外部 CLI 的账号等也不隔离。

## FAQ / 常见问题

### macOS 提示“无法验证 Cota.app 恶意软件”

如果在 macOS 上打开应用时提示“Apple无法验证 Cota.app 是否包含可能危害Mac安全或泄漏隐私的恶意软件”，可在终端运行以下命令清除隔离标记：

```sh
sudo xattr -r -d com.apple.quarantine /Applications/Cota.app
```

> **注**：如果 `.app` 文件存放在其他路径（如未移动至 `/Applications`），请将命令中的路径替换为实际的 `Cota.app` 路径。
