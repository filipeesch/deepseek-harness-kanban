# Design

## Context

See `proposal.md` for motivation and the three spec deltas for the contract. The current state
that shapes the approach:

- **Schedules already own this shape.** `src/host/schedule-model.ts` exposes
  `ScheduleModelPort { catalog(refresh?), apply(sessionId, selection) }`, built from
  `ctx.sessionController.modelCatalog()` and applied through
  `ctx.sessionController.resolveAgent(sessionId).model.select(selection)`.
  `src/host/schedule-runner.ts:80` calls it right after the session is created or reused, and the
  `hub-schedules` spec requires the occurrence to fail closed when the stored model is gone.
  The port is the only place in the plugin that ever changes a model, and it is session-scoped.
- **Every task conversation is created in one place.** `KanbanApp.createConversationNow`
  (`src/host/app.ts:437`) is the funnel behind the `conversation.create` command, the drawer's
  new-conversation action, the execution preparation, the automatic first execution, and the agent
  tools. It returns the session id; the command reports `commandReceipt = { kind: 'conversation',
  id }` and the client reads that receipt (`src/client/drawer-conversations.tsx:95`,
  `src/client/execution-preparation/use-execution-preparation.tsx:76`).
- **Schedules do not go through that funnel.** `ScheduleRunner` creates its own session with
  `ports.createSession(projectPath, workspaceId)` for a *project*, never a board.
- **A schedule's model is a project-level field.** `HubSchedule` carries `projectId` and an
  optional `model`; a schedule SHALL NOT reference a task or a worktree, so an occurrence has no
  board in scope.
- **The workflow is strict and dual-represented.** `src/domain/workflow.ts:129` lists the accepted
  root keys and rejects anything else; `src/domain/hub-schema.ts:77` refuses a stored board whose
  parsed workflow and authored YAML disagree under `canonicalWorkflow`;
  `src/domain/schema-parts.ts:177` derives both `canonicalWorkflow` (with layout) and
  `workflowMeaning` (without it) from one `workflowShape` helper.
- **Authoring already preserves the document.** `writeRootField` in
  `src/domain/yaml-map-fields.ts:272` writes or removes a root key while keeping the rest of the
  authored text, and `src/domain/stage-update.ts:161` uses it for `initial_column`.
- **The preparation decides its own steps client-side.**
  `executionPreparationPlan(task, project, modelSeatAvailable)` in
  `src/client/execution-preparation/gate.ts` and the `model` phase of
  `src/client/execution-preparation/controller.ts` gate the native seat, which
  `src/client/execution-preparation/model-seat.tsx` mounts into the
  `conversation.input.model` slot.
- **The schedule editor already has the picker.**
  `src/client/settings/schedules/schedule-editor-dialog.tsx:25-35` and :68-77 build the
  `provider::model` options, append a stale entry labelled "(not in the catalog)", and offer the
  model's reasoning efforts with an empty value meaning "model default".
- **Notice precedent.** `src/client/board.tsx:298-302` keeps a `dismissedRetained` set where
  "dismissal is per path and lasts for this board session" — ephemeral, never persisted.

## Goals / Non-Goals

**Goals:**

- One owner per concern: the workflow owns the field, the host owns applying it, the client owns
  announcing it.
- One session-scoped model mechanism shared by schedules and boards, with the two policies kept
  at their call sites.
- A single pure place that decides precedence and availability, imported by host and client so
  they cannot drift.
- No persisted migration, and no behavior change for a workflow that does not carry the field.

**Non-Goals:**

- No Hub-level or stage-level default, and no fallback list of models.
- No change to the `hub-schedules` contract, including its fail-closed rule.
- No change to the published document format version, and no new plugin command beyond what the
  existing board save already performs.
- No attempt to make the native model seat render a board-chosen value: the seat keeps its own
  native behavior, and the plugin only decides whether it appears.

## Decisions

### 1. The field lives in the board's workflow YAML, not in the board record

`model:` becomes a root mapping of the workflow document, so it is validated by the workflow
parser, guarded by the same save, edited by the same editor, and published as workflow text.

*Alternative considered*: a field on the board record or `BoardSettings`, which is where
`worktreeBasePath` lives. Rejected because `src/domain/sharing/projection.ts` deliberately excludes
settings from the published board — a board default model would silently stop travelling with a
shared board, and the whole point of putting it in the workflow is that a board's behavior
travels with the board.

### 2. `model` participates in the workflow's meaning, not in its layout

