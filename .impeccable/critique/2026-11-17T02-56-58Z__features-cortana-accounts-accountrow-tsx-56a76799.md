---
target: AccountRow
total_score: 22
max_score: 36
na_heuristics: 10
p0_count: 0
p1_count: 2
target_identity: "file:/Users/linchaoting/Developer/github/cota/src/renderer/src/features/cortana/accounts/AccountRow.tsx"
target_fingerprint: "sha256:13740a740a2570a9d2d338148256eeb73f2a57d26c936055c758ac3983dbe853"
target_path: /Users/linchaoting/Developer/github/cota/src/renderer/src/features/cortana/accounts/AccountRow.tsx
timestamp: 2026-11-17T02-56-58Z
slug: features-cortana-accounts-accountrow-tsx-56a76799
---
Method: dual-agent (A: 4e634845-53d2-4191-b3db-5710b51cf31c · B: b049477d-a9bb-4564-bf7a-d3b7e8b16166)

### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | 具备 `使用中`/`已过期` 徽章、头像加载环与 `sr-only` 状态播报；但 `resetsAt <= now` 仍输出 `0m 后重置`，且刷新失败时右侧操作区缺少行内状态恢复反馈。 |
| 2 | Match System / Real World | 3 | 业务术语清晰，但 `"5h 82% 剩余"` 与 `"3h 24m 后重置"` 每行重复拼接、语序冗余，且无 `windowMinutes` 账号缺失窗口语义前缀。 |
| 3 | User Control and Freedom | 3 | 支持 `Escape` 取消排序、破坏性操作默认聚焦取消按钮；但出错时无法直接在行内重试或保留参考余量。 |
| 4 | Consistency and Standards | 2 | `AccountRow` 与同页顶部 `AccountQuotaSummary` 在字体（sans vs `--font-mono`）、倒计时格式（`3h 24m 后重置` vs `3h24m`）、次级文本 token（`--muted-foreground` vs `--app-muted-foreground`）及低额度阈值（`<= 10%` vs `<= 15%`）上明显分裂；`AccountRow.tsx:195` 遗漏 `motion-safe:`。 |
| 5 | Error Prevention | 3 | 未托管登录切换与删除均设二次确认弹窗并默认聚焦取消；但改为常驻后若保留实心 `primary` 切换按钮会抬高误触与视觉压力。 |
| 6 | Recognition Rather Than Recall | 2 | 桌面端 `.account-row-actions` 默认 `opacity: 0` 隐藏（`styles.css:384-396`），禁用原因藏于不可聚焦按钮 Tooltip，出错后遮盖原缓存额度。 |
| 7 | Flexibility and Efficiency | 2 | 支持键盘排序，但高频的“刷新额度/更新令牌”埋入 `...` 二级菜单；过期账号缺少直达更新入口。 |
| 8 | Aesthetic and Minimalist Design | 2 | `"剩余"` / `"后重置"` 在多行列表造成高频词噪声；`.account-row-body-split` 锁死 `15rem` 而 `AccountMiddle` 左对齐 `w-52`，形成中段大片死白并过早截断长别名。 |
| 9 | Error Recovery | 2 | `rowError` 以两行截断红字直接覆盖整个 `AccountMiddle`（`AccountRow.tsx:317-325`），未区分操作错与刷新错，且无行内重试入口。 |
| 10 | Help and Documentation | n/a | 高频工程列表行，按 `AGENTS.md` 不堆砌常驻说明文案；风险提示通过确认弹窗与 Tooltip 承接。 |
| **Total** | | **22/36** | **61% · Acceptable**（安全兜底与无障碍底座扎实，布局聚合度、文案噪声与跨组件一致性待优化） |

### Design Specificity Verdict

