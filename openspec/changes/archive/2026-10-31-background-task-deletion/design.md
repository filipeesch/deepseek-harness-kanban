# Design

## Context

See [proposal.md](proposal.md) — Why. Current constraints that shape the approach:

- `KanbanApp.command()` serializes every command through one `commandTail`, and `WorktreeCoordinator.request()` holds that slot while `drive()` performs the entire lifecycle. Worktree removal, per-conversation directory returns, and native archiving therefore block unrelated commands for their full duration.
- `WorktreeCoordinator.drive()` combines admission, preflight, Git removal, directory switching, archiving, final persistence, and failure recording for five request kinds.
- The operation journal is already durable on the task and `transact` already publishes snapshots through `kanban/follow`; a background execution does not need a new channel or client polling.
- `WorktreeSharingGuard` throws on the first blocker and has no override.
- Native DSH session, archive, Git, and permission behavior remain host-owned; no DSH change and no new dependency are allowed.
- The selected scope keeps creation, attachment, return, and retry of non-destructive operations on their current synchronous path. Only task deletion and worktree-only removal become background operations.
- The user selected force as **remove the shared checkout**, overriding any sharing blocker, with an explicit consent that lists affected parties. Retaining the checkout was explicitly rejected.

## Goals / Non-Goals

**Goals:**

- Return destructive commands before slow cleanup while keeping admission failures synchronous and actionable.
- Execute admitted destructive operations through one host queue with no overlap.
- Preserve the journal across failures, restarts, and plugin shutdown.
- Make progress, failure, retained checkouts, and force recovery visible after the confirmation closes.
- Record the consequences of a forced removal on other affected tasks instead of leaving silent dangling bindings.
- Keep the change testable through narrow collaborators and pure descriptors.

**Non-Goals:**

- Background execution for create, attach, return, or non-destructive retry.
- A new batch command, remote method, event stream, or persisted-data migration.
- Splitting `WorktreeCoordinator` by every request kind, or splitting `KanbanApp` into new services.
- Stopping agents, cancelling native work, or bypassing host filesystem policy during force.
- Replacing the existing bulk preflight (`assertBatchDeletable`) or rewriting the operation descriptor as a discriminated union; both were deliberately left out.
- Changing branch, worktree creation, attachment, or policy semantics.

## Decisions

### 1. Separate destructive admission from destructive execution

`WorktreeCoordinator.request()` keeps its per-task serialization and its authoritative validation, but for `delete` and `remove` it splits into:

- **Admission**: record the request, run `idle()`, verify the target, run the sharing preflight, and inspect local changes. These checks are synchronous and fail with the existing errors (`TASK_BUSY`, `WORKTREE_CHANGED`, `SHARED_WORKTREE`, `DISCARD_REQUIRED`).
- **Execution**: the slow work currently in `drive()` — directory returns, Git removal, native archiving, final record removal, workspace cleanup.

Only after admission does `request()` persist `phase = 'queued'` and enqueue the task. It returns the hub state immediately. `Queued` is never considered a failure; `registerTaskExecutionGuards` continues to treat it as a changing context because only `waiting` and `failed` are exempt.

**Why this over fully asynchronous admission:** the visible skip and consent behavior of bulk deletion depends on `TASK_BUSY` and `DISCARD_REQUIRED` arriving as command errors. Moving those to background failures would invalidate the selected bulk behavior and force a new result protocol. It also keeps the "worktree changed since confirmation" guard synchronous.

**Alternative rejected:** run the whole lifecycle in the background and report all failures asynchronously. It would require a live bulk result surface and change the discard handoff.

### 2. One FIFO queue with concurrency 1

Add a host `OperationQueue` collaborator owned by `WorktreeCoordinator`:

- `enqueue(taskId, operationId)` is idempotent for the same pair.
- Jobs execute in admission order, one at a time, each through the coordinator's existing per-task `serial()` so a task never runs two operations.
- `settle()` drains the queue and waits for the running job; `dispose()` stops accepting new jobs and prevents not-yet-started jobs from running.
- A job calls the full execution path; the execution re-runs idleness and sharing rechecks so a checkout that became busy or shared while queued fails or returns to `waiting` instead of proceeding.

