# Design

## Context

See `proposal.md` for motivation and the spec deltas for required behavior.

The current host already owns everything the advance needs, but nothing connects it:

- `KanbanApp.observe` receives every native session event, so a live `turn/end` is available with its `reason.kind` (`completed`, `aborted`, `blocked`, `error`, `max-tokens`; `interrupted` and `forked` are never emitted live).
- `ConversationFacts` already projects `running` and `awaitingReply` per session, and `AttentionCoordinator` coalesces reads. `pendingTransition` is a durable, retryable record that `dispatchPending` already drives, including after a restart, with the record id as the native request identity.
- Entering an instructed stage persists `instructionPending`, and `runInstruction` is the only path that validates an entry, sends its instruction verbatim, and clears the marker. The confirmed-transition path (`mode: 'run'`) duplicates part of that send.
- `firstOpenSessionId` plus `createConversationNow({ allowUndecided: true })` is the established target rule, and the five-second countdown is client state in `AutoRunController`.
- `app.ts` is already the command coordinator and the owner of the pending-transition drain; the persisted task shape is duplicated between `domain/schema.ts` (legacy board) and `domain/hub-schema.ts` (Hub).

Constraints: no data-version bump, existing persisted states must keep parsing, the five-second behavior must not change, host decisions must be deterministic under an injected clock, and the feature must be provable with the existing in-memory, browser, and replay lanes without a real model.

## Goals / Non-Goals

**Goals:**

- Make the advance a host decision with no dependency on the Kanban UI being mounted, filtered, or reloaded.
- Represent one advance as one durable record, so a reload cannot duplicate or cancel it and a restart dispatches what was already decided.
- Keep the trigger and the dispatch deterministic and testable: an explicit reason check, an explicit idle gate, and an injected scheduler.
- Isolate the new behavior behind injected ports so `app.ts` only wires it and existing command paths keep their semantics.
- Record enough state to explain a pause after a reload, without deriving policy from presentation flags.
- Land the agreed refactors without changing the persisted format in a breaking way.

**Non-Goals:**

- Bulk enable/disable, auto mode at task creation, or a workflow-level default.
- Moving the five-second cancelable window to the host.
- Catching up a turn that ended while the host was not observing.
- Retrying a failed advance automatically, or advancing after a turn that did not complete.
- Replacing the attention projection, the questions index, or the worktree coordinator.

## Decisions

### 1. A coordinator subscribed to `turn/end`, with injected ports

`KanbanApp.observe` forwards an observed session event to a new `AutoAdvanceCoordinator` (new `src/host/auto-advance.ts`). The coordinator owns the debounce, the trigger checks, the idle gate, and the admission call; it receives `locateBySession`, `locate`, `facts`, `admit`, `pause`, `schedule`, `cancel`, and `report` as ports. The coordinator owns only policy: the serialized admission and the pause write are app adapters because they need the command tail, conversation creation, and the pending-transition drain.

Alternative considered: extend `AttentionCoordinator` with a turn-end callback. Rejected because attention is a read projection with its own debounce and retry budget; executing a durable write from inside it couples presentation timing to mutation and makes failure accounting ambiguous.

Alternative considered: client-side advance in `AutoRunController`. Rejected because the UI may be closed or reloaded, and because a second writer would race the host on move and send.

### 2. Trigger only on `completed`, then settle before admitting

On `turn/end`, the coordinator inspects `reason.kind`. Only `completed` proceeds. Non-completed endings record a pause reason immediately. For a completed turn, the coordinator schedules a short settle tick (about 250 ms) and then re-reads the facts, so the native activity projection has observed the end of the turn.

Alternative considered: acting inside the event callback. Rejected because the activity waterfall can still report `running` at that instant, which would make the idle gate nondeterministic.

Alternative considered: subscribing to `agent/status` idle. Rejected because it is per agent, not per turn, and it does not distinguish a completed turn from a failed one.

### 3. Idle gate on conversation facts, fail closed

A completed turn admits an advance only when every open conversation of the task reports `running === false` and `awaitingReply === false`. The facts port composes the plugin question index into `awaitingReply`, so a pending Kanban decision question counts as waiting even though it does not open a native pending request. Closed conversations are ignored. A failed facts read is treated as not idle and reported; the next completed turn re-evaluates.

Alternative considered: `SessionPort.isIdle`, which additionally checks next-turn inbox and approvals. Rejected as the primary gate because it inspects native history on every turn end; it remains the final authority inside admission through `assertExecutionContext` and the send path.

### 4. Reuse the durable pending transition, with an origin

The advance is admitted as one `PendingTransition` with `origin: 'auto'`, `fromColumnId`, resolved `columnId`, captured `text` when the destination has an instruction, resolved `sessionId`, and status `waiting`. `dispatchPending` already validates, moves through `placeTask`, sends with the record id as the request identity, and marks `sending`/`failed`. A transition persisted but not dispatched is still dispatched after a restart; that is not catch-up, because the decision was already made and recorded.

