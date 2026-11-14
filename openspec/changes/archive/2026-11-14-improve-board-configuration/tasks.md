# Tasks

## 1. Workflow field and writers

- [x] 1.1 Add `agentPreset?: string` to `Workflow`; accept the root `agent_preset` in `parseWorkflow` with the existing nonempty-text validation, add it to the persisted workflow schema in `schema-parts.ts`, and include it in `workflowShape`. Verify with new cases in `tests/domain/workflow.test.ts` and `tests/domain/schema.test.ts` covering acceptance, empty rejection, persisted round-trip, and a meaning change.
- [x] 1.2 Add `writeBoardAgentPresetField` in `src/domain/board-agent-preset-field.ts`, using `writeRootField` and parsing the result before returning; removal clears the root key and an unchanged value leaves the text untouched. Verify with a new `tests/domain/board-agent-preset-field.test.ts` covering append, in-place rewrite with comments, removal, quoting, flow documents, and blank input.
- [x] 1.3 Add a composed `writeBoardDefaultsField` that writes the model field and then the preset field, preserving text outside both. Verify with unit tests that change only one field, both fields, and neither field, asserting the other field's authored text and comments survive.
- [x] 1.4 Return `defaultAgentPreset` beside `defaultModel` in the `get_board_summary` workflow payload and update the board tool parameter text for `create_board`/`update_board`. Verify with `tests/host/board-tools.test.ts` cases for a stored preset, no preset, and the tool text mentioning the field.

## 2. Session preset application

- [x] 2.1 Add `src/host/session-preset.ts` with `SessionPresetPort`, an optional `agentPresets` service read, Agent resolution through `sessionController.resolveAgent`, and the outcome mapping (`unavailable`, `unsupported`, `failed`); it never rejects. Verify with a new `tests/host/session-preset.test.ts` covering applied, unknown/broken preset, absent service, unresolved Agent, locked session, and a thrown selection.
- [x] 2.2 Wire the port in `src/index.ts`; apply the board's preset before the model in `createConversationNow`; add the preset outcome to `CreatedConversation`, to the `conversation.create` and `task.prepareFirstExecution` receipts, and to the first-execution result type. Verify with host tests that a created conversation returns both outcomes, the preset call happens before the model call, and existing sessions and boards without a preset behave unchanged.
- [x] 2.3 Extend shared types and the remote snapshot schema with `ConversationPresetOutcome` and `CommandReceipt.preset`; add `creationPresetOutcome` beside `creationModelOutcome` in `ui.tsx`. Verify with typechecks and a client test that the helper reads only the conversation receipt.
- [x] 2.4 Add a per-board `preset-fallbacks` registry and a `ConversationPresetNotice` sibling to the model notice; wire creation outcomes from `useExecutionPreparation`, `useTaskCreation`, and the drawer's `conversation.create` path, plus a separate dismissal state in the drawer. Verify with `tests/client/conversation-preset-notice.test.tsx` and a drawer test covering record, dismiss, and reopen.

## 3. Configuration shell

- [x] 3.1 Add the `settings` (960px) and `settings-wide` (`min(1320px, calc(100vw - 48px))`) sizes to `Modal` and its styles, including the narrow-viewport rule; leave `default`, `wide`, and `parameters` unchanged. Verify in the browser harness that the configuration surfaces use the new classes and stay inside the viewport, and that an unrelated dialog's width is unchanged.
- [x] 3.2 Replace the stringly-typed section list with section descriptors (`id`, `label`, `size`, `render`) in `configuration.tsx`; remove the `selected === 'Board'` width branch. Verify with a client test that the Board descriptor requests the widest surface and with the existing configuration tests.
- [x] 3.3 Implement the leave/close guard in `Configuration` for unsaved board drafts reported by the Board container, combining it with the existing workflow-draft close guard. Verify with client tests for leaving Board, canceling, confirming, closing, and navigating without edits.

## 4. Board panels

- [x] 4.1 Turn `BoardSettings` into a sub-tab container over the five panels, add the per-panel dirty contract and `usePanelDirty`, and keep the workflow draft lifted above the panel. Verify with `tests/client/board-settings.test.tsx` covering tab labels, dirty reporting, confirmation on leaving a dirty panel, cancel, and the workflow panel never asking on a sub-tab switch.
- [x] 4.2 Move board name into the General panel, project scope into the Projects panel, and board deletion into the Danger zone panel, preserving their existing commands, confirmations, and status messages. Verify with the existing board identity/scope/deletion tests updated to the sub-tab navigation.
- [x] 4.3 Add `use-board-defaults` and the Defaults form: model mode, model selection, preset identity, one dirty state, one Save through `board.workflow.save` with the opened revision. Verify with `tests/client/board-defaults-form.test.tsx` covering save of both fields, save of one field, no changes, invalid document, and revision forwarding.
- [x] 4.4 Add the explicit model mode (`Host default` / `Specific model`), the required-route rule, and the stored-route readout. Verify with client tests for clearing to host default, blocking Save on a specific choice with no route, keeping a stored route the catalog lacks, and keeping a stored route when the catalog fails.
- [x] 4.5 Add the agent-preset list with name and description, the host-default option, the unavailable stored preset presentation, and the roster failure with retry. Verify with client tests for choosing a preset, choosing host default, preserving an unoffered stored preset, and retry after a roster failure.
- [x] 4.6 Keep the Defaults controls editable while a workflow draft exists, disable only Save, explain why, and provide the navigation action to Workflow; ensure the leave guard asks before discarding Defaults edits. Verify with client tests for the blocked save, no command sent, draft untouched, and the navigation path.

