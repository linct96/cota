# PRD 03｜Worktree UI 与 Zustand Store 集成

> 产品：Cota（macOS 优先、Terminal-first ADE）  
> 阶段：Phase 3 / 4　｜　优先级：P0　｜　版本：v1.0　｜　日期：2026-10-19  
> 状态：已实现（自动化验证；未执行真机验收）　｜　依赖：PRD 01 Git Worktree 服务、PRD 02 Terminal cwd 绑定

## 实施记录（2026-10-19）

- 保留 Local 创建入口，新增 Base UI / shadcn Worktree 表单；Main 提供基础分支和只读目录计划，提交防重、写入期间禁止关闭，失败保留输入与操作详情。
- 新建 Worktree 仅保留一个名称输入框，混合太空名称池随机预填，允许自定义；异步建议不覆盖用户已输入的名称。Main 读取仓库生效的 Git `user.name`，分支随名称自动生成 `<Git 用户名称>/<工作区名称>`；基础引用默认选中并显示当前分支名称，不额外列出 HEAD；Detached HEAD 时显示并默认选择 HEAD（当前提交），可用下拉修改，弹窗不展示分支名和目录，后台仍执行目录规划与创建前校验。分支各段统一小写、空格及不安全字符替换为连字符；缺少有效 Git 用户名称时提示配置并允许重试。Main 排除已登记工作区、当前仓库分支和目录及该仓库历史名称；池耗尽后递增轮次后缀。
- 名称历史按仓库持久化，取消关联、删除目录或移除项目后不清除；Git 创建前先预留真实目录名，预留失败不执行 Git 写入，创建失败可能消耗名称。目录计划也避开历史名称，避免复用 Agent cwd；不追溯已丢失配置或此前已删除的目录。
- Main 原子保存登记与工作区，Store 成功后一次接入并创建一个普通 Shell 标签；Shell 失败不会回滚或删除 Worktree。布局自动保存不能伪造、改绑或隐式删除 Git 工作区。
- 项目树按各 Worktree 显示实时分支 / Detached SHA、锁定和异常状态；窗口聚焦与可见时每 5 秒刷新，失败保留上次信息并丢弃过期响应。打开于、复制路径使用授权后的真实目录。
- 移除独立 Worktree 管理面板和全部入口，操作统一为新建、编辑和删除；不提供外部目录关联或“仅删除目录、保留分支”选项。“编辑”集成状态检查、真实路径、异常关联移除和本项目异常终端清理；普通工作区使用“删除工作区”，仅关闭会话并移除布局；Worktree 工作区使用“删除工作树”，复用 Phase 4 安全检查及确认流程，同步删除 Git 工作树目录与关联工作区，并默认一并删除本地分支；存在未提交内容或待删除分支未合并时，弹窗明确说明后果，确认按钮由“删除”改为“强制删除”，实际分支删除失败则保留并提示。`tests/workspace.test.ts` 验证事务、防重、失败恢复、孤儿会话和状态刷新；按项目约定不新增 UI / DOM 测试，也未做真机界面回归。

## 1. 背景与现状

Cota 的 `src/renderer/src/App.tsx` 已有项目折叠树、Workspace 列表、创建/重命名/删除 Workspace 的菜单及 Terminal 标签。`src/renderer/src/store.ts` 负责 `newWorkspace/selectProject/newTerminal` 等状态和布局自动保存；`use-project-branches.ts` 每 5 秒以 `projectPath` 查询当前 Git 分支。这个模型尚未支持 Worktree 的真实目录：同一项目下所有 Workspace 显示同一分支，点击“新增工作区”只添加逻辑对象。

本阶段在保留现有 Local Workspace 功能的前提下，为用户提供完整但克制的 Worktree 创建、浏览、打开和状态展示界面。

## 2. 目标与成功标准

- Git 项目下可以通过图形界面创建独立 Worktree，并自动进入关联 Workspace、打开首个 Terminal。
- 同一个 Project 下可以同时存在 `local` 与 `git-worktree` Workspace，历史数据和使用习惯不受影响。
- Workspace 行展示**自身**当前 Git 分支（不是整个 Project 的统一分支）。
- 创建中、创建失败、目录缺失、Locked/Prunable、Host 启动失败等状态均有可理解反馈。
- 新建和切换不会生成重复 Worktree、重复 Shell，UI 状态与 Main 持久化结果一致。