**LLM Assessment:** 页面顶部 `AccountQuotaSummary.tsx` 具有鲜明的 Cota「精密工作台」辨识度（28 格终端区块条、`--font-mono`、`tabular-nums`、等宽右对齐读数）；但下方的 `AccountRow.tsx` 却退化为通用 SaaS 列表卡片——固定左区 + 悬浮中部的纯无衬线句子式文案（`"5h 82% 剩余"`）+ hover 显露图标按钮，未能继承工作台的仪器级遥测排版与紧邻操作动线。

**Deterministic Scan:** `impeccable detect` 对 `src/renderer/src/features/cortana/accounts`（共 5 个 `.ts`/`.tsx` 文件）正则扫描返回 `0` 条问题（exit 0），`--scope layout` 与 `--scope type` 亦返回 `0` 条，无误报。由于 `.tsx` 静态正则模式不运行需解析 DOM 的对比度/字号规则，结合人工代码核查确认：`styles.css:19,435,486,503` 存在 `--text-2xs`（`11px`）与 `0.625rem`（`10px`）微字号；`AccountRow.tsx:195` 与 `AccountsPage.tsx:333` 存在未加 `motion-safe:` 的 `animate-spin`；`styles.css:384-396` 在精确指针下隐藏 `.account-row-actions`。

**Visual Overlays:** 本轮运行未注入浏览器覆盖层（当前沙盒无内置浏览器且阻塞本机 CDP/WebSocket 端口 `127.0.0.1:6173` 与 `:5173`，回退信号为静态源码核查 + `impeccable detect` CLI 扫描）。

### Overall Impression

安全与可访问性工程基础（拖拽键盘播报、弹窗确认锁、容器查询断点、双向文本隔离）非常扎实，但信息组织与视觉语言存在“两张皮”：额度数据既没有向顶部的精密遥测语法统一，又因为固定 `15rem` 左区和左对齐 `w-52` 中区而远离右侧操作区；改版只需要保持左侧不变、将额度右移贴近常显操作区并重构标题与倒计时文案层级，就能立竿见影地消除冗余噪点并打通“判断余量 → 立即切换”的单点动线。

### What's Working

1. **高风险操作兜底严谨：** 覆盖未托管登录与删除均有清晰描述的 `Dialog` 二次确认，并显式将 `initialFocus` 设为 `cancelButton`（`AccountsPage.tsx:444`），防止键盘回车误删。
2. **容器查询响应式折叠自然：** `.accounts-scroll-area` 通过 `@container account-quota (max-width: 37.5rem)`（`styles.css:505-528`）在窄容器下自动切换为纵向流式布局，兼顾桌面侧栏展开与收起后的宽度变化。
3. **无障碍排序与双向文本规范：** `AccountRow.tsx:151` 声明 `[unicode-bidi:plaintext]` 与 `truncate`，`AccountsPage.tsx:41-54` 提供完整中文拖拽读屏播报。

### Priority Issues

- **[P1] 常驻操作区布局失衡与主次视觉过载**
  - **Why it matters:** 当前 `.account-row-actions` 默认隐藏，且 `切换` 按钮采用高对比实心 `primary`（`AccountRow.tsx:188`）；同时 `.account-row-body-split` 锁死 `15rem`、额度块左对齐，在宽屏下额度悬浮在中段，与右侧按钮被大片留白隔开。一旦改为常显，若不降噪按钮样式并收拢右翼布局，会出现整排刺眼的黑色方块按钮且视线仍需横向大跨度跳跃。
  - **Fix:** 移除 hover 隐藏逻辑，将右侧操作区设为常显且使用 `28px` 规范高度与 `outline` / `secondary` 降噪按钮；固定主操作槽位宽度，避免激活行与非激活行的额度列纵向上下错位；让左侧保持弹性 `flex-1`，将额度信息紧贴操作区左侧组合为右翼紧凑群组。
  - **Suggested command:** `$impeccable layout` / `$impeccable quieter`

