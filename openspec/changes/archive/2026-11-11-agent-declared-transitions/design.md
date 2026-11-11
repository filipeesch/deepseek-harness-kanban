# Design

## Context

See `proposal.md` — Why, and the delta specs for the required behavior. This section records only the current state that constrains the approach.

The advance machinery is split in three places today:

- `src/host/auto-advance.ts` — `AutoAdvanceCoordinator` observes each task conversation's `turn/end`. It returns early unless the task's auto mode is enabled (`observe`, and again in `settle`), applies a 250 ms settle with bounded retries, and hands the decision to one injected port.
- `src/host/auto-advance-admission.ts` — `admitAutoAdvance` is already the one admission for an advance: it re-resolves the route, resolves the target conversation, re-reads pending user work immediately before the durable decision, persists exactly one `PendingTransition`, and lets the drain place and dispatch it.
- `src/host/app.ts` — the drain (`drainPending`) is the only code that places a task and delivers a destination entry instruction. A confirmed or automatic transition becomes a `PendingTransition` here; the reason does not exist today.

Routing state is a single optional field on the task: `recordedTransition { fromColumnId, columnId, at }` (`src/shared/types.ts`). `src/domain/transition-route.ts` resolves it against the live workflow into `none`, `resolved`, or `stale`, and `resolveAdvanceRoute` turns that into the destination the advance acts on. `placeTask` deletes the recording whenever the task leaves its stage (`src/domain/hub-operations.ts`), so the recording cannot outlive the move by construction.

The stage instruction is delivered as exactly one durable `agent.followup` (`src/host/native.ts`) whose content is composed by `buildStageInstructionDelivery` as `instruction` then `briefing`. The message is claimed by an exclusive Chat Definition and rendered with the host's native context row.

Two existing patterns frame the refactor. `autoModeTools` already depends on the narrow `TaskPausePort` rather than the whole `KanbanApp`, while `transitionTools` still takes `KanbanApp`. And the agent pause already establishes the product convention for an agent-authored reason: required, trimmed, rejected when blank or over `PAUSE_REASON_LIMIT`, never truncated.

## Goals / Non-Goals

**Goals:**

- Keep exactly one place that turns a completed turn into a move, so the automatic advance and an agent-declared transition can never diverge in their holds, validation, placement, or delivery.
- Make the declared transition and its reason durable across a restart between the tool call and the turn end, without adding state that outlives the move.
- Keep the destination delivery a single durable message, so the reason and the instruction it justifies cannot land in different turns.
- Follow the established module boundaries: a narrow port per tool module, a pure domain rule per policy, and one host admission per durable write.

**Non-Goals:**

- No new UI surface for the declaration. The card, the drawer, and the auto-mode control keep presenting exactly what they present today; the reason is visible in the transition tool call in the transcript and in the delivered context row.
- No change to the drawer's next-stage action, the manual drag pipeline, or the five-second countdown. A manual move stays a move and never injects a reason.
- No catch-up for turns that ended while the host was not observing them; the existing rule stands for the new arming path too.
- No new message source kind and no second Chat Definition.

## Decisions

### One advance path, two arming conditions

The coordinator keeps its single observation point. What changes is the predicate that authorizes an advance: a completed turn advances when auto mode is enabled **or** when a reason-carrying recording resolves for the current stage. Both branches feed the same `admitAutoAdvance` call and the same drain.

*Alternatives considered.* A second coordinator observing agent-declared tasks would double the observation of `turn/end`, need its own dedupe of the same event identity, and risk admitting two advances for one turn. A separate "declare and move" command path would bypass `blocksAdvance` and the pending-user-work re-read unless every check were duplicated.

The predicate is domain code, not host code: `advanceArmed(workflow, task)` in `src/domain/transition-route.ts` returns whether a completed turn should produce an advance, and the coordinator, the admission, and the presentation read it. The `observe` gate, the `settle` re-check, and the admission's `blocked` guard all consult it, so no path can admit an advance the others would refuse.

### The move never happens inside the tool call

The tool writes recording state and returns. The move, the placement, and the delivery happen in the drain, triggered by the turn end. This is the decision that keeps the change small: `admitAutoAdvance` already re-resolves the route against the current workflow, re-reads pending user work, and re-checks the task inside the transaction, so the agent-declared path inherits every guarantee without new code.

