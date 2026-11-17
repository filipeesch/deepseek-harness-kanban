# Design

## Context

See `proposal.md` for motivation. The current code decides a task's route in four places: an automatic advance on a completed turn, a reason-carrying recorded transition, a scripted program's captured exit, and a user move. `domain/transition-route.ts` gates the first two with a scripted-only check, `domain/transitions.ts` derives graph targets and manual access from a stage's authored transitions or a scripted stage's exits, and `host/app.ts` owns the durable move through `pendingTransition` and its drain. This change adds a third deterministic routing owner and keeps that machinery.

The recent main line adds constraints this design accounts for: workflow and stage descriptions, a bounded `get_workflow_summary` projection injected into every task's first-contact context, an exceptional recorded transition admitted only on its originating turn, a workflow-operator preset, and an event format that versions later-authored fields (descriptions use v4).

## Goals / Non-Goals

**Goals:**

- Add a decision stage mode whose authored configuration, validation, write path, journal representation, and presentation follow the same rules as the scripted mode, without executing anything.
- Route a confirmed choice through the host's existing durable transition and instruction dispatch, so the destination receives the choice as context and a scripted destination starts its program.
- Reuse the structured-question presentation rather than building a second visual language.
- Leave no agent-reachable way to answer the gate or route around it.
- Land the three scoped clean-ups: one routing-owner rule, one authored-targets helper, and stage identity separated from scripted control.

**Non-Goals:**

- Multi-page question rounds, free-text or "Other" answers, per-answer notes, and Additional Notes. The gate has one question and one authored choice.
- An option with no destination. Stopping is an authored final stage.
- A host-owned undo window or any undo after the route is applied.
- Renaming the editor's `execution` draft field to `kind`. The third mode is added to the existing field.
- A product tool that answers a decision.

## Decisions

### A new `decision` stage block, not a generalized stage-kind union

A stage MAY author `decision: { question, context?, options: [{ id, title, description?, to }] }`, exclusive with `on_enter_prompt`, `allowed_transitions`, and `scripted`/`deterministic`. One option is a valid explicit confirmation.

Why: the parser, schema, journal, diff, and sharing already treat a stage's modes additively, and a new block leaves every existing workflow byte-identical. Per-option identifiers, titles, descriptions, and destinations do not fit the transition-rule shape, and a discriminated `kind` union would migrate every authored document for no observable gain. Reusing `allowed_transitions` was rejected because it mixes the agent's routing contract with the person's choice and has nowhere to put the question, context, or option copy.

Option identifiers are the identity a decision record uses, matching the scripted exit's name-as-identity pattern; titles are presentation and may be renamed.

### One routing-owner rule

Add a domain predicate that answers whether a stage owns its routing deterministically (`scripted` or `decision`). `recordedTransition`, `advanceArmedFor`, `resolveAdvanceRoute`, the exceptional admission identity check, and the agent-declaration write all consult it instead of testing `column.scripted`. A completed turn does not advance out of either owner, with or without automatic mode, and no pause is recorded because the stage itself is not waiting for the person's input in the conversation sense — it is waiting for a decision on the task.

Why: the exceptional path added a second place that must refuse declarations; a single predicate prevents the third stage mode from becoming a third copy of the same checks.

### Authored targets are for presentation, not for manual access

Extract `authoredStageTargets(column)` in `domain/transitions.ts`: configured transitions for a conventional stage, exit destinations for a scripted stage, and option destinations for a decision stage. It feeds `authoredTransitions`, `transitionTargets`, the diagram's derived connections, the route statistics, and the graph warnings. `defaultDestination`, `advanceDestination`, and the drawer's next-stage route return no destination for a decision stage, so no default-advance path and no advance action exist.

Manual access is deliberately different: `transitionAccess` reports `restricted` for every other stage when the source stage authors a decision configuration, including a stage an option names. The gate is the authored way out; a manual move is a bypass and asks for the existing restricted-transition confirmation. This is an explicit exception in the access classification, not a second target list, so the diagram still draws one connection per option destination.

### A task-level decision with no persisted question

The gate is derived: a task in a stage that authors a decision configuration has an unanswered gate. No new task field stores the question, the selection, or a pending answer, so a config edit applies immediately to parked cards, and no gate can outlive the stage that authored it. The choice itself is not persisted before it is applied; the five-second window is client state.

Why: a persisted gate would duplicate authored configuration, need reconciliation when the stage changes, and introduce a second source of truth for what the person is being asked.

### The five-second window lives in the client, and applying is durable

A board-level controller holds at most one window per task: the chosen option, observation, destination name and stable identity, deadline, and a cancel action. When the deadline passes it submits `task.decide`. Cancel, reload, a moved entry, or a replaced window applies nothing. The host applies the choice after the window in one durable `pendingTransition`, which the existing drain places and dispatches.

Why: this mirrors the existing timed stage instruction, whose reload behavior is already defined as "nothing is sent". Losing a window is safe by construction because the task is still in the gate. A host-owned timer would add scheduled state, recovery, and reconciliation for a window that cannot lose data.

### `task.decide` and the pending-transition payload

