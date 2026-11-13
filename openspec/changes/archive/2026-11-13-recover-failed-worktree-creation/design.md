# Design

## Context

See proposal.md - Why for the motivation. The constraints that shape the approach:

- The operation journal is the only durable record of a context operation. It already persists an intent (`createAttempt`) before Git runs, but the recursive recovery reads only the directory's existence.
- Every Git invocation funnels through one executor method (`src/host/native.ts`), which applies one module-level deadline to all of them.
- The reader conflates identity with registration: `inspect` throws for a checkout that is not registered, so a half-written checkout is an error rather than a state.
- The product never deletes a directory itself. Removal is delegated to `git worktree remove`, which refuses a path that is not a registered working tree.
- Measured on Git 2.50.1: `worktree add` creates every missing parent, removing a worktree removes no parent, a non-empty destination is refused even with `-f`, a stale registration blocks the same path, and `worktree remove <path>` clears one stale registration without `--force` or global prune.
- Paths, hashes, and error codes are user-visible contract; `KanbanError` details are the fact channel the client renders.

## Goals / Non-Goals

**Goals:**

- Make every failed creation answer one question before it acts: what does the destination actually look like, and is that state provable from the attempt?
- Give the recovery a terminating route for every state the probe can report.
- Keep every removal scoped to what the attempt proves the host created.
- Keep the coordinator an orchestrator by moving classification, probing, and the recovery route into collaborators.

**Non-Goals:**

- No branch deletion. A branch the host created and never used stays, and is reused instead.
- No repository-wide `git worktree prune`.
- No new capability. The behavior belongs to `worktree-management` and `task-conversations`.
- No change to how a successful creation, attachment, removal, or deletion behaves.
- No recovery of a checkout the task adopted through explicit attach.

## Decisions

### D1. A creation attempt is a state, not a boolean

The attempt's recovery is decided from two axes instead of one: the directory (`absent`, `empty`, `present`) and the registration (`none`, `orphan`, `registered`). Both are recorded when the creation fails and revalidated before any action decides.

*Alternatives considered:* keeping the existence check and adding a special case for "registered" would still leave the partial checkout unnamed, which is the defect. Probing live on every snapshot would put filesystem reads on the board's read path.

The persisted shape extends the existing attempt with optional fields, so an older journal remains valid: `sourceCommit`, and `observed: { directory, registration, at }`.

### D2. Recovery verbs are derived from the state

| State | Route |
| --- | --- |
| registered | inspect and adopt, as today |
| absent + none | disarm the attempt; Retry, Return, and Delete work |
| absent + orphan | clear the registration, then treat as absent + none |
| empty + none | retry creates the checkout directly |
| present + none or orphan | discard with consent, then retry in the same action |

*Alternatives considered:* a single "retry harder" verb cannot converge, because the states need different effects, and two of them are destructive.

### D3. Discard is one accepted action: consent, clean, retry

The confirmation names the canonical destination, the empty parent candidates, and the reused branch. The action then removes the destination (only when it is not a registered worktree), clears the exact orphan registration, removes empty parents from the deepest upward but never the configured base, and retries the same creation.

The empty-parent walk stops *before* the configured base because the base is the user's setting, not an artifact: in the reported incident the destination's parent is the base itself.

*Alternatives considered:* two actions (discard, then a separate Retry) add a state where the task has no worktree and no operation while the user decides; removing only one parent level leaves a chain behind. A separate cleanup without the retry would make the user repeat a decision they just confirmed.

### D4. Orphan registration cleanup is targeted and automatic

Removing a registration whose directory is gone destroys no working tree and no branch, so it needs no consent. It targets the exact recorded destination and never runs a repository-wide prune, which would touch registrations the host does not own.

*Alternatives considered:* `git worktree prune --expire=now` is what Git's own message suggests, but it is repository-global. `add -f` clears the stale entry as a side effect, but it also overrides the "checked out by another working tree" safeguard, so it is not used.

### D5. Branch reuse is proven by the recorded commit

A retry reuses the attempt's branch only when its tip equals the source commit the attempt resolved before invoking Git. A migrated attempt without that field resolves the source once from its recorded source branch, otherwise the configured default branch, otherwise HEAD. When the attempt was released for leaving no effect, the same comparison uses the commit the retry resolves, because the released record is gone. A mismatched tip is refused with a distinct error naming the branch and the expected commit; nothing is moved, reset, or deleted.

