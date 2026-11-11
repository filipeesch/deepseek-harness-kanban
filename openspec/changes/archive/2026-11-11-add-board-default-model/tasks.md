# Tasks

## 1. Domain — The Board's Model Field

- [x] 1.1 Add `model?: ModelSelection` to `Workflow` in `src/shared/types.ts` and rename
  `ScheduleModelSelection`, `ScheduleModelEffort`, `ScheduleModelProvider`, and
  `ScheduleModelCatalog` to `ModelSelection`, `ModelEffort`, `ModelProvider`, and `ModelCatalog`,
  updating `HubSchedule.model` and every import; verify `pnpm typecheck` passes and no
  `Schedule`-prefixed model type name remains in `src/`.
- [x] 1.2 Accept a root `model` mapping in `src/domain/workflow.ts`: add it to the `keys(input,
  [...], 'workflow', COLUMN_NOTE)` list at :129, parse `provider`, `model`, and
  `reasoning_effort` into `Workflow.model`, and reject a non-mapping value, a missing or empty
  `provider`, a missing or empty `model`, an empty `reasoning_effort`, and any field the mapping
  does not define; verify `tests/domain/workflow.test.ts` covers the accepted mapping, the absent
  mapping, a snake_case `reasoning_effort`, and each rejection naming `model` in the problem.
- [x] 1.3 Include the mapping in `workflowShape` in `src/domain/schema-parts.ts` so both
  `canonicalWorkflow` and `workflowMeaning` carry it, in the parsed camelCase field names the
  `Workflow` type uses (`reasoningEffort`); the snake_case YAML key `reasoning_effort` exists only
  at the document boundary, in the parser in `src/domain/workflow.ts` and the writer in
  `src/domain/board-model-field.ts`. Verify `tests/domain/workflow.test.ts` asserts that a workflow
  differing only in `model` has different `workflowMeaning`, and `tests/domain/hub-schema.test.ts`
  accepts a stored board whose parsed workflow and YAML agree on the mapping and rejects one where
  they disagree.
- [x] 1.4 Rename the persisted schedule mapping to a shared name in `src/domain/hub-schema.ts`
  (`scheduleModel` → `modelSelection`) and reuse it for the board mapping's shape checks; verify
  `tests/domain/hub-schema.test.ts` and `tests/domain/hub-schedules.test.ts` stay green with no
  change to schedule validation.

## 2. Domain — One Place Decides Precedence and Availability

- [x] 2.1 Add `src/domain/model-preference.ts`, free of Node and schema imports, with `modelKey`,
  `parseModelKey`, `modelIsAvailable(catalog, selection)`, and
  `resolveTaskConversationModel({ boardModel })` returning the board model or `undefined`; verify a
  new `tests/domain/model-preference.test.ts` covers key round-trips, a key containing unusual
  characters, membership by provider and model, reasoning effort not affecting availability, and
  an absent board model.
- [x] 2.2 Express "an unreadable catalog is not available" inside `modelIsAvailable` rather than
  at its callers; verify the domain test covers an empty catalog and that a caller passing
  `undefined` for the catalog gets the same answer as an empty one.

## 3. Host — One Session Model Mechanism, Two Policies

- [x] 3.1 Rename `src/host/schedule-model.ts` to `src/host/session-model.ts`, rename
  `ScheduleModelPort` to `SessionModelPort`, and change `apply` to resolve a discriminated outcome
  — `applied`, `unavailable`, or `unsupported` — instead of throwing for a missing catalog entry,
  keeping `catalog(refresh?)` and the `SessionModelFace` adapter unchanged; verify
  `tests/host/schedule-model.test.ts` (renamed `tests/host/session-model.test.ts`) covers a
  successful apply, an entry absent from the catalog, a host without the model face, and that
  nothing writes the installation default.
- [x] 3.2 Keep the schedule's fail-closed policy at its call site in `src/host/schedule-runner.ts`
  by turning a non-`applied` outcome for `schedule.model` into the existing recorded failure
  before the prompt is sent; verify `tests/host/schedule-runner.test.ts` still asserts that the
  occurrence fails, records the failure, sends nothing, and archives the session it created.
- [x] 3.3 Rename the port's construction and wiring in `src/host/app.ts` and any schedule wiring
  file; verify `tests/host/schedule-wiring.test.ts` and `tests/host/schedule-commands.test.ts`
  stay green with the renamed port.

## 4. Host — Apply the Board Default at Conversation Creation

- [x] 4.1 Add the board's default model to the conversation funnel in
  `KanbanApp.createConversationNow` (`src/host/app.ts:437`): resolve it from the located task's
  board through `resolveTaskConversationModel`, apply it after the session exists and before the
  session is attached to the task, and never let a failed apply block creation; verify
  `tests/host/app.test.ts` covers a board with an available model, a board with no model, a model
  the catalog lacks, and that a conversation created outside any board is untouched.
