# Cota

macOS 本地 Terminal-first 工作区。打开目录，在内置终端中自行运行已安装的 `codex`、`pi`、`claude` 等 CLI。无需 Git 仓库，不接入 Agent SDK，不管理模型账号。

## 开发与检查

首发仅支持 **macOS Apple Silicon**。需要 Node.js **22.12+**、pnpm **11+**，以及 Xcode Command Line Tools（`xcode-select --install`，用于构建 `node-pty` 原生模块）。当前实测 Node 22.23.1 / pnpm 11.8.0 / macOS 15.8.1 arm64。

```sh
pnpm install
pnpm dev
```

```sh
pnpm typecheck
pnpm lint          # oxlint，警告也视为失败
pnpm format:check  # oxfmt
pnpm format       # 写入格式化结果
pnpm test         # Vitest + React Testing Library，无需 Agent 账号
pnpm test:pty     # 用 Electron ABI 运行真实 PTY；检查本机存在的 zsh/bash/fish
pnpm build
```

`pnpm dev` 会启用 React Grab：将鼠标移到界面元素上，按 `Cmd+C`（Windows/Linux 为 `Ctrl+C`）复制元素与 React 组件源码位置，再粘贴给编码 Agent。仅开发环境加载，不包含在生产构建中。

`test:pty` 会运行交互式登录 Shell，因此会执行本机既有的 Shell 初始化文件；只在信任本机 Shell 配置的环境中运行。自动化测试不代表中文输入法及第三方 Agent 已通过集成验收。

## 使用

1. 点击 **Open Folder**，从系统目录选择器打开本地文件夹。
2. 点击 **New Terminal**，Shell 在该项目目录启动。
3. 在 Shell 中输入已经安装的 CLI 命令；安装、登录、权限确认、更新均由对应 CLI 自己处理。
4. 切换项目或标签只隐藏终端，不销毁进程。
5. 关闭存活标签、关闭窗口或退出应用时，需要明确确认结束 Shell 及其中的程序。退出取消后继续工作。
6. 在项目行的 **更多操作（…）→ 删除项目…** 中移除项目。原生确认框默认取消；确认后结束该项目全部终端、丢弃终端输出并移除最近记录，**不会删除本地目录或文件**，其他项目不受影响。删除当前项目会切到剩余项目，全部删除后显示空态；目录已失效也可移除，之后仍可重新添加。

删除期间禁止重复删除、新建终端及切换项目；清理终端或保存配置失败时保留项目并显示错误，可重试。已经结束的终端无法因失败而恢复。

| 快捷键              | 行为                           |
| ------------------- | ------------------------------ |
| `Cmd+O`             | 打开目录                       |
| `Cmd+T`             | 当前项目新建终端               |
| `Cmd+W`             | 关闭当前标签；无标签时关闭窗口 |
| `Cmd+1…9`           | 切换当前项目的第 1…9 个终端    |
| `Cmd+,`             | 设置                           |
| `Cmd+Q`             | 退出应用                       |
| `Cmd+C` / `Cmd+V`   | 复制终端选区 / 向终端粘贴      |
| `Ctrl+C` / `Ctrl+D` | 保留 Shell 的中断 / EOF 语义   |

- 界面采用 ChatGPT 风格的浅色主题：浅灰标题栏和侧栏、白色工作区、中性按钮；终端与原生弹窗同为浅色，暂不提供深色模式。标题栏保留 macOS 原生红黄绿按钮，终端标签、新建终端与设置直接放在标题区域，不显示应用名称；空白区域可拖动窗口。最左侧为窄图标导航栏，目前仅有首页。
- 默认最多保留 **10 个标签**（包括已退出标签）；关闭旧标签后可新建。
- 默认 scrollback **5,000 行**，设置允许 **1,000–20,000** 行。减小会丢弃超过上限的旧输出。
- 已退出标签显示 `Exited` 和退出码，不再接受输入。
- 多个终端在同一目录中**没有文件隔离**，并发修改同一文件须自行协调。

## Shell 与命令找不到的排查

