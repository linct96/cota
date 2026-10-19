# PRD 04｜Worktree 安全删除、启动恢复与质量验收

> 产品：Cota（macOS 优先、Terminal-first ADE）  
> 阶段：Phase 4 / 4　｜　优先级：P0　｜　版本：v1.0　｜　日期：2026-10-19  
> 状态：已实现（自动化验证；未执行真机验收）　｜　依赖：PRD 01 Git 基础服务、PRD 02 Terminal 绑定、PRD 03 UI

## 实施记录（2026-10-19）

- 普通工作区菜单为“删除工作区”，只结束会话并移除布局；Worktree 工作区菜单为“删除工作树”，经检查并确认后删除目录与关联工作区，默认一并删除本地分支；确认按钮仅为“删除”或“强制删除”。独立管理面板及入口已移除；异常或已关联的外部工作树可在“编辑”中仅移除关联，保留目录与分支；不再提供外部目录关联入口，`origin: linked` 永不获得删除权限。
- 删除在同仓库锁内执行：校验登记 / 环境归属 / 真实路径 / Git 状态 → 明确确认 → 按初始 cwd（含子目录）或 worktreeId 结束全部关联会话并等待进程树清理 → 重新校验 → `git worktree remove` → 核对目录和 Git → 原子移除登记。安全删除使用 `git branch -d`；未提交内容或待删除分支未合并时，明确确认后使用 `git worktree remove --force` 和 `git branch -D`。不再提供仅删除目录并保留分支的 UI 选项；不递归删目录或自动 prune。
- 修改、未跟踪 / 忽略文件要求明确确认强制删除；已初始化子模块、锁定、prunable、归属不符或进程清理失败仍阻断；Git / 持久化部分成功返回目录与 operationId，不猜测回滚。日志记录阶段、关闭会话数和结果，不记录终端输入。
- 启动对账与重新扫描保留 `ready/missing/unavailable/conflict` 和外部目录信息；只恢复身份匹配且 Git 可验证的孤儿绑定，不能自动重启 Agent。侧栏保留复制路径与打开工作区；“编辑”中查看错误、重新检查、移除异常关联或结束本项目异常终端。
- `tests/worktrees.test.ts` 使用真实临时 Git 仓库覆盖删除安全边界、并发、失败恢复和持久化；Host / Store / IPC 重逻辑测试配套覆盖。按项目约定未执行真实应用、PTY/Host smoke、双 Agent 或 GUI 验收；下述真机发布门禁仍需明确授权后验证。

## 1. 背景与问题

Worktree 创建和 Terminal 绑定完成后，Cota 必须解决两个高风险问题：其一，删除 Worktree 会触及用户未提交文件、未跟踪文件和仍在运行的 Agent；其二，项目目录可在 Cota 外部移动、创建或删除，Git 临时不可用时，应用不能错误地清空列表或将旧 Terminal 绑定到其他目录。

Orca 的 `src/main/git/worktree-removal.ts` 与 `worktree-removal-preflight.ts` 可供实现时参考。Cota 实现本地、明确确认后删除、无自动清理的闭环；强制删除必须与安全删除区分。

## 2. 目标与成功标准

- 提供显式区分的“删除工作区”（Local）、“删除工作树”（Git Worktree）与“移除项目”三种操作。
- 默认删除只删除 **Cota 管理且验证为安全的 linked Worktree**；主工作树、外部 Worktree 和锁定目录禁止删除；脏目录必须明确确认强制删除。
- 删除前正确处理中关联的 Terminal/Agent 进程；无法确认全部结束时禁止删除。
- 启动时完成配置与 Git 实况对账；遇到 Git 错误不伪造空结果，不静默抹除运行中 Session。
- 底层扫描保留外部 Worktree 识别，不再提供外部关联 UI；既有外部登记不获得删除权限，可在“编辑”中显式移除关联。
- 覆盖破坏性操作、崩溃恢复、兼容性和多 Worktree 并行开发的端到端验收。

## 3. 范围与非目标

**P0 范围**：删除前校验、终端占用门禁、磁盘安全删除、分支清理、App 启动对账、外部 Worktree 识别与既有关联清理、编辑内异常修复入口、回归和发布门禁。

