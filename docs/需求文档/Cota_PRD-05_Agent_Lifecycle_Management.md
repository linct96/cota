# PRD-05｜Cota Agent 生命周期管理

**产品：** Cota（macOS 优先、Terminal-first ADE）\
**版本：** v1.0\
**优先级：** P0\
**状态：** Phase A/B/C 与系统通知代码已接入，真实 CLI 部分验收，打包与通知人工验收待完成\
**日期：** 2026-10-19\
**代码基线：** `linct96/cota@82f1c9c`（验收修复见当前工作区）\
**前置依赖：** Git Worktree、Terminal Host、Workspace V2、Terminal Binding

> **核心设计决策：** Cota 管理 PTY 和 Agent 进程；Adapter 只负责提供可信状态事件；Agent 交互始终在原生终端中完成。不重建聊天界面。受管 Hooks / Extension 仅在用户从设置主动安装并确认后写入 CLI 配置，绝不在启动、打开设置或检测时安装。

---

## 实施边界（2026-10-19）

Phase A/B/C 均已接入：CLI Registry、有界版本检测、直接 PTY 启动、不可变启动身份、共享终端上限；Host 权威 AgentSessionManager、隔离事件入口、统一受管 Hooks / Extension；Tab 状态、工作区聚合、后台更新、Host 快照恢复和未读对账。普通 Shell 默认入口与 Worktree 自动创建 Shell 不变，Host 协议为 6。配置 V2 仅持久化可选的 Agent 类型 / provider，不再保存集成启用开关，不保存运行状态、凭证或任务内容。

### 授权与事件安全

- “设置 → 常规 → Agent 状态集成”仅保留各 CLI 的安装状态、检测、安装 / 更新与卸载入口，不再提供总开关。用户主动确认安装即授权使用；新建终端提供状态接入，但不安装任何文件。菜单与 Shell 手动启动均由用户已安装的同一套受管 Hooks / Extension 主动报到，不再通过启动参数单独注入 Extension、Hooks 或启用 Codex Hooks；未安装时正常启动 CLI，任务状态未知。现有 Hooks 保留，Codex notify 不替换，不增加权限、沙箱或 Hook 信任跳过参数。
- 独立 `agent.sock`（0600）不提供管理 RPC；每次启动随机凭证只授权对应 terminalId / launchId / provider。管理通道凭证不会传给 CLI，两类凭证互不通用。
- 事件只接受白名单元数据，4 KiB 帧、最多 64 连接、2 秒首次认证、每连接及启动每秒 100 条；拒绝未知字段、无效身份、超过 30 秒的传输时间偏差、重复 / 主 Agent 旧轮次与退出后事件；子 Agent 用本次启动内的原生 agent_id 独立归并，可跨主 Agent 轮次继续执行。Pi 使用独占持续连接，断线降级；Hooks 五分钟无活动事件仅降级未知，后续可信事件可恢复。
- Hooks 原生 stdin 最多在内存读取 1 MiB / 1 秒，随即丢弃业务内容，仅提取事件类型、原生轮次 / 子 Agent / 工具请求标识、工具名、后台子 Agent ID 清单及非 Agent 任务数量；助手输出固定空 JSON，不参与权限裁决。全链路不保存提示词、回复、工具输入输出或 transcript。
- 安装后请新建终端，CLI 在启动时加载已安装的 Hooks / Extension，无需另行启用 Cota 集成。关闭终端立即撤销对应凭证；安装文件不会自动卸载，Host 停止后不再接收事件。

### 统一受管集成（2026-10-20 用户确认方案）

- 设置提供逐项检测、安装 / 更新与卸载；检测只读，安装和卸载由 Main 验证 provider 和可信窗口后再次确认修改路径。取消确认、启动应用、打开设置与检测均不修改文件。
- 已安装或需要更新的集成均可卸载：Pi 仅删除 Cota 自有扩展，Claude / Codex 遍历全部事件仅移除对应 Cota 命令，保留混合分组中的其他 Hooks 与其余配置。沿用锁与修改前比对，卸载不创建备份，拒绝损坏配置、符号链接或非自有扩展。保留共享加载脚本，避免影响其他 provider；Dev / 正式版共用配置，卸载均受影响。不结束现有 Agent，已加载的集成需重启 CLI 后停止生效。
- Pi 使用有效 agent 目录下 `extensions/cota-agent-status.ts`；Claude 追加有效配置目录中的 `settings.json`；Codex 追加有效 Home 的 `hooks.json`。共享 `~/.cota/hooks/agent-hook.sh` 与 Pi 加载器不含凭证，由终端环境指向各自 Dev / 正式版适配器与 socket。只管理 Cota 条目，保留用户配置与混合 Hook 组，安装或更新修改已有文件前备份；文件级锁、写前校验和原子替换防止覆盖并发修改，损坏配置 / 符号链接文件 / 自有文件冲突拒绝写入。
- Codex 入口为“安装并信任”（更新时“更新并信任”），必须在确认弹窗明确授权并展示 `hooks.json`、加载脚本与 `config.toml` 路径。仅信任本次 Cota Hooks：使用本机 Codex `app-server` 的 `hooks/list` 获取原生 key / 定义哈希，并通过原生 `config/batchWrite` 合并 `hooks.state`，不自行计算哈希、不批准其他 Hooks、不修改 feature 开关或绕过企业策略，不创建会话或执行 Hooks。写入沿用锁、内容比对、备份、配置版本校验与非普通文件拒绝；定义变更后重新确认。接口不支持、冲突或策略拒绝时明确提示文件已安装但未确认信任成功，可重试或在 `/hooks` 手动审核；安装并信任成功后隐藏安装入口，仅保留卸载，需更新时再显示“更新并信任”。检测仅表示文件状态，不读取信任状态或证明成功运行。Codex 按检测版本追加受支持的子 Agent / Interrupt 事件，版本未知时仅安装基础事件。自定义配置目录以检测展示的应用环境路径为准，不猜测 Shell 后续切换的目录。
- 菜单启动与普通终端均获得仅限该终端的接入凭证。Host 在白名单元数据、凭证验证后，检查报告进程到 PTY 的祖先链、前台组与 PID / 启动时间，复用 AgentSessionManager；菜单启动保留不可变的 provider / launchId，Shell 内识别的 Agent 创建独立 launchId；不传 Host 管理凭证，不上传原始 Hook JSON。轮次 ID 按原生 session_id 隔离；有界队列等待首次版本确认，不放宽认证和帧上限。
- 终端创建方式保持不变，运行中的 Agent 可出现、更新、移除。Host 用递增 revision 和移除事件防止旧状态复活；Shell 状态不随 Agent 结束而退出，保存布局不将临时识别结果变成自动启动配置。共享有界进程快照统一发现 Codex / Claude / Pi 原生进程、Codex 平台二进制及已知 npm Node 入口，无需向 Agent 先提交消息；只认所属 PTY 祖先链、前台组与唯一 provider / owner。新终端、回车提交或已有 OSC 133 命令开始 / 结束标记约 350ms 后触发检测；有 Agent 时每 750ms、无 Agent 时每 2 秒兜底，失败指数退避至 10 秒，共享单次查询且不并发堆积。常规快照仅查询可执行名称、PID / 启动时间 / 进程树 / 前台组；仅为所属终端的前台 Node 进程补查 argv（每次最多 64 个），复核身份后提取已知入口，支持绝对路径符号链接。原始命令行及其参数只在本机短暂解析，不保存、不上报；自定义启动器、Node 前置参数及歧义路径仍可依赖原生事件。进程级 Agent 的任务状态为未知，不授权 Hooks，首个可信会话 / 轮次事件到达后沿用同一 launchId 并接入任务状态。PID 复用或真实退出移除动态 Agent；查询失败、暂停或失去前台归属降级未知，不视为完成或退出。
- Codex 菜单启动 0.156+ 隔离 daemon。受管文件已安装时，普通 zsh / bash / fish 加载仅限本终端的 codex 包装：zsh 通过 Cota 私有 `ZDOTDIR` 转发启动文件；bash 通过私有 `--rcfile` 按登录顺序读取 `/etc/profile` 与首个用户 profile，不额外重复加载 `.bashrc`；fish 通过 `-C` 在用户配置加载后定义函数。保留用户 alias / function，逐次探测支持 `--no-daemon` 才追加，`agents` / `queue` / 显式 `--no-daemon` / `--remote` 不追加。该过程不改用户 Shell 文件、不安装或修复 CLI Hooks；准备失败仍启动普通 Shell。包装只对新终端生效；Codex 启动后先由前台进程发现并显示未知状态，原生事件到达后再更新任务状态。其他 Shell 或绕过包装不保证 daemon 隔离，归属不明的事件拒绝绑定。

