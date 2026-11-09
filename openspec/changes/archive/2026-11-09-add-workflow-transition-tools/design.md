# Design

## Context

See `proposal.md` for motivation. The relevant current state:

- `parseWorkflow` (`src/domain/workflow.ts`) is the only writer of `Workflow`, and `HubStateSchema` (`src/domain/hub-schema.ts`) rejects a stored Hub whose parsed workflow does not equal the stored one under `canonicalWorkflow` (`src/domain/schema-parts.ts`). Any change to the parsed shape is therefore a persisted-schema change even though the authored YAML is the source of truth.
- Two different readers interpret `allowedTransitions` today: `authoredTransitions` in `src/domain/transitions.ts` (restriction policy and diagram edges) and `nextConfiguredColumn` in `src/domain/auto-advance.ts` (advance destination, first entry only).
- The automatic advance resolves the destination inside `AutoAdvanceCoordinator.advance` and re-validates it inside `admitAutoAdvance` (`src/host/auto-advance-admission.ts`) through `requireSameDestination`.
- Every stage instruction send — card run action, timed instruction, confirmed transition, automatic advance — passes through `admitStageInstruction` (`src/host/stage-instruction.ts`), which composes the message from the workflow column and the captured instruction.
- `placeTask` (`src/domain/hub-operations.ts`) is the single placement path, and it already clears `autoMode.pause` on every placement.
- Product tools are plain adapters over `KanbanApp`/`app.command` (`src/host/tools/*`), split by capability and registered in `productToolDefinitions`.

## Goals / Non-Goals

**Goals:**

- One routing rule, expressed once, consumed by the host automatic advance and by the client drawer action.
- An authored transition condition that is data for the model and never a second access policy.
- A recorded transition whose validity is a property of one stage, so it cannot outlive the decision it describes.
- A briefing built from the workflow at send time, so it cannot go stale against an edited workflow.
- Compatibility with stored workflows and stored Hubs without a data migration.

**Non-Goals:**

- No new workflow-level configuration beyond the per-transition condition.
- No condition evaluation by the product: conditions are authored prose for the model, and the product never parses or enforces them.
- No change to the diagram's edges, to restriction semantics, or to the confirmation flow.
- No UI for editing a recorded transition directly; it is model-owned and cleared by moving the task.
- No visibility of conditions in the workflow diagram in this change (deferred; see Open Questions).

## Decisions

### 1. A transition entry is a value object, normalized at both boundaries

`Column.allowedTransitions` becomes `readonly TransitionRule[]`, with `TransitionRule = { to: string; when?: string }`. Two parsers must produce that shape:

- `parseWorkflow` accepts a bare identifier or a mapping with `to` and optional `when`, and normalizes both through one shared helper in `src/domain/yaml-fields.ts`.
- The persisted schema accepts the same union and normalizes with the same helper through a zod transform, so a Hub loaded from disk is normalized in memory before `canonicalWorkflow` compares it with the parsed YAML.

Alternative considered: store both shapes in the type and normalize at every read site. Rejected — it spreads a compatibility branch across `transitions.ts`, `workflow-graph.ts`, `schema-parts.ts`, and the client. Normalizing once at the two boundaries keeps every reader working with one shape.

Alternative considered: a new `transitions:` list next to `allowed_transitions`. Rejected — two sources for the same edge, and the workflow editor could store one while the diagram drew the other.

### 2. The recorded transition is stage-bound task state

`Task.recordedTransition?: { fromColumnId; columnId; at }` records the intent and the stage it was recorded for. Validity is derived, never persisted as a flag: the recording resolves when `fromColumnId` equals the task's current stage, `columnId` still exists, and the current stage still configures it as a target. `placeTask` deletes the recording whenever the stage changes, so a manual move, a confirmed transition, and an automatic advance all expire it through the one code path that already moves tasks. A same-stage reorder keeps it because `placeTask` compares the source and destination columns for that rule (the pause clear stays unconditional, as it is today).

Alternative considered: clearing the recording in each move command. Rejected — four call sites would have to remember, and one of them is the automatic advance.

Alternative considered: keeping a recording across stages. Rejected — a transition is an edge of one stage, so an intent recorded for another stage has no meaning.

### 3. One routing function, two consumers

A new `src/domain/transition-route.ts` owns the resolution that both the host and the client need:

```
recordedTransition(workflow, task)
  -> { kind: 'none' }
   | { kind: 'resolved', column }
   | { kind: 'stale', reason }

resolveAdvanceRoute(workflow, task)     // automatic advance
resolveNextStageRoute(workflow, task)   // drawer next-stage action
```

Both routes prefer a resolved recording and report a stale one as its own outcome. They deliberately differ on the fallback: `resolveAdvanceRoute` uses the automatic advance rule (the first configured target, then the crossing rule), while `resolveNextStageRoute` uses the adjacent stage in workflow order, because the manual action has always stepped one stage. `resolveAutoAdvance` keeps the crossing rule for the default path and consumes `defaultDestination`; this removes `nextConfiguredColumn` as a second reader of the transition list.

