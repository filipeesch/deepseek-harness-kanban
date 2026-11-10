# Tasks

## 1. Domain: stage patch and the range writer

- [x] 1.1 Add the `StagePatch` type (name, entry instruction, initial flag, allowed transitions, new identifier) to `src/shared/types.ts` and verify both the host and client typechecks pass with `pnpm typecheck`.
- [x] 1.2 Generalize `src/domain/yaml-map-fields.ts` into a field-level writer that can write scalar text, a block sequence of maps, removal of a key, and a new key at a column's indentation, and verify new unit tests in `tests/domain/` cover an inline dash column, a block scalar, a flow collection, and a column that lacks the key.
- [x] 1.3 Implement `src/domain/stage-update.ts` (`updateStage`) that applies a patch to one stage's authored text and returns the new text plus rename metadata, and verify unit tests show only the patched fields change while comments, key order, and other stages stay byte-identical.
- [x] 1.4 Implement the identifier cascade inside `stage-update.ts`: `initial_column`, `groups[].columns`, other stages' `allowed_transitions[].to`, and `connections[].from`/`to`, and verify unit tests cover each reference kind, including a connection whose target is the renamed stage.
- [x] 1.5 Verify the produced text always re-parses: assert `parseWorkflow(updateStage(...).text)` succeeds for every fixture and that an invalid result throws before any store write.

## 2. Host: the atomic stage update command

- [x] 2.1 Add `board.stage.update` to the command union in `src/shared/types.ts` and to the remote schema in `src/remote.ts`, and verify `CommandSchema` accepts the documented shape and rejects an unknown command field, `initial: false`, and an extra transition key in `tests/host/stage-command.test.ts`.
- [x] 2.2 Add `updateBoardStage` to `src/domain/hub-operations.ts` that applies the pure update, migrates idle tasks (`columnId`, pending and recorded transitions, unresolved instruction marker), and stores through the existing `saveBoardWorkflow` path, and verify `tests/domain/hub-operations.test.ts` covers a successful rename with two idle tasks.
- [x] 2.3 Implement the in-flight-work gate in the host and reject with `STAGE_RENAME_IN_FLIGHT`, and verify tests cover each condition (running conversation, pending transition, armed automatic advance, unresolved instruction, operation in progress, worktree preparing or in error).
- [x] 2.4 Wire `BoardAdministration.updateStage` with `expectedRevision` and the publishing policy, dispatch it in `src/host/app.ts`, and verify `tests/host/stage-command.test.ts` covers the revision conflict while `tests/host/board-administration.test.ts` covers the bound-board save, the activity refusal, and the allowed rename.
- [x] 2.5 Verify a rejected rename stores neither the workflow text nor the task migration: a duplicate identifier and a connection-merge conflict both leave the authored YAML and the task stages exactly as they were.

## 3. Client: shared stage header in both presentations

- [x] 3.1 Extract the shared stage header into `src/client/stage/stage-header.tsx` and make the diagram's exported `StageHeader` an adapter that keeps the drag wiring, and verify the existing diagram header browser tests still pass.
- [x] 3.2 Break `src/client/board/board-columns-view.tsx` into a column section component plus a header usage, and verify the board browser tests still pass and no board markup test needs updating beyond locators.
- [x] 3.3 Present the stage edit action in the shared header after the card count, stopping pointer propagation, and verify a browser test finds it on every stage of both presentations.
- [x] 3.4 Verify the action stays available with the layout lock on and during card selection, that pressing it starts no drag, resize, or placement-history entry, and that opening the editor leaves the selection intact.

## 4. Client: the stage editor

- [x] 4.1 Implement `src/client/stage/stage-editor-draft.ts` with `stageDraft`, `stagePatch`, validation, and the duplicate-name check, and verify `tests/client/stage-editor-draft.test.ts` covers empty name and identifier, unsafe id, empty restricted set, duplicate and self destinations, the duplicate-name warning, patch narrowness, and the rename gate.
- [x] 4.2 Implement `src/client/stage/use-stage-editor.ts` receiving `run` by injection, and verify the browser spec saves a patch, keeps the draft on an invalid submit, and reports problems inline.
- [x] 4.3 Implement `src/client/stage/stage-editor-dialog.tsx` composing the identity, instruction, transitions, and initial sections, and verify a browser test opens it from the pencil, edits the name, saves, and sees the new name in the header.
- [x] 4.4 Implement the allowed-transition checklist with the unrestricted mode and per-target conditions, and verify tests cover choosing targets, rejecting an empty restricted set, and the "any stage" mode removing the field.
- [x] 4.5 Implement the condition expand action as a nested modal, rendered beside the stage form so it cannot submit it, and verify a browser test confirms the text returns without a command, that Escape closes only the nested editor, and that focus returns to the row that opened it.
- [x] 4.6 Implement the "Make initial" action shown only for a non-initial stage, and verify a browser test asserts the task creation action moves to the new initial stage after saving.
- [x] 4.7 Implement the identifier field with the client-side gate and its explanation, and verify a browser test asserts it is read-only with in-flight work and editable without it.
- [x] 4.8 Verify focus returns to the pencil on dismiss and that cancel, Escape, and the close action store nothing.

## 5. Refactor: one save helper

- [x] 5.1 Extract the workflow save helper (dirty check, `expectedRevision`, rejection to inline problem) and use it from the stage editor, and verify the stage editor browser tests still pass.
- [x] 5.2 Move `src/client/workflow-editor.tsx` onto the helper and share its revision lookup with `src/client/workflow-view/use/use-placement-saver.ts` (which keeps its own concurrency-aware save loop), and verify their existing browser tests pass unchanged.

## 6. Test infrastructure and full verification

- [x] 6.1 Teach `tests/browser/fake-api.ts` the `board.stage.update` command, applying the patch to its workflow text and its tasks, and verify a UI save test observes the mutated snapshot.
- [x] 6.2 Run `pnpm check` and verify host and client typechecks, vitest, and the build all pass.
- [x] 6.3 Run `pnpm test:browser` and verify the new specs pass in light and dark themes with host-token assertions.
- [x] 6.4 Run the isolated real-composition lane (`node scripts/e2e-dsh.mjs --checkout <checkout> --only board`) and verify the pencil and the saved stage edit work against a temporary `$DSH_HOME`.

## 7. Review evidence

- [x] 7.1 Capture screenshots of the pencil in both presentations, the editor, the transitions checklist, the expanded condition editor, and the read-only identifier state, and store them under `.verification/` with no token, credential, or owner data.
- [x] 7.2 Write a short report under `.verification/` describing what each screenshot proves and which requirement it covers.
- [x] 7.3 Ask the reviewer to review the screens as well as the code, and verify the review records an explicit verdict on the visual states.