### 原生能力矩阵（适配范围，非真实 CLI 验收记录）

| Provider | 版本范围 | 统一加载方式 | 可观测能力与保守降级 |
| --- | --- | --- | --- |
| Pi | 1.3+，限 1.x | 已安装的受管 Extension | `agent_start` 开始，`ui_prompt_start/end` 明确交互，最终 `agent_settled` 核对 `agent_before_settle.outcome` 后区分完成、失败、中断，缺失结果为未知；持续连接断开立即未知 |
| Claude Code | 2.1.196+，限 2.x | 已安装的 `settings.json` Hooks | 使用原生 `prompt_id`；Stop 立即表示本轮结束，结果未知，可由后续原生活动纠正，不依赖 `idle_prompt`。StopFailure 表示失败；接入 AskUserQuestion、子 Agent、PostToolUseFailure 与后台任务快照；主事件缺少轮次标识则本次集成不可用 |
| Codex | 0.124+，限 0.x | 已安装的 `hooks.json`，用户确认“安装并信任”且 CLI / 策略允许 Hooks | 部分可观测：开始、工具活动、权限请求与 request_user_input；Stop 表示本轮结束，不代表成功。0.145+ 接入 SubagentStart/Stop，0.159+ 接入 Interrupt；原生信任接口不可用时转 `/hooks` 审核，不覆盖 notify |
| 未安装 / 未知 / 旧版本 / 组件缺失 | 任意 | 不注入或自动修复 | 继续基本 CLI 启动，仅进程可观测，任务未知 |

可观测性仅在收到可信事件后升级，不因版本命中就宣称集成成功。UI 同时区分 runtime/activity/outcome；`completed + unknown` 显示“本轮结束”，仅原生明确成功才显示“已完成”，失败与取消分开。主 Agent 结束不覆盖仍待处理或运行中的子任务；归并优先级为等待、执行中、未知、主 Agent 结束结果。未读由 Host 维护并以 launchId + revision 精确确认；背景、设置页、窗口失焦时不自动已读，已读不修改实际状态。工作区聚合排除没有活动 Agent 的 Shell、已退出进程及已读结束 / 失败。

工具等待按 actor 和原生请求 ID 关联：只有同一 actor 的匹配 PostToolUse / PostToolUseFailure 才清除对应等待；无 ID 的权限等待保留至该 actor 本轮结束，避免平行工具误清。子 Agent 结束或过期后，同一原生 ID 的新 Start 可恢复执行并清理上一轮状态；仍执行或等待时重复 Start 不清除等待。

Claude 后台任务只使用主 Agent Stop / StopFailure 的完整快照：后台子 Agent ID 合入同一张 actor 表去重，非 Agent 任务数量仅在会话级保存。SubagentStop 只结束对应子 Agent，不使用其中可能仍将自身标为 running 的滞后清单。完整空清单可以对账清除旧证据，字段缺失不能；无效、未知类型、ID 冲突或超限降级未知，不把截断清单当成空清单。当前支持 subagent 以及 shell / monitor / MCP task / cloud session；teammate 等归属不明的运行项降级，不按名称或 ID 外形猜测。保持 4 KiB 帧限制，较大的清单在适配端提前降级。

子任务和会话级后台快照各自有五分钟新鲜度限制；普通主 Agent 活动、新 prompt 或无快照的 Stop 不能刷新后台证据。完整快照只更新不晚于其时间的子任务证据，不用旧清单覆盖新生命周期事件。缺少结束证据时保留执行中，过期降为未知，不推断成功或取消；不读取 transcript、不解析终端标题 / Escape，也不切换 app-server。原生成功仅指本轮结算，不保证业务目标达成。