**不在本阶段**：绕过路径归属、锁定或子模块保护的强制删除；以 `rm -rf` 替代 Git 删除；自动合并 Git 分支；自动 `git fetch/pull/prune`；云端 GitHub PR；外部 Worktree 自动纳入 Cota 可删除资源；跨机器/SSH/WSL；后台自动删除孤儿目录。

## 4. 删除操作语义

| 用户操作 | Terminal | Cota Workspace 记录 | 磁盘 Worktree | Git 本地分支 |
| --- | --- | --- | --- | --- |
| 删除工作区（Local） | 显式确认后结束 | 从布局移除 | 不涉及，普通本地目录保留 | 保留 |
| 删除工作树 | 确认并安全结束全部关联会话 | Git 删除成功后移除 | 安全删除使用 `git worktree remove`；强制确认后加 `--force` | 默认删除本地分支；安全删除用 `-d`，强制确认后用 `-D`，失败保留并提示 |
| 移除项目 | 依原有流程关闭会话 | 移除最近项目显示 | 保留所有工作目录 | 保留 |

**关键规则**：Worktree 工作区的“删除工作树”必须显式确认后才执行磁盘删除；工作区重命名、删除 Local 工作区、取消关联、移除项目和删除 Terminal Tab 均不删除 Worktree 目录。

## 5. 功能需求

### FR-01 删除可行性检查（P0）

后端新增 `inspectRemoval()`，返回明确的可执行性、风险和错误码，不依赖前端自行判断。

```ts
interface WorktreeRemovalCheck {
  allowed: boolean
  worktreeId: string
  worktreePath: string
  currentBranch: string | null
  blockers: Array<
    | 'UNMANAGED'
    | 'MAIN_WORKTREE'
    | 'MISSING_OR_UNKNOWN_PATH'
    | 'LOCKED'
    | 'PRUNABLE'
    | 'DIRTY'
    | 'UNTRACKED_FILES'
    | 'IGNORED_CONTENT'
    | 'POPULATED_SUBMODULE'
    | 'RUNNING_SESSIONS'
    | 'GIT_UNAVAILABLE'
    | 'OWNERSHIP_MISMATCH'
  >
  liveTerminalIds: string[]
}
```

- **身份校验**：路径必须在 Cota 注册表中标记为 `origin: "created"`，且仓库 common dir 与 Git 最新列表一致；不得仅凭路径位于 `~/.cota/` 就信任它。
- **主工作树校验**：`isMain = true` 或 bare worktree 必须禁止删除。
- **真实路径校验**：经 `realpath/lstat` 检查，拒绝目标为 HOME、项目根目录、Worktree 根父目录、路径越界或 symlink 指向非预期位置；无法证明安全时拒绝。
- **Git 状态校验**：运行 `git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=none`；同时检测会被 status 隐藏的已忽略文件（例如 `git ls-files --others --ignored --exclude-standard -z`），避免 `.env`、依赖目录等随工作树删除而意外丢失。任何修改、暂存、未跟踪或 ignored 内容均要求明确确认强制删除；取消时文件保留。
- **子模块校验**：有实际初始化的子模块时，按安全策略阻止自动删除，尤其不能忽略可能被父仓库状态隐藏的子模块内容或本地提交。
- **锁定与失联**：locked、prunable、Git 查询失败或被外部工具修改中的 Worktree 一律不得当作可直接删除的正常目录。
- **已有 Session**：以真实 `cwd`/Worktree ID 查询 Terminal Host 中所有关联会话，而非只按 UI 当前选择的 workspaceId 判断；不同 Workspace 指向同一目录时不能遗漏。

### FR-02 删除交互与确认（P0）

