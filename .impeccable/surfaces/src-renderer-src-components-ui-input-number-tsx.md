---
version: 1
slug: "src-renderer-src-components-ui-input-number-tsx"
primary_target: "src/renderer/src/components/ui/input-number.tsx"
related_targets: ["src/renderer/src/features/settings/sections/terminal-appearance/TerminalAppearanceGroup.tsx","src/renderer/src/features/settings/sections/terminal-appearance/TerminalTypographyFields.tsx","src/renderer/src/features/settings/sections/TerminalSettings.tsx"]
---

# InputNumber

Mode: Operate. Scope: shared numeric control and the existing terminal settings fields. Preserve validation, auto-save, dialog safety and the background-transparency inversion.

## Direction contract

THESIS: Numeric editing remains text-first; permanently visible, right-stacked chevrons offer precise adjustment without making settings rows taller.

OWN-WORLD: Inherit Cota's neutral base-mira InputGroup, 28px control height, semantic border/focus/error tokens and tabular numerals. No new palette or decorative motion.

STORY: Developers can type, clear, paste or step a value; buttons stop at bounds, typed invalid values remain available for field validation, and scrolling never changes values.

FIRST VIEWPORT: Keep existing settings grids and row widths. The input occupies remaining width; a 24px column on the right contains two equally sized chevrons separated by a hairline. Focus is one continuous outline around the group.

FORM: Local component extension, user-confirmed right-stacked arrows and integration into existing numeric settings. Concept-seed check is explicitly exempt / not applicable under new-work §3: local component extensions inherit the existing surface and must not run a concept tournament. No seed was generated; there is no missing roll to corroborate.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