Alternative considered: adding the recorded transition directly inside `resolveAutoAdvance`. Rejected — the client cannot import host code, and duplicating the resolution in the client is exactly the divergence this change is meant to remove.

### 4. Staleness is an outcome, not an exception

The domain returns a `stale` outcome instead of throwing, so the coordinator decides the presentation:

- `AutoAdvanceCoordinator.advance` resolves the route; on `stale` it records the `transition-stale` pause through its existing `pause` port and admits nothing.
- `admitAutoAdvance` re-resolves the route with the same captured `fromColumnId` and destination. A route that no longer resolves throws a typed `KanbanError` with code `TRANSITION_STALE`; the coordinator maps that code to the same pause instead of the generic `advance-failed`.
- The client drawer action resolves locally and shows the same explanation without issuing a command, so a stale recording cannot move the card through the manual path either.

`AutoModePauseReason` gains `transition-stale` in the TypeScript union, in the zod enum, and as one case in `pauseLabel`. No new control state is needed: the existing paused presentation carries it.

Alternative considered: reusing `advance-failed`. Rejected — that reason already means "the admission failed unexpectedly" and offers a retry; a stale recording is a workflow-edit condition with a different recovery.

### 5. The briefing is composed at send time by its own module

A new `src/host/stage-briefing.ts` exposes `buildTransitionBriefing(workflow, task): string | undefined`. `admitStageInstruction` appends its result to the instruction it already resolves, so all four send paths share one composition point. The briefing is deliberately generated from the live workflow and the live task, not captured into `PendingTransition.text`: the captured text stays the authored instruction, which is what admission re-validates, while the briefing describes the workflow as it is when the message leaves.

The briefing is produced only when the stage configures two or more targets, matching the spec: with fewer, there is no decision to describe, and the message stays byte-identical to today's behavior.

Alternative considered: injecting a briefing before every model turn. Rejected — it would add a synthetic message per turn to every conversation, including stages with no decision, and it would bypass the admission that already knows the target column.

### 6. Tools are thin adapters over one new command

`src/host/tools/transitions.ts` registers `list_allowed_transitions` and `set_next_transition` into `productToolDefinitions`, following the existing per-capability split. Both resolve the task through `requireTask` (conversation scope or explicit `task_id`), and `set_next_transition` writes through a new `task.recordTransition` command handled by `KanbanApp`, mirroring how `edit_card` delegates to `task.edit`. The command serializes through the same lane as every other task write, so a recording cannot interleave with a placement.

The domain operation behind the command validates the target against the current stage's configured targets and refuses a stage without configured transitions. The tool never reads or writes `Task` fields directly.

Alternative considered: a single tool that both lists and sets. Rejected — the read is a cheap discovery call the model can repeat, while the write must be unambiguous about what it changes.

### 7. Both transition forms remain first-class

The bare identifier form stays valid, is not deprecated, and may be mixed with mappings in one list. The parser normalizes to `{ to }` with no `when`, and every consumer treats the missing condition as "no authored condition", which is exactly today's behavior. Nothing in the product requires a condition to exist.

### 8. No data migration

`DATA_VERSION` stays `2`. The persisted schema accepts the previous shape and normalizes it on read, and the canonical comparison runs on normalized values, so an upgraded host validates an existing Hub unchanged. Nothing is rewritten on disk until the user saves a workflow that authors conditions.

## Risks / Trade-offs

- **Downgrade rejects a conditioned workflow** → An older plugin parses the stored YAML without the mapping form and reports the board's workflow as invalid; the last valid workflow stays in effect and the editor shows the parse error. Mitigation: note the minimum version in the release notes, and keep the bare identifier form usable for boards shared with older installations.
- **Briefing grows the stage instruction message** → Only stages with two or more targets are affected. Mitigation: no condition echo beyond the authored text, one line per target, and no briefing for the common single-path stage.
- **A stale recording can strand an armed task** → The task pauses until someone acts. Mitigation: the pause is visible on the card and in the drawer, any stage change clears it (already true in `placeTask`), and the drawer's stage select remains the explicit recovery.
- **Two parsers can drift again** → The YAML parser and the persisted schema must normalize identically. Mitigation: both call one shared normalizer, and a test asserts that a legacy string workflow and its conditioned equivalent produce the same canonical shape.
- **The recorded transition can disagree with the workflow at admission** → Re-resolution in the admission path catches it. Mitigation: compare the destination identity, exactly as `requireSameDestination` does today, and map `TRANSITION_STALE` to the new pause instead of a generic failure.
- **The tool can be called from an ordinary chat with any `task_id`** → Same exposure as `edit_card` today. Mitigation: it changes only a model-facing routing hint, never the task's stage or position.

## Migration Plan

1. Ship the parser and schema change first in one release; stored Hubs keep validating because both boundaries normalize.
2. No backfill and no rewrite: a board keeps its authored YAML until the user edits it.
3. Rollback is a version revert. A board that authored conditions must revert its workflow YAML to the bare identifier form before an older plugin can parse it.

## Open Questions

- Should the workflow diagram show each transition's condition, for example as a tooltip on its connection? This needs no schema or routing change and can be decided after this change ships.
