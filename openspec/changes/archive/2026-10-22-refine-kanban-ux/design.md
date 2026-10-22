# Design: Refine Kanban UX and Task Lifecycle

## Context

See `proposal.md` for motivation and the capability deltas for required behavior. The current implementation has the following constraints that shape the approach:

- The board uses native HTML5 drag-and-drop on an `article` and a nested `button` for card activation; each card also carries a stage `select`. The drawer is a fixed-width absolute panel with a full-width stage field above its tabs.
- The Info section is a permanent edit form with a separate Markdown preview. The Git section combines creation, attachment, details, unclaimed warnings, and operation recovery in one view.
- Task lifecycle supports Archive/Restore plus Delete. Delete already archives native chats, removes shared notes and an eligible worktree, keeps the branch, and leaves unclaimed checkouts.
- Task conversations are created with `cwd` only. The native workspace registry is used only to archive sessions. DSH accepts `workspaceId` or `cwd` when creating a session, and its sidebar has no hidden-workspace state.
- Native workspace membership is established at session creation and is not migrated when the effective directory changes (the A7 assumption). New conversations can join the workspace for the current path.
- The plugin registers its product tools globally; ordinary-chat availability was confirmed in the running GUI.
- DSH exposes `ctx.llm.registerAdapter` and `LlmAdapter` but ships no deterministic test adapter.

The Railyin checkout at `~/projects/pessoal/railyin` provides observed UX evidence: pointer-based drag with a cloned ghost and drop indicator, explicit card selection mode, a compact toolbar stage select, a resizable drawer with an outside-click guard, read-only Info with an edit action, and a three-state Git tab with searchable branch selection.

## Goals / Non-Goals

**Goals:**

- Make board movement direct and predictable without native HTML5 drag artifacts.
- Reduce drawer, Info, and Git surface density while retaining operation recovery and safety warnings.
- Make Delete the only task lifecycle action and remove archive code paths and metadata.
- Bind task conversations to native workspaces so the chat does not ask for a workspace, including existing tasks.
- Replace real-model verification with a deterministic, scriptable provider.
- Preserve native conversation identity, histories, tools, permissions, and DSH navigation.

**Non-Goals:**

- Multiple boards, WIP limits, multiple worktrees per task, full Git status/diff, terminal/editor integration, or a mobile-specific redesign.
- Hiding registered workspaces from the DSH sidebar; DSH provides no such state.
- Changing DSH core, native agent loop, scheduler, or persistence.
- A real-model acceptance path. A manual real-model smoke is not part of this change.

## Decisions

### 1. Replace HTML5 drag-and-drop with pointer-driven card interaction

The card root becomes a focusable surface that handles pointer down/move/up. A drag starts only after 5px of movement, uses pointer capture, clones the card into a fixed-position ghost, hides the original in place, computes the destination with `elementFromPoint`, and renders a drop indicator at the computed index. Auto-scroll runs while the pointer is near the board edge. Click after a drag is suppressed briefly so a drop does not also open the drawer. Nested controls stop propagation. In selection mode, pointer drag is disabled and a card click toggles selection.

**Why not HTML5 DnD:** the native drag image cannot distinguish the dragged card from the source, cannot render a reliable insertion indicator across scroll containers, and conflates click with drag. A library would add a dependency for behavior the reference already implements directly.

The board removes the card stage select. The drawer keeps a compact select in its toolbar as the keyboard/pointer fallback for moving without dragging.

### 2. Add a host-backed placement operation

`task.move` gains an optional `beforeTaskId` (or append when null) and accepts a same-column destination. The host validates allowed transitions, operation/pending state, and that the anchor belongs to the destination stage. It then renumbers the destination column (and the source column for a cross-column move) in one transaction, preserving a stable integer order.

**Why renumber:** fractional positions eventually collide and complicate recovery. Single-user command serialization makes a full-column renumber cheap and deterministic. The client applies an optimistic local order and rolls back if the command rejects.

Instructed destinations keep the existing Move and run / Move only / Cancel flow; same-column reorder is a move-only operation. Worktree creation is not part of the drop or the move command.