## 3. 用户体验原则

1. **不要改变现有“新增普通工作区”的语义**：升级后旧按钮继续可创建 Local Workspace；通过清晰的菜单新增“Git Worktree”操作。
2. **显示代码目录归属**：每个 Worktree 行展示分支及可查看的绝对目录路径。
3. **失败保持当前工作区**：只有 Git 创建与注册表写入成功后，才选中新的 Worktree Workspace。
4. **操作显式，不自动改仓库**：创建不会自动 fetch、reset、强制切换现有分支。
5. **与 Terminal-first 保持一致**：完成创建时自动打开一个空 Shell，不自动发送 `pi`、`codex` 或其他命令。

## 4. 用户场景

| 编号 | 场景 | 期望结果 |
| --- | --- | --- |
| US-01 | Git 项目下点“新建 Git Worktree” | 自动填入太空名称，单一名称输入框可修改，基准引用可选择，不展示分支名和目录 |
| US-02 | 填写 `feature/login` 并确认 | 创建 linked Worktree，侧边栏出现新工作区，主面板打开其 Terminal |
| US-03 | 从 `feature/login` 切换到 `fix/auth` | 只切换活动 Workspace 与关联 Tab，不中止其他工作区的 Terminal |
| US-04 | 仓库分支在外部被修改 | 侧边栏刷新显示当前分支或 Detached HEAD |
| US-05 | 在非 Git 项目中打开 Workspace 菜单 | 仍有普通工作区；“新建 Git Worktree”禁用并说明原因 |
| US-06 | Git 创建失败 | 保持原选中项，显示具体错误和可重试动作 |

## 5. 信息架构与界面

```text
Project: cota
├─ 工作区                    [Local]       main
├─ feature/login             [Worktree]    feature/login
│  ├─ Terminal 1             running
│  └─ Terminal 2             idle
└─ fix/auth                  [Worktree]    fix/auth
   └─ Terminal 1             running

Project actions: [新增普通工作区] [新建 Git Worktree]
Worktree actions: [打开终端] [复制路径] [在 Finder 中显示] [重命名显示名称]
                  [删除工作树（Phase 4 检查并确认，默认一并删除本地分支）]
```

- 菜单建议复用现有 `DropdownMenu` / `ContextMenu` / `Dialog` 组件，保持 App 左侧项目树的视觉风格。
- 显示名称 `name` 与分支名称 `branch` 是两个字段，重命名工作区不应重命名 Git 分支或物理目录。
- Worktree 状态图标不复用“有终端”状态点，避免用户混淆“运行中”和“Git 工作树可用”。
- 分支较长时允许省略显示，但在 Tooltip / title 中可访问完整分支；Detached HEAD 显示短 SHA。

## 6. 功能需求

### FR-01 项目树的工作区类型（P0）

- 展示 `local` 与 `git-worktree`，分别用可识别的图标或次级标签；避免大面积新颜色。
- Worktree 行展示用户可识别的名称、Git 当前分支/Detached HEAD、Terminal 活跃状态。
- 对 Worktree 暴露 `path`、branch、HEAD 的查看能力；用户能复制真实路径。
- 新建的逻辑 Workspace 明确标记为 `local`，不能偷偷转成 Git Worktree；默认名称按项目独立依次为“工作区”“工作区 2”“工作区 3”，已有名称不自动修改。本项目未上线，不实现旧数据迁移。
- 若 Git 查询不可用：保留最后一次已知显示并标注“暂不可用”，不能当成仓库已没有 Worktree。

### FR-02 创建 Worktree 对话框（P0）

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| 显示名称 | 必填文本 | 默认随机太空名称；用户可修改；最多 1024 字符 |
| 基准引用 `baseRef` | 必填选择 | 默认当前分支并显示分支名称，不额外列出 HEAD；Detached HEAD 时默认 HEAD（当前提交）；列出本地可用分支，不自动拉取远程 |
| 新分支名 `branchName` | 后台自动生成，不展示 | `<Git 用户名称>/<工作区名称>`；名称修改时同步更新；两段均转换为分支安全格式；最终以 Main Git 校验为准；禁止现有同名分支 |
| Worktree 目录 | 后台规划，不展示 | 由 Main 给出最终计划路径并校验；不提供任意自由路径输入 |
| 创建后打开 Terminal | 固定启用 | 成功后只创建一个空 Shell，不启动 Agent |

