# Design: Fix task deletion ownership and recovery UX

## Context

See [proposal.md](proposal.md) — Why. The current implementation and the observed failure shape the approach:

- `WorktreeCoordinator.shared()` enumerates native sessions whose effective directory is inside the target checkout through `SessionPort.directories()`, then excludes only `task.sessionIds`. The failing session was a continuable subagent child of the task's own conversation, so it was misclassified as foreign.
- Native `SessionSummary` already exposes `parentSessionId` and `origin: 'subagent'`. The failing child header records `parentSession=<task conversation>`, `origin=subagent`, `delegationDepth=1`; its header cwd is the base project and its current working directory is the worktree.
- `native.directories()` already reads `sessionController.list()` plus live sessions and cold projections, but returns only `{ sessionId, directory }`.
- `cleanupWorktreeWorkspace` also uses only `task.sessionIds` to decide whether an owned workspace is unused.
- The sharing check requires the target directory to resolve; an already-absent worktree fails there before `GitAdapter.remove` can treat it as already removed.
- On the client, `BoardView` owns the delete/discard state and renders one dense confirmation modal. Operation status lives inside Conversations and Git only, uses kind-agnostic copy, and the generic modal initially focuses its close button. Destructive failures are not retained in the confirmation surface.

Constraints: no host preflight API, no new dependencies, no persisted-data migration, and native DSH session, archive, Git, and permission behavior remain host-owned. Task conversation tabs remain the retained top-level sessions only.

## Goals / Non-Goals

**Goals:**

- Use native conversation lineage for ownership so only genuinely foreign sessions block destructive worktree cleanup.
- Preserve fail-closed behavior when lineage metadata is missing or a checkout is genuinely shared.
- Make deletion consequences, failure state, and recovery scannable and visible in the drawer.
- Keep the design testable through pure ownership logic, a narrow read-only port, and extracted UI components.

**Non-Goals:**

- Moving, archiving, or otherwise managing subagent child sessions individually.
- Extending task execution guards or client submission guards to subagent descendants.
- Adding a host-side delete preview or preflight API.
- Broadly splitting `WorktreeCoordinator` or `KanbanApp`.
- Changing worktree creation, attachment, branch naming, or permission semantics.
- Redesigning unrelated dialogs or the board layout.

## Decisions

### 1. Compute task ownership from native subagent lineage

The task-owned session set starts from `task.sessionIds` and follows `parentSessionId` edges only when the child session records `origin: 'subagent'`. The result includes direct and nested descendants. Forks (parent link without `origin: 'subagent'`), unrelated sessions, and sessions whose parent chain is missing from the observed lineage are not owned.

A pure `ownedSessionIds(roots, lineage)` helper implements the closure with a `Set` queue, so cycles and duplicate edges terminate safely. It performs no I/O and returns the roots plus owned descendants. The sharing guard and workspace cleanup both use it.

**Why this over alternatives:**

- Workspace membership is imprecise; a user-created session can join the same workspace.
- Activity-only checks are unsafe; a settled session can be resumed later.
- Following every parent link would treat forks as owned, hiding a separate conversation that may still use the checkout.
- Persisting child IDs into `task.sessionIds` would add them as tabs and break the native subagent routing boundary.

### 2. Add a narrow session-topology port

Replace `SessionPort.directories(within?)` with a narrow read-only `SessionTopologyPort`:

```ts
interface SessionTopology {
  related: readonly { sessionId: string; directory: string }[];
  lineage: readonly { sessionId: string; parentSessionId?: string; origin?: 'subagent' }[];
}

interface SessionTopologyPort {
  /** Omit `within` when only lineage is needed. */
  topology(within?: string): Promise<SessionTopology>;
}
```

`SessionPort` extends `SessionTopologyPort`, so existing session operations remain in one injected port while the sharing guard depends only on the narrow read-only contract.

The native adapter builds both values from one `sessionController.list()` read, merges live sessions that are not in the list, and reads `parentSessionId`/`origin` from the summary or the live session header. It keeps the existing conservative "related" classification and current-directory resolution; only lineage is new. When `within` is omitted, `related` is empty and `lineage` is still global.

**Why:** one native read, interface segregation for the guard, and no domain policy leaking into the adapter. Alternatives considered were a second `lineage()` call (extra list read) and attaching lineage only to related sessions (the parent may have moved to base before the second sharing check, so the closure would be incomplete).