- [x] 4.2 Report the outcome on the conversation receipt: add an optional `model` field to
  `CommandReceipt` in `src/shared/types.ts:198` carrying the requested selection and whether it
  applied, fell back as unavailable, or was unsupported, and mirror it in `SnapshotSchema`'s
  `commandReceipt` in `src/remote.ts:118`; verify a host test asserts the receipt on
  `conversation.create` and that a receipt without the field still parses.
- [x] 4.3 Keep schedule occurrences out of the board inheritance: verify `tests/host/app.test.ts`
  or `tests/host/schedule-runner.test.ts` states that a schedule run with its own model still
  applies it, and that a schedule run with no model applies no board model.
- [x] 4.4 Confirm in the pinned DSH checkout that the host services the port uses — the session
  model face, the model catalog, and the `conversation.input.model` slot — carry no `@deprecated`
  marker, and record the replacement in `design.md` if one does; verify the recorded outcome in
  the pull request description.

## 5. Client — One Model Picker for Both Configuration Surfaces

- [x] 5.1 Extract `src/client/settings/model-picker-field.tsx` from
  `src/client/settings/schedules/schedule-editor-dialog.tsx:25-35` and :68-77, owning the
  `provider::model` option list built through `modelKey`, the appended "(not in the catalog)"
  entry, the "Host default model" option, and the reasoning-effort select with an empty value
  meaning the model's own default; verify `tests/client/schedules-settings.test.tsx` and
  `tests/client/configuration-schedules.test.tsx` stay green unchanged, proving the extraction is
  behavior-preserving.
- [x] 5.2 Move the `provider::model` encoding out of JSX onto the domain helpers and have the
  picker take the catalog as a prop with a `refresh` callback; verify a component test covers a
  stale stored selection, a catalog refresh, and the default option.

## 6. Client — Board Configuration Control

- [x] 6.1 Add `src/client/settings/board/board-model-form.tsx` that composes `ModelPickerField`,
  presents "Host default model" as the choice that removes the mapping, and writes the root `model`
  key through `writeRootField` with `fieldKeys: ['model']` before the ordinary board-workflow save;
  verify a new `tests/client/board-model-form.test.tsx` covers choosing a model, clearing it,
  preserving comments outside the mapping, and refusing to save an invalid document.
- [x] 6.2 Present a non-dismissible state readout in that form when the stored model is absent
  from the catalog, naming the stored provider and model without removing or rewriting them;
  verify a component test asserts the readout, the kept selection, and the absence of any write.
- [x] 6.3 Compose the new form into `src/client/settings/board-settings.tsx` alongside
  `BoardIdentityForm`, `BoardProjectScopeForm`, `BoardDeletionControl`, and `WorkflowEditor`,
  keeping each concern's own form and command; verify `tests/client/board-scope.test.tsx` and the
  existing board configuration tests stay green and that saving one form does not touch the
  others' drafts.

## 7. Client — Preparation Gate

- [x] 7.1 Give `executionPreparationPlan` in `src/client/execution-preparation/gate.ts` the
  board's model and the catalog and make the model part apply only when
  `modelIsAvailable` is false, treating an unreadable catalog as unavailable; verify
  `tests/client/execution-preparation-gate.test.ts` covers a board model available (no model
  part), no board model (model part), a model absent from the catalog (model part), a catalog that
  failed to load (model part), and no preparation at all when the worktree part also does not
  apply.
- [x] 7.2 Pass the board model and catalog from
  `src/client/execution-preparation/use-execution-preparation.tsx` through `PreparationPorts` in
  `controller.ts`, and confirm the native seat in `model-seat.tsx` is only mounted when the model
  phase is reached; verify `tests/client/execution-preparation-controller.test.ts`,
  `tests/client/execution-preparation.test.tsx`, and
  `tests/client/native-model-seat.test.tsx` cover the skipped step, the reopened step, and the
  host-without-the-slot case.

## 8. Client — The Fallback Notice

- [x] 8.1 Render a dismissible notice from the conversation receipt's `model` outcome in
  `src/client/conversation-notices.tsx`, naming the requested model and the model in use, with the
  outcome remembered by the mounted board (`src/client/model-fallbacks.tsx`) and the dismissed set
  kept in the drawer's view state only; verify a new
  `tests/client/conversation-model-notice.test.tsx` covers the notice on a fallback, dismissal for
  the conversation, reappearance after it is closed and reopened, no notice when the model applied,
  and no notice when the board names no model.