### 3. Implement bulk delete as client-orchestrated best effort with a host preflight

The board keeps selection state locally (not in the domain snapshot), resets it when search/filter/project changes, and disables drag while active. `task.delete` gains a batch-only `requireIdle` mode. With it, the host checks before starting an operation that the task has no operation/pending transition, every conversation is idle, and the worktree has no local changes; it rejects with the existing busy/discard error codes rather than queueing. The client deletes eligible tasks sequentially, records skipped tasks with reasons, leaves them selected, and shows one summary. Single-task deletion keeps its existing queue-until-idle behavior.

**Why not a host `deleteMany`:** a per-task loop reuses the existing deletion transaction, worktree coordinator, and recovery journal. A batch command would need a new partial-result receipt and failure semantics without removing the per-task operations. The serial host command queue already prevents concurrent deletion.

### 4. Bind conversations to native workspaces and reconcile existing tasks

A new `WorkspacePort` wraps the native registry: ensure/reuse a workspace for a canonical path, read a workspace, and delete a registration. New conversations resolve the workspace for the task's effective directory, create the session with `workspaceId`, and never fall back to a cwd-only session.

Workspace ownership is recorded in plugin state:
- The base-project workspace is shared. It is reused if it exists and is never deleted with a single task.
- A worktree workspace is owned by its task when Kanban created it. It is deleted with the task if no other task or session uses it.
- A pre-existing workspace is not owned and is never renamed or deleted.

Titles are the project name for the base workspace and `project · branch` for a worktree workspace. Existing titles are preserved.

Existing tasks require reconciliation because their sessions were created with cwd only. On initialization and before a task drawer opens, the plugin ensures a workspace for the task's effective directory and for each retained session's recorded header cwd. The registry indexes a session by its canonical header cwd; the gate in the task list must verify that creating the workspace makes a cwd-only session a member and removes the picker. If it does not, the implementation must report the limitation and revise this decision rather than claim success. Existing sessions keep their creation-time workspace; only new conversations join a workspace for a changed directory.

### 5. Use native session titles for conversation tabs

The client catalog exposes `SessionSummary.title` and the retained session face exposes `rename(title)`. Tabs read the native title, fall back to `Agent N`, and call native rename from a double-click or context-menu edit. The plugin stores no tab-label state. Closed tabs use the catalog title when available and the same fallback otherwise.

### 6. Make the drawer resizable and dismissible without losing drafts

A pointer-driven resize handle on the drawer's left edge updates a width stored in `localStorage` (plugin-scoped key), clamped to a minimum/maximum and resettable by double-click. The handle is keyboard-operable as a vertical separator. A board-scoped `pointerdown` listener closes the drawer only when the target is the board background, not the drawer, resize handle, or any native portal/overlay. Escape also closes it. Info drafts move into `TaskPageState` (in-memory UI state), so switching tabs, closing, or switching tasks preserves them; a successful save or explicit cancel clears the draft. Reload still loses drafts, which is acceptable for uncommitted UI state.

### 7. Turn Info into a read-only view with an inline editor

The Info panel renders the task title and Markdown description as read-only content. Edit toggles both fields into inputs; Save and Cancel are explicit. The existing `expectedRevision` and draft-generation logic stay to prevent stale writes. The project moves to the drawer header and the effective directory is removed from Info; technical context remains in the Git detail surface.

### 8. Reduce Git to a worktree state machine with progressive disclosure

The Git panel becomes four states: no worktree, creating, ready, and error. The ready state shows branch, path, state, and an inline removal confirmation. The no-worktree and error states show the creation form or retry path, with attachment as a secondary action. Operation recovery and discard consent remain visible when applicable. Unclaimed checkouts render as a compact warning whenever present. A secondary detail surface exposes base project, Git root, effective directory, and ownership.

Branch selectors become a small searchable combobox over local branches for both the source branch and the existing-branch choice. This is implemented with an input plus filtered suggestions, not a new dependency.

### 9. Remove task archiving with a fail-closed schema migration