New client command `{ type: 'task.decide', taskId, entryId, optionId, destinationIdentity, note? }`. Inside the serial command lane it re-reads the task, the stage, the exact entry, the current option, and the destination's stable identity the person saw; it refuses a busy task, a replaced entry, a removed or retargeted option, and a destination whose stable identity changed, and it changes nothing on refusal. On success it persists a `pendingTransition` carrying `decision: { optionId, note?, destinationIdentity }` and a composed reason; the drain re-checks the source stage's option, its current destination, and that identity before the first placement (an already-placed move only recovers delivery), so a durable retry cannot route to a removed or retargeted option or a recreated stage; the drain places the task with the origin `decision:<optionId>`, records the observation with the stage entry, and dispatches the destination instruction (or lets a scripted destination admit its execution). The reason composes the option title, the observation, and — when it still fits the accepted transition-reason length — the option description; the title is never truncated.

Why the pending transition instead of a direct placement: the drain already owns durable placement, instruction dispatch, failure surfacing, and retry, so the choice inherits the same guarantees as an automatic advance. Extending `origin` to a third value was rejected: the field already means "host advance vs user move" and drives pause retention and card copy. A dedicated `decision` field names the fact and lets the drain map the history origin.

### `set_stage_decision` and the authoring path

The tool writes the block in parts through the same validated workflow write path the other stage tools use, clears the conflicting mode in the same write, and reports changed fields. `set_stage_prompt`, `set_stage_routes`, and `set_stage_script` refuse a decision stage. Option destinations are authored references: a stage rename rewrites them, and removing a stage removes the options that named it, refusing when that would leave a gate with no option.

Why: keeping every mode switch inside one validated write keeps the exact document, the journal, and the sharing behavior consistent with the editor's own switch.

### Presentation reuse and the client surfaces

The question, context, options, and descriptions are extracted from the structured-question form into a shared presentational slide; the question form keeps its round state machine and the decision panel adds the observation and the confirm action. The panel is the drawer's fixed strip above its sections (like the script panel), not the composer dock, so it works without a conversation and never forks the conversation's question state.

The card gains a `decision` attention fact mapped to the existing awaiting-input tint, its own accessible mark, and a pending status line; the fact is client-derived from the workflow and the current entry, so no snapshot channel changes. The advance action disappears because the routing owner has no next-stage destination.

### Summary exposure

The workflow summary adds `type: 'decision'` and `routePolicy: 'decision'` to the stage record plus a bounded decision record (question) and one record per option (identifier, title, destination). Option descriptions are omitted. The first-contact context inherits the projection, so every preset sees the gate; the transition tools additionally report that the stage owns its routing and refuse declarations, which is what keeps the text from becoming an invitation to answer.

### Journal and sharing

`StageDefinition` gains `decision`; `stage.field-changed` gains a `decision` field; `derive` compares option destinations through stable stage identities like scripted exits; `materialize` writes the authored block; the revision diff and the sharing change summary name the changed fields. A decision-carrying change is stamped with a new event format version, following the description precedent: a peer that understands less reports the board as requiring a plugin update and neither applies nor publishes over it. The layout stamp is unchanged.

### Stage identity split

`ensureLocalStageIdentity`, `reconcileLocalStageIdentities`, target capture, and target resolution move to `domain/stage-identity.ts`; `captureScriptedTargets` becomes `captureStageTargets` (scripted exits and decision options). `scripted-state.ts` keeps only the scripted control. Saving a workflow freezes the identity of every stage that authors a routing mode, including decision stages and their option destinations.

## Risks / Trade-offs

- **Event format bump breaks older peers on boards with a gate** → Conditional versioning (only decision-carrying events use the new version), an explicit "plugin update required" board state, and coverage of both the apply and the publish path; existing boards without a gate keep writing the earlier version.
- **Extracting the shared question presentation can regress the well-tested question form** → The extraction is presentational only; the form keeps its state machine and draft behavior; browser and unit tests cover both surfaces in light and dark appearance.
- **A reload during the window silently discards the person's choice** → The task stays in the gate and the panel returns; the specs state the rule, and the card keeps the attention signal, so nothing is lost except the five seconds.
- **The gate is bypassable by a confirmed manual move** → Intentional; the bypass is recorded as a manual move, so the history stays truthful and an author can require a final stage instead.
- **A workflow edit while a card waits changes what the person reads** → The command re-reads the current option and refuses a stale one; the panel is derived from the current configuration, so the person never answers a question that is no longer authored.
- **Two browser tabs could each hold a window** → The second submission is refused as a stale entry, the first route is durable, and the gate remains visible until it applies.
- **Auto mode stays enabled with no pause while the gate waits** → The card and status line state the gate; no pause record is invented, and the summary reports the stage type, so the state is visible without pretending automatic mode was interrupted.

## Migration Plan

No stored state migrates: existing workflows remain valid and no task field changes meaning. The event format version is bumped additively, retained events keep their stamps, and a gate is authored through the editor or `set_stage_decision` when a board wants one. The package version is bumped in the same change. Rolling back the plugin leaves local data intact; a board that already holds a gate cannot be read by the older build, which the event negotiation surfaces as an update requirement rather than a partial apply.