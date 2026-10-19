# PRD 02｜Terminal 与 Git Worktree 工作目录绑定

> 产品：Cota（macOS 优先、Terminal-first ADE）  
> 阶段：Phase 2 / 4　｜　优先级：P0　｜　版本：v1.0　｜　日期：2026-10-19  
> 状态：已实现（自动化验证；未执行真机验收）　｜　依赖：PRD 01 的 GitService、Workspace V2 与 Worktree 注册表

## 实施记录（2026-10-19）

- `terminal-binding.ts` 与 `WorktreeManager.withTerminalTarget` 由已保存的 Workspace、注册表和实时 Git 解析目录；Renderer 不能指定 cwd。Main 与 Host 双重校验，创建与删除共用仓库生命周期锁。
- Host 协议已升级到 2，Session/Attachment 保留不可变初始 cwd 与 Worktree 身份；旧协议明确拒绝，重连不自动创建 Shell 或重启 Agent。
- `tests/host.test.ts` 使用真实临时 Git 仓库和模拟 PTY 验证双目录隔离、幂等、身份冲突、目录失效、重连与旧协议；主进程 IPC、终端流控等既有自动化测试保留。
- `scripts/host-smoke.cjs` 已同步协议与参数，但按项目约定未启动真实应用、Host/PTY smoke 或 Agent 验收。本项目未上线，不做 V1 数据迁移。

## 1. 背景与现状

当前 `src/main/terminals.ts` 的 `TerminalManager.create()` 在 `projectDirectory(target.projectPath)` 中启动 Shell。即使存在多个逻辑 Workspace，同一项目下所有 Terminal 的初始 cwd 仍然一样。`src/main/host-protocol.ts` 的协议版本为 1，Terminal Host 与应用主进程通过本地 Socket 交互；Session 支持 `create/list/attach/detach/close/closeWorkspace`，但尚未携带可信的独立 Worktree cwd。

阶段 2 的核心需求是让每个 Terminal 在其关联 Workspace 的**实际物理工作目录**中启动，并且保证输入伪造、重连和 Workspace 删除竞争不会使 Terminal 意外落到项目主目录。

## 2. 目标与成功标准

- `local` Workspace 保持现有 cwd：`projectPath`。
- `git-worktree` Workspace 的 Terminal cwd 指向其绑定 Worktree 真实路径。
- Terminal 创建参数中不接受 Renderer 指定任意 cwd；目录由 Main 根据可信配置和 Git 实况解析。
- 同一 Worktree 可拥有多个 Terminal，不同 Worktree 的 cwd 与文件修改相互隔离。
- 保留 Terminal Host 的现有 attach/detach/scrollback 行为；协议变化可显式识别和拒绝不兼容旧 Host。
- 不新增 Agent API。Pi、Codex CLI、Claude Code 全都以普通 Shell 命令形式运行。

## 3. 范围与非目标

**P0 范围**：Terminal 创建授权、Host 方法协议调整、pty cwd、Session cwd 和 Worktree 身份校验、重连对账、工作目录失效的错误反馈、自动化测试。

**不在本阶段**：Worktree UI 与创建表单；关闭和删除 Worktree 的用户交互；Agent 自动启动；跨机器运行；改变 `MAX_TERMINALS = 10`；通过 Terminal Shell 当前 `cd` 动态改变 Workspace 归属。

## 4. 用户故事

| 编号 | 场景 | 期望结果 |
| --- | --- | --- |
| US-01 | 在 `feature/login` Worktree 新建 Terminal | `pwd` 指向 `feature/login` 的实际工作目录 |
| US-02 | 在 `fix/auth` Worktree 新建另一个 Terminal | `pwd` 指向另一目录，编辑文件不影响 `feature/login` |
| US-03 | 在旧 `local` Workspace 新建 Terminal | cwd 仍然是原项目目录，与升级前一致 |
| US-04 | Renderer 被刷新而 Host 仍在 | Terminal 能按旧会话 ID 重新 attach，不在别的目录悄悄新建 Shell |
| US-05 | Worktree 目录在外部被删除 | 新建失败并明确提示；绝不回退到 `projectPath` |

## 5. 设计原则

1. **Main 是工作目录解析权威**：Renderer 仅提交 `projectPath`、`workspaceId`、Terminal ID 和尺寸。
2. **Host 二次校验**：Main 到 Host 的内部消息携带经授权解析的 cwd，Host 再做路径有效性和身份一致性检查。
3. **cwd 在 Session 生命周期内不可改变**：用户在 Shell 内 `cd` 是进程行为，不修改绑定的初始目录。
4. **创建重试必须幂等**：同一 Terminal ID 再次请求时，只有项目、Workspace 和 resolved cwd 都相同才能复用会话。
5. **无法校验就拒绝启动**：不能把 Worktree 缺失误认为应当使用项目根目录。

