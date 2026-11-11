# Tasks

## 1. Persisted shape and the shared pause rule

- [x] 1.1 Add `AutoModeHold` and the optional `hold` field to the task's auto-mode record in `src/shared/types.ts`, and replace the `AutoModePauseReason` union with a `AUTO_MODE_PAUSE_REASONS` const tuple the union is derived from. Verify `tests/domain/schema.test.ts` accepts a document carrying a hold, rejects an unknown pause reason, and rejects a hold on a task with no auto mode.
- [x] 1.2 Point `autoModePause` in `src/domain/schema-parts.ts` at `z.enum(AUTO_MODE_PAUSE_REASONS)` and add the strict `autoModeHold` object to `autoMode`. Verify the schema tests above fail against the previous literal enum and pass after the change.
- [x] 1.3 Create `src/domain/auto-mode-hold.ts` with `activeHold`, `blocksAdvance`, `normalizePauseReason`, `applyHold`, and `clearAutoModeState`, including the exported reason length limit. Verify a new `tests/domain/auto-mode-hold.test.ts` covers each term of `blocksAdvance` separately, a trimmed reason, a blank reason rejection, and an over-limit rejection.
- [x] 1.4 Rename the client's `AutoModeState` view union to `AutoModeViewState` so it no longer collides with the persisted interface, and update its importers. Verify `pnpm check` reports no duplicate or ambiguous type name.

## 2. One blocking rule for the advance

- [x] 2.1 Replace the inline blocking triple in `resolveAdvanceDecision` with `blocksAdvance`, keeping the `busy` decision kind and its comment. Verify `tests/host/auto-advance.test.ts` gains a case where a task carrying a hold yields no advance, and the existing busy cases still pass.
- [x] 2.2 Make the admission's `blocked()` delegate to `blocksAdvance` and assert in the admission transaction that no hold is present when it commits. Verify `tests/host/auto-advance-admission.test.ts` covers a hold recorded after the settle decision and before the transaction, and reports the revision conflict without moving the task.
- [x] 2.3 Keep `AutoAdvanceCoordinator.observe` reading only `enabled` and confirm a paused task's completed turn is dropped by the decision rather than by a second rule. Verify `tests/host/auto-advance.test.ts` asserts no advance, no recorded pause, and no retry for a held task.

## 3. Operations, repository, and commands

- [x] 3.1 Add `operations.pauseTask` and `operations.resumeTask`, make `setAutoMode(true)` clear the hold as well as the diagnostic pause, and give `placeTask` a `retainAgentPause` option that keeps the hold for an automatic advance. Verify `tests/domain/hub-operations.test.ts` covers: pause records the hold, pause on a disabled task records nothing, resume clears both records, resume on an unpaused task changes nothing, a user move clears the hold, and an automatic placement keeps it.
- [x] 3.2 Add `pauseTask` and `resumeTask` to `HubStore` in `src/host/hub-repository.ts`, mirroring `setAutoMode`. Verify `tests/host/hub-commands.test.ts` persists the hold and survives a reload of the stored document.
- [x] 3.3 Add the `task.pause` and `task.resume` commands to `Command` and handle them in `KanbanApp.execute`, calling `autoAdvance.forget(taskId)` for both, and pass `retainAgentPause: pending.origin === 'auto'` where the drain calls `placeTask`. Verify `tests/host/auto-mode-command.test.ts` covers the round trip, the forgotten queued settle, and the hold surviving an automatic advance that was already admitted.

## 4. Agent tools

- [x] 4.1 Implement the `TaskPausePort` on `KanbanApp` (run the command, then re-read the located task) and create `src/host/tools/auto-mode.ts` exposing `pause_task` and `resume_task` through `requireTask`, with the reason as a required parameter. Register it from `productToolDefinitions` and verify `tests/host/tools.test.ts` lists both names in the expected surface.
- [x] 4.2 Verify a new `tests/host/pause-tools.test.ts` covers: the conversation scope, an explicit identifier for another task, a blank reason, an oversized reason, an informative success with auto mode disabled, a resume of a task that is not paused, and that neither call changes the stage, the position, or the recorded transition.

## 5. Client presentation

- [x] 5.1 Add the `paused-by-agent` state and the derived `pressed` value to `autoModeView`, order the branch before the diagnostic pause, and make `AutoModeControl` treat both paused states alike and activate them as a resume. Verify `tests/client/auto-mode.test.tsx` covers the state, the reason in the title and accessible name, the unpressed value while paused, and the resume activation; verify `tests/client/task-card.test.tsx` still passes.
- [x] 5.2 Present the reason in the card status region and keep a diagnostic pause visible beside it. Verify the status-line assertions in `tests/client/board.test.tsx` cover the pause reason, the pause beside a failed turn, and the absence of an entry for the held state.
- [x] 5.3 Update the browser lane for the new activation semantics and add a held-task scenario. Verify `pnpm test:browser` passes with the updated `tests/browser/auto-mode.spec.ts` expectations for the paused chip and a new `paused-by-agent` case.

## 6. Documentation, compatibility, and full verification

- [x] 6.1 Describe the agent pause in `README.md` (auto-mode section and the tool-name table) and in `docs/operations.md`, including the resume paths, the rule that a prompt does not resume, and the requirement that every installation on a shared Hub be on this build. Verify the tool table lists `pause_task` and `resume_task`.
- [x] 6.2 Bump `version` in `package.json` to the next minor release, because the installed artifact changes. Verify the version in the manifest and in `README.md` agree.
- [x] 6.3 Run `pnpm check` for the host and client typechecks, the vitest suites, and the build. Verify it exits clean with the new tests included.
- [x] 6.4 Repair and run the isolated real-composition lane with `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only auto-mode`. The lane was already red on the base commit: it created a task in an instructed stage and waited for the card play action, which "Automatic first execution on task creation" resolves at creation. It now creates without starting, completes the first-execution preparation, asserts the delivered instructions as collapsed plugin-sourced context rows, and asserts the dead end that a stage configuring no transitions produces. Verify the lane exits zero against an isolated profile and leaves the DSH checkout clean.
