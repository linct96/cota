---
name: Cota
description: A local, terminal-first desktop workspace for parallel CLI coding agents and Git worktrees, built on shadcn/ui (base-mira + neutral).
colors:
  background: 'oklch(1 0 0)'
  foreground: 'oklch(0.145 0 0)'
  primary: 'oklch(0.205 0 0)'
  primary-foreground: 'oklch(0.985 0 0)'
  secondary: 'oklch(0.97 0 0)'
  secondary-foreground: 'oklch(0.205 0 0)'
  muted: 'oklch(0.97 0 0)'
  muted-foreground: 'oklch(0.556 0 0)'
  app-muted-foreground: 'oklch(0.488 0 0)'
  text-normal: 'oklch(0.371 0 0)'
  text-subtle: 'oklch(0.535 0 0)'
  accent: 'oklch(0.97 0 0)'
  accent-foreground: 'oklch(0.205 0 0)'
  border: 'oklch(0.922 0 0)'
  input: 'oklch(0.922 0 0)'
  ring: 'oklch(0.708 0 0)'
  sidebar: 'oklch(0.985 0 0)'
  sidebar-foreground: 'oklch(0.145 0 0)'
  sidebar-accent: 'oklch(0.97 0 0)'
  sidebar-accent-foreground: 'oklch(0.205 0 0)'
  destructive: 'oklch(0.577 0.245 27.325)'
  warning: '#a16207'
  success: '#166534'
  dot-status-working: '#38bdf8'
  dot-status-attention: '#ca8a04'
  dot-status-completed: '#299f51'
typography:
  root:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '16px'
    fontWeight: 400
    lineHeight: 1.5
  headline:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '1.125rem'
    fontWeight: 600
    lineHeight: 1.4
  title:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '0.875rem'
    fontWeight: 600
    lineHeight: 1.4285
  body:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '0.75rem'
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '0.625rem'
    fontWeight: 500
    lineHeight: 1.4
rounded:
  xs: '4px'
  sm: '6px'
  md: '8px'
  lg: '10px'
  xl: '14px'
  2xl: '18px'
  pill: '9999px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  row-compact: '28px'
  titlebar: '44px'
  nav-rail: '48px'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 8px'
    height: '28px'
  button-secondary:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.secondary-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 8px'
    height: '28px'
  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.app-muted-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.md}'
    padding: '0 8px'
    height: '28px'
  input-default:
    backgroundColor: 'transparent'
    textColor: '{colors.foreground}'
    typography: '{typography.body}'
    rounded: '{rounded.md}'
    padding: '2px 8px'
    height: '28px'
  card-surface:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: '16px'
  badge-pill:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.secondary-foreground}'
    typography: '{typography.caption}'
    rounded: '{rounded.pill}'
    padding: '2px 8px'
    height: '20px'
---

# Design System: Cota

## Overview

**Creative North Star: "The Precision Workbench"**

Cota is engineered as an instrument-grade desktop workbench built directly on the **`shadcn/ui` (`base-mira` style + `neutral` base color)** token architecture. The application chrome recedes into an achromatic structural frame, allowing live PTY terminals, Git diffs, and coding-agent telemetry to command full visual priority. Every surface is calibrated for multi-hour engineering focus: zero-chroma OKLCH grayscale steps establish spatial hierarchy, while compact 28px (`h-7`) interactive rows and crisp 1px hairlines maximize information density without visual clutter.

Rather than relying on decorative gradients, glowing AI borders, or heavy frosted-glass blurs, Cota treats color and motion as scarce operational signals. When a pixel carries chroma or animation—such as a pulsing sky-blue agent indicator (`--dot-status-working`), an amber input-required dot (`--dot-status-attention`), or a green/red diff stat—it communicates a concrete machine state that demands developer awareness.

**Key Characteristics:**

