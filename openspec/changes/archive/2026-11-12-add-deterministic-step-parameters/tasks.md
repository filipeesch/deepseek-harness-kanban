# Tasks

## 1. Shared contract and domain

- [x] 1.1 Add `DeterministicParameter` and the typed `DeterministicInput` to `src/shared/deterministic.ts`, and add `params` to `DeterministicCapture`, `parameters` to `DeterministicControl` and `DeterministicSummary`; verify the shared typecheck passes and existing consumers of the capture type still compile.
- [x] 1.2 Extend `src/domain/deterministic-definition.ts` with the parameter declaration schema (unique safe name, optional description, accepted count) and include it in the canonical comparison; verify schema tests for valid, duplicate, unsafe, empty-description, and oversized declarations.
- [x] 1.3 Add the shared limit constants (count, name, description, value, total) and one validation helper; verify boundary tests for each limit and that the same helper is used by parsing.
- [x] 1.4 Add `params` to the deterministic field rewrite in `src/domain/deterministic-write.ts` and to the equality/diff path in `src/domain/stage-update.ts`; verify a round-trip keeps inline code, comments, and quoting untouched while adding or removing a declaration.
- [x] 1.5 Update `src/domain/deterministic-state.ts`: the capture schema carries only parameter names, the control carries the entry values, and `establishStageEntry` accepts optional parameters; verify domain tests for a fresh entry, a repaired entry, and a later entry that inherits nothing.

## 2. Workflow authoring and the shared journal

- [x] 2.1 Accept `deterministic.params` in `src/domain/workflow.ts` and confirm a parameterized stage is valid as the initial stage and as an exit or transition destination; verify parse tests for both compositions and for invalid declarations.
- [x] 2.2 Bump `EVENT_FORMAT_VERSION` and `BOARD_LOG_VERSION` to 3 in `src/domain/journal/event.ts` and `src/domain/journal/log.ts`; verify new executable events carry version 3, a retained version-2 log still decodes, and a newer version decodes as `unsupported-version` rather than `invalid`.
- [x] 2.3 Represent parameter declarations through journal creation, field change, clearing, and compaction in `src/domain/journal/`; verify a deterministic journal test recovers the declaration and contains no parameter value.
- [x] 2.4 Extend the stage editor draft and form (`src/client/stage/deterministic-draft.ts`, `deterministic-section.tsx`) with parameter name/description rows and inline validation; verify client tests for add, remove, duplicate name, and empty description.
- [x] 2.5 Verify the existing YAML diagnostic pinning covers an invalid parameter declaration in `tests/client/deterministic-yaml-diagnostics.test.ts`; no source change was required.

## 3. Transition tool surface

- [x] 3.1 Extend `TransitionWrite` and the routing port in `src/host/tools/transitions.ts` with the parameter value set and carry it into the recorded transition; verify host tests that the recorded transition stores and clears it.
- [x] 3.2 Return each target's declared parameter names and descriptions from `list_allowed_transitions`; verify a tool test for a target that declares two parameters and a target that declares none.
- [x] 3.3 Accept an open `parameters` object in `set_next_transition`, enforce exactly the declared names and the limits, reject a set for a target that declares none, name the accepted parameters in every rejection, and echo the recorded values; verify tool tests for valid, missing, unknown, empty, oversized, and no-declaration cases.
- [x] 3.4 Revalidate the recorded values against the destination's current declaration at placement and fail the pending transition with an actionable error instead of creating a mismatched entry; verify a host test where the declaration changes between recording and the move.

## 4. Placement and stage entry

- [x] 4.1 Pass optional parameter values through `placeTask` and entry establishment so `control.parameters` is written with the entry; verify a placement test that the entry holds the values and a later entry does not.
- [x] 4.2 Confirm every entry path creates the entry without a parameter gate (manual move, creation, automatic advance, deterministic routing); verify one test per path asserting the entry exists and no path refuses it.
- [x] 4.3 Forward recorded parameters through the automatic advance that consumes the recorded transition; verify the advance test.

## 5. Supervisor admission, Play, and recovery

- [x] 5.1 Extract `buildDeterministicInput` into `src/host/deterministic/input.ts` with the typed `DeterministicInput`, filtering `params` to the captured declared names, and delegate from the supervisor; verify a pure unit test plus the existing supervisor input test.
- [x] 5.2 Include the declared names in the capture content and keep values and descriptions out of the fingerprint; verify a capture test where a name change changes the fingerprint and a value or description change does not.
- [x] 5.3 Check parameter completeness after capture and before the trust gate, settling a failed configuration refusal that names the missing parameters, follows no error route, appends no history row, and preserves the entry; verify supervisor tests with an error route configured and without one.
- [x] 5.4 Revalidate on Play against the newly captured declaration and leave the entry repairable when a name is missing; verify the Play test.
- [x] 5.5 Reuse the entry's own values during recovery and ignore a saved declaration edit; verify the recovery test.
- [x] 5.6 Include the declared names in the reviewed version so a name change invalidates local approval while a value or description change does not; verify the review and trust tests.

## 6. Repair command and client surface

- [x] 6.1 Add `task.deterministicParameters` to the shared command union, `src/remote.ts`, `src/client/command-scope.ts`, the host command handler, and a supervisor method that rejects a stale entry, an active or stopping execution, an incomplete set, and a stage that no longer declares parameters; verify host tests for each rejection and for a successful write.
- [x] 6.2 Project the entry's parameter values into the snapshot summary and show them read-only in the script panel; verify the snapshot and client tests.
- [x] 6.3 Add the parameters overlay with declared names, descriptions, current values, validation, and a save action; show the edit action whenever the entry exists and is not active or stopping; verify client and browser tests in both themes.
- [x] 6.4 Show Play and the edit action on a parameter refusal, distinct from an executor failure, and confirm a saved value followed by Play starts a new execution of the same entry; verify the browser test.

## 7. History, documentation, and release metadata

- [x] 7.1 Add bounded `parameters` to the settled deterministic execution history entry and record only on settle; verify a test that an execution carries its values and that a refusal or an edit adds no row.
- [x] 7.2 Update `docs/deterministic-steps.md` with the declaration, the `input.params` field, the refusal, the repair overlay, and the limits; verify every new section and link resolves.
- [x] 7.3 Review and update the `kanban-workflow-architect` preset and its workflow-design references for the new transition argument, the validation error, and the read surface; verify the persona and skill size ceilings and the preset mount test.
- [x] 7.4 Bump `version` in `package.json` in the same change; verify the bump is the only release-metadata change and is reported by `pnpm check`.

## 8. Verification

- [x] 8.1 Run `pnpm check` and confirm host and client typechecks, vitest, and the build pass.
- [x] 8.2 Run `pnpm test:browser` and confirm the editor, panel, and overlay scenarios pass with light and dark screenshots under `.verification/`.
- [x] 8.3 Run the isolated real-composition lane with a parameterized deterministic fixture covering agent-supplied values, the refusal path, and the repair path; confirm the lane uses a throwaway `DSH_HOME`, no personal profile, and no real model traffic.
- [x] 8.4 Review the final diff for scope: only the authorized input-builder refactor is present, the two declined refactors are absent, and the host-API, preset, docs, and version checks from the project instructions are satisfied.
