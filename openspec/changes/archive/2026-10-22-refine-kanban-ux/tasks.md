# Tasks

## 1. Gates and Baseline

- [x] 1.1 Run `pnpm run check` on the current checkout and record the baseline result so later failures are attributable to this change.
- [x] 1.2 Prove the workspace-membership gate: create a workspace for an existing cwd-only session's recorded header cwd in a disposable host, then verify the session becomes a member and the embedded chat no longer asks for a workspace; record the exact observation and stop for design revision if it fails.
- [x] 1.3 Prove the deterministic-adapter protocol gate: register a minimal test adapter through `ctx.llm.registerAdapter`, list one model, and complete one scripted stream through `finish`; stop for design revision if the public protocol cannot support it.

## 2. Lifecycle and Persistence

- [x] 2.1 Remove `archivedAt` from the task type, initial state, schema, and domain checks; verify the domain schema/store tests no longer construct or expect archive metadata.
- [x] 2.2 Remove `task.archive` and `task.restore` from the command union, host command switch, store methods, and bridge fixtures; verify the command tests reject unknown archive commands and the bridge tests still pass.
- [x] 2.3 Add schema version 2 with a version 1 migration that drops archive metadata; verify a version 1 board with null archive values loads and a non-null archive value fails closed with a dedicated error.
- [x] 2.4 Remove the archived-task board view, page-state flag, drawer Archive/Restore buttons, and archived-card actions; verify the client board and lifecycle tests contain no archive/restore interaction.
- [x] 2.5 Update the Delete confirmation and result copy to state that task data/notes/worktree are removed, native chats are archived without history loss, and the branch is kept; verify the confirmation test asserts those effects and no Archive alternative.
- [x] 2.6 Add the batch-only `requireIdle` preflight to `task.delete` so an operation, pending transition, running conversation, or dirty worktree rejects before an operation starts; verify host tests for each blocker and verify the single-task delete still waits for idle.
- [x] 2.7 Implement the client-side best-effort batch loop that deletes eligible tasks sequentially, records skipped tasks and reasons, retains skipped selections, and reports one summary; verify client tests with mixed eligible/blocked selections.

## 3. Board Placement and Direct Manipulation

- [x] 3.1 Extend `task.move` with an optional placement anchor and same-column destination; renumber the affected column(s) in one transaction and validate the anchor and allowed transition; verify app/store tests for cross-column move, same-column reorder, append, invalid anchor, and forbidden transition.
- [x] 3.2 Add the pointer drag hook with pointer capture, 5px threshold, cloned ghost, hidden source, drop indicator, auto-scroll, and post-drag click suppression; verify component tests dispatch pointer events and assert the ghost/indicator state.
- [x] 3.3 Apply an optimistic client order for same-column and cross-column drops and roll it back when the host command rejects; verify a client test asserts the optimistic order and the restored order after rejection.
- [x] 3.4 Remove the per-card stage select and keep the compact drawer stage select as the non-drag fallback; verify the board no longer renders a card stage combobox and the drawer transition tests still pass.
- [x] 3.5 Make the whole card surface open the drawer, stop propagation for nested controls, and support keyboard activation; verify click, Enter, nested-control, and selection-mode tests.
- [x] 3.6 Move the New task action to the top of the configured initial column and remove the header action; verify the board test opens creation from the initial column and the header has no New task action.
- [x] 3.7 Add explicit selection mode with card controls, drag disabled, selection count, one confirmation, and the batch summary; verify client tests for entering, selecting, deleting, skipping, and leaving selection mode.
- [x] 3.8 Remove the board legend sentence and verify attention indicators still expose their accessible labels and tooltips.

## 4. Native Workspace Binding

- [x] 4.1 Add a WorkspacePort abstraction and native implementation for ensure/reuse, lookup, deletion, and title creation; verify host tests against a fake registry for existing and new paths.
- [x] 4.2 Extend session creation to accept a workspace identity and use the native `workspaceId` create path; verify a conversation is never created cwd-only when a workspace is required.
- [x] 4.3 Persist workspace identity and ownership for the base project and worktree workspace; verify schema/store restart tests retain ownership without adding a required field to old data.
- [x] 4.4 Ensure the base-project workspace on task/conversation creation, reusing an existing workspace and preserving its title; verify the base workspace is shared by two tasks and is not duplicated.
- [x] 4.5 Ensure a worktree workspace on the first conversation created after a worktree becomes active, with the `project · branch` title; verify the conversation joins it and the existing session keeps its original grouping.
- [x] 4.6 Reconcile existing tasks and retained sessions on initialization by ensuring workspaces for their recorded header cwds; verify the picker gate from task 1.2 using a real existing task.
- [x] 4.7 Delete an owned worktree workspace registration after a task deletion when no other task or session uses it; never delete the base workspace or a pre-existing workspace; verify host tests for owned, shared, user-created, and cleanup-failure cases.
- [x] 4.8 Remove the workspace/cwd display from the conversation tab row and Info, keeping technical paths in the Git detail surface; verify the drawer tests contain no effective-directory text in those places.