- [x] 8.2 Keep the notice non-blocking: verify a test asserts that a conversation created by the
  automatic first-execution preparation still arms its countdown and can send its instruction while
  the notice is visible, and that the preparation is not reported as failed.

## 9. Agent Tools

- [x] 9.1 State the board's default model in the `get_board_summary` `include_workflow` payload and
  in the `update_board` and `create_board` descriptions in `src/host/tools/boards.ts`; verify
  `tests/host/board-tools.test.ts` covers a board with a model, a board without one, a workflow
  that sets it, a workflow that clears it, and a rejected malformed mapping leaving the board
  unchanged.

## 10. Documentation

- [x] 10.1 Document the board default model in the README board-configuration section and in
  `docs/operations.md`: the YAML shape, the configuration control, the preparation skipping the
  model step, the fallback notice, the board-configuration readout, and the fact that the
  installation default is never written; verify `rg -n "model" README.md docs/operations.md`
  describes the board default and does not claim the model step is always presented.

## 11. Verification

- [x] 11.1 Run `pnpm check` and confirm both typechecks, the full vitest suite, and the build pass
  with the new domain, host, and client tests included.
- [x] 11.2 Run `pnpm test:browser` in light and dark appearances, assert the picker, the
  board-configuration readout, and the notice contrast against host tokens, and store the
  screenshots under `.verification/`.
- [x] 11.3 Run `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only prepare` with
  `DSH_SNAPSHOT=replay` and a replay override whose board names a model, asserting that the model
  step is skipped when the model is available and presented when it is not, and keep the model
  traffic deterministic with no real model call.
- [x] 11.4 Run the fresh isolated web instance from AGENTS.md with a throwaway `DSH_HOME` and the
  `kanban-smoke` profile, exercise the preparation, the notice, and the board configuration control
  against the smoke checklist, and store the report and screenshots under `.verification/` without
  tokens or owner data.
- [x] 11.5 Run `openspec validate "add-board-default-model" --strict` and confirm the change stays
  valid after implementation.

## 12. Review Follow-ups

- [x] 12.1 Carry a third apply reason, `failed`, end to end: `ModelApplyReason` in
  `src/shared/types.ts`, a total `SessionModelPort.apply` that never rejects for policy, the
  receipt schema in `src/remote.ts`, `SESSION_MODEL_FAILED` in `src/host/schedule-runner.ts`, and a
  notice copy for a host that could not be asked. Verify the host, first-execution, and notice tests
  each name the reason.
- [x] 12.2 Thread the created conversation's outcome through `FirstExecutionConversation` and
  `startFirstExecutionNow` so the `task.prepareFirstExecution` receipt carries `model` exactly like
  `conversation.create` does, and mirror it in `tests/client/helpers.ts`. Verify
  `tests/host/first-execution.test.ts` asserts both receipt shapes and the absent model on a path
  that reuses an existing conversation.
- [x] 12.3 Record the outcome for a conversation created by the automatic start as well as the
  manual one, and keep dismissal in `TaskDrawer` so it resets with the drawer. Verify
  `tests/client/conversation-model-notice.test.tsx` covers the **New task** path, section
  navigation, closing and reopening a conversation, and closing and reopening the drawer.
- [x] 12.4 Keep the shared workflow draft intact: the board model form writes only the `model:`
  field through its own command and is disabled while the workflow editor holds unsaved text.
  Verify `tests/client/board-model-form.test.tsx` asserts the exact saved YAML, the disabled save,
  and that the draft setter is never called.
- [x] 12.5 Make the picker editable in both directions: choosing **Model default** clears a stored
  reasoning effort, and a stored effort the catalog no longer offers stays visible and keeps its
  meaning. Verify `tests/client/model-picker-field.test.tsx`.
- [x] 12.6 Say what the reopened model step accepts, naming the model the board wanted and what
  **Start execution** begins it on. Verify both branches in
  `tests/client/execution-preparation-dialog.test.tsx`.
- [x] 12.7 Give the notice its own painted container with a heading, the sentence, and the dismiss
  action, and measure 4.5:1 contrast in both appearances through the plugin browser lane, which
  resolves `var()` and `color()` values it actually paints rather than treating an unreadable
  colour as black. Verify `tests/browser/board-model.spec.ts`.
- [x] 12.8 Coalesce concurrent catalog reads and keep `modelCatalog` independent of the schedule
  runtime so board configuration works when no schedule runtime is wired. Verify
  `tests/host/session-model.test.ts` and `tests/host/app.test.ts`.
- [x] 12.9 Deduplicate requested preparation targets in `scripts/e2e-dsh.mjs` so the board model
  scenario is registered once. Verify with
  `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only prepare`.