*Alternative considered and rejected.* Admitting a transition from the tool call itself would move the card mid-turn, mark the destination entry, and queue its instruction while the current turn still runs. Because a host-admitted prompt is not pending user work, the turn end would then advance again from the new stage and skip it. Suppressing that advance would need a per-turn marker whose cleanup has its own failure modes; deferring to the turn end removes the case entirely.

### The reason lives on the recording

`RecordedTransition` gains `reason`. The tool call and the turn end are separate observations — possibly separated by a restart — so the reason must be persisted, and the recording is already the state that says "this task will move next". `placeTask` deletes the recording on any stage change, which gives the required lifetime for free and keeps the promise that nothing about the reason survives the move.

*Alternatives considered.* A separate `declaredTransition` field would duplicate the routing state and need its own invalidation on every stage change. Keeping the reason only in memory would lose it across a restart and leave the recording armed with no justification.

Because a stored recording may predate the field, `reason` is optional in the schema and the arming rule requires it: a recording without a reason keeps its routing meaning for auto mode and the drawer, and does not advance a task by itself. That makes the upgrade behavior identical to the previous release for existing data, and avoids failing to parse a Hub document over a field the user did not write.

### The reason is a block in the existing delivery

`buildStageInstructionDelivery` composes `instruction`, then the reason block, then the briefing. The message identity, the at-most-once delivery, the Chat Definition, and the collapsed summary are untouched; only the text grows.

*Alternative considered and rejected.* A second native message with its own source kind would read as a more faithful "context line", but two `agent.followup` calls back to back are not documented to land in the same turn. If the second one were observed in the following turn, the reason would justify a stage after the one it describes. A single message cannot be split.

The block names the stage the task came from, because the destination instruction alone does not say it:

```text
Transition reason (from Review):
<the recorded reason>
```

The admission composes it from the source stage name resolved against the live workflow plus the recorded reason, both read immediately before the delivery, so a renamed stage is described with its current name.

### Tool modules depend on narrow ports

`transitionTools` stops taking `KanbanApp` and takes a `TaskRoutingPort`, mirroring `autoModeTools`' `TaskPausePort`:

```ts
export interface TaskRoutingPort extends TaskScopeSource {
  recordTransition(taskId: string, write: TransitionWrite): Promise<LocatedTask>;
  /** Locates the task that owns the calling conversation; never another task. */
  ownTask(exec: ToolRunContext): LocatedTask;
}
```

The port is satisfied by the app at composition time. The module no longer names the board repository, the command queue, or the snapshot, which is what lets the tool rules be tested against the port alone.

`requireTask` stays for the read tool and for tools that legitimately accept `task_id`. The write tool uses a sibling, `requireOwnTask`, that only resolves through `exec.agent.id`; its error is the existing `MISSING_TASK_CONTEXT`, and its schema simply offers no task identifier, so a model cannot name another task even by accident.

### One admission for both origins

`admitAutoAdvance` is renamed and generalized rather than copied. It takes the origin as an input (`'auto' | 'agent'`), and the pieces that were implicitly auto-mode-specific become explicit:

- the `blocked` guard reads `advanceArmed` instead of `autoMode?.enabled`;
- the transaction invariants assert the arming condition that matches the origin — auto mode still enabled for `'auto'`, the same reason-carrying recording still resolving for `'agent'`;
- the created `PendingTransition` carries `origin` and the recorded `reason`;
- the stale-route failure throws a categorized error for both, and only the caller decides whether that becomes a pause.

The drain changes in one place: it passes the pending transition's `reason` and `fromColumnId` to `admitStageInstruction`, which forwards the composed block to the delivery.

### Non-completed turns and stale routes branch on auto mode

The pause record lives inside `autoMode` (`autoMode.pause`), and a task whose auto mode is disabled has no such record to write. Rather than introduce a second pause location, the rule is: diagnostics are an auto-mode concern. A task whose auto mode is disabled records no pause; the recording stays armed and the next completed turn acts on it. A stale recording with auto mode enabled pauses with `transition-stale` exactly as today; the same recording with auto mode disabled advances nothing and records nothing, and the drawer's next-stage action still refuses with the existing explanation.

