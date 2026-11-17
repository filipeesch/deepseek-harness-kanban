# Design

## Context

See `proposal.md` for the motivation. The current state that shapes the approach:

- The move pipeline runs the whole preparation before applying the move: `useBoardMoves.beforeApply` awaits `ExecutionPreparationController.open`, which loads worktree defaults, calls `worktree.create`, then `conversation.create`, optionally presents DSH's native model selector, and only then resolves, so `useMoveRequest.apply` issues `task.move`. The provisioning phase of that dialog is a `busy` modal, so the board is unusable while Git runs.
- `WorktreeCoordinator.request` drives creation synchronously inside the command: creation is not admissible to the background queue, and `app.command` serializes every command behind one global lane (`app.serial`). Only `delete` and `remove` pass `background: true`, are admitted by `DestructiveAdmission`, and run on the per-repository `OperationQueue` against the journaled `ContextOperation`, publishing progress through the snapshot feed.
- The host refuses `task.move` and conversation work while a task carries `task.operation` (`assertContext`), so the move must be applied before the background work starts, not after it.
- `task.move` records a `pendingTransition` and the command handler awaits `dispatchPending` before building its response, so the destination entry marker exists when the move response lands.
- The first-execution sequence exists in three places: the client controller, the host `prepareFirstExecution` used by the agent tool creation path, and the cross-card message preparation. Only the first two are in scope.

## Goals / Non-Goals

**Goals:**

- Move the card before any long work, and keep only the worktree decision in front of the move.
- Make worktree creation a durable background context operation that publishes progress and survives a client reload.
- One admission for background worktree creation, shared by the interactive preparation, task creation, and the agent tool path.
- Remove the preparation's model step and the code that exists only to serve it.
- Keep the failure model honest: no rollback, the current recovery surfaces, and an explicit card status while the card is context-busy.

**Non-Goals:**

- No new command or agent action that starts a card; `create_card` keeps preparing and dispatching in one call.
- No change to destructive operations, the queue's lane policy, or the journal's record shape beyond admitting `create`.
- No change to automatic advance or decision routing, which create a first conversation without asking.
- No change to the Git section, the missing-worktree notice, or the cross-card message preparation.
- No persistence for the countdown or the client preparation.

## Decisions

### Decision: apply the move before the background preparation

The move pipeline asks the worktree question, then applies `task.move`, then hands off to the preparation. This is forced by two facts: the host refuses a move while the task has a context operation, so a move after the creation would be impossible, and the destination entry marker must exist before the first conversation and countdown can be attached to it.

Alternatives considered: prepare then move with an inline progress indicator (rejected: the card still waits); move without arming the countdown (rejected: the instructed entry would need a manual play every time).

### Decision: the worktree question stays a dialog and closes on the answer

The question decides the execution directory, so it must be answered. Presenting it before the move preserves the existing "canceling leaves the card in its stage" contract and keeps the Ask policy honest. The dialog loses its provisioning, error, and model phases, so it closes as soon as the answer is recorded and never holds work.

Alternatives considered: an inline card prompt or reuse of the drawer's worktree notice (more UI surface and a new card state), and always deriving the default without asking (removes a decision the person owns).

### Decision: worktree creation is admitted to the background operation queue

`worktree.create` accepts a background admission that records the `ContextOperation` with phase `queued`, enqueues it on the repository lane, and returns immediately. Admission itself, including the collision-free title-default derivation, stays in the command lane; the Git write and the directory switching then run on the repository lane outside it. The journal publishes `preflight`, `git`, and `switching` transitions through the feed, and the operation survives a client reload. Without the queue the Git write would hold `app.serial` and block every other command, including moves on other cards.

Alternatives considered: an un-awaited synchronous command (rejected: it blocks the global lane and has no recovery state).

### Decision: generalize the admission rather than special-case the call site

`WorktreeCoordinator.request` currently branches on the operation kind to decide between `admitAndQueue` and a direct `drive`. The design introduces an admission abstraction with per-kind preconditions: destructive kinds keep the confirmed-binding comparison and pending-admission guard, and creation keeps its own preconditions (Git project, no pending transition, no other operation, scripted context stopped before admission). The coordinator decides synchronous versus queued in one place, driven by the request's background option, so the Git section, the notice, and attachment keep their synchronous behavior without duplicating the admission logic. Only creation, removal, and deletion are eligible for the background lane.

The queued Git work runs after admission, so the scripted-context stop happens at admission time. The scripted supervisor already refuses to capture an execution while the task carries an operation or an unready worktree, so no new gap is introduced.

### Decision: the client owns the conversation and the countdown

Once the worktree is `ready` and the operation is cleared, the client creates the first conversation with `conversation.create { ensureFirst: true }`, records the model and preset outcomes from the receipt, and lets the existing auto-run controller arm the countdown. The preparation run is in-memory state owned by the mounted board, mirroring the auto-run controller: it is created after the move, it observes snapshots for its task, and it abandons without side effects when the entry marker disappears, the task moves away, or the board unmounts.

This is deliberate: the countdown is not persisted, so the conversation step that precedes it must not be either. A reload between readiness and the conversation leaves the worktree in place, creates no conversation, and leaves the entry unresolved with the run action available.

Alternatives considered: a host-owned preparation operation that also creates the conversation (more durable, but it would create a second, journaled conversation step and a second countdown trigger, contradicting the agreed reload behavior).

### Decision: remove the model step from the preparation