- 用户提交后立即禁用“创建”按钮并展示明确的进行中状态；一键不可重复提交。
- 请求返回成功才关闭对话框、更新 Store、选中新 Workspace、调用 `newTerminal()`。
- 当创建成功但 Terminal 打开失败时，保留已创建 Worktree，提示“Worktree 已创建，终端启动失败”，提供重试；**不得回滚已经产生的 Git Worktree**。
- 出现 `BRANCH_EXISTS`、`PATH_CONFLICT`、`BASE_REF_NOT_FOUND`、`GIT_UNAVAILABLE` 等错误时，错误信息显示在对话框内且用户输入保留。
- 关闭创建对话框不应自行停止已经启动的 Git 写入；若不支持安全取消则明确完成后确认最终状态，杜绝“取消后后台不明生成目录”。

### FR-03 Store 操作与状态（P0）

```ts
interface WorkspaceStoreActions {
  createGitWorktree(input: CreateWorktreeInput): Promise<boolean>
  refreshProjectWorktrees(projectPath: string): Promise<void>
  selectProject(projectPath: string, workspaceId?: string): Promise<boolean>
  newTerminal(): void
}

type WorktreeUiStatus =
  | 'idle' | 'creating' | 'ready'
  | 'unavailable' | 'missing' | 'error'
```

- `createGitWorktree` 调用 Main 单一原子业务接口，不能由 Renderer 自行先 Git add、再 saveLayout 分两步模拟事务。
- 必须等待 Main 的结果，再对 `workspaces / selectedWorkspaces / activeTabs` 做一次一致更新。
- `creating` 以仓库或创建请求 ID 标识，防止重复点击；Tab 只在创建成功后产生。
- 现有 `subscribe -> saveLayout` 保留，但不得覆盖由 Main 在创建事务中已保存的管理注册表；必要时使用版本号或状态同步策略消除竞态。
- 切换 Workspace 不应销毁其他 Workspace 的 Terminal；继续保持现有按 `workspaceId` 分组选项卡的行为。
- 不应把工作区重命名提交给 Git；重命名只改变 Cota 元数据。

### FR-04 Workspace 真实分支展示（P0）

- 将 `use-project-branches.ts` 的查询维度由 `projectPath` 调整为每个 Workspace 的实际目录或 Worktree ID。
- 后端返回 Worktree 自身分支与 HEAD；Renderer 不自行拼装读取 `.git/HEAD`。
- 以 Git 数据为准：用户在终端中执行 `git switch` 后，下一次可见状态刷新显示真实分支。
- 可复用已有窗口获得焦点时刷新及前台 5 秒轮询策略；后台不可高频触发 Git。
- 创建、打开和删除操作完成后应立即主动刷新，不仅依赖下一次轮询。
- 查询故障与真实的 Detached HEAD 要分开展示：错误不等于 `branch = null`。

### FR-05 非 Git 项目与异常状态（P0）

- 非 Git 目录维持现有 Workspace/Terminal 工作流；禁用 Git Worktree 动作并展示“此目录不是 Git 仓库”。
- Git 不可用、目录移动、Locked/Prunable 等状态应展示明确反馈；可查看错误详情但不能直接提供强制修复。
- `missing`/`unavailable` 的 Workspace 仍可显示其名称及历史 Tab；用户在“编辑”中重新检查状态、查看错误，必要时显式移除关联（保留目录与分支）；该项目的异常终端也在“编辑”中逐个结束。不再提供独立管理 / 恢复面板。
- 普通工作区的“删除工作区”只结束 Session 并移除布局，不删除本地文件；Worktree 工作区的“删除工作树”由 Phase 4 判断使用安全删除或明确确认后的强制删除，确认按钮仅为“删除”或“强制删除”。外部目录、锁定、已初始化子模块或归属异常等仍禁止删除，保留工作区与登记。
- 删除或取消关联当前 Worktree 后清空当前选择，显示“未选择工作区”，不自动激活其他工作区或创建终端；操作非当前 Worktree 时保留当前选择，取消或失败不改变选择。

### FR-06 无障碍与快捷操作（P1）

- 为新菜单、输入和错误消息设置中文可读的 `aria-label`、键盘聚焦与焦点归还。
- 创建完成后焦点进入新 Terminal；创建失败后焦点保留在错误字段或对话框内。
- 保留 `Cmd+O` 打开目录、`Cmd+,` 设置、新建/关闭 Terminal 及数字标签切换快捷键。
- 支持复制路径/在 Finder 中显示的动作必须来自主进程经验证的真实路径。