- Workspace 菜单按类型提供单一删除动作：Local 为“删除工作区”，Git Worktree 为“删除工作树”；后者仅对已登记且由本环境 Cota 创建的 linked Worktree 通过安全检查后执行。外部或不可安全删除的目录显示原因，不降级为仅移除工作区。
- 确认弹窗精简说明删除的目录、关联工作区、关联终端及是否删除本地分支；安全删除标题为“删除工作树”、按钮为“删除”。强制删除标题为“强制删除工作树”、按钮为“强制删除”，明确未提交、未跟踪、忽略文件将丢弃，未合并提交可能丢失，操作可能无法恢复。
- 如有运行中的 Terminal/Agent，告知将结束相关进程，要求用户显式确认；不能静默终止 Agent。
- 保留单一删除入口，Main 在仓库锁内判断风险：存在 `DIRTY/UNTRACKED_FILES/IGNORED_CONTENT`，或待删除本地分支不满足 Git 的合并条件（有效 upstream，否则项目 HEAD）时，要求强制确认；其余阻断原因仍拒绝删除，不提供绕过。
- 工作区菜单默认同时删除本地分支；不提供仅删除目录并保留分支的 UI 选项。安全确认用 `git branch -d`，强制确认用 `git branch -D`；确认后目录变脏时不得从安全删除自动升级。分支提交在确认后变化则停止，删除目录后分支再次变化则保留并提示。
- 用户拒绝确认时，不应终止任何进程、不应修改 Git、不应更改 UI 选中项。

### FR-03 安全删除事务（P0）

删除在 Main 进程统一编排，按如下顺序执行：

```text
用户点击“删除工作树”
  -> Main: 锁定 repoCommonDir 与 worktreeId，暂停此 Workspace 新建 Terminal
  -> GitService: 严格查询并检查 Worktree / ownership / dirty / locked
  -> Terminal Host: 列出并检查全部关联 Session
  -> 向用户展示风险和结束终端确认（如需）
  -> Terminal Host: 结束所有关联会话，等待确认全部结束
  -> GitService: 再次核对真实路径、Git 状态和用户可删除性
  -> git worktree remove <verifiedPath>（仅强制确认后带 --force）
  -> 验证 Git 注册表与目标路径状态
  -> ConfigStore: 移除 对应 `origin: "created"` 记录及对应 Workspace/Tab
  -> 默认 git branch -d <verifiedBranch>（强制确认后 -D）
  -> Renderer 刷新 Git 列表与布局
```

- 若终端停止失败或超时，**停止整个删除流程**，保留磁盘和元数据。
- 检查与删除之间也可能有外部更改；必须再次检查，不能只相信最早的 UI 检查快照。
- 不使用应用直接递归删除目录作为正常路径；标准删除依赖 Git 官方 `worktree remove` 的安全行为。
- 若 Git 目录已删除、但本地 ConfigStore 更新失败，保留“磁盘已删除、登记待修复”的明确状态；不能再次试图删除未知路径。
- 若 Worktree 删除成功但分支删除失败（锁、其他 Worktree 占用、提交变化等）：整个操作返回**部分成功**，明确“目录已删除、分支保留”，不能假装回滚目录。
- 同 Git 仓库的创建/删除写操作串行化；与 Phase 2 的 Terminal 创建门禁同源，避免“检查完占用后又启动新 Agent”。

### FR-04 启动时 Git / 注册表 / Terminal 对账（P0）

恢复步骤：

1. 读取 V2 配置，保留 `worktreeRecords`、workspaceId、Terminal ID 和最近项目。
2. 连接 Host（若仍存活），取得包含 cwd、worktreeId 的真实会话清单。
3. 按 repoCommonDir 扫描 `git worktree list --porcelain -z`。
4. 将真实 Git Worktree、Cota 登记记录和 Host Session 进行三方关联。
5. 按下表给每个 Worktree 定状态；成功才允许将布局更新持久化。

| 对账状态 | 判定 | 恢复动作 |
| --- | --- | --- |
| `ready` | Git 返回且归属匹配 | 恢复 Workspace，可安全重新附着存活 Terminal |
| `missing` | Git 权威列表确认路径已不再登记/目录缺失 | 保留诊断记录，提示手工移除登记或重新选择目录 |
| `unavailable` | Git 报错、超时、权限失败 | 保留最后已知列表、Workspace 与 Session，不删除任何登记 |
| `external` | Git 发现未由 Cota 注册的 Worktree | 仅保留底层扫描识别，不提供关联 UI，不赋予删除权 |
| `conflict` | Git common dir、路径或 Host Session 身份不一致 | 阻止危险操作，提供错误原因和手动修复入口 |

