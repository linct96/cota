# PRD 01｜Git Worktree 基础服务与数据模型

> 产品：Cota（macOS 优先、Terminal-first ADE）  
> 阶段：Phase 1 / 4　｜　优先级：P0　｜　版本：v1.0　｜　日期：2026-10-19  
> 状态：已实现（自动化验证）　｜　依赖：现有 Electron Main、ConfigStore、Git CLI
>
> 实施调整（2026-10-19）：项目尚未上线，按用户确认不实现 V1 数据迁移；仅接收 V2 配置。已有 V1 文件保留并提示手动移走，不自动覆盖或清理。

## 1. 背景与现状

Cota 当前使用 Electron + React + Zustand + node-pty。现有 `ProjectWorkspace` 仅包含 `id / projectPath / name`，同一 Project 下的多个 Workspace 是 UI 逻辑分组，尚未对应独立 Git 工作目录。`src/main/git.ts` 仅提供 `projectBranch()`；`ConfigStore` 使用版本 1 并保存最近项目和布局。本阶段先建立可信、可测试、可持久化的 Worktree 基础服务，不改变现有终端或界面行为。

Orca 的参考原则：由 Git 提供 Worktree 真实状态，由应用单独管理创建记录；严格区分普通 Git Worktree 与应用有权删除的资源；Git 读取失败不能解释为空列表。

## 2. 目标与成功标准

**目标**：为 Cota 建立本地 Git 仓库发现、Worktree 查询、受控创建、元数据持久化的基础能力，供 Phase 2/3/4 使用。

- 能准确识别普通 Git 仓库、已有 linked Worktree、非 Git 目录、Git 不可用和 Git 操作错误。
- 可从指定已存在的本地 Git 引用创建一个新分支对应的 linked Worktree，且路径不与其他 Cota 环境碰撞。
- 以 Git 当前状态返回分支和 HEAD；Cota 的注册表仅记录创建来源与管理权限。
- 新配置直接使用 V2；普通 Workspace 显式标记 `local`，不实现 V1 数据迁移。
- 自动化测试通过，不创建、覆盖或清理非 Cota 管理的用户目录。

## 3. 范围与非目标

**P0 范围**：GitService、WorktreeInfo 模型、ConfigStore V2、基础业务校验、串行写锁、后端接口和自动化测试。

**不在本阶段**：Worktree 页面和创建表单；Terminal cwd 绑定；自动复制 `.env` / 共享 `node_modules`；Git fetch/pull；Git 合并/PR；用户界面的删除和强制删除。可以预留底层 `remove` 接口，但不得开放未经 Phase 4 安全门禁的破坏性入口。

## 4. 用户场景

| 编号 | 场景 | 期望结果 |
| --- | --- | --- |
| US-01 | 用户打开一个普通 Git 项目 | 后端能够返回 Git 根目录、Git common dir、当前已有 Worktree |
| US-02 | 用户打开非 Git 目录 | 返回明确的 `nonGit` 状态，原有本地 Workspace 功能不受影响 |
| US-03 | 用户希望基于 `main` 开发 `feature/login` | 创建独立目录与本地分支，并登记 Cota 管理元数据 |
| US-04 | 用户已通过命令行创建 Worktree | `list()` 可以识别，但标记为非 Cota 管理，不能默认赋予删除权限 |
| US-05 | 开发期间已有 V1 配置 | 保留原文件并明确提示手动移走后重建，不自动迁移或覆盖 |

## 5. 功能需求

### FR-01 仓库发现（P0）

- 输入已由现有 `projectDirectory()` 规范化的绝对目录路径。
- 使用 `git rev-parse` 获得工作树根路径、Git common dir、是否 bare；以真实路径归一化识别同一 Git 仓库。
- `projectPath` 保留 Cota 原始项目概念；另以 `repoCommonDir` 识别同一仓库，避免通过不同 Worktree 打开仓库时重复归组。
- 结果状态至少为 `ready / nonGit / gitUnavailable / unavailable / unsupported`；只有确认为非 Git 才可返回 `nonGit`，不能因超时或权限错误回退为空。
- `bare` 仓库不支持第一版“创建普通工作目录”入口，返回明确提示。

### FR-02 Worktree 列表（P0）

- 使用 `git worktree list --porcelain -z`，按 NUL 分隔解析；不得解析面向人阅读的对齐文本。
- 至少返回：`path`、`branch: string | null`、`head`、`isMain`、`isBare`、`locked`、`lockReason?`、`prunable`、`prunableReason?`。
- 路径以真实 Git 结果为准，支持中文、空格和特殊字符；Detached HEAD 的 `branch` 为 `null`。
- 结合本地注册表中 `origin === "created"` 派生 `managedByCota`，但不把曾保存的分支名当成当前分支名。
- Git 调用异常必须以结构化错误上抛；不允许 `catch { return [] }`。