### 3. Extract a `WorktreeSharingGuard`

A host class `WorktreeSharingGuard` depends on the worktree store and `SessionTopologyPort` and exposes `assertExclusive(taskId, target)`:

1. Canonicalize the target and return early when the directory is genuinely absent.
2. Reject when another task is associated with the same checkout or a nested path in either direction.
3. Fetch topology for the target and compute the task's owned closure.
4. Reject when a related native session is outside that closure.
5. Emit `SHARED_WORKTREE` with actionable details: `taskId`/`taskTitle`/`path` for another task, or `sessionId`/`path` for a foreign native session.

The guard is injected into `WorktreeCoordinator` (with a default constructed from the same store and topology port) so tests can substitute it. The coordinator's local `shared()` implementation is removed; both pre-switch and pre-removal calls delegate to the guard. The early return for an absent directory allows `GitAdapter.remove` to handle the already-removed checkout.

**Why:** the sharing policy is a distinct responsibility, and the coordinator is already large. Alternatives were leaving `shared()` in place (harder to test in isolation) or duplicating lineage logic in the app.

### 4. Keep subagent lifecycle native-owned

Subagent descendants are owned for sharing and workspace cleanup, but they are not added to `task.sessionIds` or `closedSessionIds`, are not rendered as tabs, and are not passed to `setDirectory` or `archive`. Native `resolveAgent` rejects generic subagent routing, so moving them through the plugin's generic session path is not supported.

The native consequences are accepted explicitly:

- Archiving a parent conversation gates its descendant sessions through native archived-session behavior.
- A subagent child is created with the parent's header cwd (the base project); its working-directory projection may still point at the worktree. If it is resumed after the worktree is removed, native `working-directory.ensure` recovers a missing directory to the header cwd.
- The plugin does not claim to move or archive child sessions. The verification strategy covers the stale projection and native recovery behavior through the manual real-DSH deterministic-subagent e2e.

**Why:** this respects the native subagent ownership boundary and avoids unsupported generic operations. Archiving children directly was rejected because there is no plugin surface to unarchive a child independently; moving them was rejected because native routing does not allow it; refusing deletion was the original bug.

### 5. Reuse ownership in worktree-workspace cleanup

`cleanupWorktreeWorkspace` computes the same owned closure from `topology()` (lineage only) and treats a workspace as still used only when it contains a session outside that closure. A missing lineage entry fails closed and retains the workspace. This keeps a task's own subagent child from preserving an otherwise removable workspace registration.

**Why:** the workspace cleanup already needs the same ownership answer; duplicating a top-level-only check would reintroduce an inconsistency. The extra list read happens only after a completed task deletion.

### 6. Treat an absent worktree directory as already removed

The sharing guard returns early when the canonical target does not exist. The existing `GitAdapter.remove` path already handles the absent case: it returns when the checkout is neither registered nor present, skips the dirty inspection when the directory is absent, rejects a locked registration, and runs `git worktree remove` for an unlocked registration. The supported Git behavior removes the stale registration even when the directory is gone. The change adds a regression check for this path and only adjusts the adapter if the verified Git behavior differs.

**Why:** an absent target cannot be "shared" in a meaningful filesystem sense, and the Git registration is the only remaining cleanup effect. Using `git worktree prune` would also affect unrelated missing worktrees, so the target-specific existing removal path is preferred.

### 7. Use a structured client-only deletion flow

Extract the destructive UI from `board.tsx` into a dedicated client module with presentational dialogs. The board keeps the command runner, selection state, and the decision to open a dialog; the new module owns the confirmation, discard, bulk-confirmation, and bulk-result surfaces. Rename `Destruction` to a clear request/confirmation type as part of the extraction.

The single-task confirmation renders:

- Task title and project.
- A consequence list: card and notes removed (irreversible); the number of conversations archived and that histories remain; worktree path, branch, and whether the checkout is Kanban-created or externally attached; branch kept; no worktree means the project folder is untouched; unclaimed checkouts remain on disk with their paths.
- Notes for a running conversation (deletion waits for idle) and for local changes (a separate discard confirmation follows).
- One red `Delete task` action and a secondary Cancel action. Cancel receives initial focus.
- A busy state that disables closing and the actions while the command runs.
- On failure, the dialog stays open, shows a friendly problem summary with retry/return recovery, and keeps raw code/path/session details behind a disclosure. The existing discard handoff is preserved.