关闭失败时保留会话与错误诊断；尚未收到真实退出事件则恢复 runtimeState=running，使输入 / resize 可继续并允许重试关闭。停止阶段已撤销的集成凭证不恢复，activity 保持 unknown；若关闭期间已退出则保留 exited 和退出码，禁止错误恢复 running。

2026-10-20 经用户明确授权，在隔离 HOME / CLI 配置与临时 Git Worktree 中执行了真实 CLI / Electron Host / PTY 验收，发现并修复菜单 Agent 的原生 setsid Hook 归属拒绝问题。三种版本的通过项、阻塞项和未测项见 [真实 CLI 验收记录](../验收记录/2026-10-20-agent-cli-acceptance.md)。这不是全版本或全部 DoD 通过；应用 GUI、macOS ARM64 打包及发布 smoke 仍待验收。

### 原生系统通知（2026-10-20）

- Main 直接消费 Host 权威状态，使用 Electron 原生 Notification，不由 Renderer 或终端输出推断结果。后台终端的明确成功、明确失败及需要操作触发提醒；结果未知的结束仅称“本轮结束”，中断、进程退出和集成不可用不冒充任务失败 / 成功。权限等待与原生问题统一提示返回终端处理，不代替用户授权。
- 当前终端实际可见且窗口聚焦时不通知；设置页、其他终端或窗口失焦不视为正在查看。按 launchId、轮次与状态去重，已读回执不重复提醒，断连清理，初始快照不补发历史提醒。
- 通知仅含 Agent 名、项目 / 工作区名称与状态，不含提示词、回复或工具内容。点击后再次核对存活会话身份，再聚焦窗口、切回主页并选择对应终端；已关闭或被新会话替换的目标忽略。
- 系统不支持、显示失败或系统权限关闭不影响状态与未读提醒。没有新增通知配置面板或依赖。代码与相关重逻辑已自动化验证；系统横幅、权限、勿扰模式和点击跳转由用户后续人工验收。

以下背景中的“当前实现”描述需求提出时的基线。

## 1. 产品背景

### 1.1 当前实现

Cota 目前已经具备：

- 基于 Electron、React、Zustand 的桌面工作区。
- 多项目、多 Local Workspace、多 Git Worktree。
- 基于 `node-pty` 和 xterm.js 的终端。
- 独立 Terminal Host，支持会话列表、附着、分离和恢复终端屏幕。
- Worktree 与 Terminal 的真实 cwd 绑定。
- Terminal 退出状态检测和进程树清理。
- 开发版、正式版数据隔离。

当前用户使用 Agent 的流程为：

1. 打开项目，进入 Workspace 或 Worktree。
2. 创建普通 Terminal。
3. 手动执行 `pi`、`codex` 或 `claude`。
4. 在 Terminal 中输入任务，与 Agent 交互。
5. 手动切换终端，检查各个 Agent 是否完成。

Cota 当前只知道 Terminal 是否启动、运行或退出，不知道内部 Agent 的任务执行状态。

### 1.2 主要问题

| 问题 | 用户影响 |
| --- | --- |
| Agent 需要手动启动 | 每次创建工作区都要输入命令 |
| 无法区分 Shell 和 Agent | 侧栏不能清晰表达当前运行的程序 |
| 无法判断 Agent 是否在执行任务 | 多 Worktree 场景需要频繁切换检查 |
| 无法识别需要操作的 Agent | 权限请求或问题容易被忽略 |
| 无法识别任务结束事件 | 不知道何时应开始 Review |
| Terminal 与 Agent 状态混用 | 容易把任务完成误认为进程退出 |
| 缺乏会话状态关联 | Renderer 重载后难以恢复准确的 Agent 状态 |

## 2. 产品目标与成功标准

### 2.1 核心目标

在现有 Terminal Host 基础上实现 Agent Session Manager，让 Cota 能够：

1. 在指定 Workspace 中一键启动 Pi、Codex CLI 或 Claude Code。
2. 自动绑定正确的 Worktree cwd。
3. 管理 Agent 进程的启动、存活、退出和关闭。
4. 通过可信的 Agent 生命周期事件识别工作中、等待操作与任务完成。
5. 在 Terminal 标签和 Workspace 列表中展示状态。
6. 切换 Workspace 时持续监控其他 Agent。
7. 在 Renderer 重载后恢复仍存活的 Agent 会话和最新可信状态。

### 2.2 成功标准

- 三种 Agent 均支持从 UI 启动，并保留原生 TUI。
- 启动相同 Terminal ID 的重复请求不会创建第二个 Agent。
- Cota 能准确区分进程运行和任务执行。
- 对于成功接入生命周期事件的 Agent，工作、完成和等待操作状态能够正确更新。
- 不具备相应事件能力时，准确展示状态未知，不错误标记完成。
- 多个 Worktree 的 Agent 会话互不干扰。
- Cota 退出、Worktree 删除、Host 异常时不会留下错误的会话登记或误杀其他工作区的进程。

### 2.3 非目标

本版本明确不实现：

- Chat 风格的原生 Agent UI。
- 直接调用模型 API 替代 CLI。
- 多 Agent 自动任务编排。
- 自动生成任务 Prompt。
- 自动代码 Review、Commit、Push。
- 通过模型分析 Terminal 输出判断任务是否完成。
- 完整的历史会话搜索和重启后对话恢复。
- SSH、远程 Host 和移动端 Agent 管理。
- 自动处理权限请求或自动发送用户输入。

## 3. 产品范围

| 能力 | 版本 | 说明 |
| --- | --- | --- |
| Agent CLI 安装检测 | P0 | Pi、Codex、Claude |
| 从 UI 一键启动 Agent | P0 | 新建独立 Agent Terminal |
| 普通 Shell 保持不变 | P0 | 兼容现有全部 Terminal 操作 |
| Agent 进程生命周期 | P0 | 启动、运行、关闭、退出、错误 |
| Agent 状态管理器 | P0 | 独立于 Terminal 状态 |
| Pi 生命周期事件适配 | P0 | 优先实现 |
| Claude Code 生命周期事件适配 | P0 | 支持的版本接入 |
| Codex 生命周期事件适配 | P0 | 按版本能力渐进启用 |
| Agent 状态的 Tab 与侧栏展示 | P0 | 含 Worktree 状态聚合 |
| Agent 事件源降级策略 | P0 | 避免状态误报 |
| Agent 完成后的桌面通知 | P1 | 仅可信状态触发 |
| 手动启动的 Agent 自动识别 | P1 | 尽力识别，不承诺完整状态 |
| Agent 历史会话及 Resume | P1 | 单独 PRD |
| Agent 模型与启动参数管理 | P1 | 保留各 CLI 原生设置 |
| 并行任务编排 | P2 | 单独设计 |

