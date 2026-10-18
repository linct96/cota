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
pnpm test         # Vitest，主线流程与核心逻辑，无需 Agent 账号
pnpm test:pty     # 用 Electron ABI 运行真实 PTY；检查本机存在的 zsh/bash/fish
pnpm test:host    # 构建后验证独立 Host、断线重连和屏幕恢复
pnpm build
```

`pnpm dev` 会启用 React Grab：将鼠标移到界面元素上，按 `Cmd+C`（Windows/Linux 为 `Ctrl+C`）复制元素与 React 组件源码位置，再粘贴给编码 Agent。仅开发环境加载，不包含在生产构建中。

`pnpm test` 仅覆盖主线流程与核心逻辑：工作区及终端状态、设置保存、IPC 删除与权限校验、配置持久化、Shell 与参数校验、PTY 生命周期与背压、进程树清理、Git 分支读取。安全边界、异步竞态及失败恢复保留自动化覆盖；不保留 DOM、样式、文案、菜单及弹窗交互测试，界面通过人工回归检查。

`test:pty` / `test:host` 会运行交互式登录 Shell，因此会执行本机既有的 Shell 初始化文件；只在信任本机 Shell 配置的环境中运行。自动化测试不代表中文输入法及第三方 Agent 已通过集成验收。

## 使用

1. 点击 **Open Folder**，从系统目录选择器打开本地文件夹。
2. 点击 **New Terminal**，Shell 在该项目目录启动。
3. 在 Shell 中输入已经安装的 CLI 命令；安装、登录、权限确认、更新均由对应 CLI 自己处理。
4. 添加项目时默认创建“工作区 1”；点击文件夹行右侧的 **+** 弹出命名框，预填“工作区 N”并选中文本，可自定义名称；确认后才创建并选中新工作区，取消不改变现有状态。名称会去除首尾空格，不能为空。工作区行的 **右键菜单 → 编辑工作区** 可修改名称，预填并选中原名称，保存不影响选中状态或终端，取消不生效。所有工作区使用独立 UUID、平等管理各自的终端标签，通过顶部 **+** 或 `Cmd+T` 创建终端。点击选中没有终端的工作区时自动创建一个终端（仍受全局 10 个终端上限限制）；关闭当前工作区的最后一个终端后取消选中，保留工作区，再次点击时重新创建终端。切换项目、工作区或标签只隐藏终端，不销毁进程。工作区共用项目目录，不提供文件隔离。有 Git 分支时，在工作区名称下方显示分支副标题；同一项目下各工作区显示相同分支，窗口聚焦或可见时每 5 秒刷新。非 Git 目录、分离 HEAD 或 Git 不可用时不显示。
5. 关闭终端标签（含 `Cmd+W`）时，只有空闲 Shell 或已退出的终端直接关闭；存在前台/后台子进程（含暂停任务，不计已结束的僵尸进程）、Shell 被 `exec` 替换为其他程序，或无法确认进程状态时，使用 shadcn AlertDialog 确认。纯 Shell 内建计算且无子进程无法精确识别。关闭窗口或退出应用（含 `Cmd+Q`）仍在存在存活终端时确认，默认聚焦“取消”。取消后继续工作；退出清理失败时同样使用该组件提示，应用保持打开。
6. 工作区行的 **右键菜单 → 删除工作区** 仅结束并移除该工作区的终端；删除项目最后一个工作区时，自动移除文件夹行和最近项目记录。文件夹行的 **更多操作（…）→ 删除项目** 则删除该项目全部工作区和终端。两者均使用默认聚焦“取消”的 shadcn 确认弹窗，**不会删除本地目录或文件**，其他项目不受影响。删除当前项目后切到剩余项目，无项目则显示空态；目录已失效也可移除，之后仍可重新添加。

删除期间禁止重复删除、新建终端及切换项目；清理终端或保存配置失败时保留目标记录，可重试。已移除工作区顶部的全局错误横幅，项目操作、资源上限及布局保存失败仅记录到开发者控制台；终端、设置和弹窗内部的错误提示保留。已经结束的终端无法因失败而恢复。

| 快捷键              | 行为                           |
| ------------------- | ------------------------------ |
| `Cmd+O`             | 打开目录                       |
| `Cmd+T`             | 当前工作区新建终端             |
| `Cmd+W`             | 关闭当前标签；无标签时关闭窗口 |
| `Cmd+1…9`           | 切换当前工作区的第 1…9 个终端  |
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
pnpm run pack   # release/mac-arm64/Cota.app（不要用 pnpm 内建的 pack 命令）
pnpm dist       # 同时生成 release/Cota-0.1.0-arm64.dmg
node scripts/host-smoke.cjs --packaged  # 校验 .app 内的真实 Host / PTY
```

原生依赖在安装、打包时按 Electron ABI 重建，`node-pty` 及其 `spawn-helper` 从 ASAR 解包。更换 Electron 或机器架构后，请重新 `pnpm install` / 打包，不要把系统 Node ABI 编译的模块直接复制进应用。

