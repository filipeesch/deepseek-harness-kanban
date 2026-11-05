# Proposal

## Why

Deleting a card still freezes the board even though the cleanup already runs in the background. `task.delete` performs every authoritative preflight check — native idleness, target canonicalization, Git worktree inspection, sharing guard — inside the host's single serialized command lane, so unrelated board commands wait behind it; bulk deletion then keeps a blocking modal open while it awaits one such admission per selected card, and pays for the Git inspection twice per task. The perceived freeze is therefore in admission, not in execution.

## What Changes

- **Admission becomes an in-memory decision.** `task.delete` and `worktree.remove` accept the request after validating only persisted state: the task exists, its recorded worktree path still matches the confirmed target, no other operation holds the task, and no pending transition is mid-delivery. The command records the operation, marks it `queued`, and returns without touching Git, native sessions, or the filesystem.
- **Preflight moves into the destructive queue.** Each lane job first enters the existing `preflight` phase and runs the authoritative checks — conversation idleness, canonical target stability, checkout sharing, local-change detection — then continues into the existing execution phases. A failure at any point is recorded as a failed operation with its failing phase, exactly like a post-admission failure today.
- **Preflight failures become asynchronous, recoverable states.** A busy conversation, a shared checkout, a dirty worktree, or a target that changed after confirmation no longer rejects the command. The deleting card, the board destructive-operation notice, and the drawer present the recorded failure, and the existing retry, force, and return actions — including the separate discard consent reached through retry — recover it.
- **Destructive execution runs one operation per repository.** The host queue replaces its single global lane with one lane per Git root; projects without a Git root use their project identity as the lane. At most one destructive operation runs per lane, while different repositories may proceed concurrently.
- **Bulk deletion becomes a non-blocking fan-out.** The confirmation closes on accept, accepted cards leave the selection and selection mode exits immediately, and no result dialog is shown. Admission rejections that are still synchronous (the task disappeared, or another operation holds it) surface as a board error, and later failures surface in the destructive-operation notice.
- **Remove the now-redundant bulk preflight.** `assertBatchDeletable` and the `requireIdle` command flag exist only to reject bulk admission synchronously with the same checks the queue now owns; both are removed. **BREAKING** (protocol): `task.delete` no longer accepts `requireIdle`.
- **BREAKING** (behavioral): a confirmed deletion or worktree removal that previously returned an error such as `TASK_BUSY`, `SHARED_WORKTREE`, `DISCARD_REQUIRED`, or `WORKTREE_CHANGED` before recording anything now records the operation and fails asynchronously with the same problem.
- **Targeted refactors.** `DestructiveOperationHandler` loses its `admissionOnly` flag and splits admission from execution around an extracted, shared `OperationJournal`; `WorktreeCoordinator` delegates its journal operations to that journal; the queue becomes a per-repository queue; the board's bulk fan-out moves into a `useBatchDeletion` hook next to the existing `useDestructiveOperations` and `useMoveRequest`.
- **New real-composition lane.** A dedicated `background-delete` DSH lane proves that the board stays usable while an admitted deletion is still in its queue.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-lifecycle`: admission is an in-memory decision, the authoritative preflight runs inside the destructive queue, destructive preflight failures are recoverable asynchronous states, destructive execution is serialized per repository instead of globally, the discard consent is reached through recovery, and bulk deletion no longer reports skips at admission.
- `kanban-board`: bulk deletion closes its confirmation on accept, clears the selection immediately, and reports no accepted/skipped result; the card status strip names the checking state during preflight.
- `worktree-management`: worktree-only removal is admitted from persisted state and its preflight runs inside the destructive queue lane.

## Impact

- Host: `src/host/app.ts` (delete/remove command cases), `src/host/worktrees.ts` (admission split, journal delegation, lane-aware resume), new journal, admission, and execution modules, and `src/host/operation-queue.ts` (per-repository lanes).
- Protocol and types: `src/shared/types.ts` and `src/remote.ts` drop `requireIdle`; no persisted schema changes, because `queued` and `preflight` already exist and no field is added.
- Client: `src/client/board.tsx`, new `useBatchDeletion`, and `src/client/bulk-delete-dialogs.tsx` loses the result and progress surfaces; no other surface or command is added.
- Tests and docs: host and client suites, browser harness, a new `tests/e2e-dsh/kanban-background-delete.e2e.template.ts` registered in `scripts/e2e-dsh.mjs`, and `README.md` plus `docs/operations.md` for the per-repository queue and the bulk behavior.
- Verification: the fast gates plus the isolated real-composition lane; no dependency added, no DSH change, and no real-model traffic.