The bulk confirmation uses the same visual language with a compact per-task row (title, project, worktree presence) plus an aggregate consequence summary. The result surface shows the deleted count and each skipped task with a user-facing reason. The discard confirmation remains separate and keeps its required checkbox.

The confirmation is client-only: dirty, shared, or busy conditions are still discovered by the authoritative host command and shown inline. No preview API is added.

**Why:** the user selected a structured client-only dialog. A host preflight would add a second validation path and a new API without removing the need for host validation on confirm.

### 8. Make operation status kind-aware and drawer-wide

A pure `describeOperation(task, operation)` helper maps the operation kind and phase to user-facing copy, progress facts, and available actions:

- Create/attach/return: creation/attachment/return phases and recovery.
- Remove: returning chats, worktree removal, and recovery.
- Delete: returning chats, worktree removal, archiving, and recovery.
- Progress facts include returned/archived counts, whether Git completed, the target path, and the failed phase. Delete never reports "conversations switched" as its primary explanation.

The status renders above the drawer tabs for every operation kind and every section. `OperationStatus` is removed from the Conversations and Git panel bodies to avoid duplicate surfaces. `PendingTransitionStatus` remains and shares the status-stack spacing/styles.

Recovery rules:

- `Retry` is offered when the operation is waiting or failed; the existing discard handoff is reused for `DISCARD_REQUIRED`.
- `Return` is offered only when the host would permit a return. It is hidden or disabled when a delete is in `archiving`, has `archivedSessionIds.length > 0`, or failed in the archiving phase.
- Raw error codes are secondary; the primary copy states what completed and what did not.

**Why:** recovering from a partial operation requires knowing what actually happened, and the current copy is misleading for destructive operations. The alternative was to keep status in Conversations/Git, which hides recovery from Info/Notes users.

### 9. Keep error handling in the active surface

Destructive dialog errors and operation-status errors stay in those surfaces. The board-level `actionError` continues to handle non-destructive failures and does not duplicate a destructive dialog error. A small problem-notice treatment adds a friendly heading and an optional details disclosure while preserving the existing `ErrorNotice` behavior elsewhere. When the host reports a foreign session ID, the client resolves its native title when available; otherwise the ID stays in the details.

**Why:** a failure that closes the dialog and appears elsewhere is the core UX complaint. Keeping the error where the user acted makes recovery discoverable.

### 10. Targeted refactor boundaries

- Add the pure ownership helper and the sharing guard.
- Add the narrow topology port and native topology implementation.
- Extract destructive dialogs and the operation status/descriptor.
- Add optional initial-focus and description support to the generic modal.
- Keep `WorktreeCoordinator`, `KanbanApp`, the command protocol, the persistence schema, and the native execution/archive APIs otherwise intact.
- Update the README and operations guidance for lineage ownership, attached-checkout removal, and failure recovery.

**Why:** the files being changed already carry too many responsibilities, but a broad split would expand the review and regression surface. The selected approach isolates the new policies and surfaces without rewriting the runtime.

## Verification Strategy

The change uses five lanes so cheap checks stay fast and the native assumptions are proved where they can be deterministic.

### 1. Fast module lane

Vitest in the normal suite, with no DSH, real Git, or model calls:

- the pure `ownedSessionIds` helper;
- `WorktreeSharingGuard` with an in-memory store and topology port, plus a temporary path for the absent-target branch;
- the pure `describeOperation` descriptor;
- native topology against a mocked session context;
- `DeleteTaskDialog` and the drawer-wide operation status through React Testing Library.

The session fakes must return global `lineage` even when `topology(within)` filters `related`. Otherwise the post-switch second sharing check is not exercised.

### 2. Host integration lane

Real temporary Git with controlled native ports:

- `WorktreeCoordinator`: an owned child or nested child does not block; a foreign session, fork, missing-parent child, or another task still blocks; the second check after switching uses global lineage; absent and attached checkouts are covered;
- `GitAdapter`: an absent registered checkout is removed without pruning unrelated missing worktrees;
- `KanbanApp`: workspace cleanup distinguishes owned descendants from foreign sessions, and a failed preflight deletion retries without migration;
- the product walkthrough: real app, real Git, archived parent, untouched child, retained branch, and intact base files.

