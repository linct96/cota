# Electron E2E 测试流程

## 首期边界

- 本地手动运行，macOS 优先；不接 CI，不测试安装包。
- Playwright Test 驱动构建后的真实 Electron，保留 Renderer → Preload → IPC → Main → Git / Terminal Host / PTY 链路。
- 独立于 `pnpm test`（Vitest），不替代已有 PTY / Host smoke。
- 不读取真实账号、不执行真实 Agent / GitHub / GitLab CLI、不访问远端仓库。

## 运行

使用项目要求的 Node、pnpm 版本，执行 `pnpm install --frozen-lockfile`。无需额外下载 Playwright 浏览器，直接使用项目安装的 Electron。

```sh
# 构建并执行首期核心场景（会打开真实桌面窗口）
pnpm test:e2e

# 只执行名称匹配的场景
pnpm test:e2e --grep '工作树'

# 已经构建后，定向执行或调试；修改应用代码后必须重新构建
pnpm exec playwright test --grep '终端经 UI'
pnpm exec playwright test --grep '终端经 UI' --debug

# 查看最近一次报告
pnpm exec playwright show-report
```

默认单 worker、零重试。失败后先看报告分析原因，修复后只重跑失败用例：

```sh
pnpm exec playwright test --last-failed
```

不要通过增加重试掩盖竞态；也不要在产品开发时默认执行整套 E2E。

## 目录与职责

| 路径                     | 职责                                               |
| ------------------------ | -------------------------------------------------- |
| `playwright.config.ts`   | 用例发现、超时、单 worker、HTML 报告               |
| `e2e/launch.cjs`         | 测试专用启动入口；先隔离目录，再加载原始构建产物   |
| `e2e/desktop.fixture.ts` | 临时数据、应用生命周期、原生对话框替身、日志与清理 |
| `e2e/security.cjs`       | 只观测真实 preload 的沙箱及上下文隔离状态          |
| `e2e/core.spec.ts`       | 真实 UI 操作与业务断言                             |

测试入口及安全观测 preload 不打包进生产应用；仅在测试启动入口注册安全状态观测通道，不改变生产 IPC，也不绕过主进程安全校验。Playwright 版本由 lockfile 固定；升级 Playwright 或 Electron 后，应重新验证启动与退出兼容性。

## 隔离与离线策略

每个用例新建 `/private/tmp/cota-e2e-*` 私有目录，包括：

- `home/`：独立 Home、Shell 配置、CLI 配置和工作树。
- `profile/Cota Dev/`：配置、数据库、Chromium 用户数据与单实例身份。
- `sample-project/`：真实 Git 仓库，只有测试身份和初始文件，无远端。
- `home/.gitconfig`：测试身份，禁用签名、凭据 helper、hooks 和远程传输。
- `bin/`：外部 CLI 的可控“不可用”替身，以及执行真实 `/usr/bin/git` 的隔离启动脚本。主进程会清除 `GIT_*`，启动脚本在可执行文件边界重新指定临时配置并禁用系统配置。

环境变量采用白名单，不继承个人令牌、代理、`NODE_OPTIONS` 或 Agent 配置。测试入口在导入业务模块前断言 Home 和目录标记；每次启动再次断言实际 profile、Node Home、沙箱、上下文隔离及禁用 Node integration。

Terminal Host 使用项目原有的 profile 哈希隔离通信目录；无需修改 Host 协议。测试只通过已有 Host 只读查询辅助检查身份和清理，不用 Host 写接口代替 UI 业务操作。

Electron 会话拦截 HTTP(S)/WS(S)，外部打开和意外原生对话框直接报错。文件选择框只在用例需要时返回临时目录，后续仍走真实目录授权逻辑。

**这不是操作系统级网络沙箱**：任意 Node 网络请求或自行启动的其他程序不受 Electron 会话拦截限制。首期只运行受控命令，不进入 OAuth、联网刷新或远端写入流程；未来增加这些场景时必须先提供对应替身，不能直接接入真实账号。

## 核心验收

1. 启动、取消目录选择、打开真实项目。
2. 终端 UI 输入 → 真实 PTY 输出、正确 cwd、退出码。
3. 工作区切换，独立 Shell 变量与活动终端恢复。
4. 文件预览复用与双击固定。
5. 外部文件修改 → Git 状态和 Diff 更新；UI 暂存 / 取消暂存，核对真实 index。
6. 设置即时持久化，正常退出再启动后保留。
7. 工作树创建、切换和删除，核对目录及 Git 登记。
8. Renderer 重载后恢复同一终端与 Shell PID，不重复创建。

终端使用已有 `terminalGpuAcceleration: 'off'` DOM 回退渲染，直接检查输出；不验证 WebGL。优先用角色 / 可访问名称定位，仅在 xterm、Monaco 或稳定的终端身份上使用现有类名 / 属性。不使用固定 sleep，不直接修改 Zustand 状态。

## 失败排查与清理

失败报告保存在 `playwright-report/`、`test-results/`（已忽略提交），包括页面截图、各次启动的 trace、Renderer / Main / Host 日志和会话诊断。Playwright trace 显式绑定 Electron context，不依赖默认浏览器 fixture 的自动录制。

正常退出必须走应用已有确认和清理流程，检查 Host 与已知 Shell 已结束。异常时尝试经已验证 token 请求 Host 关闭；不可连接时，核对准确可执行文件和 Host 入口后才使用现有进程树清理。不会按名称批量杀 Electron，也不会停止其他 profile 的 Host。

清理失败会让用例失败并保留隔离目录，日志记录路径；请先检查对应进程，再移除目录。直接强杀测试 runner 或操作系统崩溃可能跳过 finally，暂不提供自动扫描 / 批量清理工具。日志和 trace 可能包含测试命令与文件内容，不要在用例中放入真实凭据。

暂不覆盖 Windows、安装包、安全存储 / 系统钥匙串、真实授权、远端 MR/PR、系统输入法、WebGL 视觉效果或性能。

## 首次落地验证记录

2026-10-29：构建及 Node 侧类型检查通过；E2E 最近一次执行 7 通过、1 失败。工作树用例因主进程清除 `GIT_*` 后读取不到测试用户而阻塞；已改用临时 Home 的标准 `.gitconfig` 并增加真实 Git 隔离启动脚本，受本轮测试预算限制尚未复验。继续验证时先运行 `pnpm exec playwright test --last-failed`，不要把当前状态视为整套已通过。