Adding `model` to `workflowShape` (`src/domain/schema-parts.ts:177`) puts it in both
`canonicalWorkflow` and `workflowMeaning`, exactly like `default_view`: it is behavior, not
placement.

*Alternative considered*: treat it like `position`/`size`/`connections` — present in the integrity
check, absent from the meaning, merged silently. Rejected as inconsistent: the model changes how a
task runs, and a silent merge would let one side's choice disappear without a review.

*Consequence, accepted*: a change that only touches the model counts as a workflow-meaning change
in `src/domain/sharing/workflow-merge.ts:80-86`, so a model-only local edit plus a remote flow
edit makes the board need the existing per-board choice instead of merging automatically. This is
the one decision to revisit if the review friction shows up in practice.

### 3. One session-scoped model port; the policy stays with the caller

`src/host/schedule-model.ts` becomes `src/host/session-model.ts` exporting `SessionModelPort` with
`catalog(refresh?)` and `apply(sessionId, selection): Promise<ModelApplyOutcome>`, where the
outcome distinguishes `applied`, `unavailable`, and `unsupported` instead of throwing. The port is
mechanism only. `ScheduleRunner` keeps its own fail-closed policy — a non-`applied` outcome for the
schedule's own model still fails the occurrence before sending — and `KanbanApp` keeps the
board's fall-back-and-continue policy.

*Alternative considered*: keep throwing and `try/catch` at the call site. Rejected: the two
callers need different reactions, an exception would carry policy the port cannot know, and the
schedule's existing tests assert a recorded failure rather than a caught error.

*Alternative considered*: two ports, one per caller. Rejected: the mechanism is identical and the
plugin would drift between two copies of the same native call.

### 4. Precedence and availability live in one pure domain module

A new `src/domain/model-preference.ts` holds `resolveTaskConversationModel({boardModel})`, which
returns the board's route or nothing when the board leaves the choice to the deployment default
(schedules keep their own stored model and never inherit from the board, per Assumption A1, so
there is no cross-caller merge function here), plus `modelKey`/`parseModelKey` for the
`provider::model` encoding, `modelIsAvailable(catalog, selection)`, and `modelSelectionKey` for
comparing two selections including their effort. It imports no Node and no schema, matching
`src/domain/note.ts` as the house pattern for a small pure module.

*Alternative considered*: keep the encoding inline in the schedule dialog. Rejected: the board
dialog, the preparation gate, and the host would each re-derive the same key, and the
"not in the catalog" behavior would be unverifiable without a browser.

### 5. Apply inside the single conversation funnel; announce through the receipt

`createConversationNow` resolves the board's model from the located task's board and applies it
after `this.sessions.create(...)` succeeds, mirroring where `ScheduleRunner` applies its own. The
outcome travels on the command receipt as an optional `model` field on `CommandReceipt`
(`src/shared/types.ts:198`), which both existing consumers already read. The client keeps the
dismissed set for that notice in view state only, following `dismissedRetained`.

*Alternative considered*: record the fallback on the task or in `ConversationFacts` so it
survives reloads. Rejected because the agreed notice is ephemeral per conversation, and a
persisted field would need its own clearing rules and its own removal path.

*Alternative considered*: a separate command that reports whether the model applied. Rejected:
it would read a state the funnel already knows and could race with the next command on the tail.

### 6. Author the root key with the existing root-field writer

The configuration control writes and clears `model:` through `writeRootField` with
`fieldKeys: ['model']`, the way `src/domain/stage-update.ts:161` writes `initial_column`, and the
result goes through the ordinary board-workflow save so the guarded save and the integrity check
stay on the path.

*Alternative considered*: literal `old`/`new` pairs as `edit_board_yaml` does. Rejected: it fails
on zero or multiple matches and cannot add a key that is not there yet.

### 7. Extract the schedule picker instead of writing a second one

`ModelPickerField` comes out of `schedule-editor-dialog.tsx` owning the catalog options, the stale
entry, and the reasoning-effort select, with the catalog reached through the existing
`ClientApi.modelCatalog(refresh?)`. The board section composes it and owns nothing but the
workflow field, keeping `src/client/settings/board-settings.tsx`'s one-concern-per-form shape.

### 8. The preparation gate reads availability from the same predicate

`executionPreparationPlan` gains the board's model and the catalog, and asks
`modelIsAvailable`. An unavailable or unreadable catalog counts as unavailable, so the step reopens
and the human chooses. The host still re-validates on apply and remains the authority; a race
between the client's cached catalog (30 s TTL) and the host's view is covered by the notice.