- **[P1] 剩余额度与重置倒计时文案冗余、视觉层级扁平且跨区域分裂**
  - **Why it matters:** `"5h 82% 剩余"` 与 `"3h 24m 后重置"` 在每一行重复出现，占用大量水平空间并降低关键数字（`82%`）的扫视信噪比；且与顶部 `AccountQuotaSummary` 的 `--font-mono`、紧凑格式（`3h24m`）、`--app-muted-foreground` 与 `<= 15%` 阈值不一致。
  - **Fix:** 通过列表级列标题、前置微标签或垂直双层单元把“标题文案（窗口/余量含义）”“主百分比（等宽加粗）”“重置倒计时（弱色 mono）”拆出清晰梯度，剔除逐行重复的 `"剩余"`/`"后重置"` 废字；统一使用 `--app-muted-foreground` 与 `<= 15%` 阈值，并补充非纯色警告信号（如微进度条/下划线）及 `resetsAt <= now` 时的 `"即将重置"` 边界文案。
  - **Suggested command:** `$impeccable clarify` / `$impeccable typeset`

- **[P2] 报错吞掉缓存额度、禁用原因键盘不可达及动效前缀遗漏**
  - **Why it matters:** `rowError` 会直接覆盖整块额度显示（`AccountRow.tsx:317-325`），导致用户刷新失败后看不到历史余量也无法在行内重试；禁用 `切换` 按钮的 Tooltip 说明对键盘/读屏用户不可见；`AccountRow.tsx:195` 遗漏 `motion-safe:`。
  - **Fix:** 报错时保留弱化显示的最近一次缓存额度并紧邻错误摘要提供行内重试入口；为 `switchUnavailable` 提供可读的描述关联；补全 `motion-safe:animate-spin`。
  - **Suggested command:** `$impeccable harden`

- **[P3] 左侧固定 `15rem` 在宽屏下过早截断长别名**
  - **Why it matters:** 右侧空间富裕时，长名称叠加 `Team`/`使用中` 徽章仍被限制在 `240px` 内截断。
  - **Fix:** 将左侧主体改为 `min-w-0 flex-1`，把宽屏多余空间释放给账号名与邮箱展示。
  - **Suggested command:** `$impeccable layout`

### Persona Red Flags

- **Alex（高频多号切换开发者）：** 每次切换都要把鼠标滑到行上等操作区出现，且眼睛得在“中段左偏的文字额度”与“最右侧图标”之间往返定位；刷新失败后还必须点开 `...` 菜单才能再次刷新。
- **Jordan（首次配置多账号的新手）：** 同一个页面顶部写 `5h 82% 3h24m`（`<= 15%` 下划线），下面每行却写 `5h 82% 剩余 3h 24m 后重置`（`<= 10%` 变红），容易误解两处口径是否不同；遇到无时长窗口仅见 `"82% 剩余"` 也不知指代哪个周期。
- **Sam（键盘与读屏/低视觉依赖用户）：** Tab 跳过带 `switchUnavailable` 的禁用按钮无法得知不可切换原因；开启系统减少动态效果后，切换中旋转图标仍在转动；低额度仅依赖红色文字，缺乏图形/标尺辅助识别。

### Minor Observations

- `.account-row-actions` 现有 `min-w-10`（`40px`）小于双按钮宽度，改为常显后建议统一占位槽位宽度，防止有/无主按钮的行产生横向锯齿错位。
- `DESIGN.md` 规定工作台标准控件高度为 `28px`（`h-7` / `icon`），常显操作区从 `icon-lg`（`32px`）收敛为 `28px` 更有精密仪器感且更耐看。
- 过期账号（`needsReauthorization`）在右侧操作区可条件升格「更新令牌」动作，无需用户再二级菜单查找。

### Questions to Consider

1. 改为常显后，是否接受将“使用中”行与“可切换”行的右侧主槽位等宽对齐，从而保证多行额度数字在纵向上严格成列？
2. 你更倾向于用“顶部统一列标题（极简行内数值）”消除重复文案，还是“行内微标签 + 进度条（每行自解释）”？
3. 刷新失败或凭据过期时，是否希望在行内直接露出「重试 / 更新」动作按钮？