**Why concurrency 1:** removal and archiving touch Git worktree metadata, native session state, and workspace registration. Sequential execution preserves the current bulk safety and avoids concurrent `git worktree remove` calls in one repository. The queue does not sit in `commandTail`, so it does not block commands.

**Alternative rejected:** per-task parallel execution. It is faster but can race Git metadata and native archive operations.

### 3. Persist a distinct `queued` phase

Add `'queued'` to the operation phase enum. `waiting` keeps its existing meaning (waiting for every conversation to become idle), so reusing it would produce false status copy and would make resume logic ambiguous.

`queued` is persisted after admission and before enqueue. `resumePending()` routes any pending destructive operation through the queue instead of driving all tasks concurrently, preserving the one-at-a-time guarantee after restart. A queued operation that cannot run because the plugin is shutting down remains journaled and is resumed on the next start.

### 4. Extract a destructive-operation handler from `drive()`

Move the delete/remove execution path into a dedicated host module with two explicit steps:

- `prepare`: the idleness, target, sharing, local-change, and active-operation checks used by both admission and execution recheck.
- `execute`: directory returns, checkout removal, native archiving, final persistence, affected-binding marking, and workspace cleanup.

`drive()` keeps the create/attach/return path and delegates destructive requests to the handler. The handler receives the coordinator's store, session port, Git port, sharing guard, clock/id sources, and a failure recorder through constructor injection; it does not own scheduling. This keeps the new behavior out of an already large orchestrator and leaves the non-destructive paths untouched.

**Alternative rejected:** split the whole coordinator by request kind. It expands the regression surface without benefiting this change.

### 5. Persist force as part of the destructive request

`OperationRequest` for `delete` and `remove` gains `force?: boolean`. The existing request-upgrade path merges `force` the same way it already merges `discardChanges`, so:

- Force reuses the recorded failed operation and its journal rather than creating a new intent.
- A retry after restart keeps the recorded force consent.
- `sameRequest` remains kind-compatible for destructive upgrades.

Force bypasses only `WorktreeSharingGuard`. The preflight still enforces idleness, target stability, local-change consent, and host policy. A force request also performs a new check: it is refused with a recoverable problem when another task has a non-failed context operation on the same checkout. That check is not part of the sharing guard and is never skipped by force.

**Why record force instead of treating it as a transient client flag:** a background execution can fail or restart after the user consented. Losing the consent would silently downgrade the operation back to the refused state.

### 6. Sharing guard reports every blocker and accepts force

`assertExclusive(taskId, target, options)` collects all blockers before throwing:

- every other task whose worktree path contains or is contained by the target;
- every native session outside the task's lineage whose effective directory is inside the target.

The `SHARED_WORKTREE` problem keeps its existing top-level detail fields for compatibility and adds `blockers` entries shaped as `{ kind: 'task', taskId, title, path }` or `{ kind: 'session', sessionId, path }`. The client resolves session titles through the existing title provider. With `force`, the guard returns without enumerating blockers; the consent is built from the failed operation that already recorded them.

**Why collect all:** a force consent that lists only the first blocker hides the real blast radius.

### 7. Record affected bindings instead of rewriting contexts

`Worktree` gains an optional persisted `error: Problem`. After a forced removal succeeds, the final transaction marks every other task whose binding canonicalizes to the removed checkout:

- `worktree.status = 'error'`;
- `worktree.error = { code: 'WORKTREE_REMOVED', ... }` identifying the task that removed it and the path;
- `effectiveCwd` is not changed.

The Git section already renders an error state; it will render the recorded reason. Leaving `effectiveCwd` untouched is deliberate: silently returning another task's conversations to base would hide a context change the user did not approve. Its next execution fails visibly through the existing context admission, and the Git surface explains why.

**Alternative rejected:** clearing the other binding and returning it to base automatically. It mutates another task's execution context as a side effect of a different task's deletion.

### 8. Client destructive-operation controller and close-on-acceptance

Replace the board's `destruction`, `destructionStarted`, `destructionPending`, `destructionError`, `discard`, and the three near-identical `confirm/retry/returnDestruction` methods with a controller that owns a small state machine:

```
idle -> confirming -> submitting -> accepted (closed)
                                 -> failed (confirmation stays or reopens)
                                 -> force-consent -> submitting
                                 -> discard-consent -> submitting
```

