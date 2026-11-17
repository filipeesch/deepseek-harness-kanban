# Tasks

## 1. Decision definition and workflow parsing

- [x] 1.1 Add `src/domain/decision-definition.ts` with a strict schema and parser for the decision block (question, context, option count, identifier shape, title length, description length, destination identity) and a canonical form for comparison; verify with a new `tests/domain/decision-definition.test.ts` covering every accepted and rejected shape.
- [x] 1.2 Extend `Column` in `src/shared/types.ts` with `decision` and extend `parseWorkflow` in `src/domain/workflow.ts`: accept the block, reject it combined with `on_enter_prompt`, `allowed_transitions`, `scripted`, or `deterministic`, and reject an unknown or self option destination; verify in `tests/domain/workflow.test.ts`.
- [x] 1.3 Add `decision` to `StagePatch` and write it in `src/domain/stage-update.ts` (authored text writer, clearing the conflicting fields, option destinations following a stage rename and a stage removal refusing to empty a gate); verify in `tests/domain/stage-update.test.ts`.
- [x] 1.4 Teach the persisted workflow codecs in `src/domain/schema-parts.ts` (column, canonical shape, workflow identity) about the block; verify existing schema and storage migration tests still pass and add a round-trip assertion.

## 2. Routing ownership and stage identity

- [x] 2.1 Extract `src/domain/stage-identity.ts` with identity allocation, reconciliation, `captureStageTargets`, and captured-target resolution, and leave `scripted-state.ts` with the scripted control only; verify `tests/domain/scripted*/*.test.ts` and `tests/domain/hub-operations.test.ts`.
- [x] 2.2 Extract `authoredStageTargets(column)` in `src/domain/transitions.ts` and use it from `authoredTransitions`, `transitionTargets`, and the warning destinations; verify `tests/domain/transitions.test.ts` and `tests/domain/workflow-warnings.test.ts`.
- [x] 2.3 Add one routing-owner predicate and replace the scripted-only checks in `transition-route.ts`, the exceptional admission, and the exceptional declaration write; verify `tests/domain/transition-route.test.ts`, `tests/host/exceptional-turn.test.ts`, and `tests/host/exceptional-integration.test.ts`.
- [x] 2.4 Make `transitionAccess` report every other stage as restricted from a decision stage, and make the default, advance, and next-stage routes return none for it; verify in `tests/domain/transitions.test.ts` and `tests/client/stage-advance.test.ts`.
- [x] 2.5 Freeze the identity of a decision stage and its option destinations in the workflow save path; verify in `tests/domain/hub-operations.test.ts`.

## 3. Durable choice and history

- [x] 3.1 Add the `task.decide` command to `src/shared/types.ts` and handle it in `src/host/app.ts` inside the serial lane, validating the entry, the task's busy state, the current option, and its destination, and persisting a pending transition that carries the decision; verify with a new `tests/host/decision-routing.test.ts`.
- [x] 3.2 Extend `PendingTransition` and its strict schema with the decision payload and map it in the drain to the `decision:<option>` stage-entry origin, the observation, and the composed transition reason; verify the routing test above and `tests/domain/schema.test.ts`.
- [x] 3.3 Extend the stage-entry history record and its strict codec with the chosen option and the observation, record it on placement, and present it in `src/client/history/history-view.ts` with a renamed and a removed option; verify `tests/domain/task-history.test.ts` and `tests/client/history-view.test.ts`.
- [x] 3.4 Compose the destination reason from the option title, the observation, and, when it fits, the description, bounded by the accepted reason length without truncating the title; verify `tests/host/transition-briefing-send.test.ts` and the routing test.
- [x] 3.5 Refuse a stale choice and prove that a retried submission does not duplicate the placement, the history entry, or the instruction; verify with the routing test and a simulated interrupted response.

## 4. Tools and the workflow summary

- [x] 4.1 Report the routing owner and the gate's options in `list_allowed_transitions`, and refuse an ordinary and an exceptional declaration from a decision stage in `set_next_transition`; verify `tests/host/transition-tools.test.ts`.
- [x] 4.2 Add `set_stage_decision` to `src/host/tools/authoring.ts` behind the workflow architect gate, refusing the conflicting stage writers and reporting the changed decision fields; verify `tests/host/script-authoring.test.ts` and `tests/host/board-authoring.test.ts`.
- [x] 4.3 Project the decision stage in `src/host/workflow-summary.ts`: the decision type and policy, the bounded question, and one record per option with title and destination, omitting descriptions; verify `tests/host/workflow-summary.test.ts` and `tests/host/task-context.test.ts`.

## 5. Journal, revisions, and sharing

- [x] 5.1 Carry the decision block in the journal event vocabulary: `StageDefinition`, the stage field-change value, derivation through stable identities, materialization, and the conditional new event format version; verify `tests/domain/journal-*.test.ts`.
- [x] 5.2 Include the block in workflow difference and in revision comparison and summaries; verify `tests/domain/workflow-difference.test.ts` and `tests/host/board-revisions.test.ts`.
- [x] 5.3 Publish and apply the block through board sync, report a board that requires a plugin update on an older peer, and keep the layout stamp unchanged; verify `tests/host/sharing-per-board-service.test.ts` and the journal version tests.

## 6. Client surface

- [x] 6.1 Extract the structured-question presentation into a shared presentational slide (context, question, options, descriptions) and make `QuestionForm` use it without changing its round state machine; verify the existing question tests and `pnpm test:browser`.
- [x] 6.2 Add the decision panel to the task drawer above its sections, with selection, the optional observation, confirm, collapse, and the shared presentation; verify with a new `tests/browser/decision-panel.spec.ts` in light and dark appearance.
- [x] 6.3 Add the board-level five-second window controller with one entry per task, the card and panel countdown, cancel, reload behavior, and submission of `task.decide`; verify with a new `tests/client/decision-window.test.ts` and a browser spec for the cancel path.
- [x] 6.4 Present the decision attention fact on the card (tint, mark, status line) and remove the advance action in a decision stage; verify `tests/client/board-projection.test.ts` and the card browser specs.
- [x] 6.5 Wire the panel, the window, and the card into the board and drawer composition so the gate works without a conversation; verify the browser spec exercises a task with no conversation.

## 7. Editor and authoring UI

- [x] 7.1 Add the third execution mode and the Decision tab to the stage editor draft, tabs, and dialog, with inline validation, mode switching that clears the conflicting mode, and the description kept on the Stage tab; verify `tests/client/stage-editor-draft.test.ts` and a new browser spec.

## 8. Presets, docs, and distribution

- [x] 8.1 Update the workflow design skill and its YAML reference with the decision block and `set_stage_decision`, and update the workflow operator skill to state that the person answers a gate; verify the preset tests and the documented size ceilings.
- [x] 8.2 Document the stage type in the product documentation and bump `version` in `package.json`; verify the manifest and the distribution compatibility test.

## 9. Verification

- [x] 9.1 Run `pnpm check` (host and client typechecks, vitest, and the build) and fix every failure.
- [x] 9.2 Run `pnpm test:browser` for the decision panel, the card attention surface, and the countdown in light and dark appearance, and keep the screenshots under `.verification/`.
- [x] 9.3 Run the isolated real-composition lane with a decision stage and a replayed session: answer the gate, verify the destination instruction carries the reason, verify a completed turn does not cross the gate, and verify a canceled window applies nothing.