## 6. 功能需求

### FR-01 分离 Renderer 请求与 Host 内部命令（P0）

建议不要直接在公共 `CreateTerminal` 中开放一个可被 Renderer 赋值的 `cwd`。

```ts
// 仅由 Renderer 发给 Main
interface CreateTerminalRequest {
  id: string
  projectPath: string
  workspaceId: string
  cols: number
  rows: number
}

// Main 解析后传给 Terminal Host
interface ResolvedTerminalCreate extends CreateTerminalRequest {
  cwd: string
  workspaceKind: 'local' | 'git-worktree'
  worktreeId?: string
  repoCommonDir?: string
}
```

`Main` 需要校验：项目属于打开的项目集合；workspaceId 存在、对应 projectPath；Git Worktree ID 存在于可访问的 `worktreeRecords` 注册表；Git 列表当前仍包含目标并且路径和 repository identity 一致。`local` Workspace 则使用已验证的项目路径。

### FR-02 Terminal Host 授权与 spawn（P0）

- `terminal:create` IPC 入口保持原有前端形状；内部新增 `resolveTerminalTarget()`，不能信任 Renderer 直接传入的 cwd。
- 将 Host `create` 的参数更新为 `ResolvedTerminalCreate` + `Preferences`，不再只依赖 `allowedProjects: string[]` 判定目录授权。
- 在 Host 中对 `cwd` 做真实路径解析、可访问性和类型校验；`git-worktree` 情况下检验路径为目标仓库真实成员（或 Main 发来的授权记录与当前 Git 状态匹配）。
- 保留 `pty.spawn(shell, ['-il'], { cols, rows, cwd, name, env })`；新功能不得引入 `cd path && agent` 一类 Shell 拼接方式。
- Terminal Host 必须拒绝指向不存在目录、已解绑 Worktree、路径与期望不一致的请求。
- 同一 `workspaceId` 可创建多个 Terminal；数量仍受现有 `MAX_TERMINALS = 10` 限制。

### FR-03 Host 协议版本与可恢复错误（P0）

- `HOST_PROTOCOL` 从 `1` 升级到 `2`，同步 Main、HostClient、HostServer 与类型定义。
- 新协议附带 cwd / Worktree 身份；`TerminalSession` 和 `TerminalAttachment` 需要返回原始绑定 cwd，供 Main 和 UI 检查。
- 如果已经存在旧协议 Host，必须明确提示协议不兼容并安全拒绝新建或 attach，不可在旧 Host 中忽略新字段而回退项目目录。
- HostClient 连接失败、Host 崩溃或创建请求超时不触发静默新建新 Shell；现有中断重连的语义应保留。
- 协议升级应通过真实 Host smoke test 校验；保留开发版与正式版隔离机制。

### FR-04 会话注册与重连（P0）

```ts
interface TerminalSession {
  id: string
  projectPath: string
  workspaceId: string
  cwd: string
  worktreeId?: string
  cols: number
  rows: number
  exited: boolean
  exitCode?: number
}
```

- Session 创建时记录稳定的 cwd、Worktree ID 与 repo identity（如适用）。
- `list()` 返回宿主仍存活的真实 Session；`attach()` 对 Terminal ID、Project、Workspace 和绑定路径做一致性检查。
- Renderer 重启时根据 Host Session 与 ConfigStore V2 恢复布局；发现孤儿 Session 时保留诊断信息，不附着到不匹配的 Workspace。
- **区分窗口/Renderer 重启与 Host 完全终止**：只有 Host 中仍存活的会话可以重连；若 Host 已结束，不能伪造“恢复运行中的 Agent”，也不能无提示重启 Agent。
- 在新建 Worktree 尚未纳入已验证注册表时，新建 Terminal 返回可重试错误；不通过延迟重复创建绕过授权。

### FR-05 目录与生命周期并发（P0）

- Terminal 创建期间必须拿到 Worktree 创建/删除操作所使用的同一 Workspace 生命周期门禁。
- 当前 Phase 2 只实现接口和门禁基础；Phase 4 将在删除时阻止新建、结束已有会话并复核已无关联 PID。
- `create` 幂等复用检查增加 cwd、worktreeId；同 ID 但目录不同必须报冲突。
- 当 Worktree 已失效/目录丢失时，向当前 Terminal 视图返回“工作目录不可用”错误，而非自动调整到主 Worktree。
- 不允许在已有 Session 上热切换 cwd；若需切换 Worktree，必须新建 Terminal。