Acceptance is detected from the command response: the task has an operation, or the task is already gone. On acceptance the controller closes the confirmation and clears the affected selection. On a pre-admission rejection it keeps the confirmation and its error. On a later failure, the board notice and drawer status expose the failed operation, and reopening the dialog presents the recorded failure.

Bulk keeps the per-task command loop. Each accepted task counts as queued; each rejection counts as skipped with its message. Accepted tasks leave the selection, skipped tasks remain selected, and the result surface reports queued versus skipped. The board notice tracks the queued operations.

**Why a controller instead of more component state:** the accepted, failed, force, and discard transitions are the same for delete and remove and are currently duplicated three times.

### 9. Shared destructive surfaces

Extract presentational pieces:

- `DestructiveConsequences` for the card/notes/conversation/worktree summary shared by delete and remove.
- `OperationRecoveryActions` for retry, return, and force, shared by the confirmation, the drawer status, and the board notice.
- Semantic delete and remove dialog entry points over one shared destructive implementation, plus separate force, bulk-confirmation, and bulk-result dialogs and a shared `DestructiveConsequences` component.
- `DestructiveOperationsNotice` on the active board, derived from task operations and worktree errors. It groups queued/running operations, failed operations with recovery actions, and retained plain-checkout paths only after the deletion actually completes. Retained-path reports are dismissible.
- The Git error state exposes the recorded reason and a removal action so an externally removed binding can be cleared before creating or attaching another checkout.

The force dialog is opened by the board controller from any force entry point so the consent, checkbox, and affected-party list have one implementation. It renders task titles from state and conversation titles through the existing provider, falling back to the session id.

The card status uses the operation descriptor's kind-aware language: "Queued to delete", "Deleting…", "Deletion needs attention", and the equivalent removal copy. The raw phase token is no longer the label.

### 10. Protocol, compatibility, and documentation

- `CommandSchema` adds optional `force` to `task.delete` and `worktree.remove`.
- `ContextOperation` phase enums in both persisted schemas accept `queued`.
- `Worktree` schemas accept optional `error`.
- No migration is required: existing records omit the optional fields, and previously failed operations remain readable. A previously failed `SHARED_WORKTREE` operation recorded before blocker collection can still offer force using its existing detail fields; the consent lists what it has.
- The documented policy that shared-target failures must not be forced is replaced by the consented exception. `README.md` and `docs/operations.md` are updated in the same change.

## Risks / Trade-offs

- **Force removes another conversation's working directory.** → The consent lists every affected task and conversation, states that the directory is removed, requires explicit opt-in, and refuses force while another task has an active operation. Native recovery to the header cwd is documented but not guaranteed mid-turn.
- **A queued operation can become invalid before it runs** (conversations become busy or a checkout becomes shared). → Execution re-runs the checks; it returns to `waiting` or records a new failure rather than proceeding on stale consent.
- **Force could bypass too much.** → Force is scoped to the sharing guard; policy, dirty consent, target stability, idleness, and the active-operation refusal still apply.
- **The queue hides completions that used to be synchronous.** → The card, notice, and drawer subscribe to the same published state; completion and failure are pushed through the existing stream. `settle()` keeps shutdown and tests deterministic.
- **Bulk no longer reports completed deletions immediately.** → The result reports queued versus skipped and the notice continues to track each operation; no message claims completion before it happens.
- **Affected bindings become error states the other task must recover from.** → The persisted problem names the forced removal and the other task's Git surface explains it; the user can create or attach a checkout to recover.
- **Sequential execution delays large bulk deletes.** → The board is responsive and progress is visible; sequential execution protects Git and native state.

## Migration Plan

1. Ship the schema additions (optional `Worktree.error`, `queued` phase, optional `force`) before relying on them; older records remain valid and need no rewrite.
2. Roll out host behavior first, then the client surfaces. A client that predates the change still receives queued operation snapshots and can render existing operation status; it simply does not show the new notice or force action.
3. Rollback is code-only. Queued operations left by a rollback are still journaled operations with a phase the older code does not know; if a rollback must be sustained, the operations need to be resumed by a build that understands `queued`. Avoid rolling back while destructive operations are queued.
4. Update `README.md` and `docs/operations.md` in the same change so the documented force policy matches the shipped behavior.

## Open Questions

None that change the specs, the approach, or the task breakdown.