### FR-03 创建新 Worktree（P0）

- 请求字段：`projectPath`、`name`、`branchName`、`baseRef`。第一版只支持创建**新本地分支**，不复用或强制重置现有分支。
- 验证 baseRef 是本地可解析的提交引用；推荐将引用解析为提交 OID 后传给 `git worktree add -b`，防止用户输入被解释为选项。
- 使用 `git check-ref-format --branch` 校验分支名称；检查同名分支和目标目录冲突；不可使用 `-B`、`--force` 或 Shell 字符串拼接。
- 新目录正式版默认位于 `~/.cota/worktrees/{repoName}/{slug}`，开发版位于 `~/.cota-dev/worktrees/{repoName}/{slug}`；同名仓库追加 `repoId` 前 8 位，工作区目录冲突依次追加 `-2`、`-3`（不自动改分支名）。目录选择同时检查磁盘、Git、注册表，并与创建共用仓库锁；预览不占用目录或消耗编号，提交时复核预览路径，被占用则要求重新预览，不静默换目录。开发版与正式版通过独立根目录隔离，不再增加 `dev/release` 子目录。内部完整 ID 保留，不迁移已有路径（包括旧 `worktrees/dev`、`worktrees/release` 路径），也不保留旧 UUID 目录的删除特例。仓库父目录统一以 `.cota-repository` 保存完整仓库标识用于归属校验，不接管或删除无标记、归属不符的已有目录。路径与元数据独立于 Cota 最近项目列表，不放入临时目录。
- `repoId` 可基于首次发现时 canonical Git common dir 计算稳定哈希并持久化；仓库移动时通过注册表和后续对账处理，不靠重新计算哈希直接丢弃旧记录。
- 先创建 Git Worktree，再写入管理注册表；成功返回真实 `GitWorktreeInfo` 和 `WorktreeRecord`。若 Git 已成功但配置落盘失败，返回可恢复的部分成功错误，包含路径和 Git 状态，**不得盲目递归删除工作目录**。
- 同仓库写操作按 `repoCommonDir` 串行化。失败后必须重新探测 Git 状态，不可以依赖错误文案判断是否已经创建成功。

### FR-04 V2 配置模型（P0）

```ts
type WorkspaceKind = 'local' | 'git-worktree'

interface ProjectWorkspace {
  id: string
  projectPath: string
  name: string
  kind: WorkspaceKind
  worktreeId?: string
}

interface WorktreeRecord {
  id: string
  projectPath: string
  repoCommonDir: string
  repoId: string
  path: string
  origin: 'created' | 'linked'
  initialBranch?: string
  baseRef?: string
  registeredAt: string
}

interface AppConfigV2 {
  version: 2
  recentProjects: string[]
  preferences: Preferences
  layout?: WorkspaceLayout
  worktreeRecords: WorktreeRecord[]
}
```

- 仅加载字段完整的 `version: 2`，不迁移 V1，也不为缺失的 `preferences.openWith` 补默认值。普通 Workspace 必须显式指定 `kind: 'local'`。第一阶段创建的记录均为 `origin: "created"`；第四阶段允许登记用户主动关联的外部 Worktree (`origin: "linked"`)。
- `worktreeRecords` 为独立持久化数据，不能因现有 `remember()` 最近 20 个项目淘汰逻辑而被删除。
- V2 布局和独立注册表必须阻止无效绝对路径、重复 ID、无效关联与同一 Worktree 重复绑定；Renderer 的布局写入不允许覆盖注册表。
- 保留现有 ConfigStore 的临时文件 + 原子 rename 写入方式；不支持的版本或损坏数据均保留原配置文件并提示，不使用部分加载的数据覆盖配置。
- Phase 1 不自动登记外部 Worktree，更不得赋予外部 Worktree 删除权限。首版限定同一个 Worktree ID 最多绑定一个 `git-worktree` Workspace；普通 `local` Workspace 可继续多个共享目录。

### FR-05 Git 运行安全与错误码（P0）

- 命令使用 `execFile('git', args, { cwd, ... })`；清理 `GIT_DIR / GIT_WORK_TREE / GIT_COMMON_DIR` 等会改变仓库上下文的变量。
- 读取命令设置合理超时和输出限制；写入命令允许正常 checkout 完成，不能用过短的超时使写入变为未知半完成状态。
- 结构化错误至少包含 `NOT_GIT_REPO`、`GIT_UNAVAILABLE`、`BRANCH_EXISTS`、`BASE_REF_NOT_FOUND`、`PATH_CONFLICT`、`WORKTREE_LOCKED`、`GIT_COMMAND_FAILED`、`CONFIG_PERSIST_FAILED`。
- 错误允许附带非敏感的可操作说明；日志不得输出环境中的 Token、密钥或整个 Shell 环境。