## 5. Conversation Tabs and Drawer Shell

- [x] 5.1 Read native session titles from the client catalog with an `Agent N` fallback; verify tab labels update when a `SessionSummary.title` changes and use the fallback when absent.
- [x] 5.2 Add tab rename through an inline editor opened by double-click and the context menu, calling the native session rename; verify success updates the tab and native list, and a rejected rename keeps the previous title.
- [x] 5.3 Use the native title for closed-conversation entries and reopening controls; verify closed tabs show the title or the positional fallback.
- [x] 5.4 Add the drawer header title, project, and inline icon actions for delete and close; verify the header test asserts title/project and accessible icon labels.
- [x] 5.5 Implement pointer-based drawer resizing with bounds, double-click reset, and keyboard separator behavior; persist the width in a plugin-scoped local preference and verify restore after reload.
- [x] 5.6 Close the drawer on board-background pointer down and Escape while ignoring native portals, overlays, and the resize handle; verify tests for each ignored target.
- [x] 5.7 Move Info drafts into task page state so tab switches, drawer close, and task switches preserve them, and clear them on save or cancel; verify a draft survives reopening and is not written unless saved.
- [x] 5.8 Render the compact stage select in the drawer toolbar with only permitted transitions; verify instructed destinations still open the Move and run / Move only / Cancel confirmation.
- [x] 5.9 Refactor Info into a read-only Markdown view with an Edit mode for title and description, explicit Save/Cancel, and the existing revision-conflict handling; verify read, edit, cancel, stale-revision, and no-message tests.
- [x] 5.10 Remove the Info project duplicate, editing hint, and effective-directory detail, and show the project in the drawer header; verify the Info test asserts their absence.
- [x] 5.11 Add the inline SVG icon module for settings, delete, close tab, new task, and selection; verify every icon-only control has an accessible label and a tooltip.

## 6. Git Surface

- [x] 6.1 Refactor the Git panel into no-worktree, creating, ready, and error states with only the applicable actions; verify component tests for each state and for operation recovery visibility.
- [x] 6.2 Add a searchable branch combobox for the source branch and existing-branch choice over local branches; verify filtering, keyboard selection, and the empty-results message.
- [x] 6.3 Keep attaching an existing worktree as a secondary action in the no-worktree state; verify the existing attach behavior and repository-mismatch rejection still pass.
- [x] 6.4 Show unclaimed checkouts as a compact warning with path, branch, and error whenever present; verify the warning appears without opening a details surface and task deletion leaves the paths on disk.
- [x] 6.5 Keep inline worktree removal confirmation, discard consent, operation retry/return, and recovery information in the simplified layout; verify the existing lifecycle consent and recovery tests.
- [x] 6.6 Move base project, Git root, effective directory, and ownership into a secondary detail surface; verify they are absent from the primary ready state and reachable from the detail control.
- [x] 6.7 Remove the transition-time worktree prompt and verify a board drop or drawer stage change makes no branch/worktree request when the task has no worktree.

## 7. Deterministic LLM Verification

- [x] 7.1 Implement the test-only `kanban-fixture` adapter with `providerInfo`, `listModels`, `prepareCall`, and the streaming protocol; verify the protocol gate from task 1.3 and a provider list in the GUI.
- [x] 7.2 Add scripted fixtures for text, tool calls, errors, cancellation, and delayed chunks; verify each fixture produces the expected terminal outcome without network access.
- [x] 7.3 Select the fixture model per session or preset without changing the global default; verify a normal session still uses its configured model and a fixture session uses the scripted route.
- [x] 7.4 Disable the real-model branches and consent flags in `scripts/verify-native-*`; verify a provider request outside the fixture route fails the test and no helper can opt into a real model.
- [x] 7.5 Add GUI-level deterministic tests for one ordinary chat turn, one board-tool call, one error turn, and one reload; verify they run against the existing DSH GUI with zero provider network calls.
- [x] 7.6 Keep the existing unit/integration fakes and verify they remain independent of the fixture adapter.

## 8. Documentation and Acceptance

- [x] 8.1 Update the README and operations guide for the initial-column New task action, delete-only lifecycle, workspace binding, compact drawer/Git surfaces, native tab titles, and deterministic tests.
- [x] 8.2 Update the verification boundary and scenario evidence to state that real-model calls are not part of acceptance and to reference the fixture adapter.
- [x] 8.3 Run `pnpm run check` and verify typechecks, unit/integration tests, and the build pass with the new schema and client behavior.
- [x] 8.4 Rebuild and reconcile the plugin in the existing DSH GUI at `http://127.0.0.1:51781`; verify drag/reorder, whole-card open, initial-column creation, bulk best-effort deletion, drawer resize/close, Info edit, Git states/search, tab rename, and no workspace picker; capture evidence without starting a replacement server.
- [x] 8.5 Run `openspec validate refine-kanban-ux --strict` and verify the change has no archive/restore references in product specs or code and no real-model acceptance path.
- [x] 8.6 Review the completed tasks against the five capability deltas and record any deliberate deviation for the archive step; do not archive the change until implementation and GUI verification are complete.