Remove the archive/restore UI, archived view, commands, and `archivedAt` from the active task model. Bump the persisted board schema to version 2 and migrate version 1 by dropping archive metadata. If a stored task has a non-null archive value, loading fails with a dedicated error instead of silently deleting, hiding, or resurrecting that task. The user confirmed there is no archive history; this guard protects unexpected data without building a legacy feature.

Deletion keeps its existing semantics: return retained chats to the base project, archive native chats without erasing histories, remove task/notes/eligible worktree, keep the branch, and leave unclaimed checkouts. The worktree workspace cleanup runs after the task's chats are archived and before/after the task record is removed, using the ownership ledger; a cleanup failure is reported but does not turn a completed task deletion into a claimed success.

### 10. Verify with a deterministic LLM adapter

Add a test-only plugin that registers a `kanban-fixture` provider through `ctx.llm.registerAdapter`. The adapter implements `providerInfo`, `listModels`, `prepareCall`, and the streaming protocol; it returns scripted text, tool calls, errors, or delayed chunks from deterministic fixtures. Tests select it per session or preset and never change the global default. The existing `verify-native-*` scripts stop accepting real-model runs; any request for a non-fixture provider fails the test. Existing unit/integration fakes remain.

The adapter is verification infrastructure, not a product capability, so it has no capability spec delta. Its first task is a protocol gate proving that one ordinary GUI turn, one tool call, and one error can run without network access.

### 11. Use inline SVG icons

Add a small icon module with 16–20px inline SVGs rendered with `currentColor`. Buttons keep `aria-label` and tooltips; destructive actions keep text or an explicit confirmation. No icon dependency is added.

## Risks / Trade-offs

- [Pointer drag excludes native drag accessibility] → Keep the drawer stage select as the keyboard path, use a focusable card, and test both pointer and keyboard activation.
- [Same-column reorder can race a snapshot] → Optimistic client order is reconciled against the next snapshot; the host renumbers inside one serialized transaction and rejects stale anchors.
- [Workspace creation introduces sidebar clutter that cannot be hidden] → Use stable titles, delete owned worktree registrations when unused, never rename user workspaces, and keep the workspace label out of the drawer.
- [Retroactive workspace membership for existing cwd-only sessions is unproven] → Make it an explicit verification gate before claiming the picker is removed; if the registry does not index the session, report the limitation and revise the design.
- [Schema version bump complicates rollback] → Document that version 2 data is not readable by the previous plugin version; back up board storage before deployment. The archive guard prevents silent data loss.
- [Bulk best effort reports partial success] → Show a per-task skip summary, keep skipped tasks selected, and never stop chats or discard worktree changes.
- [Native title changes asynchronously] → Read the catalog title reactively and keep the `Agent N` fallback; do not cache a second label.
- [Outside-click handling can close during native overlays] → Scope the listener to the board background, ignore portals/overlays and the resize handle, and test with a native menu open.
- [Simplified Git can hide recovery state] → Keep operation status, retry/return actions, discard consent, and unclaimed warnings visible; only technical paths move behind disclosure.
- [Deterministic adapter drifts from the real protocol] → Add contract tests for chunk/finish semantics, tool calls, cancellation, and errors; keep real-model runs out of acceptance.
- [Info drafts are memory-only] → Document that reload discards uncommitted UI drafts; domain writes still use explicit Save.

## Migration Plan

1. Add schema version 2 and the v1→v2 load migration; strip archive metadata and fail closed on non-null archived tasks. Add domain tests for both paths.
2. Ensure workspaces for existing tasks and retained sessions on initialization; record managed workspace ownership. Existing sessions keep their current native identity and history.
3. Deploy through the existing build/reconcile procedure; no replacement server and no DSH core change.
4. Update fixtures and tests that construct `Task` values with `archivedAt`, `task.archive`, or `task.restore`.
5. Rollback requires restoring a pre-change board-state backup; the previous plugin version does not read version 2. Native session logs are untouched by this change.

## Open Questions

None that change the approach. The retroactive workspace-membership gate is a verification checkpoint; if it fails, implementation stops and the change is revised rather than shipping a claim the host cannot support.