- 不得把 Git 列表查询失败转成 `[]`；不因一次失败自动删除存储或 Host 会话。
- 恢复不可自动发送 Shell 命令，不自动重启原 Agent；Host 已结束的 Session 显示为已不可重连或不恢复运行态。
- 不再提供外部 Worktree 关联入口；底层识别及既有 `origin: linked` 保护保留。既有关联可在“编辑”中显式移除，不调用 Git 删除。
- `prunable` 状态显示“需要 Git 元数据修复”，不自动 `git worktree prune`；是否运行修复命令留给用户自行决定。

### FR-05 错误修复和状态可观察性（P0）

- 不提供独立管理 / 恢复面板。“编辑”中显示目录、状态和错误，提供“重新检查”；外部或异常记录可显式移除关联，确认后结束关联终端并移除工作区和登记，不删目录及分支。本项目异常终端可逐个结束。
- 用户可以通过 Git CLI 自己修复分支或 Worktree；Cota 仅在用户明确确认“强制删除”后使用 `--force`、`-D`，不使用 `rm -rf` 或自动 `prune`。
- 每次删除生成 `operationId`，记录阶段、目标路径、Git 返回状态、Host 关闭结果和最终状态；日志中不能出现终端输入内容或环境机密。
- 破坏性操作失败时，UI 保留 Worktree 行及明确状态，不静默消失。

## 6. 端到端场景

### 场景 A：正常删除

已提交所有修改、无锁定、无运行中的终端。用户确认删除后，Git 目录消失，Cota Worktree 记录移除，原项目和其他 Worktree 均保持正常；已合并的本地分支默认一并删除。

### 场景 B：Agent 仍在运行

Worktree A 的 Codex 正在运行。用户点击删除，看到将结束关联终端的提示；取消时 Agent 保持运行；同意结束后 Host 确认进程树已停止，才允许调用 `git worktree remove`。

### 场景 C：未提交或未跟踪文件

Worktree 有被忽略的 `.env.local` 或修改过的 `src/app.ts`。弹窗显示“强制删除”，明确这些文件将丢弃；用户取消则文件和终端不变，确认后才执行强制删除。锁定、子模块与归属限制不会被绕过。

### 场景 D：外部创建或删除

用户在系统 Terminal 中创建 Worktree B，Cota 底层扫描将其识别为外部 Worktree，不提供关联 UI，不赋予磁盘删除权。若用户在外部删除已登记 Worktree A，Cota 显示 `missing`，保留修复线索；用户可在“编辑”中重新检查或显式移除异常关联，不将旧 Shell 附着到新目录。

### 场景 E：Git 临时不可用

Git 仓库所在磁盘暂不可读或 `git worktree list` 超时，Cota 标记 `unavailable` 并保留历史状态；磁盘恢复后重试扫描，正确回到 `ready`。

## 7. 安全和数据保护要求

- 不支持对主工作树、HOME、Worktree 集合父目录或非 `origin: "created"` 路径调用磁盘删除。
- Worktree 的物理所有权不是由目录名称决定的；必须同时满足 Cota 注册证据、Git common dir、Git 当前关联结果及真实路径检查。
- 当子进程树状态不确定，宁可拒绝删除也不冒险清理目录。
- 删除的 Git 命令只使用绝对路径和参数数组，禁止 shell 拼接；不提供 `rm -rf` 的自动回退。
- 对同一个 repoCommonDir 的 Worktree 状态变更与 Terminal create 使用串行/互斥机制。
- 开发版与正式版使用分离注册表及独立 Worktree 根目录（`~/.cota-dev/worktrees` / `~/.cota/worktrees`）；任何环境不能仅因路径符合默认目录规则就删除另一环境创建的 Worktree。

## 8. 验收标准与测试矩阵