## 4. 核心产品模型

### 4.1 Terminal 与 Agent 的关系

每个 Terminal 可能运行一个普通 Shell，也可能是由 Cota 显式创建的 Agent Terminal。必须保留现有 Terminal ID 与 Workspace 绑定关系。

建议采用以下模型：

```text
Project
└── Workspace / Git Worktree
    ├── Terminal A（普通 Shell）
    ├── Terminal B（Pi）
    │   └── Agent Session B
    └── Terminal C（Codex）
        └── Agent Session C
```

**一个受 Cota 管理的 Agent Session 只绑定一个 Terminal ID。**

一个 Workspace 可以包含多个 Agent Session，每个 Agent Session 独立管理。普通 Terminal 不自动升级成受管理的 Agent Session。

### 4.2 状态需要分为两个维度

**维度 A：进程生命周期 `runtimeState`**

| 状态 | 含义 |
| --- | --- |
| `starting` | 已接受启动请求，正在解析和启动 CLI |
| `running` | Agent 主进程仍然存活 |
| `stopping` | 正在关闭 Agent 及其子进程 |
| `exited` | Agent 主进程已经退出 |
| `error` | 启动失败或发生明确的运行时错误 |

此状态由 Terminal Host 的实际进程生命周期决定。

**维度 B：任务状态 `activityState`**

| 状态 | 含义 |
| --- | --- |
| `unknown` | Agent 存活，但暂无可靠任务状态 |
| `idle` | Agent 明确处于待命状态 |
| `working` | Agent 已开始处理一轮任务 |
| `needs-input` | Agent 明确要求用户输入或确认 |
| `completed` | Agent 当前响应轮次已结束；是否成功由 outcome 单独表达 |
| `failed` | 原生事件明确报告本轮执行失败 |
| `interrupted` | 当前任务轮次被明确取消 / 中断 |

`runtimeState=running` 不应自动等于 `activityState=working`。`activityState=completed` 不应导致 Agent 进程退出。

### 4.3 状态展示规则

| 实际情况 | UI |
| --- | --- |
| CLI 启动中、关闭中、空闲，或进程存活但没有可靠事件 | 其他状态，不显示角标 |
| 收到可信任务开始事件 | 工作中 |
| 收到可信等待用户事件 | 需要操作 |
| 收到原生响应结束事件，结果未知 | 本轮结束 |
| 收到可信最终成功结算事件 | 已完成 |
| 收到可信任务失败事件 | 执行失败 |
| 收到可信任务中断事件 | 已中断 |
| 进程退出 | 其他状态，不显示角标；保留终端退出信息 |
| 启动失败 / 连接失败 | 连接失败 |

对于缺少原生事件的 Agent，禁止使用“终端超过 N 秒没有输出”推断任务完成或等待输入。对于任务完成事件，必须明确其含义是“一轮任务完成”，不能把它解释成整个用户需求、Git 变更或测试已经成功。

### 4.4 会话身份

每个 Agent Session 必须包含：

- `terminalId`：关联 Terminal。
- `launchId`：该次 Agent 启动的唯一标识。
- `provider`：`pi | codex | claude`。
- `projectPath`：所属项目。
- `workspaceId`：所属 Workspace。
- `cwd`：Main 授权解析出的真实工作目录。
- `runtimeState`：进程状态。
- `activityState`：任务状态。
- `startedAt`、`lastEventAt`。
- `lastTurnId`（可选）。
- `eventSource`：状态来源。
- `observability`：`full | partial | unavailable`。
- `exitCode`（可选）。

Agent Session 不应另建一套可任意指定 cwd 的工作区系统。

## 5. 功能需求

### FR-01｜Agent 安装检测（P0）

在 Cota 中支持检测以下 CLI：

| Agent | 默认可执行命令 |
| --- | --- |
| Pi | `pi` |
| Codex CLI | `codex` |
| Claude Code | `claude` |

要求：

- 使用与用户终端环境一致的可执行文件解析策略。
- 兼容 Finder 启动应用时缺少用户登录 Shell PATH 的情况。
- 支持 Homebrew 及常见版本管理器产生的用户 PATH。
- 禁止仅依赖 Electron Main 启动时的原始 `process.env.PATH`。
- 可以读取 CLI 的版本，用于判定生命周期事件适配能力。
- 检测失败时给出可理解的错误，不自动安装 CLI。
- 检测操作必须有超时及输出长度限制。
- 后续允许配置每种 CLI 的可执行文件路径。

启动不依赖版本检测完全成功；检测失败可以降级为基本进程管理，但不能启用未经验证的事件适配。

### FR-02｜新建 Agent 入口（P0）

在现有“新建终端”操作之外增加“新建 Agent”。

建议：

- 保留原有 `+` 新建普通 Terminal。
- 在 Workspace 的更多操作中增加“新建 Agent”。
- 可从菜单选择 Pi、Codex 或 Claude。
- 新建 Agent 后创建独立标签，并切换到该标签。
- 新标签复用现有 xterm.js 终端组件。
- 不自动生成 Prompt。
- 不修改其他工作区的运行状态。
- 未安装的 CLI 显示不可用及说明。

**新建 Worktree 后仍保持当前默认打开普通 Shell 的行为，不自动启动 Agent。**

首次启用深度状态集成时，向用户说明对应 CLI 会加载 Cota 提供的本地生命周期适配组件，允许用户选择禁用。禁用后仍能启动 CLI，只展示进程级状态。

### FR-03｜Agent 启动与 Terminal Host 集成（P0）

推荐为受管理的 Agent Terminal 使用独立 PTY 直接启动 CLI，而不是等待普通 Shell 就绪后自动向 stdin 写入 `codex\n` 等命令。

