# 主进程模块

按业务能力组织代码，不按 controller/service/utils 建立全局技术分层。`index.ts` 是应用组装入口，业务域通过各自的 `ipc.ts` 接入桌面应用。

## 目录职责

| 目录                    | 职责                                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| `app/`                  | 窗口安全、菜单、渲染进程通信、可信 IPC 边界、退出生命周期             |
| `accounts/`             | Agent 账号、凭据文件、OAuth、网络访问和账号存储                       |
| `agents/cli/`           | CLI 发现、启动命令、来源检测与自更新                                  |
| `agents/hooks/`         | Hooks / Extension 适配、配置安装、Shell 集成及事件发送                |
| `agents/runtime/`       | 原生事件接收与校验、任务状态归并、进程识别、防休眠                    |
| `agents/notifications/` | Agent 通知策略与 Electron 桌面通知                                    |
| `code-hosting/`         | GitHub / GitLab 适配、端点和账号发现、远端分支、评审预检与创建        |
| `files/`                | 文件浏览、安全读取及目录监听                                          |
| `git/branches/`         | 分支快照、订阅缓存、分支读取、本地操作与远端同步                      |
| `git/source-control/`   | 状态解析、更改与历史审阅、文本 Diff、行数统计及文件写操作             |
| `git/worktrees/`        | Worktree 授权与仓库锁、目录归属、创建计划、登记恢复、安全删除及初始化 |
| `git/commit-message/`   | 提交信息生成流程与提示词                                              |
| `host/`                 | 独立 Terminal Host 的协议、客户端、服务端及进程入口                   |
| `ports/`                | 端口扫描子进程、工作区归属与受控进程终止                              |
| `settings/`             | 配置持久化、设置 IPC 与通知声音读取                                   |
| `system/`               | Shell、进程与平台能力；不持有工作区或界面状态                         |
| `terminal/`             | PTY 创建、会话管理、输出背压、终端绑定与 Agent 运行态接入             |
| `validation/`           | 按路径、设置、命令、终端、工作区及 Worktree 分类的输入校验            |
| `workspace/`            | 项目与工作区生命周期的 IPC 编排                                       |

## 关键边界

- `app/ipc.ts` 统一验证发送方并包装 IPC 结果；业务域仍负责参数、账号、仓库和目录身份校验。
- `WorktreeManager` 保留对外生命周期接口；其内部模块共享同一个 `WorktreeAccess` 和仓库锁，禁止另建锁绕过授权或确认后的复验。
- `TerminalManager` 持有会话集合和关闭状态；创建、输出及 Agent 集成模块使用同一批会话，不复制运行状态。
- `CodeHostingService` 持有评审创建锁和持久化防重复保护；`context.ts` 只负责端点发现、账号扫描缓存和上下文代次，预检不替代提交前校验。
- `validation/index.ts` 是稳定的校验入口；目录内文件直接依赖具体校验模块，避免通过入口反向循环依赖。
- 主进程可以依赖 `shared/`，但 `shared/` 不依赖主进程；禁止通过渲染进程模块复用业务逻辑。

## 文件与构建约定

- 文件按职责命名；已有目录能表达领域时，不重复堆叠领域前缀。仅为稳定入口或内聚业务流程保留必要的聚合模块。
- 文件持续增长或混入独立职责时，优先提取完整操作或无状态函数，不按行数机械切片，不引入泛用基类。
- `electron.vite.config.ts` 显式声明应用、Host、端口扫描、Pi Extension 和 Agent Hook 入口。源码可移动，但输出名和同目录打包约定必须保持兼容；`__dirname` 在运行时指向打包产物目录。