## 7. 流程

```text
Renderer: createTerminal({id, projectPath, workspaceId, cols, rows})
  -> Electron Main: trusted IPC + lookup Workspace V2
  -> Main: resolve/worktree list + canonical path + lifecycle gate
  -> HostClient: create(ResolvedTerminalCreate, preferences)
  -> HostServer: authorize / validate cwd
  -> TerminalManager: pty.spawn(shell, ['-il'], { cwd })
  -> Host: register Session.cwd and respond
  -> Renderer: attach(id, projectPath, workspaceId, attachmentId)
```

## 8. 异常处理

| 触发条件 | 产品行为 |
| --- | --- |
| workspaceId 不存在或项目不匹配 | 拒绝创建，提示工作区已变更 |
| Worktree 不存在、prunable 或已解绑 | 拒绝创建，返回工作目录失效 |
| Renderer 冒充其他 cwd | 公共 API 不提供 cwd 字段；Main 忽略多余字段并以注册表重新解析 |
| Host 协议旧于 2 | 明确要求重新连接兼容 Host，不创建位置错误的 Terminal |
| 同一终端 ID 由不同 cwd 重试 | 返回冲突，不复用或覆盖原会话 |
| Host 断开 | 保留当前错误提示和恢复入口，不自动执行 Shell 指令 |
| 用户在 Shell 中手动 cd | 允许，Workspace 归属不改变，下一新终端仍在绑定目录启动 |

## 9. 非功能要求

- 不增加每次输入或输出的 Git 调用；只在创建、恢复和显式工作区变化时验证 cwd。
- 主进程与 Host 使用现有 Socket 鉴权；不得向 Renderer 暴露 Host 管理 Token。
- 兼容现有 `.xterm` 视图、scrollback、resize、acknowledge 和 `stopProcessTree` 行为。
- Shell 配置文件或 Agent 自行更改当前目录不由 Cota 监控；验收应在 Shell 启动后的第一条 `pwd` 检查初始目录。

## 10. 验收标准

- **AC-01** 新 Terminal 绑定 linked Worktree A 后，`pwd` 等于 A 的真实路径；绑定 B 后等于 B。
- **AC-02** 修改 A 中的 `src/example.ts` 不直接修改 B 的同名文件；证明代码目录隔离。
- **AC-03** V2 `local` Workspace 的 Terminal 仍从 `projectPath` 启动；不要求迁移 V1 数据。
- **AC-04** `create` 请求重试同 ID、同 cwd 只出现一个 Shell；同 ID、不同 cwd 返回冲突。
- **AC-05** 删除或移动 Worktree 目录后点击新建 Terminal，返回错误，且不会在项目主目录启动。
- **AC-06** 模拟 Renderer 关闭并重启、Host 保持存活，attach 后得到原 Terminal 的 screen snapshot 和真实 cwd。
- **AC-07** 模拟旧 Host v1 握手，新 Main 不会静默创建/附着错误目录的会话。
- **AC-08** 原有 Terminal 输入、输出、resize、backpressure、退出关闭测试无回归。

## 11. 开发任务与交付清单

| 任务 | 优先级 | 主要文件 |
| --- | --- | --- |
| T2-01 明确 Renderer/Host 两层请求契约 | P0 | `contracts.ts`、`host-protocol.ts` |
| T2-02 Main `resolveTerminalTarget` 与生命周期校验 | P0 | `index.ts`、`worktree-manager.ts` |
| T2-03 Host 协议升级与授权校验 | P0 | `host-server.ts`、`host-client.ts` |
| T2-04 TerminalManager `cwd` 与幂等检查 | P0 | `terminals.ts` |
| T2-05 断线、旧 Host、cwd 错误的集成测试 | P0 | Host / PTY smoke tests |

**Definition of Done**：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:pty`、`pnpm test:host` 通过；Local Workspace 回归行为不变；不同 Worktree 终端初始 `pwd` 正确；不新增 Agent 控制逻辑。

## 12. 跨阶段依赖与参考

- 前置：PRD 01 已建立 Workspace V2 和 Worktree 真实路径的查询能力。
- 后续：PRD 03 为用户提供真实 Worktree 的创建/选择入口；PRD 04 实现删除期间的终端冻结和安全结束。
- 当前 Cota 对应实现：`src/main/terminals.ts`、`src/main/host-protocol.ts`、`src/main/host-server.ts`、`src/main/index.ts`、`src/renderer/src/components/TerminalView.tsx`。