启动流程：

```text
Renderer
  -> 选择 Workspace + Agent 类型
  -> Main 校验项目、Workspace 与 Worktree 身份
  -> Main 构造受限的 Agent 启动请求
  -> Terminal Host 重新校验 cwd 和命令
  -> 创建 Agent Session
  -> node-pty 直接启动 Agent CLI
  -> 关联 Terminal ID
  -> Renderer attach / xterm.js 渲染
```

具体要求：

- 普通 Shell 仍维持现有 `pty.spawn(shell, ['-il'])` 行为。
- Agent Terminal 可以使用 `pty.spawn(agentExecutable, argv)`。
- Host 必须为 Agent 提供正确的 PATH、HOME、TERM、交互环境及工作目录。
- Agent 的标准输入输出仍直接连接 PTY。
- UI 不需要理解 Agent TUI 的内部布局。
- 不允许 Renderer 提交任意可执行命令。
- 不通过 Shell 字符串拼接启动 Agent。
- 不增加自动绕过权限确认的 CLI 参数。
- 创建操作按 Terminal ID 和不可变启动身份保持幂等。
- Agent CLI 退出后，保留退出信息与最后屏幕输出，直到用户关闭标签。

直接启动的 Agent 退出后不自动进入 Shell；用户可以继续打开普通终端。

### FR-04｜Agent 生命周期管理器（P0）

新增 `AgentSessionManager`，由 Terminal Host 持有受管理 Agent 的运行时状态。

核心职责：

- 管理 Agent Session 的创建、查询、退出和删除。
- 绑定 Terminal 与 Agent Session。
- 接收并校验 Agent 事件。
- 维护每个 Agent 的最新可信状态。
- 对外发送状态变化。
- 防止一个会话的事件影响其他会话。
- 对重复事件去重，拒绝无效或过期事件。
- 在进程退出时终止该会话的活动状态。

不建议让 Renderer 的 Zustand Store 自行推断 Agent 状态。

Host 是进程生命周期的唯一权威；Agent 原生事件是任务状态的主要来源；Renderer 仅展示快照与增量更新。

### FR-05｜三种 Agent 的状态事件适配（P0）

为每个 Agent 实现独立 Adapter，统一转换为 Cota 内部事件。

#### Pi Adapter

优先使用 Pi 的 Extension 能力。

建议支持：

- `session_start`：会话初始化。
- `agent_start`：一轮运行开始。
- `agent_settled`：自动处理结束，任务进入完成/待命。
- `session_shutdown`：会话结束。
- 受支持的显式用户输入请求事件。

注意：`turn_end`、`agent_end` 不一定意味着所有自动延续都已经结束，因此不应无条件映射为最终完成。

菜单与手动启动统一通过用户在设置确认安装的受管 Extension 自动加载，不再传入 `--extension`，不覆盖用户扩展。

#### Claude Code Adapter

优先使用 Claude Code 自带 Hooks。

可参考：

- `SessionStart`
- `UserPromptSubmit`
- `PermissionRequest`
- `Notification`
- `Stop`
- `SessionEnd`

通过用户在设置确认安装的受管 Hooks 接入，不再传入 `--settings` 注入 Hooks，并保留用户原有 Hooks。

其中：

- `UserPromptSubmit` 作为任务开始信号。
- `PermissionRequest` 或明确的权限通知作为需要操作信号。
- `Stop` 作为当前响应轮次结束信号，outcome 为 unknown，可由后续原生活动修正；不等待延迟的 idle_prompt。
- `StopFailure` 表示失败，不与取消混为一谈。
- `AskUserQuestion` 的 PreToolUse 表示提问等待，匹配的 PostToolUse / PostToolUseFailure 才恢复活动。
- SubagentStart / SubagentStop 与已观察到的后台任务参与归并，主 Agent Stop 不覆盖子任务等待 / 活动。
- `SessionEnd` 作为会话结束辅助信号。

如果 Stop Hook 导致继续执行或产生新活动，立即纠正为执行中；“本轮结束”不宣称最终成功。已有子任务 / 后台任务尚未结束时，保留其待处理 / 执行中状态，缺失后续证据时降级未知。

#### Codex Adapter

优先检测当前 Codex CLI 是否支持生命周期 Hooks，以及当前版本的功能与信任策略。

可利用的事件类型包括：

- SessionStart
- UserPromptSubmit
- PermissionRequest
- Stop
- SessionEnd
- Interrupt

如只能使用传统 `notify`，则仅使用其实际提供的完成事件，不将其推断为权限等待事件。

要求：

- 按 CLI 版本或实际能力判定可用集成方式。
- 尊重 Codex 原有 Hook 信任和企业管理策略。
- 不允许通过危险的信任绕过开关强制启用 Hooks。
- 无法加载事件适配时，降级为进程状态监控。
- 不因为 Hook 缺失阻止用户正常使用 Codex。

#### 统一约束

三个 Adapter 都只发送状态相关的必要信息。

禁止默认上传或保存：

- Prompt 原文。
- Agent 的完整回复。
- Tool 参数与执行结果。
- API Key、Token、环境变量敏感值。
- 完整会话 Transcript。

P0 不实现完整原生聊天记录采集。

### FR-06｜Agent 事件接收与状态转换（P0）

所有 Adapter 转换为统一事件：

- `session-started`
- `turn-started`
- `attention-required`
- `turn-completed`
- `turn-interrupted`
- `session-ended`

每条事件包含：

- `terminalId`
- `launchId`
- `provider`
- `eventId` 或单调序号
- `timestamp`
- `type`
- `turnId`（可选）

Host 使用独立的本地事件入口，或等效的受限消息通道。

此入口与现有 Terminal Host 管理 Socket 的权限隔离；Agent 插件不得取得 Host 管理 Token，也不得调用关闭终端、删除 Worktree 等能力。

状态转换规则：

