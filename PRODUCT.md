# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are software engineers and technical builders who run multiple CLI coding agents (Codex, Claude Code, Pi, Grok) and Git worktrees in parallel on local machines (macOS and Windows). They work across multiple repositories, branches, and terminal sessions simultaneously and need immediate visibility into agent execution status, code diffs, local dev services, and AI account quotas without context-switching across fragmented windows.

## Product Purpose

Cota is a local, terminal-first desktop workspace that unifies project and Git worktree management, multi-terminal and coding-agent orchestration, source control diff/review inspection, workspace background services, and local AI CLI account management into a single desktop environment. Success means developers can spin up isolated worktrees, launch and monitor multiple CLI agents, review diffs, and switch AI accounts with zero friction and full local control.

## Positioning

Unlike general-purpose terminal emulators that lack Git worktree and agent awareness, or cloud-bound agent IDEs that abstract away the local shell, Cota is built around the real local CLI workflow: native PTY terminals (`node-pty` + `xterm.js`), first-class Git worktree lifecycle and environment setup, real-time CLI agent state tracking (`idle`, `running`, `needs-input`, `completed`, `failed`), integrated Monaco diff/file review, and encrypted local account switching (`cortana.sqlite3` + Electron `safeStorage`) for Codex, Claude Code, Pi, and Grok.

## Operating Context

- **Desktop runtime:** Electron desktop application (`electron-vite`, React 19, TypeScript) running locally on macOS (`darwin`) and Windows (`win32`).
- **Core workflows:**
  - Managing multiple local projects, local workspaces, and isolated Git worktrees (including automated file copy and post-create setup commands).
  - Running split-pane PTY terminals (up to 50 concurrent terminals globally) and launching/monitoring CLI coding agents with system notifications and focus-jump support.
  - Inspecting file trees, Git staging/commits, branch comparisons, commit histories, and hosted PR/MR reviews directly beside the terminal.
  - Running foreground workspace tasks and long-lived port-bound services (`PORT` / `COTA_PORT`).
  - Managing and switching local CLI authentication accounts and inspecting usage quotas via the built-in Cortana accounts module.

## Capabilities and Constraints

- **Local-first & process safety:** All state, worktree setups, and SQLite account credentials live on the user's machine. Credentials are encrypted via OS keychain (`safeStorage`).
- **Scope boundary for Cortana module:** Only the account management capability (OAuth/browser login, credential import, safe account switching, and quota refresh for Codex, Claude Code, Pi, and Grok) is part of Cota; protocol-translation gateways and custom model routing are excluded from scope.
- **Explicit execution & destructive guards:** Worktree initialization commands, service startups, and worktree/branch deletions never run silently in the background without user intent; destructive operations and unsaved external CLI logins are guarded by pre-checks and confirmation locks.
- **Main-process authority:** Frontend validation (TanStack Form + Zod) is for immediate feedback only and never replaces main-process security and filesystem checks.
- **Terminal & service limits:** Capped at 50 concurrent terminals globally; workspace services run as foreground processes in managed PTY hosts without hidden daemons.

## Brand Commitments

- **Name:** Cota
- **UI & copy language:** Simplified Chinese (`zh-CN`) for interface labels, feedback, and documentation, paired with precise technical terminology (`Worktree`, `Diff`, `Agent`, `Terminal`, `Cortana`).
- **Voice:** Direct, concise, and factual—engineered for daily high-frequency developer operation without marketing fluff.

## Evidence on Hand

- Production application shell and routes in `src/renderer/src/App.tsx` and `src/renderer/src/router.tsx` (`/`, `/settings`, `/cortana/accounts`).
- Shared IPC contracts and domain models in `src/shared/contracts.ts`.
- Product feature documentation and operational constraints in `README.md` and `AGENTS.md`.
- No external marketing claims, customer testimonials, or pricing tiers exist and none should be fabricated.

## Product Principles

1. **Terminal and agent state first:** Keep running terminals mounted and responsive across route transitions, and surface agent attention states (`needs-input`, `running`, `failed`) where the developer can act on them immediately.
2. **Safe local mutation:** Never overwrite untracked user files, active external CLI logins, or unmerged Git worktrees without explicit preflight checks and recovery paths.
3. **High-density operational clarity:** Prioritize keyboard accessibility, scannable status indicators, and predictable spatial hierarchy over decorative chrome.
4. **Strict boundary discipline:** Keep the product focused on local workspace, worktree, terminal, Git review, and CLI account orchestration rather than expanding into cloud gateways or proxy services.

## Accessibility & Inclusion

- Full keyboard navigation and customizable shortcut bindings across macOS and Windows (`src/shared/shortcuts.ts`).
- Semantic ARIA roles, focus management (`initialFocus` / `finalFocus` on dialogs and menus), explicit `aria-invalid` / `aria-describedby` form feedback, and `prefers-reduced-motion` support.
