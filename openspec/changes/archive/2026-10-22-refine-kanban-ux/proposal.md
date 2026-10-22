# Proposal: Refine Kanban UX and Task Lifecycle

## Why

The Kanban plugin is functional, but first real use exposed 17 friction points across the board, drawer, task lifecycle, native workspace binding, and verification. The observed behavior diverges from the direct-manipulation experience of the Railyin reference: cards use native HTML5 drag without a ghost, stage controls are duplicated, Archive competes with Delete, the Info and Git tabs expose implementation detail, and embedded chats still ask the user to select a workspace.

This change captures the decisions aligned on October 22, 2026. It refines the existing product rather than replacing its architecture: native DSH conversations, worktrees, notes, and product tools remain. The separate UX issue list anticipated by the previous change is now this change.

## What Changes

- **Board direct manipulation.** The whole card surface opens the task drawer. Cards no longer carry a stage selector; the board moves tasks only through pointer-based drag and drop. Dragging clones a ghost, hides the original in place, shows a drop indicator, supports auto-scroll, and optimistically moves the card. Same-column reordering is supported. A cross-stage drop moves immediately when the destination has no entry instruction; an instructed destination still opens the required Move and run / Move only / Cancel dialog. Worktree creation is no longer offered from the drop or transition flow.
- **Task creation entry point. BREAKING.** The New task action moves from the board header to the top of the configured initial column. The creation dialog still collects title, description, and project and still creates in the initial stage without starting an agent.
- **Bulk deletion.** An explicit selection mode in the board header enables checkboxes and disables drag. Deleting a selection uses one confirmation and a best-effort batch: eligible tasks are deleted, while tasks with running conversations, a pending operation/transition, or a dirty worktree are skipped and reported; skipped tasks remain selected.
- **Drawer shell.** The drawer becomes resizable and persists its width. Clicking the board background closes it; clicks in native portals, overlays, or the resize handle do not. Escape closes it. Unsaved Info drafts survive tab switches and drawer close. Header actions use inline icons.
- **Drawer header and stage control.** The task title and project appear in the drawer header. The workflow stage select moves into the compact toolbar beside the tabs and lists only permitted transitions. The effective cwd is removed from the tab row and Info.
- **Info tab.** Info becomes read-only by default: title plus Markdown-rendered description. An Edit action turns title and description into inputs with Save/Cancel. The explanatory sentence, the project duplicate, and the effective-directory detail are removed.
- **Git tab.** The section is reduced to the Railyin three-state shape (ready / creating / error) with branch and path summary, searchable branch selectors, inline worktree removal confirmation, and a compact unclaimed-checkouts warning. Attaching an existing worktree remains as a secondary action in the no-worktree state. Operation recovery and discard consent remain.
- **Task lifecycle. BREAKING.** Archive and Restore are removed completely: no archived-task view, no archive/restore commands, no archive metadata, and no legacy migration or legacy UI. Delete is the only lifecycle action. It archives native DSH conversations without erasing histories, removes the task, notes, and eligible worktree, preserves the Git branch, and leaves unclaimed checkouts on disk with a warning.
- **Native workspace binding.** Each new task conversation joins a native DSH workspace for its effective project or worktree path instead of being created with cwd only. The base-project workspace is shared by tasks in that project; a worktree workspace is per task. Workspace titles are the project name and `project · branch`. Existing workspaces are reused and never renamed. The worktree workspace registration is deleted when its task is deleted, if Kanban created it and no other session uses it. DSH has no hidden-workspace flag; the sidebar entries remain visible while in use.
- **Conversation tabs.** Agent tabs use the native session title, with `Agent N` as fallback. Renaming a tab renames the native session; closed tabs use the same title. Reactivating a task restores its existing sessions.
- **Copy.** The board legend sentence is removed; attention indicators keep their accessible labels and tooltips.
- **Deterministic verification.** A test-only, scripted LLM adapter is introduced for GUI and native-contract tests. Tests select it per session or preset; no test in the acceptance path makes a real model request. Existing real-model helper scripts are disabled or guarded out of acceptance.

## Capabilities

### New Capabilities

None. This change modifies existing capabilities only.

### Modified Capabilities

- `kanban-board`: task creation moves to the initial column; card activation covers the whole card; board movement becomes pointer-based drag with same-column reorder and instructed-stage confirmation; bulk selection/deletion is added; the card stage selector is removed.
- `task-conversations`: drawer header exposes task and project; Info becomes read-only with inline edit; stage control becomes compact; cwd is removed from tab/Info surfaces; tab titles use native session titles and can be renamed; drawer dismissal and draft retention are defined.
- `task-lifecycle`: archive/restore requirements are removed; Delete is the only lifecycle action; batch deletion follows the same deletion semantics with best-effort skipping and reporting.
- `worktree-management`: the transition-time worktree prompt is removed; worktree creation is offered only through the existing notice and Git tab; the Git tab is simplified, gains searchable branch selectors, keeps secondary attach, and surfaces unclaimed checkouts compactly.
- `project-contexts`: task conversations join a native workspace for their effective path; base and worktree workspace ownership, naming, reuse, and cleanup are defined; existing sessions keep their original workspace grouping when the effective directory changes.

## Impact

- **Client:** board, card, drawer, Info, Git, tab, icon, and page-state components; drag/drop interaction; bulk-selection state; resizable drawer; draft retention.
- **Host:** native session creation with `workspaceId`; workspace registry create/resolve/delete; task lifecycle commands; worktree coordination; task ordering; store/schema changes for workspace ownership and archive removal.
- **Persistence:** `archivedAt` leaves the active model. A load-time compatibility guard rejects unexpected legacy archived tasks instead of silently exposing or deleting them. Workspace identifiers are persisted for cleanup.
- **Tests:** client board/state/lifecycle tests, host app/product-walkthrough tests, domain schema/store tests, bridge fixtures, and native workspace tests. A test-only LLM adapter and deterministic fixtures replace real-model helper runs in acceptance.
- **Docs and specs:** README, operations, verification boundaries, and the affected capability specs.
- **Dependencies:** no new runtime dependency; no DSH core change; Railyin remains an external UX reference.

## Scope Exclusions

No multiple boards, WIP limits, multiple worktrees per task, full Git status/diff, terminal/editor integration, mobile-specific redesign, new main-chat navigation shortcuts, or real-model acceptance tests. Existing native DSH navigation, tools, permissions, and conversation behavior remain available.
