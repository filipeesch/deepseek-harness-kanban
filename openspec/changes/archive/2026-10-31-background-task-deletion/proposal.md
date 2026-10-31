# Proposal

## Why

Deleting a task blocks the whole UI while the host performs the entire lifecycle: the `task.delete` command is serialized behind the app's global command queue, the client keeps a busy modal open, and bulk deletion awaits one command per task. A slow worktree removal, directory switch, or native archive therefore freezes unrelated board actions for its full duration. The failure mode that follows is also a dead end: when the sharing preflight reports `SHARED_WORKTREE`, retrying repeats the same refusal and the user has no consented way to complete the deletion.

## What Changes

- **Background destructive lifecycle**: `task.delete` and `worktree.remove` admit the request, run the cheap, authoritative preflight synchronously (idle, target, sharing, dirty), persist the operation, and then execute on a global FIFO queue with concurrency 1. The command returns immediately after durable admission; execution no longer holds the command queue.
- Add a persisted operation phase `queued`, distinct from the existing waiting-for-idle phase, so the board can show that a destructive operation is in line.
- Confirmations close when the host accepts the operation. Progress, failures, and retained checkouts are surfaced on the task card, in a persistent board notice with recovery actions, and in the drawer operation status.
- **Consented force removal**: when a destructive operation fails with `SHARED_WORKTREE`, the failure surfaces offer a force action for both delete and remove worktree. The force confirmation lists every affected card and native conversation, explains that the checkout directory will be removed, and requires explicit opt-in. Force bypasses the sharing guard only; it does not bypass host policy, dirty-check consent, or the refusal to remove while another task has an active operation on the same checkout.
- The sharing guard collects all blockers (other tasks and foreign native sessions) into the error details instead of only the first one, and accepts a force option.
- The destructive request journal gains `force`, so retrying or restarting after a forced request keeps the recorded consent.
- After a forced removal, other cards bound to the removed checkout are marked with a persisted worktree error that explains what happened; their effective directory is not silently rewritten.
- Bulk deletion keeps the per-task command loop but reports **queued** and **skipped** tasks instead of claiming completed deletions; skipped tasks remain selected and the board notice tracks the queued operations.
- Targeted refactors: a destructive-operation handler extracted from `WorktreeCoordinator.drive`, the FIFO operation queue, a client destructive-operation controller replacing the duplicated board state and recovery methods, split destructive dialogs with shared consequence and recovery components, and kind-aware card status copy.
- **BREAKING** (behavioral): a confirmed deletion or worktree removal no longer completes before the command returns, and a consented force removal now deletes a shared checkout that the previous documented policy refused to touch. Existing operations, persisted boards, and unforced requests remain readable and compatible.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-lifecycle`: deletion admission/background completion, confirmation closing on acceptance, failure and progress surfaces, force consent, affected bindings, and bulk queued/skipped result.
- `worktree-management`: background worktree-only removal, sharing guard force option and complete blocker reporting, active-operation refusal, and affected binding marking.
- `task-conversations`: queued phase and force recovery in the visible operation status.
- `kanban-board`: card status copy for background deletion, board notice for progress/failure/retained checkouts, and bulk queued/skipped behavior.

## Impact

- Host: `src/host/worktrees.ts`, `src/host/worktree-sharing.ts`, `src/host/app.ts`, new queue/handler modules under `src/host/`, `src/shared/types.ts`, `src/shared/ports.ts` only if the guard contract changes.
- Protocol and persistence: `src/remote.ts` command schema for `force`, `src/domain/schema.ts` and `src/domain/hub-schema.ts` for `queued` and `Worktree.error`, plus the worktree and operation type definitions.
- Client: `src/client/board.tsx` (controller extraction), `src/client/destructive-dialogs.tsx` (split), `src/client/operation-status.tsx`, `src/client/operation-description.ts`, `src/client/task-card.tsx`, `src/client/git.tsx`, and `src/client/styles.ts`.
- Specs and docs: the four capabilities above; `README.md` and `docs/operations.md` because they currently state that shared-target failures are not an instruction to force deletion.
- Verification: fast module and client suites plus the isolated real-composition lane; no new dependency, no DSH change, and no real-model traffic.