- Built on `shadcn/ui` (`style: "base-mira"`, `baseColor: "neutral"`) with 1:1 CSS custom property parity in `src/renderer/src/styles.css`.
- Frame-in-frame desktop shell with a recessed outer frame (`bg-muted`: `oklch(0.97 0 0)` light / `oklch(0.269 0 0)` dark) and an inset top-left rounded canvas (`bg-background`, `18px` radius).
- Zero-chroma OKLCH neutral foundation (`oklch(L 0 0)`) paired with domain-prefixed semantic status signals (`--dot-status-*`, `--source-control-*`, `--file-icon-*`).
- Instrument-grade compact density (`28px` standard control and tree-row height, `12px` primary UI copy, `tabular-nums` numeric alignment).
- Progressive disclosure of secondary actions on hover or keyboard focus and focus-aware split-pane dimming (`0.8` opacity on unfocused terminal panes).

## Colors

Cota uses a two-tier token architecture in `src/renderer/src/styles.css`: **Tier 1** preserves the canonical `shadcn/ui` `base-mira` (`neutral`) OKLCH grayscale primitives, and **Tier 2** extends them with domain-scoped application tokens that stay independent of preset updates.

### Primary

- **`primary`** (`oklch(0.205 0 0)` light / `oklch(0.922 0 0)` dark) & **`primary-foreground`** (`oklch(0.985 0 0)` light / `oklch(0.205 0 0)` dark): Used for primary form actions, active section tab underline indicators, and radio/checkbox accents. When users customize `--primary` in appearance settings, `--primary-foreground` is computed automatically via WCAG relative luminance (`#000000` or `#ffffff`).

### Secondary

- **`dot-status-working`** (`#38bdf8`): Indicates an actively executing CLI agent (`running` state), paired with a dual-ring expanding ripple animation.
- **`dot-status-attention`** (`#ca8a04` light / `#fbbf24` dark) & **`warning`** (`#a16207` light / `#fbbf24` dark): Indicates an agent waiting for user confirmation (`needs-input` state) and warning badges.
- **`dot-status-completed`** (`#299f51` light / `#35c264` dark) & **`success`** (`#166534` light / `#86efac` dark): Indicates completed agent turns (`completed` / `succeeded`), ready badges, and Git line additions (`--source-control-stat-added`).
- **`destructive`** (`oklch(0.577 0.245 27.325)` light / `oklch(0.704 0.191 22.216)` dark): Indicates failed agent runs, form validation errors, destructive actions (deleting worktrees or projects), and Git line deletions (`--source-control-stat-removed`).

### Neutral