This keeps one presentation path and one stored record. The alternative — a pause outside `autoMode` — would need a new schema field, a new presentation branch on the card and in the drawer, and a new way for the user to clear it, for a state that resolves itself on the next completed turn.

### A failed agent-armed advance is reported through the transition record

If the delivery or the placement fails after the advance was persisted, the pending transition is marked `failed` with its error. Because it now carries the reason, the manual retry keeps the original justification instead of delivering an instruction with no account of why. The status strip and the drawer's recovery status name the origin: `Agent-declared transition` for `'agent'`, which attributes the decision instead of implying the user made it, keeping the existing `Confirmed action` wording for records the current UI no longer creates. No pause is written for this failure when the task's auto mode is disabled.

The recovery paths are the existing ones, widened from `'auto'` to every host origin: the card's play action stays enabled for a failed host advance and may run the entry it left unresolved, a successful run of that entry clears the record, and the drawer's dismiss removes it without moving the task again. The recovered send reuses the delivery identity the failed admission owned and re-injects the recorded reason, so the justification reaches the next stage and a delivery that already landed is recognized instead of sent twice. Narrowing them to `'auto'` would leave a declared advance that failed with no way out: it blocks the next advance and the play action alike, because a pending transition blocks both.

### Module boundaries after the change

| Concern | Module | Change |
| --- | --- | --- |
| Arming rule, route resolution | `src/domain/transition-route.ts` | `advanceArmed` added; resolved recording exposes its reason |
| Reason validation | `src/domain/transition-reason.ts` (new) | limit constant, trim, reject blank, reject over limit |
| Recording write | `src/domain/hub-operations.ts` | `recordTransition` requires the reason when it names a target |
| Recorded transition shape | `src/shared/types.ts`, `src/domain/schema-parts.ts` | optional `reason`; `PendingTransition` gains `origin: 'agent'` and `reason` |
| Turn trigger | `src/host/auto-advance.ts` | gates on `advanceArmed`; renamed to the turn-advance coordinator |
| Advance admission | `src/host/auto-advance-admission.ts` | origin-parameterized; one path for both |
| Delivery composition | `src/host/stage-message.ts`, `src/host/stage-instruction.ts` | optional reason block between instruction and briefing |
| Briefing text | `src/host/stage-briefing.ts` | states the required reason and the end-of-turn timing |
| Tools | `src/host/tools/transitions.ts`, `src/host/tools/scope.ts` | `TaskRoutingPort`, `requireOwnTask`, reason validation, no task identifier on the write |
| Command surface | `src/host/app.ts` | `task.recordTransition` takes the reason; the port is satisfied here |

## Risks / Trade-offs

- **Two observations of one rule can drift** → the arming predicate and the pause decision are pure domain functions used by the coordinator, the admission, the presentation, and the tests, so a divergence fails a unit test rather than a live board.
- **The turn-end advance is invisible until it happens** → accepted deliberately: no card, drawer, or control change is in scope, and the declaration and its reason are visible in the transcript's tool call and in the delivered context row. Presenting the pending declaration on the card would be a follow-up, not part of this change.
- **A recording stored without a reason is inert** → intended: it keeps the previous release's behavior for existing data and never moves a task under semantics its author never chose. The cost is one branch in the arming rule and one scenario.
- **Two followups were rejected, so the reason shares the instruction's row** → the collapsed row keeps its existing summary and only the expanded body grows; a user who wants a separate line can revisit the delivery shape, but the current host does not let the plugin guarantee turn co-location.
- **The stored Hub gains a field** → an older plugin build rejects a document that holds a reason. Tasks are never published to a shared document, so only local data is affected; the README's downgrade note must mention the recording alongside the pause.

## Migration Plan

1. Add the optional field to the schema and the type first, so a document written by the new build still parses and an older document keeps parsing.
2. Land the domain rule with the reason optional on read but required on write, then the host path, then the tool surface.
3. No backfill: recordings made before this change stay as they are and stay inert for arming.
4. Rollback is the previous build, which ignores the extra field on read only if it tolerates it — it does not, so document the same "resume and clear" guidance the pause already carries: clear a declared transition before downgrading.
5. Update `README.md` and `docs/operations.md` in the same change; both currently state that recording never moves a task and that both tools work with auto mode disabled, and both statements change.

## Open Questions

None that change the specs, the approach, or the task breakdown.