当前包是**未签名、未公证的个人开发构建**，使用默认 Electron 图标，不是正式公开发行版本。可将 `.app` 放入 Applications 后启动；若 macOS 阻止，确认来源后按系统提供的“隐私与安全性 → 仍要打开”流程处理，不要求关闭 Gatekeeper 或全局移除隔离属性。

`pnpm-workspace.yaml` 定向固定 `app-builder-lib` 的 `@electron/get` 为 3.1.0：electron-builder 26.15.3 依赖的缓存模式在 3.0.0 中不存在；去掉此约束可能导致打包报 `Cannot read properties of undefined (reading 'ReadWrite')`。

## 自动构建与发布

`.github/workflows/release.yml` 在推送 `vX.Y.Z` 格式的正式版本 Tag 时触发，例如 `v0.1.0`。Tag 必须指向已合入 `main` 的提交，不接受预发布版本或带前导零的版本号。

流程在 macOS ARM64 Runner 上执行：冻结依赖安装 → 格式检查 / lint / 测试 → 类型检查与构建 → DMG 打包 → 安装包版本及真实 Host / PTY 检查 → 上传 GitHub Release，并自动生成更新说明。任一步失败都不会进入发布步骤。

安装包版本取自 Tag（去掉 `v`），不改写仓库中的 `package.json` 或锁文件；本地打包仍使用 `package.json` 的版本。产物为 `Cota-X.Y.Z-arm64.dmg`。重跑同一 Tag 的工作流会替换已有 Release 的同名安装包。

```sh
# 确认发布提交已推送至 main 后，以实际版本号替换示例
git tag v0.1.0
git push origin v0.1.0
```

工作流只使用 GitHub 提供的 `GITHUB_TOKEN`，需要仓库启用 GitHub Actions 并允许工作流写入 Release。当前仍是**未签名、未公证**的安装包，仅支持 macOS Apple Silicon；不包含应用内自动更新。

## 数据与退出边界

- 最近最多 20 个项目、Shell / scrollback 偏好、工作区名称与 UUID、终端关联和选中状态保存在 Electron `userData/config.json`；打包版默认位于 `~/Library/Application Support/Cota/config.json`，开发版目录名可能为 `cota`。文件权限为 `0600`，写入串行并通过同目录临时文件原子替换。
- 损坏或版本不兼容的配置会提示并保留原文件，不静默覆盖；修复或移走提示路径下的文件后重启。
- 启动仅在上次选中的工作区仍有可恢复的 Host 终端会话时，恢复该工作区及原活动标签；原活动标签已不存在时使用该工作区的其他现有标签。正常 `Cmd+Q` 已清理终端，重开保持未选中；升级重启等保留 Host 会话的场景可恢复选中。**不自动创建终端或重新执行旧命令**；空工作区需点击后才新建终端。
- PTY 由独立 Terminal Host 托管。Renderer 重载、Main 意外结束时，只要 Host 仍存活，下次打开可接回原 Shell、已有标签及有界屏幕内容，包括常见全屏 TUI。重连只 attach，不因超时或会话缺失自动重新执行命令；Host 也已结束时，保留工作区但不伪造恢复旧终端。
- 正常关闭窗口 / 退出仍确认并按顺序清理受管理 Shell、可追踪子进程和 Host，必要时升级为强制终止。Host / 系统崩溃、系统重启或程序主动脱离进程树，不承诺恢复；不写磁盘终端历史。
- 当前 Host 复用现有 Electron 运行时，**尚不支持安装包替换期间的存活保证**；签名稳定 Helper、更新和迁移逻辑本次不做。复杂终端协议及转义序列中途断线仍需人工验收。
- 终端内容只用于 Renderer / Host 的本地有界内存呈现，不写完整输出日志、不遥测、不上传。本应用不发起 Agent 请求，但用户自行运行的 CLI 仍可访问网络与文件，并遵循自己的隐私和权限策略。
- Renderer 无 Node.js / 文件系统直通能力。Preload 暴露固定、类型化 IPC，Main 校验主窗口、主 Frame、来源 URL 和输入参数，通过带随机凭据的本地 Unix socket 访问 Host；Host 独占 PTY、校验参数并执行全局终端上限。

## 文档与当前状态

- [PRD](docs/需求文档/PRD.md)
- [已确认技术方案与目录](docs/技术方案.md)
- [测试及真实验收记录](docs/验收记录.md)
- [第三方源码许可](THIRD_PARTY_NOTICES.md)

一期功能代码、开发检查和本地 `.app` / `.dmg` 构建已落地。**仍需完成验收记录中的人工项，不能将当前开发包视作已通过全部 Release Gate。** 不包含 SQLite（后续阶段再引入）、Agent 原生集成、Worktree、编辑器、分屏、云端、跨系统重启的冷恢复或更新流程。
