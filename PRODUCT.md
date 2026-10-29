# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

核心用户是在 macOS 与 Windows 本机并行运行多个 CLI Coding Agent（Codex、Claude Code、Pi、Grok）及 Git Worktree 的软件工程师与技术开发者。他们通常同时跨多个仓库、分支与终端会话推进开发任务，需要在一个界面内即时掌握 Agent 运行状态、审阅代码 Diff、管理本地开发服务并查看/切换 AI 账号配额，避免在碎片化的终端与浏览器窗口之间频繁切换。

## Product Purpose

Cota 是一款本地优先、终端优先的桌面工作区应用，将项目与 Git Worktree 生命周期管理、多终端分屏与 Coding Agent 状态编排、源码 Diff / PR 审阅、工作区后台服务管理以及本机 AI CLI 账号管理整合在同一个桌面环境中。产品的核心目标是让开发者能够零摩擦地创建隔离工作树、并发启动与监控多个 CLI Agent、审阅代码变更并安全切换 AI 账号。

## Positioning

不同于缺乏 Git Worktree 与 Agent 状态感知的通用终端模拟器，也不同于屏蔽本地 Shell 的云端绑定型 AI IDE，Cota 直接围绕真实的本地 CLI 工作流构建：原生 PTY 终端（`node-pty` + `xterm.js`）、一等公民的 Git Worktree 环境初始化与管理、实时 CLI Agent 状态追踪（`idle`、`running`、`needs-input`、`completed`、`failed`）、内嵌 Monaco Diff / 文件审阅，以及基于 `cortana.sqlite3` 与系统密钥（Electron `safeStorage`）加密的本地多账号切换。

## Operating Context

- **桌面运行时：** 基于 Electron（`electron-vite`、React 19、TypeScript）构建的跨平台本地桌面应用，支持 macOS（`darwin`）与 Windows（`win32`）。
- **核心工作流：**
  - 管理多个本地项目、本地工作区与隔离的 Git Worktree（含创建后自动复制本地配置文件及执行环境初始化命令）。
  - 运行支持递归分屏的 PTY 终端（全局最多并发 50 个终端），启动并监控 CLI Coding Agent，支持系统通知与点击通知一键定位终端。
  - 在终端旁直接浏览文件树、暂存/提交 Git 变更、对比分支、查看提交历史及审阅托管平台 PR/MR。
  - 运行工作区前台快捷任务与绑定端口（`PORT` / `COTA_PORT`）的长驻服务，并扫描本机监听端口。
  - 通过内置 Cortana 账号模块管理并切换 Codex、Claude Code、Pi、Grok 的本地认证凭据与用量配额。

## Capabilities and Constraints

- **本地优先与进程安全：** 所有工作区状态、Worktree 初始化配置与 SQLite 账号凭据均保存在用户本机，敏感凭据通过系统密钥库（`safeStorage`）加密存储。
- **Cortana 模块边界：** 仅保留账号管理核心能力（浏览器 OAuth 授权、本地登录导入、安全账号切换、配额刷新）与终端/Worktree 能力；协议转换网关与自定义模型路由不在本产品范围内。
- **显式执行与破坏性操作保护：** Worktree 初始化命令、长驻服务启动及工作树/分支删除均需用户显式触发，绝不静默后台执行；删除未合并分支或覆盖未保存的外部 CLI 登录前强制执行预检与确认锁。
- **主进程安全权威：** 前端校验（TanStack Form + Zod）仅用于即时交互反馈，绝不替代主进程的安全与文件系统校验。
- **终端与服务上限：** 全局并发终端上限为 50 个；工作区服务均作为受管 PTY 终端内的前台进程运行，不创建脱离进程树的隐藏守护进程。

## Brand Commitments

- **产品名称：** Cota
- **界面与文档语言：** 界面文案、错误反馈与文档统一使用简体中文（`zh-CN`），并保留精准的开发者技术术语（`Worktree`、`Diff`、`Agent`、`Terminal`、`Cortana`）。
- **表达风格：** 直接、克制、重事实，面向高频日常工程操作，拒绝营销化修辞。

## Evidence on Hand

- 生产级应用外壳与路由实现位于 `src/renderer/src/App.tsx` 与 `src/renderer/src/router.tsx`（`/`、`/settings`、`/cortana/accounts`）。
- 跨进程 IPC 契约与领域模型定义位于 `src/shared/contracts.ts`。
- 功能说明与研发规范记录于 `README.md` 与 `AGENTS.md`。
- 不存在任何外部营销数据、客户背书或付费套餐信息，后续设计不得虚构此类内容。

## Product Principles

1. **终端与 Agent 状态优先：** 路由切换与文件/Diff 预览期间始终保持运行中的终端挂载与响应，并将需要人工介入的 Agent 状态（`needs-input`、`running`、`failed`）第一时间呈现在可见区域。
2. **安全的本地变更：** 绝不静默覆盖未跟踪文件、未保存的外部 CLI 登录或未合并的 Git Worktree，所有高风险操作必须具备预检与恢复路径。
3. **高密度操作清晰度：** 优先保障全键盘可达性、一眼可扫读的状态指示器与稳定的空间层级，而非装饰性视觉外壳。
4. **严格的模块边界纪律：** 专注于本地工作区、Worktree、终端、Git 审阅与 CLI 账号编排，不向云网关或代理服务膨胀。

## Accessibility & Inclusion

- 支持跨 macOS 与 Windows 的完整键盘导航与可自定义快捷键绑定（`src/shared/shortcuts.ts`）。
- 严格实现语义化 ARIA 角色、弹窗与菜单焦点恢复（`initialFocus` / `finalFocus`）、表单字段级 `aria-invalid` / `aria-describedby` 错误关联，以及系统级 `prefers-reduced-motion` 减弱动态效果适配。