1. `session-started` 只确认 Agent 会话已初始化。
2. `turn-started` 将活动状态更新为 `working`。
3. `attention-required` 仅在可信事件支持时更新为 `needs-input`。
4. `turn-completed` 仅将匹配的当前 Turn 标记为 `completed`。
5. `turn-interrupted` 将当前 Turn 标记为 `interrupted`。
6. 新 Turn 开始后，清除上一轮完成/等待状态。
7. 进程退出事件优先于全部活动状态。
8. 事件接收通道丢失或状态无法重新验证时，应降级为未知，不保留虚假的完成或等待状态。
9. 过期 Turn、重复事件、已退出会话的迟到事件不得覆盖最新状态。

不得仅根据 Terminal 键盘输入、输出停止或 CPU 使用率切换到 `completed`。

### FR-07｜Terminal 标签状态（P0）

在现有 `TerminalTab` 增加 Agent 身份和活动状态显示。

建议表现：

- 没有活动 Agent 的普通 Shell：保留现有 Terminal 图标及标题；接入原生事件后临时展示 Agent 名称与状态，进程退出后恢复。
- Agent Terminal：显示 Agent 名称和状态。
- `working`：小型活动指示。
- `needs-input`：需要操作的图标。
- `completed`：结果未知时用中性“本轮结束”；原生明确成功时用“已完成”。
- `failed`：执行失败，与进程连接失败区分。
- `starting` / `stopping` / `unknown` / `exited` / `idle`：展示层统一称为“其他状态”，不显示角标；底层生命周期和任务状态仍保留，不将未知视为成功。
- `error`：连接失败角标；保留现有退出码与错误机制。

Tab 标题示例：

- `Pi · 1`
- `Codex · 1`
- `Claude · 1`

状态必须具有文本或 Tooltip，不能单凭颜色区分。状态改变时不抢夺焦点、不自动切换 Terminal。

### FR-08｜Workspace 状态聚合（P0）

Worktree 可以包含多个 Agent。工作区状态应从所属的 Agent Session 聚合，而不是自行保存第二份独立状态。

建议优先级：

1. 存在 `needs-input` → 展示“需要操作”。
2. 否则存在 `working` → 展示“工作中”。
3. 否则存在未读的 `failed` → 展示“执行失败”。
4. 否则存在未读的 `completed` → 展示“本轮结束”（工作区不把混合结果宣称成功）。
5. 否则存在存活但状态未知的 Agent → 展示“运行中”。
6. 否则无活动 Agent → 保留普通工作区展示。

工作区左侧默认以绿色小圆点表示存在终端或 Agent，均不存在时显示灰点。聚合结果为非“其他状态”时，优先显示 Agent 状态图标；没有 Agent 提示或聚合为“其他状态”时保留圆点。

当同一个 Worktree 同时有多个 Agent 时，优先显示最需要用户关注的状态，并允许在 Tooltip 中查看具体数量。

没有活动 Agent 的普通 Shell 不参与 Agent 状态聚合。Local Workspace 与 Git Worktree 采用一致的 Agent 展示模型。

### FR-09｜退出、关闭和 Worktree 删除（P0）

Agent Terminal 必须复用现有 Terminal 生命周期管理。

要求：

- 关闭 Agent Tab 时，使用既有终端关闭确认和进程树清理机制。
- 不因任务完成自动关闭 PTY。
- 不因 Renderer 隐藏或切换 Workspace 结束 Agent。
- Worktree 删除时，复用现有删除前检查及关联终端关闭流程。
- 删除前仍需由用户确认危险的数据丢失操作。
- 不允许 Agent 状态事件触发 Git Worktree 自动删除。
- 关闭 Agent 失败时保留诊断状态，不伪造成功。
- 不允许误杀其他 Workspace、其他 Cota 实例或用户在外部终端中的 CLI。

本阶段不改变当前 Cota 正常退出时结束终端的产品行为。

### FR-10｜重连与恢复（P0）

Cota 的 Terminal Host 已有 attach/detach 和屏幕快照能力。Agent 需要复用这一机制：

- Renderer 重新加载时向 Host 查询真实 Session。
- 以 Host 返回的 Session 和 Activity 快照恢复 UI。
- Host 中仍存活的 Agent 可以重新 attach。
- 不对同一个 Terminal ID 重新 spawn Agent。
- Worktree 身份不一致时拒绝自动关联。
- Host 进程已结束时，不自动重新运行历史 Agent。
- Host 协议不兼容时明确提示，而不是静默清理旧进程。

已完成的一轮任务可以显示最新完成状态，但不能将普通布局持久化记录当成 Agent 仍然存活的证明。

## 6. 界面交互

### 6.1 创建

用户在 Workspace 菜单选择：

`新建 Agent → Pi / Codex / Claude Code`

Cota 检测 CLI、获取真实 cwd、打开 Agent Tab 并启动 CLI。

CLI 启动失败时：

- 保留当前 Workspace。
- 显示原因。
- 不产生僵尸 Agent Session。
- 提供重新尝试入口。
- 不在错误情况下自动回退项目主目录启动。

### 6.2 工作中

Agent 状态显示在 Tab 和 Workspace 行。用户切换其他 Workspace 不影响 Agent 继续执行。

### 6.3 需要操作

仅在 Adapter 收到可信的权限请求或交互请求时显示。

点击对应 Workspace/Tab，进入现有 Terminal TUI，由用户自行输入或确认。

Cota 不自动批准权限、不解析提示文字后代替用户操作。

### 6.4 已完成

Agent 完成一轮任务后：

- Tab 标记已完成。
- Worktree 可以显示未读完成状态。
- 用户仍可返回 Agent TUI 输入下一条任务。
- 下一轮任务开始后清除上一轮完成状态。
- P0 不进行自动 Git Review 或关闭 Terminal。

完成状态的已读处理应与任务状态分离：只有该 Agent Tab 实际可见且应用窗口持续聚焦 2 秒后，才清除完成 / 本轮结束的未读提醒并隐藏 Agent 完成角标，不改变真实的 `activityState`。后台完成时保留角标；失焦、切换终端或进入设置页取消计时，再次聚焦重新计时。新任务开始、Agent 被移除或连接断开时取消旧计时，不得清除新任务状态。

## 7. 技术边界与现有架构集成

### 7.1 建议模块划分