## 5. Native model selector

- [x] 5.1 Add `useModelCatalog` with a request-token guard and retry, and migrate the Defaults panel to it. Verify with a client test where a slower earlier read resolves after a newer one and does not overwrite it.
- [x] 5.2 Move the `{ slots, locale }` seat type to a neutral `NativeSeat` with `PreparationSeat` kept as an alias, and pass the seat from `BoardView` into `Configuration` and the Defaults panel. Verify with typechecks and the existing native seat tests.
- [x] 5.3 Add the synthetic directory adapter and `NativeModelField`: project the catalog into `ModelDirectoryState`, override the whole native face, map `select` to the form value, map `load` to the catalog retry, and render the read-only stored route when the slot is absent. Verify with `tests/client/native-model-field.test.tsx` using a stub slot entry for projection, selection, retry, absent slot, and a throwing `inject`.
- [x] 5.4 Migrate the schedule editor to the native field and the explicit host-default choice while keeping the existing `modelMode` validation and stored-model readout. Verify with updated `tests/client/schedule-editor.test.tsx` cases for choosing a route, host default, missing route, selector unavailable, and catalog validation.
- [x] 5.5 Remove `model-combobox.tsx`, `model-picker-field.tsx`, `model-options.ts`, and `tests/client/model-picker-field.test.tsx`; confirm no import remains. Verify with `pnpm typecheck` and a repository-wide search for the removed modules.

## 6. Preset cards and roster

- [x] 6.1 Extract `useAgentPresetRoster` and the built-in display mapping into `src/client/agent-preset-roster.ts`; make `AgentPresetCards` presentational over its state and reuse the hook in the Defaults panel. Verify with the existing roster failure/retry/empty tests and a test that the Defaults list uses the same roster state.
- [x] 6.2 Add `defaultPresetId` to the cards: mark the card, render the localized "Board default" badge, and focus it after the roster loads; pass `state.workflow.agentPreset` from the drawer. Verify with `tests/client/agent-preset-cards.test.tsx` cases for marking, initial focus, no marking when the roster lacks the preset, and activation still required.
- [x] 6.3 Keep the card activation flow: skip the explicit selection for the host default, select the card's preset otherwise, and leave a failed second selection on the board default. Verify with drawer tests for the host default, the board default card, a different card, and a failed selection.

## 7. Documentation and distribution

- [x] 7.1 Update the README board/default-model paragraph and `docs/operations.md` to describe the new configuration sub-sections, the native selector, and the board default agent preset. Verify by reading the rendered sections and checking that every behavior named matches the specs.
- [x] 7.2 Update the `kanban-workflow-design` skill and its references: `agent_preset` is an accepted root field with its own paragraph, the unsupported-field list no longer claims agent/preset settings are rejected, and the operations reference mentions the board summary's default preset. Verify by loading the skill and checking its references resolve and stay within the documented size ceilings.
- [x] 7.3 Update the board tool parameter descriptions and the `get_board_summary` description to name `defaultAgentPreset` beside `defaultModel`. Verify with the tool tests and by reading the generated tool descriptions.
- [x] 7.4 Bump `version` in `package.json` for the changed installed artifact. Verify with `openspec validate --strict`, `pnpm build`, and a check that the package version changed.

## 8. Browser harness

- [x] 8.1 Add harness scenarios and props for the new Configuration seat and the Defaults panel, including a stub native model seat and a no-seat variant. Verify the harness builds with `node scripts/build-browser-harness.mjs`.
- [x] 8.2 Rewrite `tests/browser/board-model.spec.ts` for the new surface: sub-tab navigation, host-default/specific modes, the stub native selection, the stored-route readout, and the absent-slot state in light and dark. Verify with `pnpm test:browser` and inspect the screenshots under `.verification/`.
- [x] 8.3 Add a browser spec for the configuration shell and Board panels: surface widths/classes, sub-tab labels, unsaved-change confirmation on leaving a dirty panel, cancel and confirm, and the workflow draft surviving a sub-tab switch. Verify with `pnpm test:browser`.
- [x] 8.4 Add appearance coverage for the marked preset card and the preset fallback notice in both host themes, asserting the rendered tokens and contrast. Verify with `pnpm test:browser` and the saved screenshots.

## 9. Real-composition verification

- [x] 9.1 Update `tests/e2e-dsh/kanban-board-ux.e2e.template.ts` for the Board sub-tab navigation (Projects and Workflow) and keep the project-scope and workflow assertions. Verify with the real-composition lane.
- [x] 9.2 Update `tests/e2e-dsh/kanban-board-model.e2e.template.ts` for the Workflow sub-tab and add an assertion that the Defaults native model selector opens and selects a route through the host component. Verify with the lane and a screenshot without credentials.
- [x] 9.3 Add a deterministic real-composition case for a board default preset: the Defaults list stores it, the card is marked, and a new conversation receives it, using a replay fixture and no real model turn. Verify with the lane and the committed replay override.
- [x] 9.4 Run the full gates: `pnpm check`, `pnpm test:browser`, the real-composition lane against an installed and built DSH checkout, and `openspec validate improve-board-configuration --strict`. Record the evidence under `.verification/` and confirm no developer profile, personal data, or credentials were touched.