- **`background`** (`oklch(1 0 0)` light / `oklch(0.145 0 0)` dark): The primary inset workspace surface (`--surface-canvas`) housing terminals, Monaco diff editors, cards, and right-hand inspection panels.
- **`muted`** & **`secondary`** (`oklch(0.97 0 0)` light / `oklch(0.269 0 0)` dark): The recessed outer window shell, `44px` top titlebar, `48px` left navigation rail, and secondary button fills.
- **`accent`** (`oklch(0.97 0 0)` light / `oklch(0.269 0 0)` dark) & **`accent-foreground`** (`oklch(0.205 0 0)` light / `oklch(0.985 0 0)` dark): Active/selected row highlight in file trees, Git file lists, and branch pickers.
- **`sidebar`** (`oklch(0.985 0 0)` light / `oklch(0.205 0 0)` dark) & **`sidebar-accent`** (`oklch(0.97 0 0)` light / `oklch(0.269 0 0)` dark): Tonal surface and active/hover highlight for the left project and worktree panel.
- **`foreground`** (`oklch(0.145 0 0)` light / `oklch(0.985 0 0)` dark): Primary high-contrast text for active tab titles, dialog headings, and focused list items.
- **`text-normal`** (`oklch(0.371 0 0)` light / `oklch(0.87 0 0)` dark): App-specific default reading tone for file explorer rows, diff paths, and standard body copy.
- **`app-muted-foreground`** (`oklch(0.488 0 0)` light / `var(--muted-foreground)` `oklch(0.708 0 0)` dark): App-specific secondary tone for resting navigation icons, inactive workspace items, and diff stat counters (tuned slightly darker than `base-mira`'s `muted-foreground` `oklch(0.556 0 0)` in light mode for crisp icon legibility).
- **`text-subtle`** (`oklch(0.535 0 0)` light / `oklch(0.627 0 0)` dark): App-specific de-emphasized tone for `.gitignore`-excluded files (paired with italic styling).
- **`border`** (`oklch(0.922 0 0)` light / `oklch(1 0 0 / 10%)` dark) & **`input`** (`oklch(0.922 0 0)` light / `oklch(1 0 0 / 15%)` dark): Structural `1px` panel dividers and form control strokes.
- **`ring`** (`oklch(0.708 0 0)` light / `oklch(0.556 0 0)` dark): Keyboard focus ring and active panel resize handle indicator.

### Named Rules

**The Mira Preset Integrity Rule.** Never repurpose or alter the semantic role of canonical `base-mira` tokens (`background`, `foreground`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar-*`). Keep custom domain tokens in the dedicated app-specific block of `src/renderer/src/styles.css`.

**The Scoped Token Naming Rule.** New custom CSS variables must follow `<domain>-<element>-<role/state>` in kebab-case—such as `--dot-status-*`, `--source-control-*`, `--terminal-*`, `--file-icon-*`, or `--window-*`—and be registered in `@theme inline` as `--color-<name>: var(--<name>)` when needed as Tailwind utility classes.

**The Dynamic Mixture Rule.** Hover and active surface states derive from `color-mix(in oklab/oklch, ...)` against `var(--foreground)` or `var(--input)` (e.g., `--muted-hover`, `--accent-hover`, `--background-hover`, `--terminal-tab-hover`) rather than hardcoded hex steps, ensuring automatic adaptation across light, dark, and custom-tinted themes.

**The Signal-Only Chroma Rule.** Saturated colors are strictly reserved for operational telemetry: live agent states (`--dot-status-*`), Git diff additions/deletions (`--source-control-*`), validation alerts (`--destructive`, `--warning`, `--success`), and file-extension icons (`--file-icon-*`).

## Typography

**Display Font:** `'Inter Variable'`, sans-serif (`--font-sans`)
**Body Font:** `'Inter Variable'`, sans-serif (`--font-sans`)
**Label/Mono Font:** `'Inter Variable'` for UI labels; user-configured monospace font stack (`var(--font-mono)`) for PTY terminals, inline code, and Monaco diff views.

**Character:** Clean, neutral neo-grotesque proportions optimized for dense desktop interfaces, with strict `user-select: none` across application chrome and `tabular-nums` enforced on all counters, diff stats, and tables.

### Hierarchy

- **Headline** (`600` weight, `1.125rem` / `18px`, `1.4` line-height): Section titles inside settings and long-form `.typeset` documentation views.
- **Title** (`600` weight, `0.875rem` / `14px`, `1.4285` line-height): Panel headers (`项目`), dialog titles, and empty-state titles (`500` weight).
- **Body** (`400` weight, `0.75rem` / `12px`, `1.625` line-height): Standard interface text, settings descriptions, and file/worktree tree entries.
- **Label** (`500` weight, `0.75rem` / `12px`, `1.5` line-height): Button labels, tab titles, form field labels, and menu items.
- **Caption** (`500` weight, `0.625rem` / `10px`, `1.4` line-height, plus `--text-2xs: 0.6875rem` / `11px`): Compact status badges, Git line addition/deletion counters (`tabular-nums`), and micro keyboard hints.

### Named Rules

**The Compact Scale Rule.** Following `shadcn/ui` `base-mira` conventions, primary operational controls, tabs, and tree items default to `12px` (`text-xs/relaxed`) rather than web-marketing `16px`, preserving vertical room for terminal scrollback and file trees.

**The Tabular Telemetry Rule.** All numeric indicators—Git `+add / -del` counts, port numbers, and quota metrics—must apply `font-variant-numeric: tabular-nums` so columns never jitter during live updates.

**The Bidirectional Path Rule.** File names, relative paths, and branch refs must apply `unicode-bidi: plaintext` and `truncate` to prevent mixed CJK/ASCII/symbol path strings from corrupting layout order.

## Layout

Cota uses a fixed-viewport (`100vw × 100vh`, `overflow: hidden`) desktop app-shell architecture divided into four structural zones:

1. **Top Status & Tab Bar (`--app-titlebar-height: 44px`):** Acts as the Electron window drag region (`-webkit-app-region: drag`). Automatically reserves `96px` leading inset on macOS (`data-platform="darwin"`) for native traffic-light controls and `138px` (`3 × 46px`) trailing inset on Windows (`data-platform="win32"`) for custom window buttons.
2. **Primary Navigation Rail (`--app-navigation-width: 48px`):** Vertical icon rail on the far left with top-aligned workspace switchers (`首页`, `Cortana`) and bottom-aligned `设置`.
3. **Inset Workspace Canvas (`flex-1`):** Framed with a top-left `18px` radius (`rounded-tl-2xl`) and `1px` top/left border (`border-border`). Inside, a horizontal `ResizablePanelGroup` manages three collapsible zones:
   - **Left Project & Worktree Sidebar:** Default `240px` (`min: 200px`, `max: 400px`, collapsible to `0px`), styled with `bg-muted/40 text-app-muted-foreground`.
   - **Center Main Stage (`min: 200px`, `flex-1`):** Hosts recursive split-pane terminals (`TerminalWorkspace`), pinned/preview `FilePreview`, or `SourceControlDiff` on `bg-background`. Running terminal DOM nodes remain mounted (`hidden` via CSS) when viewing diffs or secondary routes (`/settings`, `/cortana/accounts`).
   - **Right Inspection Panel:** Default `0px` when closed, expands from `240px` up to `65%` width on `bg-background` to display `FileExplorer` or `SourceControlPanel` (`Git`).
4. **Row & List Density:** File explorer rows, source control file rows, and all-file diff triggers share a strict `28px` height (`content-visibility: auto; contain-intrinsic-size: auto 28px`) for instant scrolling across large repositories.

## Elevation & Depth

Cota conveys depth primarily through **stepped tonal layering and `1px` hairline borders (`border-border`)** rather than drop shadows. The outer shell (`bg-muted`) sits at the lowest perceptual plane; the project sidebar (`bg-muted/40` over `bg-background`) occupies the middle plane; and the active terminal/editor canvas (`bg-background`) sits at the highest plane.

### Shadow Vocabulary

- **Active Control Lift** (`var(--shadow-xs)`): Applied exclusively to active segmented tabs (`.right-panel-files-tab[data-active]`) and active agent quick-jump pills (`.project-item-agent-button[data-active="true"]`) to lift the selected pill off its recessed track.
- **Card Hairline Ring** (`ring-1 ring-foreground/10`): Replaces heavy card drop shadows in `base-mira` `Card` components with a crisp `1px` perimeter ring.
- **Inactive Pane Dimming** (`--terminal-pane-inactive-overlay: color-mix(in oklab, var(--muted-foreground) 3%, transparent)` + `--terminal-pane-inactive-content-opacity: 0.8`): Recesses unfocused split terminal panes into the background without adding borders or shadows.

### Named Rules

**The Flat-At-Rest Rule.** Structural panels, cards, and list rows cast zero drop shadow at rest; spatial separation is achieved strictly via `oklch` surface contrast and `1px` `border-border` lines.

**The Invisible Handle Rule.** Panel resize handles (`.ui-resizable-handle`) are `1px` wide and transparent at rest with an `8px` hit target, illuminating into a `2px` `--panel-separator-hover` (`var(--accent-hover)`) or `--panel-separator-active` (`var(--ring)`) line only during pointer hover, drag, or keyboard focus.

## Shapes

The geometry derives all inner radii from the `base-mira` base token `--radius: 0.625rem` (`10px`) via `@theme inline` calc multipliers:

- **Workspace Shell Corner (`18px` / `--radius-2xl: calc(var(--radius) * 1.8)`):** Applied to the top-left corner (`rounded-tl-2xl`) of the main workspace container where it meets the top bar and left navigation rail.
- **Cards & Dialogs (`10px` / `--radius-lg: var(--radius)`):** Standard container rounding (`rounded-lg`) for `Card`, modal `Dialog`, and `Popover` surfaces.
- **Interactive Controls & Rows (`8px` / `--radius-md: calc(var(--radius) * 0.8)`):** Default corner radius (`rounded-md`) for `Button` (`h-7`), `Input` (`h-7`), workspace tabs, project folder rows, and Git file rows.
- **Compact Micro-Controls (`6px` / `--radius-sm: calc(var(--radius) * 0.6)`):** Used for `xs` buttons (`h-5`), `icon-xs` split-pane actions (`rounded-sm`), and inline `<kbd>` shortcut caps (with a `2px` bottom border bevel).
- **Status Pills & Scrollbars (`9999px` / `rounded-full`):** Used for `Badge` components, `.dot-status` indicators (`6px` circle), and macOS-style overlay scrollbar thumbs (`10px` track with `2.5px` transparent padding border, expanding on hover).

## Components

Cota's components feel **crisp, compact, and instrument-grade**: built on `@base-ui/react` and `shadcn/ui` (`base-mira`) primitives, they respond with immediate background shifts, `1px` active press feedback, and zero layout shift.

### Buttons

- **Shape & Sizing:** `8px` radius (`rounded-md`) at `base-mira` default `28px` height (`h-7`, `px-2`, `text-xs/relaxed`, `14px` icon). Micro actions use `xs` (`h-5` / `20px`, `rounded-sm`, `10px` text) or `sm` (`h-6` / `24px`). Navigation rail icons use `icon-xl` (`size-9` / `36px`, `20px` icon).
- **Primary (`default`):** `bg-primary text-primary-foreground hover:bg-primary/80`.
- **Secondary & Outline:** `secondary` uses `bg-secondary text-secondary-foreground` with a `5%` `--foreground` color-mix on hover; `outline` uses `border-border hover:not-disabled:bg-input/50 dark:bg-input/30`.
- **Navigation & Project Variants:** Custom `navigation` and `project` variants rest with `text-app-muted-foreground` on a transparent background, revealing `bg-muted-hover` or `bg-accent` on hover and `bg-foreground/6` or `bg-accent` when `data-[active="true"]`.
- **Tactile Press & Focus:** Pressing any non-menu button applies a crisp `1px` downward physical nudge (`active:not-aria-[haspopup]:translate-y-px`); keyboard focus renders `focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30`.

### Chips / Badges

- **Style:** Pill-shaped (`rounded-full`), `20px` height (`h-5`), `px-2`, `10px` (`text-[0.625rem]`) medium-weight text.
- **State Variants:** Supports `default` (`bg-primary`), `secondary` (`bg-secondary`), `outline` (`border-border bg-input/20`), plus tinted semantic variants (`warning` with `bg-warning/10 text-warning`, `success` with `bg-success/10 text-success`, `destructive` with `bg-destructive/10 text-destructive`) used for worktree lock/error alerts and account status tags.

### Cards / Containers

- **Corner Style:** `10px` (`rounded-lg`).
- **Background & Border:** `bg-background text-card-foreground` bounded by `ring-1 ring-foreground/10` rather than a drop shadow.
- **Internal Padding:** `16px` (`--card-spacing: --spacing(4)`) by default, tightening to `12px` (`--spacing(3)`) on `data-[size=sm]`.

### Inputs / Fields

- **Style:** `28px` height (`h-7`), `8px` radius (`rounded-md`), `border-input bg-input/20 dark:bg-input/30`, `px-2 py-0.5`, `12px` (`md:text-xs/relaxed`) text.
- **Focus & Validation:** Focus shifts border to `focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30`. Invalid fields (`aria-invalid="true"` / `data-invalid`) switch to `aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20`, paired with inline `FieldError` copy directly below the control.

### Navigation & Workspace Tabs

- **Left Icon Rail:** `48px` wide; icons switch from `regular` to `fill` weight when active (`data-active="true"`).
- **Workspace & Terminal Tabs:** Resting tabs sit transparently on the `44px` titlebar (`color: var(--accent-foreground)`), brightening to `--terminal-tab-hover` on hover and snapping to solid `var(--background)` when selected (`aria-selected="true"`). Preview tabs italicize their title (`font-style: italic`) until pinned via double-click or `Enter`. Trailing close/action buttons sit over a right-aligned gradient mask (`mask-image: linear-gradient(to right, transparent, #000 55%)`).

### DotStatus & Agent Pills (Signature Component)

- **DotStatus (`.dot-status`):** A `6px × 6px` semantic state indicator embedded in project worktree rows, agent quick-jump buttons, and terminal tabs. Renders a hollow `1px` ring when `empty` (`--dot-status-empty`), neutral gray when `idle` (`--dot-status-idle`), pulsing dual-wave sky blue (`--dot-status-working`, `dot-status-ripple`, `1.6s cubic-bezier(0, 0.2, 0.8, 1) infinite`) when `running`, amber (`--dot-status-attention`) when `needs-input`, green (`--dot-status-completed`) when `completed`, and crimson (`--destructive`) when `failed`.
- **Project Item Agent Bar (`.project-item-agents`):** Nested beneath a workspace row, displaying compact icon buttons for each active CLI agent (`Codex`, `Claude Code`, `Pi`, `Grok`) badged at the bottom-right corner with a miniature `DotStatus` (`8px` container with `bg-background` or `bg-muted` cutout ring).

## Do's and Don'ts

### Do:

- **Do** use canonical `shadcn/ui` `base-mira` tokens (`bg-background`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-sidebar-accent`) for all standard surfaces and controls.
- **Do** name any new custom CSS token in `src/renderer/src/styles.css` using `<domain>-<element>-<state/role>` (e.g., `--dot-status-*`, `--source-control-*`, `--terminal-*`, `--file-icon-*`), place it under the app-specific comment block, and expose it in `@theme inline` if utility classes are needed.
- **Do** reuse `shadcn/ui` and `@base-ui/react` primitives (`Button`, `FieldGroup`, `Field`, `Dialog`, `Tabs`, `Collapsible`) and assign semantic, module-descriptive `className` hooks (e.g., `project-folder-row`, `source-control-file-actions`).
- **Do** keep tree rows and file lists at `28px` height with `content-visibility: auto` and hide row-level action buttons until `:hover` or `:focus-within`.
- **Do** cancel Electron titlebar drag behavior (`-webkit-app-region: no-drag`) on all interactive controls, open dropdown/context menus, and portaled dialog overlays.

### Don't:

- **Don't** introduce parallel token aliases (such as `surface-canvas` or `recessed-shell`) in component classes when a canonical `base-mira` token (`background`, `muted`, `secondary`) already serves that role.
- **Don't** introduce decorative gradients, neon AI glows, glassmorphism (`backdrop-filter: blur`), or multi-layered ambient drop shadows onto workspace panels or cards.
- **Don't** hardcode hex or Tailwind palette classes (such as `bg-slate-100` or `text-zinc-500`) in component JSX; always bind to semantic tokens (`bg-muted`, `text-app-muted-foreground`, `text-text-normal`).
- **Don't** unmount the `TerminalWorkspace` DOM tree when toggling file previews, Git diffs, or secondary pages (`/settings`, `/cortana`); toggle visibility via CSS (`hidden`) to preserve live xterm buffers and WebGL contexts.