## 6. 接口建议

```ts
interface CreateWorktreeInput {
  projectPath: string
  name: string
  branchName: string
  baseRef: string
}

interface CreateWorktreeResult {
  worktree: GitWorktreeInfo
  record: WorktreeRecord
}

interface GitService {
  inspectRepository(path: string): Promise<GitRepositoryInfo>
  listWorktrees(repoPath: string): Promise<GitWorktreeInfo[]>
  createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult>
}
```

主进程模块建议：`src/main/git-worktrees.ts`（Git 命令与解析）、`src/main/worktree-manager.ts`（创建编排与注册表）、`src/main/validation.ts`（参数与路径校验）；共享契约集中于 `src/shared/contracts.ts`。

## 7. 异常与边界

| 情况 | 系统行为 |
| --- | --- |
| Git 不存在或没有执行权限 | 明确告知不支持 Git；本地项目仍正常打开 |
| 非 Git 项目 | 仍可使用 `local` Workspace，不触发创建 Git Worktree |
| 已存在分支/目录 | 阻止创建，不修改旧资源 |
| checkout 过程中部分成功 | 重新读取 Git 列表，返回部分成功与人工修复线索 |
| `.git` 是文件而非目录 | 正常识别 linked Worktree |
| 列表 Git 超时/权限异常 | 抛出错误，不把已知记录清空 |
| App Dev 与 Release 同时运行 | 默认 Worktree 物理目录不交叉，注册表相互隔离 |

## 8. 非功能要求

- 所有新增 Git 操作仅运行在 Electron Main，不运行于 Renderer；界面不能传递任意可执行命令。
- 不依赖网络，默认不执行 fetch；操作在 macOS 本地文件系统上完成。
- 不引入额外运行时 Git SDK 依赖，复用系统 Git CLI。
- 关键日志可追踪：repoCommonDir、operationId、operation、duration、outcome；不要记录敏感环境变量。
- 非 Git 项目及原有 Workspace 回归行为不变。

## 9. 验收标准（Given / When / Then）

- **AC-01** 给定正常仓库及两个 linked Worktree，当调用列表接口，则准确获得三个目录及其真实分支、HEAD、main 标志。
- **AC-02** 给定含空格或中文的仓库路径，当读取列表，则路径不被截断或误解码。
- **AC-03** 给定已存在的 `feature/login` 分支，当尝试创建同名 Worktree，则拒绝且不修改任何已有目录。
- **AC-04** 给定一个非 Git 目录，当发现仓库，则返回 `nonGit`，不会抛出造成 Cota 项目无法打开的异常。
- **AC-05** 给定版本 1 或损坏的 V2 配置，当加载时，保留原文件、明确告知错误，且禁止覆盖写入；合法 V2 布局与注册表可往返持久化。
- **AC-06** 给定 Cota Dev 与 Release，创建相同仓库的同名 Worktree 时，默认目录保持隔离。
- **AC-07** 给定 Git 执行报错，当列出 Worktree，则 UI/调用方拿到错误而非伪造的空数组。
- **AC-08** 给定模拟 ConfigStore 写失败，当 Git 创建成功，则提供可恢复错误和路径，磁盘工作树不被误删。

## 10. 开发任务与交付清单

| 任务 | 优先级 | 主要文件 |
| --- | --- | --- |
| T1-01 Git 仓库与 Worktree 解析 | P0 | `git-worktrees.ts`、解析单测 |
| T1-02 新分支 Worktree 创建及冲突校验 | P0 | `git-worktrees.ts`、`validation.ts` |
| T1-03 数据模型与 ConfigStore V2 校验、原子持久化（无迁移） | P0 | `contracts.ts`、`config.ts` |
| T1-04 创建编排、注册表和同仓库串行锁 | P0 | `worktree-manager.ts` |
| T1-05 Temp Git Repo 集成测试与 V2 持久化/失败恢复 | P0 | `worktrees.test.ts`、`config.test.ts` |

**Definition of Done**：`pnpm typecheck`、`pnpm lint`、`pnpm test` 均通过；不改变既有 Terminal cwd；真实 Git 测试通过；输出的类型和错误码稳定，供 Phase 2/3 接入。

## 11. 后续依赖与参考

- Phase 2 消费 Workspace `kind / worktreeId / path`，建立可信 Terminal cwd 绑定。
- Phase 3 使用本阶段创建和列表接口形成用户界面。
- Phase 4 在本阶段 Git 服务上叠加安全删除及启动恢复；本阶段禁止直接开放破坏性删除。
- 参考：`https://github.com/stablyai/orca/blob/main/src/main/git/worktree-listing.ts`；`https://github.com/stablyai/orca/blob/main/src/main/git/worktree-add.ts`。