```text
src/
├── shared/
│   ├── contracts.ts
│   └── agent-contracts.ts          # 新增
├── main/
│   ├── index.ts                    # Agent IPC 入口
│   ├── host-protocol.ts            # 协议扩展
│   ├── host-server.ts              # 路由与鉴权
│   ├── terminals.ts                # Shell / Agent PTY
│   ├── agent-session-manager.ts    # 新增
│   ├── agent-event-server.ts       # 新增
│   └── agents/
│       ├── registry.ts
│       ├── pi.ts
│       ├── codex.ts
│       └── claude.ts
└── renderer/src/
    ├── store.ts
    ├── App.tsx
    └── components/
        ├── TerminalTab.tsx
        └── AgentLauncher.tsx       # 新增
```

### 7.2 Main / Host / Renderer 职责

| 层 | 职责 |
| --- | --- |
| Renderer | 用户操作、状态展示、未读状态 |
| Main | Workspace 授权、Agent 启动请求、可信 IPC |
| Host | PTY 进程、Agent Session、运行时状态、Adapter 事件接收 |
| Agent Adapter | 将原生事件转换为 Cota 统一事件 |

必须使用现有 Terminal 与 Worktree 生命周期门禁，不能创建一个绕过它们的独立启动通道。

### 7.3 Host 协议

当前 `HOST_PROTOCOL=2`。建议将其升级为 `3`，明确加入 Agent Session 能力。

建议新增内部操作：

- `agent:start`
- `agent:list`
- `agent:get`
- `agent:stop`

以及订阅式事件：`agent:state-changed`。

Agent PTY 的输入、输出、resize、attach、detach、close 仍尽量复用原有 Terminal 方法。

Main 必须校验 Renderer 请求来源。Host 不能信任 Renderer 提交的路径、任意命令或 Adapter 身份。

### 7.4 数据持久化

本阶段优先使用 Host 中的运行时 Session 作为真实状态来源。

`AppConfig` 仅需要保存与布局有关的最小元数据，例如：

- Terminal 类型。
- Agent Provider。
- Terminal 标题。
- 原有 Workspace 绑定。

新增字段尽量保持可选，使现有 V2 普通终端布局仍可读取；如确需修改配置版本，应单独处理迁移和损坏配置保护。

**不持久化 `runtimeState=running` 作为下次启动的事实。**

不保存完整 Agent 对话内容。

### 7.5 性能与资源

- 保留现有 `MAX_TERMINALS=10`，Agent Tab 计入同一限制。
- 不对每一条 PTY 输出执行 Agent 状态解析。
- 不对每个 Agent 进行高频全量进程树轮询。
- 状态事件在 Host 层去重后再通知 Renderer。
- 重复状态事件不得触发 UI 大范围更新。
- Agent 事件异常不得阻塞 PTY 输入输出。

### 7.6 安全要求

- Adapter 代码只能从 Cota 可信打包资源加载。
- 不执行来自 Workspace 文件的任意未经授权状态插件。
- 不擅自修改用户全局 Pi、Codex、Claude 配置；只有设置中明确确认的安装动作允许追加 Cota 自有集成。
- 不修改用户 Agent 的权限模式。
- 不自动使用危险的权限或 Hook 信任绕过参数。
- Adapter 上报的数据仅能改变显示状态，不能触发文件删除、终端管理或其他高权限操作。
- 本地事件通道需要会话令牌、数据大小限制、类型校验和速率限制。
- 事件令牌不复用 Terminal Host 的管理令牌。
- 终端与 Agent 的工作目录仍由 Main 授权、Host 复核。

## 8. 异常和降级策略

| 场景 | 预期行为 |
| --- | --- |
| CLI 未安装 | 提示安装，不创建 Agent Session |
| CLI 已安装但版本未知 | 可以尝试启动；状态能力降级 |
| CLI 鉴权失败 | 显示原生终端错误，不标记任务完成 |
| Hook 或 Extension 加载失败 | Agent 正常运行，显示状态未知 |
| 用户主动禁用状态集成 | 仅监控进程生命周期 |
| Agent 长时间没有输出 | 不自动认为已完成 |
| Agent 等待权限但没有可用事件 | 不伪造需要操作状态 |
| Adapter 收到重复事件 | 去重，保持状态 |
| Adapter 收到旧 Turn 事件 | 丢弃，不覆盖当前 Turn |
| Terminal 已退出仍收到事件 | 不恢复运行状态 |
| Renderer 断开后重新附着 | 从 Host 恢复真实状态 |
| Host 已丢失 | 状态不可恢复，不自动重启旧 Agent |
| Worktree 路径缺失或身份冲突 | 禁止启动新的 Agent |
| 用户删除 Worktree | 沿用安全关闭及删除流程 |

## 9. 验收标准

### 核心功能

- **AC-01** 在 Git Worktree A 选择 Pi，能够启动原生 Pi TUI，初始 cwd 为 A 的真实路径。
- **AC-02** 在 Worktree B 启动 Codex，两个 Agent 能同时运行，互不影响。
- **AC-03** 在普通 Local Workspace 中启动 Claude Code，仍能正常使用。
- **AC-04** 使用现有“新建终端”按钮，仍然启动普通 Shell，不自动运行 Agent。
- **AC-05** 启动失败不产生虚假的 Agent Session 或重复进程。
- **AC-06** 重复提交相同启动请求，不创建第二个 Agent 进程。

### 状态准确性

- **AC-07** Agent 主进程仍运行、任务已完成时，显示“已完成”，不显示“已退出”。
- **AC-08** 收到任务开始事件后，状态切换为“工作中”。
- **AC-09** 收到可信的交互请求事件时，状态切换为“需要操作”，用户仍在原生 TUI 中处理。
- **AC-10** 没有可信事件时，状态保持“未知”，不根据输出静默时间猜测。
- **AC-11** 下一轮任务开始后，清除上一轮完成状态。
- **AC-12** 旧事件、重复事件和不同 Session 的事件不能污染当前状态。

### 生命周期与兼容