- 默认使用有效、可执行的绝对路径 `SHELL`，否则回退 `/bin/zsh`。Shell 均以 `-il`（交互式登录）启动。
- 设置可填写 `/bin/zsh`、`/bin/bash` 或 `/opt/homebrew/bin/fish` 等**可执行文件绝对路径**，不能填写 `fish -l` 之类带参数命令。路径本身可包含空格。
- Shell 设置只影响新建的终端，已有 Shell 不重启。
- Finder 启动时的环境可能不同于系统终端。先在 Cota 中运行 `echo $PATH`、`command -v codex` / `pi` / `claude`。Shell 的 `command not found` 原样展示，Cota 不会自动安装命令。
- Homebrew 可按官方建议在对应 Shell 初始化文件中配置 `brew shellenv`；fnm 等版本管理器应配置在该 Shell 的交互式初始化中。zsh 常见位置为 `~/.zprofile`、`~/.zshrc`，fish 为 `~/.config/fish/config.fish`，bash 为 `~/.bash_profile`。不要为修复 PATH 而关闭系统安全保护。
- 若初始化只存在于另一个 Shell，请在设置中选择该 Shell，或调整自己的初始化文件；也可以直接输入已安装 CLI 的绝对路径。
- Shell 初始化文件中的交互提问、错误或耗时命令会影响终端启动；本应用不重写用户的配置。

## 本地打包

```sh
pnpm pack   # release/mac-arm64/Cota.app
pnpm dist   # 同时生成 release/Cota-0.1.0-arm64.dmg
```

原生依赖在安装、打包时按 Electron ABI 重建，`node-pty` 及其 `spawn-helper` 从 ASAR 解包。更换 Electron 或机器架构后，请重新 `pnpm install` / 打包，不要把系统 Node ABI 编译的模块直接复制进应用。

当前包是**未签名、未公证的个人开发构建**，使用默认 Electron 图标，不是正式公开发行版本。可将 `.app` 放入 Applications 后启动；若 macOS 阻止，确认来源后按系统提供的“隐私与安全性 → 仍要打开”流程处理，不要求关闭 Gatekeeper 或全局移除隔离属性。

`pnpm-workspace.yaml` 定向固定 `app-builder-lib` 的 `@electron/get` 为 3.1.0：electron-builder 26.15.3 依赖的缓存模式在 3.0.0 中不存在；去掉此约束可能导致打包报 `Cannot read properties of undefined (reading 'ReadWrite')`。

## 数据与退出边界

- 最近最多 20 个项目和 Shell / scrollback 偏好保存在 Electron `userData/config.json`；打包版默认位于 `~/Library/Application Support/Cota/config.json`，开发版目录名可能为 `cota`。文件权限为 `0600`，写入串行并通过同目录临时文件原子替换。
- 损坏或版本不兼容的配置会提示并保留原文件，不静默覆盖；修复或移走提示路径下的文件后重启。
- 重启仅恢复最近项目和设置，**不恢复终端标签、进程或滚动内容**。
- 正常退出按顺序清理受管理 Shell 和当时可追踪的子进程，必要时升级为强制终止。强杀应用、系统崩溃，或程序主动脱离进程树/另起守护进程，不承诺清理或恢复。
- 终端内容只用于本地内存呈现，不写完整输出日志、不遥测、不上传。本应用不发起 Agent 请求，但用户自行运行的 CLI 仍可访问网络与文件，并遵循自己的隐私和权限策略。
- Renderer 无 Node.js / 文件系统直通能力；只有 Main 持有 PTY。Preload 暴露固定、类型化 IPC，Main 校验主窗口、主 Frame、来源 URL 和输入参数。

## 文档与当前状态

- [PRD](docs/需求文档/PRD.md)
- [已确认技术方案与目录](docs/技术方案.md)
- [测试及真实验收记录](docs/验收记录.md)
- [第三方源码许可](THIRD_PARTY_NOTICES.md)

一期功能代码、开发检查和本地 `.app` / `.dmg` 构建已落地。**仍需完成验收记录中的人工项，不能将当前开发包视作已通过全部 Release Gate。** 不包含 SQLite（后续阶段再引入）、Agent 原生集成、Worktree、编辑器、分屏、云端或后台会话恢复。