### 9. YAML keys are snake_case, types stay camelCase

`model: { provider, model, reasoning_effort }` in the document and
`{ provider, model, reasoningEffort }` in the parsed workflow, matching both the existing
snake_case YAML convention (`initial_column`, `on_enter_prompt`, `default_view`) and the
already-named `ScheduleModelSelection`. `Workflow.model` reuses the renamed `ModelSelection`.

### 10. Keep the native call behind the local adapter and re-check deprecation

`agent.model.select` stays reached through the port's local `SessionModelFace` interface, which is
already the seam the schedule port uses. A deprecation is a design problem to solve with the
documented replacement, not a reason to add the use anyway.

**Audit performed against the pinned DSH checkout (`17edd257f5`).** None of the three host APIs the
change touches carries a `@deprecated` marker, so no replacement is required:

- `AgentModel.select` — `packages/core/agent/src/model-selection.ts:112`: no marker. This is the
  session-scoped write the port uses.
- `SessionController.modelCatalog` — `packages/api/session-controller/src/index.ts:325`: no marker.
  (The only `@deprecated` in that file is on the legacy `events` entry point, unrelated here.)
- The `conversation.input.model` slot — `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:1467`
  (declared at `packages/client/ui-conversation/src/client/contract/slots.ts:320`): the slot catalog
  records no deprecation for it or for `conversation.input.model.label`.

The audit also settled which host call the plugin must **not** use:
`SessionControllerCommands.selectModel` (`packages/api/session-controller/src/commands.ts:166`) is
not deprecated, but its documented behaviour is "Validate and record one Session model selection;
save the default in the background". That background write is the installation-wide default, so the
command is unusable for a per-conversation default even though it is public. The Agent's own
`model.select` appends a durable `model/selection` Session event and touches nothing else, which is
the behaviour the feature requires. The trade-off is that the plugin depends on a face the port
declares locally (`SessionModelFace`) rather than on the typed remote; the port already handles a
host that does not expose it by reporting `unsupported`, and the schedule path turns that into a
recorded failure.

## Risks / Trade-offs

- **A shared board can hand a teammate a route they do not have.** → The conversation still
  starts, on the deployment default, with the dismissible notice and the non-dismissible readout in
  board configuration; nothing is refused and nothing is rewritten.
- **A model-only change can force a per-board review during team sync.** → Accepted for
  consistency with `default_view`; documented here as the revisit point, and the review path
  already exists rather than being new.
- **Client and host can disagree about availability.** → The host is the single authority on
  apply, the client only decides whether to show the step, and "unknown catalog" resolves to the
  safer branch where the human chooses.
- **The strict parser makes `model:` an all-or-nothing field.** → It must be added to the accepted
  root keys, to `Workflow`, to the parser, and to `workflowShape` in the same change, or every
  board that carries it fails the stored-workflow integrity check; a fixture that round-trips a
  workflow with a model covers this, and no existing board can already carry the key because
  unknown root keys were rejected before this change.
- **An older plugin receiving a published workflow that carries `model:` rejects that document.**
  → The team comparison refuses that board instead of corrupting it; the plugin installs from a
  single Git address, so installations move together, and the failure is visible rather than
  silent.
- **Applying the model adds a host round trip to every conversation creation.** → It is the same
  call the schedules already make, it happens after the session exists, and a failure never blocks
  creation for a board default.
- **Falling back silently would hide a stale route.** → Explicitly required not to: the notice and
  the configuration readout are the counterweight to choosing the fall-open policy for boards while
  schedules keep failing closed.

## Migration Plan

1. Land the domain field first (parser, `Workflow`, `workflowShape`, strict keys) with round-trip
   and integrity tests; no board carries the field yet, so behavior is unchanged.
2. Land the port rename and the extracted picker with the schedule editor switched onto them;
   schedules must stay green as an unprefixed refactor.
3. Land the application, the receipt field, the preparation gate, the notice, and the board
   configuration control.
4. Update the tools and the documentation.

Rollback is the removal of the field from the parser plus the configuration control: any workflow
that carries `model:` becomes invalid, so rolling back a version that wrote the field means
clearing it from the affected boards' YAML first. Because no persisted store outside the workflow
text changes, nothing else needs unwinding.

## Open Questions

- Whether the board's model should also appear in the drawer header or the conversations panel
  once a board is configured; the notice and the configuration readout already answer "what is
  this running on", so this is presentation polish for later.
- Whether several board-level workflow fields written through `writeRootField` deserve a shared
  field-editor abstraction after a second one exists.