- **AC-13** 切换 Workspace 后，后台 Agent 继续工作，侧栏状态可以更新。
- **AC-14** Renderer 重载，Host 仍存活时，原 Agent 不重复启动，并能重新附着。
- **AC-15** Agent 自行退出后，保留退出码及最后终端输出。
- **AC-16** 关闭 Agent Tab，按现有规则结束进程及其子进程。
- **AC-17** 删除 Worktree 时，不能遗漏其关联 Agent，也不能误杀其他 Worktree 的 Agent。
- **AC-18** 开发版与正式版 Agent Session 互相隔离。
- **AC-19** 原有 Terminal 输入、resize、scrollback、snapshot、backpressure 和关闭确认无回归。
- **AC-20** 未安装状态集成时，三种 Agent 仍能作为普通交互式 CLI 正常使用，任务状态未知。

## 10. 开发阶段

建议拆成三个可独立验收的阶段。

### Phase A：受管理的 Agent Terminal

**目标：先把 Agent 当成可管理的进程。**

任务：

- 定义 Agent Session 类型和启动契约。
- 实现 Agent CLI Registry。
- 实现三种 CLI 安装及路径检测。
- 增加“新建 Agent”入口。
- Terminal Host 支持直接 spawn Agent。
- 扩展会话列表、退出和重连逻辑。
- 保持普通 Shell 全部既有功能。

完成后应能从 Cota 中直接启动三种 Agent，但任务状态可以暂时显示未知。

### Phase B：Agent 生命周期事件与状态引擎

**目标：让 Cota 能识别 Agent 正在工作还是已经完成。**

任务：

- 实现 AgentSessionManager。
- 实现安全的生命周期事件接收器。
- 实现状态转换及事件去重。
- 实现 Pi Extension Adapter。
- 实现 Claude Hooks Adapter。
- 实现 Codex Hooks / Notify Adapter。
- 增加 Adapter 能力检测和降级处理。
- 增加多 Agent 状态一致性测试。

完成后，对已验证支持的 CLI 版本可以准确展示工作、完成和明确的用户交互请求。

### Phase C：界面状态与恢复

**目标：用户不切换终端也能看到不同 Worktree 的 Agent 状态。**

任务：

- TerminalTab 增加 Agent 身份和状态。
- Workspace 行显示聚合状态。
- 增加未读完成、未读需要操作标识。
- 保证后台 Workspace 能接收状态变更。
- 从 Host 恢复仍存活的 Agent Session。
- 处理异常退出、事件失效和不兼容 Host。
- 回归测试现有 Worktree 删除及 Terminal 关闭流程。

完成后形成完整的本地 Agent 生命周期管理能力。

## 11. 开发任务清单

| ID | 任务 | 优先级 | 主要位置 |
| --- | --- | --- | --- |
| AG-01 | Agent 数据契约 | P0 | `src/shared/contracts.ts` |
| AG-02 | CLI 探测与 Registry | P0 | `src/main/agents.ts` |
| AG-03 | 受管理的 Agent PTY 启动 | P0 | `main/terminals.ts` |
| AG-04 | AgentSessionManager | P0 | `main/agent-session-manager.ts` |
| AG-05 | Host 协议与 Main IPC | P0 | `host-protocol.ts`、`index.ts` |
| AG-06 | 生命周期事件接收器 | P0 | `main/agent-event-server.ts` |
| AG-07 | Pi Adapter | P0 | `src/main/agents/pi-extension.ts` |
| AG-08 | Claude Adapter | P0 | `src/main/agents.ts`、`src/main/agents/hooks.ts`、`src/main/agents/hook-entry.ts` |
| AG-09 | Codex Adapter | P0 | 同上（统一受管 Hooks、共用 Hook 元数据转换） |
| AG-10 | Agent Launcher UI | P0 | `src/renderer/src/components/AgentMenu.tsx` |
| AG-11 | Tab、Workspace 状态展示 | P0 | `TerminalTab.tsx`、`App.tsx` |
| AG-12 | Store 与重连对账 | P0 | `store.ts` |
| AG-13 | 单元、Host 集成、实际 CLI 验证 | P0 | `tests/`、smoke scripts |
| AG-14 | 完成 / 失败 / 等待操作原生通知 | P1 | `main/agent-notifications.ts`、Main / preload / Renderer 定位链路；已实现，用户人工验收待完成 |

## 12. Definition of Done

本 PRD 完成需要满足：

1. `pnpm typecheck` 通过。
2. `pnpm lint` 通过。
3. `pnpm test` 通过。
4. `pnpm test:pty` 通过。
5. `pnpm test:host` 通过。
6. macOS ARM64 打包和 Host smoke test 通过。
7. 使用真实 Pi、Codex CLI、Claude Code 版本进行交互测试，记录具体版本和支持的事件矩阵。
8. Agent 启动、退出、重连和 Worktree 删除场景均有测试。
9. 不回归已有 Git Worktree 安全删除及 Terminal 工作目录授权功能。
10. 对于状态未知、不支持和事件丢失的情况，UI 不能误报任务完成或需要操作。
11. 不擅自修改全局 Agent 配置，不修改权限策略；受管安装必须由用户明确确认。
12. 不引入完整原生 Chat UI，也不引入远程 Runtime 架构。

**最终验收目标：** 用户可以在多个 Worktree 中启动不同 Agent，继续使用原生 TUI，并在 Cota 的 Tab 与 Workspace 列表中查看准确、可解释的 Agent 生命周期状态。

## 13. 开发参考

### Cota 现有架构

- `src/main/terminals.ts`
- `src/main/host-server.ts`
- `src/main/host-client.ts`
- `src/main/host-protocol.ts`
- `src/main/terminal-binding.ts`
- `src/main/process-tree.ts`
- `src/main/worktree-manager.ts`
- `src/shared/contracts.ts`
- `src/renderer/src/store.ts`
- `src/renderer/src/components/TerminalTab.tsx`

### Agent 官方文档

- [Pi Extensions](https://pi.dev/docs/latest/extensions)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [Codex Hooks](https://developers.openai.com/de-DE/docs/hooks)

### Orca 架构参考

- [Agent Launch](https://github.com/stablyai/orca/tree/main/src/main/agent-launch)
- [Agent Session](https://github.com/stablyai/orca/tree/main/src/main/native-chat)
- [Notifications](https://github.com/stablyai/orca/tree/main/src/main/notifications)

仅参考其职责划分和事件处理思路，不复制完整 Native Chat、Daemon、远程 Host 和多 Agent Orchestration。
