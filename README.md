# FAQ / 常见问题

## macOS 提示“无法验证 Cota.app 恶意软件”

如果在 macOS 上打开应用时提示“Apple无法验证 Cota.app 是否包含可能危害Mac安全或泄漏隐私的恶意软件”，请先确认应用来源可信，再在终端运行以下命令清除隔离标记：

```sh
sudo xattr -r -d com.apple.quarantine /Applications/Cota.app
```

> **注**：如果 `.app` 文件存放在其他路径（如未移动至 `/Applications`），请将命令中的路径替换为实际的 `Cota.app` 路径。