*Alternatives considered:* comparing against the current source tip would let a moved source silently change the content under an existing branch name. Deletion with a tip proof would still delete a branch the user may have created at the same commit.

### D6. Deadline classes, plus per-operation cancellation

Git commands are grouped by what they touch. Ref reads keep the short deadline; commands that create, remove, or read a checkout's working tree get their own class, because their cost follows the repository size, not the command kind. Cancellation aborts a per-operation controller, is classified by the existing `OPERATION_CANCELLED` path, and lands on the same recovery surface as any other failure.

*Alternatives considered:* a single longer constant keeps the failure mode for a larger repository or a slower volume. A configurable per-Hub setting adds a schema and a settings surface for a value most users should never need. No deadline at all cannot bound a hung command.

A cancelled command is classified by the signal that fired, which `src/host/host-command.ts` already distinguishes from the deadline.

### D7. State facts are persisted at failure and revalidated lazily

The state is known when the failure is classified, so it is recorded there. Every action re-reads it before deciding, and the fresh read is written back. The panel therefore shows the last observed state, and a manual directory change outside the plugin refreshes on the next command rather than on its own.

*Alternatives considered:* a live probe on snapshot assembly adds a Git call to every board read that has a failed creation, and a dedicated read command adds a round trip and a loading state to the drawer.

### D8. Four collaborators, each with one reason to change

| Collaborator | Owns |
| --- | --- |
| `CreateAttempt` | predicates over the persisted attempt: provable, commit-proven, retry mode |
| `CheckoutStateProbe` | the two-axis state, without throwing for a checkout that is not ours |
| `CreateRecovery` | choosing and executing the authorized route |
| `CreateFailureClassifier` | whether a failure kept an attempt and which phase owns it |

This also removes the argument sniffing in `beforeCreateFailure`, the dense retention expression in `drive`, the duplicated `RECOVERY_PENDING` block, the five copies of "does this path exist", and the proof/inspect/adopt sequence that `drive` and `returnToBase` each implement.

*Alternatives considered:* keeping the logic inline adds a fifth branch to a method that already has four responsibilities; splitting by operation kind as well would widen a change that is already cross-cutting.

### D9. The client contract grows two actions and one label

`OperationDescription` gains `discard` and `cancel`; the shared recovery-action descriptors and the board notice reuse them. The last-action failure is rendered as not saved, next to but distinct from the recorded operation failure.

*Alternatives considered:* persisting the last action's failure would make it survive a reload but needs a schema field, a clearing rule, and its own tests, without changing what the user must do.

### D10. Persistence stays backward readable, forward breaking

New attempt fields are optional. An older journal is read and healed. A newer Hub is rejected by an older build because the operation schema is strict; this is the project's existing downgrade trade-off and is documented rather than migrated.

## Risks / Trade-offs

- **The plugin now deletes a directory without Git** -> the target must be the canonical attempt path, must fail `assertWorktreeTarget`, must not be a registered worktree, and must be refused when it is the base, the Git root, the project path, or an ancestor of any of them. Removal revalidates immediately before acting.
- **A user's empty directory could be removed as a "parent"** -> the walk stops before the configured base and only removes directories that are empty, deepest first. The confirmation lists the candidates before anything runs.
- **Downgrade rejects a newer Hub** -> the fields appear only on a failed creation classified by this release; the operations guide records the downgrade consequence.
- **Cancellation can race a command that is between phases** -> the per-operation signal is checked at each pass boundary, so a cancel either aborts the running command or stops the next step; both land on the same recorded failure.
- **The state can be stale** -> every action revalidates, so a stale fact can mislead the panel but cannot mislead an effect.
- **Deadline values are still chosen numbers** -> they live in one table with a comment naming the repository size they were calibrated against, and the cancellation action is the escape hatch.
- **A killed `worktree add` is hard to reproduce in tests** -> the tests inject the post-kill filesystem and registration state through the executor and real Git fixtures instead of killing a process.

## Migration Plan

1. Ship the optional attempt fields and the new commands. No Hub migration runs; a stored journal without the fields is read and re-resolved once.
2. A card already stuck before this release heals on its next recovery action: an absent destination disarms the attempt, and a partial checkout offers the discard.
3. The operations guide is updated in the same change so the documented recovery matches the shipped surface.
4. Rollback: an older build refuses a Hub whose operation record carries the new fields. Retry or return the affected task to base before downgrading.
