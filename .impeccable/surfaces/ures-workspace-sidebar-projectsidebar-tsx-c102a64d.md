---
version: 1
slug: "ures-workspace-sidebar-projectsidebar-tsx-c102a64d"
primary_target: "src/renderer/src/features/workspace/sidebar/ProjectSidebar.tsx"
related_targets: ["src/renderer/src/features/workspace/sidebar/AgentList.tsx","src/renderer/src/features/workspace/sidebar/WorkspaceItem.tsx","src/renderer/src/state/left-panel-store.ts"]
---

# Project sidebar Agent list

Mode: Operate. Extend the existing project sidebar so developers can scan and jump between all workspace Agents. Preserve project grouping, workspace status summaries, terminal sessions and launch/delete workflows.

## Direction contract

THESIS: One Agent presence, two views: inline workspace icons when collapsed; a global flat list when expanded. Never show both at once.

OWN-WORLD: Inherit Cota's compact neutral sidebar, existing project buttons, semantic status dots, ScrollArea and Resizable primitives. No new visual tokens or system changes.

STORY: Scan real Agent terminal titles, status and project/branch provenance; click to select that workspace and focus its terminal. Include Agents in folded projects, exclude ordinary shells, keep project/workspace/tab order stable.

FIRST VIEWPORT: Projects remain above a bottom Agents header with count. Default collapsed. Expanded, the lower list has its own scrollbar and a draggable horizontal separator; each row has an 18px provider icon centered against both text lines, title and status, followed by a truncated project/branch line. Use the workspace's actual branch (or detached short HEAD); omit unavailable branch text. Preserve workspace summary dots above.

FORM: User-confirmed flat list and adjustable split. Local surface extension; concept-seed is not applicable under new-work §3. Empty lists show a concise empty state. Keep the header keyboard operable and the separator labeled. No search, filters, new terminal actions or backend changes.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