The native model selector needs a created conversation, and the conversation now exists only after the move and the Git work. The preparation therefore has no model step. The first conversation uses the board's default model when the board names an available one and the deployment default otherwise, as the conversation creation path already does, and the fallback notice keeps working from the creation receipt. DSH's native selector remains the conversation's own control.

This removes the preparation's `model` phase, the session lease used to render the native slot, the `nativeSeat` prop chain, and `model-seat.tsx`. It also narrows the preparation gate: a task with a ready worktree, a recorded base-project choice, a folder project, or a Never policy now moves and arms the countdown exactly as before, with the conversation created by the dispatch.

### Decision: task creation with Start uses the same run; the agent tool keeps its contract

Creation by the UI admits the same background worktree and completes with the same client run, so the created task no longer depends on the board for the worktree, only for the conversation and the countdown. The `task.prepareFirstExecution` command loses its last caller and is removed.

The agent tool keeps preparing and dispatching in the same call and reporting the outcome. It uses the same background admission and waits for the operation to settle; the task creation happens inside the command lane, the wait happens outside it, and the conversation creation and dispatch re-enter the lane. That keeps the tool's contract while removing the second implementation of the preparation sequence.

### Decision: report admission and runtime failures on the card

An admission-time failure, including a destination that cannot be derived, rejects the admission and is recorded by the preparation run; a runtime failure is recorded on the operation. In both cases the card keeps its destination stage, the card status region names the creation step that needs attention, the drawer operation status offers the existing Retry, Return, and Cancel actions, and the Git section offers Discard for an incomplete checkout. The run action stays unavailable while a failed operation is recorded, because a failure may have left a checkout that must be resolved first.

### Decision: describe operations by kind instead of by phase branch

The card status region and the drawer copy gain a worktree-creation vocabulary (admitting, creating the checkout, preparing the conversation, needs attention) through a per-kind description rather than new conditionals in the status projection. Creation labels live next to the existing removal and deletion labels.

## Architecture

```
domain/first-execution.ts        plan: ask | create-default | blocked | none (no model)
client/execution-preparation/    decision + dialog (question and blocked only)
client/preparation-run           admit -> observe ready -> create conversation -> arm
client/board-moves               ask, move, hand off to the run
client/use-task-creation         create, hand off to the same run
host/worktrees                   background admission, queue, journal
host/first-execution             agent tool path: admit, await, converse, dispatch
```

Sequence for an interactive move on an Ask-policy task:

1. The move pipeline validates the transition and opens the preparation.
2. The preparation asks the worktree question; the answer closes it.
3. `task.move` is applied; the response carries the destination entry marker.
4. The preparation run admits `worktree.create { background: true, mode: 'new' }`, or calls `worktree.dismiss` for the base-project answer.
5. The host records the operation, enqueues it, and returns.
6. The feed publishes preflight, Git, and directory switching; the worktree becomes `ready` and the operation clears in the same transaction.
7. The run creates the first conversation, records the receipt outcomes, and arms the countdown for the entry.
8. Expiry sends the instruction through the existing admission.

## Risks / Trade-offs

- The card is context-busy while the checkout is created: moves and the run action are refused by the host. Mitigation: the card status names the step in progress, and the interval is bounded by the Git command.
- Two completion owners (client run and agent tool) can drift. Mitigation: both depend on the same admission and the same readiness rule; only the final conversation-plus-dispatch step differs by owner, and the tool's step stays host-side.
- A reload between `ready` and the conversation leaves a ready worktree and no conversation. Mitigation: it is the agreed behavior; the run action creates the conversation, and the specs state it.
- A failed operation blocks the run action until it is resolved. Mitigation: the card status says the creation needs attention and the Git section and drawer operation status carry the recovery actions.
- Removing the model step changes an established control. Mitigation: the conversation's native model selector replaces it, the docs are updated, and the board default still applies.
- The preparation no longer catches an underivable destination before the move. Mitigation: the loss is the dialog only; the failure is reported on the card, in the drawer, and in the Git section, and the entry cannot execute until it is resolved.
- A queued creation serializes per repository, so two cards in the same repository create one after the other. Accepted: Git worktree metadata is never touched twice at once.
- The agent tool's wait must not hold the global command lane. Mitigation: the lane split is explicit in the tool path; the wait resolves from the operation journal.

## Migration Plan

- No data migration: the operation journal already carries the create phases, and the executor already resolves a `queued` operation. Stored tasks and stored hubs are unaffected.
- The `worktree.create` command gains an optional background flag; existing callers keep the synchronous path, so the change can deploy in one plugin step.
- Rollback: revert the client preparation run and the background flag. Queued operations already recorded stay resolvable by the same executor, because the journal and its recovery predate this change.
- `pendingTransition.worktreeRequest` stays untouched: stored hubs may still carry it, and its removal needs a migration, so it is deferred.

## Open Questions

- Removing the dead `pendingTransition.worktreeRequest` field needs a stored-hub migration check and is deferred; it changes no requirement, approach, or task in this change.
- A workflow-diagram drop of a task with no conversation onto an instructed stage is covered by the shared move pipeline and the board and drawer scenarios, not by a diagram-specific test. A follow-up may add one; it changes no requirement or task here.
- The reload between the worktree admission and the first conversation is exercised by the manual smoke checklist, not by an automated reload test. A follow-up end-to-end scenario may cover it; the run-disposal tests hold the client half.