## 7. 页面状态与交互矩阵

| 当前状态 | UI 展示 | 用户可执行操作 |
| --- | --- | --- |
| Git 项目，尚无 linked Worktree | 显示已有 Local Workspace 与新建入口 | 新建 Git Worktree |
| `creating` | 禁用重复创建，展示创建中 | 保留界面，无二次提交 |
| `ready` | 显示工作区、分支、终端状态 | 切换、打开 Terminal、复制路径 |
| `unavailable` | 提示 Git 暂时不可用并保留最后状态 | 重试查询；不执行删除 |
| `missing` | 标记目录缺失，保留工作区记录 | Phase 4 修复/移除记录 |
| 非 Git 项目 | 提示不支持 Git Worktree | 继续使用 Local Workspace |

## 8. 数据流

```text
用户点击“新建 Git Worktree”
  -> Renderer 表单校验
  -> window.desktop.createGitWorktree(input)
  -> Electron Main: WorktreeManager.create + ConfigStore 持久化
  -> 返回 {record, worktree, workspace}
  -> Zustand 只提交一次状态更新
  -> 选中 workspaceId
  -> newTerminal() -> Terminal Main/Host（Phase 2 的可信 cwd）
  -> Git 状态刷新 -> 页面显示实际分支
```

## 9. 异常处理与回退

- Git 创建失败：不生成 UI 僵尸 Workspace，不改变活动 Project/Tab，表单数据不丢失。
- Git 创建成功、Terminal 创建失败：Worktree 显示为可用，Terminal 告警，可手动重新打开。
- UI state 更新失败或页面重新加载：以 Main 的 `worktreeRecords` 注册表与 Git 列表为依据重建，不能仅依赖临时 Zustand 数据。
- Worktree 在外部被改分支：刷新后使用新分支文字，不重写 `initialBranch`。
- 现有 Local Workspace 与 Worktree 使用相同显示名称：允许，但列表中必须能凭类型/分支区分。

## 10. 验收标准

- **AC-01** Git 项目菜单同时具有“新增普通工作区”和“新建 Git Worktree”；旧功能不变。
- **AC-02** 创建 Worktree 成功，界面新增正确的 `git-worktree` Workspace，默认选中，首个 Terminal `pwd` 指向对应目录。
- **AC-03** 同一项目的两个 Worktree 各自显示不同分支；切换不结束另一个 Worktree 的 Terminal。
- **AC-04** 重命名 Workspace 显示名称，Git 分支和目录不变化。
- **AC-05** 创建同名分支失败，错误明确，不产生重复 Workspace/Tab，用户填写内容被保留。
- **AC-06** 非 Git 目录仍能新建和使用 Local Workspace，Git Worktree 操作不可执行。
- **AC-07** 在终端外部执行 `git switch` 或将 HEAD 置为 detached 后，页面能显示正确分支/短 SHA。
- **AC-08** 模拟后端 Git 查询失败，UI 显示不可用而不是抹除 Worktree 行。
- **AC-09** 创建成功但 Shell 创建失败，Worktree 不丢失，用户可再次打开 Terminal。
- **AC-10** 键盘、Dialog 焦点、关闭按钮、原有 Terminal 快捷键没有回归问题。

## 11. 开发任务与交付清单

| 任务 | 优先级 | 主要文件 |
| --- | --- | --- |
| T3-01 Worktree IPC 与 Preload 接口 | P0 | `index.ts`、`preload/index.ts`、`contracts.ts` |
| T3-02 Worktree Store Action + 状态一致性 | P0 | `renderer/src/store.ts` |
| T3-03 创建 Worktree 对话框与错误展示 | P0 | `renderer/src/App.tsx`、可复用 Dialog 组件 |
| T3-04 项目树类型、状态、操作菜单 | P0 | `renderer/src/App.tsx` |
| T3-05 独立分支查询与刷新 | P0 | `use-project-branches.ts` 或新 hook |
| T3-06 UI 端到端测试与可访问性回归 | P0 | UI tests、手工验收记录 |

**Definition of Done**：Git 项目中能从 UI 创建 Worktree 并立即使用 Terminal；Local Workspace 功能保持兼容；错误与处理中状态完整；Main、Host、Renderer 状态一致；`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过。