| 编号 | 类型 | 验收用例 | 预期 |
| --- | --- | --- | --- |
| AC-01 | 功能 | 删除 clean 由 Cota 创建的 linked Worktree | 目录删除、配置同步、已合并分支一并删除 |
| AC-02 | 安全 | 删除含未提交修改、未跟踪或 ignored 文件的 Worktree | 显示强制删除及后果；取消保留全部内容，明确确认后删除 |
| AC-03 | 安全 | 对主工作树/外部 Worktree/锁定 Worktree 发起删除 | 不出现可执行删除或后端直接拒绝 |
| AC-04 | 生命周期 | 工作区存在运行中的 Agent，用户取消删除 | 进程继续运行，磁盘及 UI 不变 |
| AC-05 | 生命周期 | 用户确认停止后 Host 未能结束进程 | 终止删除，保留磁盘和记录 |
| AC-06 | 数据 | Worktree 删除成功后配置写入失败 | 明确部分成功，可手动重新扫描修复 |
| AC-07 | 数据 | 删除尚未合并的本地分支 | 删除前要求强制确认；确认后 -D 删除；分支提交变化则停止，实际分支删除失败时保留并提示 |
| AC-08 | 恢复 | Renderer 重启且 Host 存活 | 按 cwd/Worktree 身份重连正确会话 |
| AC-09 | 恢复 | Git 查询超时/失败 | 状态为 unavailable，已知工作区不被清空 |
| AC-10 | 恢复 | 外部新增 linked Worktree | 底层扫描保留识别，无关联 UI 和磁盘删除权 |
| AC-11 | 恢复 | 外部删除或移动 Worktree | 标记 missing/conflict，不在其他目录重新启动 Terminal |
| AC-12 | 并发 | 在删除预检查后并发请求新 Terminal | 生命周期门禁拒绝新建或删除安全等待，绝不边启动边删除 |
| AC-13 | 功能 | V2 配置下移除 Local Workspace/项目 | 不隐式删除任何磁盘 Worktree |
| AC-14 | 全链路 | A/B 两个 Worktree 分别启动 Codex/Pi 手工命令 | 工作目录独立，切换无误，单独关闭/删除互不影响 |

## 9. 自动化测试要求

- **单元测试**：Git porcelain 解析、删除 blockers、路径包含/真实路径校验、Repo 锁、工作区状态 reducer、错误码。
- **集成测试**：临时 Git 仓库构建普通/脏/locked/prunable Worktree，真实运行 `git worktree add/remove`；安全检查防 TOCTOU 测试。
- **Host 集成**：Terminal 关联检查、模拟长期运行子进程、stopProcessTree 失败和恢复、Host v1/v2 不兼容。
- **Renderer E2E/手工**：创建 → 进入 Terminal → 修改文件 → 确认 Git 状态 → 关闭 → 删除 → 重启恢复。
- **跨版本与场景**：现有 Local Workspace、最多 10 个 Terminal、Cota Dev 与 Release 同时运行、仓库与目录路径中文/空格。
- **破坏性操作隔离**：测试统一在临时目录进行，禁止对个人 HOME 或真实项目执行清理用例。

## 10. 开发任务与交付清单

| 任务 | 优先级 | 主要文件 |
| --- | --- | --- |
| T4-01 删除预检查和所有权/路径门禁 | P0 | `worktree-manager.ts`、`git-worktrees.ts` |
| T4-02 Terminal 占用检测、冻结与安全关闭 | P0 | `index.ts`、`terminals.ts`、Host protocol |
| T4-03 删除确认、部分成功提示与关联清理 | P0 | `App.tsx`、`store.ts`、`config.ts` |
| T4-04 启动对账和状态机 | P0 | `worktree-manager.ts`、`store.ts` |
| T4-05 外部 Worktree 识别与编辑内异常关联清理 | P0 | `worktree-manager.ts`、`App.tsx` |
| T4-06 Git/Host/Renderer 端到端与回归测试 | P0 | Tests、smoke scripts |
| T4-07 发布前人工安全演练与日志检查 | P0 | QA checklist |

## 11. 发布门禁（Definition of Done）

- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm test:pty`、`pnpm test:host` 全部通过。
- AC-01 至 AC-14 全部通过；至少完成一次真实本地双 Worktree 与双 Agent 手工验收。
- 未经明确确认，不终止运行中的用户任务；删除失败不丢失原始文件。
- Git 异常、Host 崩溃、配置写失败均保留可操作修复路径。
- 新建、关闭、重启、删除场景下，原有 Local Workspace、Terminal 标签和最近项目的行为无回归。