Alternative considered: a separate `autoAdvance` record. Rejected because it would duplicate the drain, retry, failure, and restart behavior that already exists and is covered by tests.

Alternative considered: dispatching the move and the send directly from the coordinator. Rejected because it would bypass the single-flight drain and the durable record, so a crash between move and send would be invisible.

### 5. Pure domain resolution with a cycle guard

New `src/domain/auto-advance.ts` resolves the path as a pure function of the workflow and the current stage:

```
resolveAutoAdvance(workflow, fromColumnId)
  -> { fromColumnId: string; path: Column[]; destination?: Column; instruction?: string }
```

Rules: the first configured `allowed_transitions` entry when configured, otherwise the following column in workflow order; no destination when the list is empty or resolves to the current stage; continue from a destination without an instruction; stop at the first instructed stage or at the last reachable stage; never revisit a visited stage. The function returns the path and its source stage so admission can reject a plan resolved for a stage the task has already left, and tests can assert the cascade without mocking the host.

Alternative considered: resolving inside the host coordinator. Rejected because the rule is workflow policy, testable without sessions, and shared by the card's derived "no next stage" state.

### 6. Capture destination and instruction at admission

The resolved destination and its exact instruction are copied into the pending transition. A later workflow edit cannot change an admitted advance, matching the existing rule that a displayed instruction is the instruction sent. The admission transaction re-resolves the destination against the current workflow and requires the same destination id and the plan's `fromColumnId`. A changed or removed destination raises `INVALID_TARGET` and is recorded as an `advance-failed` pause; a task that moved since resolution is skipped without a pause, so its new stage is evaluated on its own next completed turn.

Alternative considered: re-resolving at dispatch. Rejected because it would make the sent instruction differ from the one that justified the move.

### 7. One host admission service for every stage instruction

New `src/host/stage-instruction.ts` exposes one path used by three callers:

```
admitStageInstruction({ taskId, expectedColumnId, expectedEnteredAt, instruction, requestId })
  -> validate entry identity
  -> require the reviewed instruction
  -> resolve target: first open conversation, else create
  -> assertExecutionContext
  -> sessions.send(..., requestId)
  -> clear the entry marker
```

`runInstruction` becomes a thin command adapter, the confirmed-transition drain calls it after `placeTask`, and the automatic advance calls it through the coordinator. Marker clearing stops being duplicated, and `INSTRUCTION_ALREADY_RESOLVED` keeps one meaning. The client `AutoRunController` keeps its five-second timer and still issues `task.runInstruction`; only the host side is unified.

Alternative considered: moving the timer to the host at the same time. Rejected for this change because it rewrites the existing countdown spec and multiplies the surface; it is a separate, smaller change that can reuse this service.

### 8. Resolve the target before persisting the advance

When the destination is instructed and no conversation is open, the fix creates a conversation before the transition is persisted, because the durable record needs a concrete session id. If admission then fails, the new empty conversation remains visible in the drawer; that is accepted in exchange for keeping the durable record self-contained and the dispatch path unchanged.

Alternative considered: persisting the transition with an optional session and creating the conversation during dispatch. Rejected because it extends the drain's contract and splits target resolution across two phases.

### 9. Persist the pause on the task

`autoMode` becomes an optional task object: `enabled` plus an optional `pause { reason, at, message? }`. Persisted reasons are `turn-error`, `turn-blocked`, `turn-aborted`, `turn-max-tokens`, and `advance-failed` (before a durable transition exists). Derivable states are not persisted: an advancing destination, a failed admitted transition, an unresolved entry, and "no next stage" all read from the snapshot and the shared resolver. Each pause write carries the stage it was observed in and is ignored if the task moved before the write commits. The pause is cleared on an admitted advance, on disabling auto mode, and on any move of the task; reading a conversation never clears it.

Alternative considered: deriving the reason from attention. Rejected because the failure dot only covers `error` and clears when the conversation is read, so `blocked`, `aborted`, and `max-tokens` would be invisible and a read would erase the explanation.

### 10. Client derivation, one control, mirrored placement

New `src/client/auto-mode.tsx` owns `CardAutoModeControl`, `DrawerAutoModeToggle`, `AutoModeNotice`, and a pure `autoModeView(task, workflow)` with a fixed precedence: failed admitted advance, admitted advance, disabled, persisted pause, unresolved entry, no next stage, armed. The persisted pause outranks the derived blockers because it is the recorded cause; the dead-end notice names "no next stage" rather than assuming a terminal stage, so an empty or self-configured transition reads correctly. `TaskCard` composes the control in its context region and the status strip consumes the derived entries; `drawer.tsx` renders the toggle in the header actions and the notice above the panel. The toggle command is `task.autoMode { taskId, enabled }`, dispatched through the existing `run` path.