### 3. Client integration lane

React Testing Library in jsdom:

- updated single and bulk confirmations, discard consent, and operation status;
- inline deletion failure, no duplicate board-level error, busy/dismissal behavior, and initial focus;
- Return hidden after archiving and kind/phase-specific copy.

### 4. Browser lane

Focused Playwright specs using the existing browser harness:

- delete-dialog layout, consequence sections, actions, focus, and overflow;
- operation-banner visibility from Info and Notes, recovery actions, and the no-duplicate-status rule.

### 5. Manual real-DSH lane

A plugin-owned `tests/e2e-dsh/kanban-deletion.e2e.template.ts` run by the existing `scripts/e2e-dsh.mjs` lane with `DSH_SNAPSHOT=replay`. It uses `ctx.subagents.startActivation` with a two-turn replay child fixture.

The scenario has a protocol gate first: the parent task conversation must have a live Agent, the real child activation must succeed with `parentSession` and `origin: subagent`, the child's effective directory must be the worktree project subdirectory, and the child must not appear as a task conversation tab. Only then does it delete the task and assert the card, worktree, branch, parent archive, and child archive state. It then prompts the child while the parent is archived to prove the native gate, unarchives the parent, prompts again, and proves the child recovers to the base project directory.

This lane is manual, requires the pinned `dsh-v0.2.1-rc.2` checkout and built DSH artifacts, and does not run in `pnpm test`. It uses no real model. If the protocol gate fails, the scenario stops and is revised before the destructive assertions.

### Evidence and boundaries

- Update `docs/scenario-evidence.md` with the new test and e2e references for every changed scenario.
- Record the actual manual e2e run and its result in `docs/verification-runs.json`; do not claim a pass without a recorded run on the pinned checkout.
- Native DSH archive/history behavior remains host-owned. The manual e2e is the proof for the parent-archive gate and child working-directory recovery; the rest of the suite proves the plugin-owned contracts around them.

## Risks / Trade-offs

- **Child session working directory becomes stale after worktree removal** → Native `working-directory.ensure` restores the header cwd (the base project) when the child is resumed; the parent archive gates execution first. Document this and verify it in the manual real-DSH deterministic-subagent e2e; do not claim the plugin moves children.
- **Lineage metadata can be missing or corrupt** → The closure treats an unknown parent as not owned, so the operation remains blocked rather than deleting a possibly shared checkout. This is intentionally fail-closed.
- **The sharing check remains point-in-time** → The coordinator keeps its second check before Git removal; this is not an atomic lease. Do not claim a guarantee the host cannot provide.
- **Client-only confirmation can discover dirty or shared blockers only after confirm** → The dialog stays open with inline recovery; the host command remains authoritative.
- **Moving operation status changes the drawer layout** → Reuse the existing operation/error styles and the pending-transition spacing; verify every section and both waiting/failed states.
- **Attached-checkout removal remains destructive** → The confirmation explicitly says the attached checkout will be removed and the branch kept; no semantic change is introduced.
- **Bulk selection can be large** → Use a compact per-task row and aggregate consequences, with a scrollable list and concise skip reasons.
- **The broad `SessionPort` remains broad** → The sharing guard depends only on the narrow topology port; a full port split is deferred.
- **Existing client tests assert the old copy and labels** → Update them with the new dialog and status; the verification strategy and tasks cover the new cases.

## Migration Plan

1. No persistence schema change or data migration. Existing boards and operation journals remain readable.
2. Deploy through the existing build/reconcile procedure; do not start a replacement server.
3. Existing failed operations remain recorded. A preflight failure such as the reported JetPack case has no switched chats, archives, or Git effect, so an explicit retry after deployment is safe.
4. If a failed deletion already archived conversations, the UI does not offer Return; retry remains the recovery path.
5. Rollback reverts the code; persisted state remains compatible, and external effects already completed are not undone by the rollback.
6. Update the README and operations documentation in the same change.

## Open Questions

None that change the approach. The native parent-archive gate and child working-directory recovery are covered by the manual real-DSH deterministic-subagent e2e in the verification strategy; they are not open design decisions.
