# Cota

## Cortana 账号管理

最左侧导航中的 **Cortana → 账号管理** 用于管理 Codex、Claude Code、Pi 和 Grok 的本机账号。支持浏览器授权（Pi 使用本地登录导入）、凭据导入、账号切换、重命名、删除、排序和用量刷新。Codex 与 Claude Code 还支持 API 账号。

账号保存在当前 Cota 用户目录的 `cortana.sqlite3` 中，仅创建一张 `accounts` 业务表，凭据通过 Electron `safeStorage` 使用系统密钥加密。开发版与正式版使用各自的用户目录。

检测到 `~/.cortana/app.sqlite3` 时，可使用「导入 Cortana」复制已有账号。导入以只读方式访问源数据库，跳过重复账号及不支持的产品；删除 Cota 中的账号不会退出 CLI 的当前登录。切换账号前会检查尚未保存的外部登录，并在写入失败时恢复已修改的认证文件。切换后，已启动的 CLI 可能需要重启才能使用新账号。

本阶段仅迁移账号模块。依赖协议转换网关或自定义模型的部分 API 账号可导入、查看和管理，在相关模块接入前暂不可切换。账号切换保留配置中的其他设置；TOML 配置由解析器重新序列化，注释和排版可能改变。Cortana 的自定义 `codex_home` 设置不会导入，Codex 目标目录使用 `CODEX_HOME` 或默认的 `~/.codex`。

账号适配逻辑移植自 Cortana，原始许可见 `resources/licenses/cortana.txt`。

# FAQ / 常见问题

## macOS 提示“无法验证 Cota.app 恶意软件”

如果在 macOS 上打开应用时提示“Apple无法验证 Cota.app 是否包含可能危害Mac安全或泄漏隐私的恶意软件”，请先确认应用来源可信，再在终端运行以下命令清除隔离标记：

```sh
sudo xattr -r -d com.apple.quarantine /Applications/Cota.app
```

> **注**：如果 `.app` 文件存放在其他路径（如未移动至 `/Applications`），请将命令中的路径替换为实际的 `Cota.app` 路径。