Alternative considered: a host-projected auto-mode state in the snapshot. Rejected because every fact needed is either persisted on the task or already in the snapshot; a new projection would add a second source of truth for the same state.

### 11. Serialize admission with commands

The admission runs through the app's existing command tail, so an automatic advance cannot interleave with a user move or edit. The coordinator additionally keeps an in-memory set of handled `(sessionId, seq)` events, and admission guards on the task's operation, transition, entry, source stage, and re-resolved destination, so a duplicate event or a stale tick cannot admit twice. Disabling auto mode forgets a queued settle, so re-enabling within the window cannot advance for a turn that ended before the re-enable.

### 12. Recover a failed admitted advance

A failed admitted advance keeps its failed transition and auto mode stays enabled. The destination entry stays unresolved, so the card play action remains available; a successful manual send clears the failed record in the same transaction that clears the marker. The drawer status offers **Retry automatic advance** (the same request identity) and **Dismiss failed advance**; dismissing deletes only that failed automatic transition without sending anything implicitly, unblocking moves and deletion. A failed transition is never retried automatically.

Alternative considered: converting a failed admitted advance into a pause and clearing the transition. Rejected because the spec requires the failure to be reported through the transition state, and a pause would lose the captured request for an explicit retry.

### 13. Schema fragments, not a second schema

New `src/domain/schema-parts.ts` holds the shared primitives, `operation`, `pendingTransition` (now with optional `origin`), the workflow pieces, the base task object, and a task-invariant helper that takes a column resolver. `schema.ts` (legacy `BoardState`) and `hub-schema.ts` compose them; the Hub task extends the base with `boardId`. The two per-aggregate `superRefine` blocks stay in their files because their cross-record rules differ.

### 13. Test seams

The coordinator takes `schedule` and a clock-like injection so tests drive the settle tick deterministically, mirroring `AutoRunController`'s `AutoRunClock`. Domain resolution, admission, and derivation are pure enough for unit tests; the coordinator is exercised through the existing in-memory Hub fixture and the fake session port; the automatic path in the real composition is covered by a replay lane with a deterministic turn boundary.

## Risks / Trade-offs

- **Literal cascade can walk a linear workflow to its last stage after one completed turn.** → This is the chosen product behavior; the card shows the destination before the move settles, the resolver is pure and covered by scenarios, and a workflow that does not want this can configure transitions or instructions.
- **A `turn/end` observed before the activity projection settles could mis-gate the advance.** → The settle tick re-reads facts, and the gate fails closed; a missed advance falls back to the next completed turn, which is the stated no-catch-up rule.
- **Workflow edits racing an admission could send an instruction for a stage that no longer exists.** → Destination and instruction are captured at admission, and the admission transaction revalidates the destination; a failed validation is recorded as a failed transition, never as a silent send.
- **An admission failure after creating a conversation leaves an extra empty conversation.** → Accepted; the conversation is visible and harmless, and the alternative would split target resolution across the durable record.
- **The persisted pause could describe a stage the task already left.** → Any move clears the pause; each pause write also carries its observed stage and is ignored if the task moved before it commits.
- **Sharing the pending-transition record with automatic advances could leak user-confirmation copy into automatic failures.** → The origin field drives distinct labels on the card and in the drawer, and the status-strip requirement requires the distinction.
- **Extracting schema fragments could change legacy parsing.** → Only composition changes; the accepted and rejected fixtures in `tests/host/storage-migration.test.ts` and `tests/domain/store.test.ts` stay as regression guards, and the new fields are optional.
- **A task with two open conversations can finish a turn while the other is waiting for a question.** → The idle gate includes `awaitingReply`, so the advance waits for the human; the next completed turn re-evaluates.

## Migration Plan

1. Add the optional task `autoMode` state and the optional `pendingTransition.origin`; existing persisted states parse unchanged, and a transition without an origin reads as user-confirmed.
2. Land the shared schema fragments behind the existing parse entry points; run the migration and legacy-store tests before wiring the feature.
3. Add the admission service and route the existing `runInstruction` and drain through it; the observable behavior and the five-second path must not change.
4. Add the domain resolver and its tests, then the coordinator and host wiring, then the client control, drawer, and notice.
5. Add the browser and replay coverage for the automatic path.

Rollback is safe: disabling or removing the feature leaves optional fields in storage that older code ignores, and pending transitions of either origin remain dispatchable by the existing drain. No data-version change and no destructive migration are involved.

## Open Questions

- The exact pause-reason wording on the card, in the drawer, and in the transition status is deferred to implementation; the specs constrain the meaning, the tone, and the distinction from a user confirmation, not the literal copy.
