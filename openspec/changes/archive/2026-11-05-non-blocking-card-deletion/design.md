# Design

## Context

See [proposal.md](proposal.md) — Why. The constraints that shape this approach:

- Destructive execution already leaves the interactive path: `WorktreeCoordinator` persists the operation, marks it `queued`, and hands it to `OperationQueue` ([`src/host/operation-queue.ts`](../../../src/host/operation-queue.ts)), which runs one job at a time. Only admission still holds the lane.
- `KanbanApp.command()` serializes every command through one `commandTail` ([`src/host/app.ts:299`](../../../src/host/app.ts#L299), [:321](../../../src/host/app.ts#L321)). While `admitAndQueue` runs, no other command is served.
- `admitAndQueue` calls `drive(taskId, { admissionOnly: true })` ([`src/host/worktrees.ts:181`](../../../src/host/worktrees.ts#L181)), which performs `sessions.isIdle`, `git.projectDirectory`, `WorktreeSharingGuard.assertExclusive` (native topology plus one `realpath` per related session), and `git.inspect` — about six Git spawns plus sandbox policy evaluation ([`src/host/git.ts:110`](../../../src/host/git.ts#L110)).
- `WorktreeCoordinator.request()` additionally canonicalizes the target in `start()` and again in `confirmationMatches()`, both inside the command.
- Bulk commands carry `requireIdle`, which makes the host repeat idleness and `git.inspect` in `assertBatchDeletable` ([`src/host/app.ts:360`](../../../src/host/app.ts#L360)) before admission repeats them. The client awaits one command per card while a modal `aria-modal` dialog is open.
- The operation journal is already durable on the task, `transact` already publishes through `kanban/follow`, and the phase enum already contains `queued` and `preflight`. No new channel, field, or phase is required.
- Waiting operations are event-driven, not polled: `PendingWorkRunner` calls `worktrees.resumePending()` on native activity and on hub changes, and `resumePending()` re-enqueues every non-failed destructive operation.
- Constraints: no new dependency, no DSH change, and no persisted-data migration.

## Goals / Non-Goals

**Goals:**

- Make destructive admission a decision over persisted state with no Git, native-session, or filesystem IO.
- Move the authoritative preflight into the queue lane without changing its checks, error codes, or failure journaling.
- Serialize destructive execution per repository while allowing independent repositories to make progress.
- Make bulk deletion a non-blocking fan-out with no result dialog.
- Leave admission, preflight, and execution as narrow, injected collaborators with a shared journal.

**Non-Goals:**

- A batch command or any other protocol addition.
- Extracting the `KanbanApp` command switch into per-domain handlers.
- Trimming the fixed per-command cost (`dispatchPending` and the full snapshot), which is orthogonal to this change.
- Splitting the non-destructive create/attach/return path.
- Parallel execution inside one repository, or any change to sandbox, policy, or Git semantics.

## Decisions

### 1. Admission is a pure predicate over persisted state, and the journal is written before any IO

Replace the coordinator's `request()` branch for `delete` and `remove` with an admission collaborator that:

1. Locates the task and project.
2. Rejects unless `(task.worktree?.path ?? null) === expectedWorktreePath`, the task has no active context operation (a `failed` operation of the same kind is the only exception, so a retry upgrades the existing journal), and its pending transition, if any, is not mid-delivery.
3. Records the operation with `phase: 'queued'`, the persisted target path as `targetPath`, and the confirmed request — without `canonicalPath`.
4. Enqueues the lane job and returns.

`WorktreeCoordinator.start()` and `confirmationMatches()` keep canonicalization for create/attach, where the target is user input. For `delete` and `remove` they compare and store the persisted binding, and canonicalization moves into the lane preflight, which already throws `WORKTREE_CHANGED` when the confirmed target no longer resolves to the binding. A new confirmation may not substitute the target of an already recorded destructive operation: it is rejected with `OPERATION_TARGET_CHANGED` and the original journal, target, and failure stay intact, so recovery remains explicit.

**Why:** the rejected checks are exactly the ones that cannot be decided from the persisted board, and every one of them is already re-run inside `drive()` before cleanup. Admission no longer duplicates them.

**Alternatives rejected:** keeping the synchronous preflight (produces the freeze this change removes); fully optimistic admission without a target comparison (would allow deleting a task whose binding changed after confirmation); keeping the checks synchronous only for dirty worktrees (requires `git.inspect`, which is the dominant cost).

### 2. The queue job owns the preflight and reuses the existing phases

`drive()` already starts with the authoritative preflight: it sets `phase: 'preflight'`, runs `idle()`, validates target stability, runs `assertPreRemoval()` (sharing guard, absent-directory tolerance, dirty detection), and only then performs the cleanup. This change deletes the `admissionOnly` flag so the flag cannot exist without the work, and splits the former handler into:

- `DestructiveAdmission` — the predicate in decision 1, the journal write, and the enqueue.
- `DestructiveExecution` — preflight plus cleanup, with the Git port, session port, sharing guard, journal, and clock injected. It never schedules itself.

No new phase is added: `queued` covers the wait, `preflight` covers the checks, and the existing execution phases are unchanged. A failure keeps today's `phase: 'failed'` plus `error.details.failedPhase`, so the card, drawer, and notice copy and the force/retry/return recovery paths keep working unchanged. A rejection raised by the persisted-state admission of an *existing* operation is recorded the same way; leaving the journal in `waiting` would hide the recovery actions and block every other context operation. Because admission can now accept a task that is busy or dirty, a queued `DISCARD_REQUIRED` or `SHARED_WORKTREE` becomes a recorded failure whose retry is the existing recovery route; the retry re-runs the preflight and, for local changes, reaches the separate discard consent through `adviseCommandFailure` ([`src/client/command-failure.ts:47`](../../../src/client/command-failure.ts#L47)).

**Why:** the queue job must be able to wait and re-check; reusing the existing preflight keeps error codes, journal shape, and recovery surfaces identical.

**Alternative rejected:** a new `checking` phase. `preflight` already exists with copy and is already used by the non-destructive path; adding a second name for the same state would change the persisted enum without changing behavior.

### 3. One queue lane per repository

`OperationQueue` becomes lane-aware:

```
enqueue({ lane, taskId, operationId, run })
  Map<lane, { pending: Job[], running?: Promise<void> }>
  idempotency key stays taskId + ':' + operationId (global)
  settle()  -> every lane idle and no running job
  dispose() -> clears every lane and refuses new jobs
```

The lane key is resolved once, at admission, and stored only in memory for the job — it is derivable at resume from the same task: `project.gitRootPath` for a Git project, `'project:' + project.id` otherwise. `resumePending()` groups pending destructive operations by lane, orders each lane by `operation.createdAt`, and enqueues per lane instead of globally.

**Why:** Git worktree metadata, `git worktree remove`, and the repository lock are per repository, while native archiving and workspace deletion act on distinct sessions and workspaces. Per-repository lanes keep the safety property that mattered (never two `git worktree remove` calls in one repository) and remove the artificial wait between unrelated repositories.

**Alternatives rejected:** a single global lane (keeps a large multi-repository bulk waiting on unrelated work); one lane per task (races Git metadata); concurrency limits per lane greater than one (no benefit inside a repository).

### 4. Waiting stays event-driven

A lane job that finds a busy conversation records `phase: 'waiting'` and returns without rescheduling, exactly as today; the next native activity event reaches `resumePending()` through `PendingWorkRunner` and re-enqueues the operation. Startup and hub-change dispatch also re-enqueue. No timer, polling loop, or new wake-up channel is introduced.

**Risk noted:** a conversation that becomes idle without a native event would leave the operation waiting. This is the current behavior for background execution; the change does not widen it, and startup plus activity events cover the documented paths.

### 5. Bulk deletion becomes a client fan-out in a dedicated hook

`useBatchDeletion` owns the batch state next to the existing `useDestructiveOperations` and `useMoveRequest`:

```
confirm(tasks)  -> close the confirmation synchronously
                -> remove accepted ids from the selection, leave selection mode
                -> fire one task.delete per task, without awaiting before closing
                -> admission rejections are collected as a board error naming the task
```

The hook receives `run` and the current tasks, mirroring the destructive controller, so acceptance is still decided from the command result. `BulkDeleteDialog` keeps the confirmation and loses `progress`; `BulkResultDialog`, `BulkResult`, and `BulkProgress` are deleted from [`src/client/bulk-delete-dialogs.tsx`](../../../src/client/bulk-delete-dialogs.tsx). Selection state stays where it is today.

**Why a hook:** the fan-out needs its own pending/rejection state and must not add another block of asynchronous state to `board.tsx`, which already carries selection, drawer, drag, and storage concerns. The project already uses this exact pattern.

**Alternative rejected:** sequential awaiting with a progress modal — the current behavior, which keeps the board blocked for the whole batch.

### 6. Remove `requireIdle` and `assertBatchDeletable`

With admission decided from persisted state, a synchronous bulk skip requires the same Git and session reads the queue now owns. The flag, the client argument, and the method are removed; the `task.delete` schema keeps every other field. No command or persisted record carries `requireIdle` across a restart.

**Alternative rejected:** keeping the flag and ignoring it — a dead protocol surface that would invite the freeze back.

### 7. Extract a shared `OperationJournal`

`update()` is duplicated verbatim between `WorktreeCoordinator` and `DestructiveOperationHandler`, each with its own `requireTask` and `OPERATION_CHANGED` guard. The extract owns `read`, `update(taskId, operationId, change)`, `requireTask`, and the operation-changed invariant, and is injected into the coordinator, the admission, and the execution collaborators. The coordinator keeps ownership of the hub store and of failure recording; only journal mechanics move.

**Alternative rejected:** splitting the whole coordinator by request kind, which expands the regression surface without serving this change.

### 8. Destructive status copy names the checking state

The card status label and the notice line gain `preflight` for destructive operations (`Checking…`), and `describeOperation` already explains that phase as checking the task context and permissions. Both live in small pure functions (`cardStatusEntries`, `stateLabel`, `describeOperation`) that are covered by existing client tests, so the spec's new checking state is a mapping addition, not a new surface.

### 9. A dedicated real-composition lane proves the board stays free

A new `background-delete` lane at `tests/e2e-dsh/kanban-background-delete.e2e.template.ts`, registered in the `scenarioTemplates` map and the usage line of [`scripts/e2e-dsh.mjs`](../../../scripts/e2e-dsh.mjs), runs under `launchWebScaffold` with `DSH_SNAPSHOT=replay`. Determinism comes from the harness, not from sleeps: the test wraps `scaffold.ctx.workspaceRegistry.archiveSession` with a gate it releases explicitly.

```
delete confirmed -> dialog closed, card queued
                  (native archive is gated, so the operation cannot finish)
                  -> create a second task from the board
                  -> open its drawer
                  -> release the gate
                  -> deleted card is gone
```

The gate makes "the board served commands while a deletion was queued" a deterministic assertion rather than a timing race, and no model call is involved.

## Risks / Trade-offs

- **Accepting work that is certain to fail later** → the task can be busy, dirty, or shared at admission. The failure is a recorded operation with the existing recovery actions, and bulk now requires one discard consent per dirty card instead of skipping them up front. This is the accepted cost of a free board.
- **A changed target between confirmation and execution** → the lane preflight canonicalizes the confirmed path against the recorded binding and records `WORKTREE_CHANGED`; the wrong checkout is never removed.
- **Fan-out cost is N commands with N snapshots** → the hook fires them without awaiting before closing the dialog. The cost is measurable and bounded by the selection size; if it proves material, a batch admission command is a follow-up change, not something this change introduces quietly.
- **Cross-repository concurrency touches native archiving and workspace deletion concurrently** → lanes are per repository, hub writes stay serialized by the repository store, and archiving and workspace deletion act on distinct sessions and workspaces. A host test with two repositories must assert both overlap and independence.
- **Waiting operations depend on activity events** → unchanged from today; startup and hub-change dispatch also resume, and a host test covers resume after the conversation turns idle.
- **Protocol break on `requireIdle`** → client and host ship in one bundle, and no persisted record contains the flag, so there is no migration.

## Migration Plan

1. Ship the host change and the client change together; both are bundled in one plugin release.
2. Existing journals need no rewrite: `queued`, `waiting`, and in-progress phases keep their meaning, and `resumePending()` derives the lane from the task, so operations recorded by an older build resume correctly.
3. Rollback is code-only. A rolled-back build resumes the same journals with a single global lane; no persisted value becomes unreadable.
4. Update `README.md` and `docs/operations.md` in the same change, because they currently describe a single serial destructive queue and a bulk result with skipped tasks.

## Open Questions

- Whether the bulk fan-out's snapshot cost is material enough to justify a batch admission command. Measured during implementation: a host test admits ten selected deletions concurrently while the repository lane is busy in 35.6 ms total, roughly 3.6 ms per command including its dispatch and snapshot, so the fan-out is not material. A batch admission command remains a possible follow-up for a much larger selection, not a requirement of this change.
