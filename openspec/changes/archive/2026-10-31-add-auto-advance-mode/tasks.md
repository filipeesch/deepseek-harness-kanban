# Tasks

## 1. Shared contracts and domain rules

- [x] 1.1 Extract the shared persisted-schema fragments into `src/domain/schema-parts.ts` (primitives, operation, pending transition, workflow pieces, base task, shared task invariants with a column resolver) and compose them from `src/domain/schema.ts` and `src/domain/hub-schema.ts`; verify `pnpm vitest run tests/host/storage-migration.test.ts tests/domain/store.test.ts tests/domain/hub-schema.test.ts` and `pnpm run typecheck` pass without changing existing fixtures.
- [x] 1.2 Add the optional task auto-mode state (`enabled` plus optional `pause { reason, at, message? }`) and the optional `pendingTransition.origin: 'auto'` to the shared fragments; verify a new schema test accepts a task with and without both fields, rejects an unknown reason or extra key, and that a persisted transition without `origin` still parses as user-confirmed.
- [x] 1.3 Add `task.autoMode { taskId, enabled }` to the `Command` union, `CommandSchema` in `src/remote.ts`, and the host command dispatch; verify a schema test accepts the variant, rejects a missing or extra field, `pnpm run typecheck` passes, and `KanbanApp.command` enables and disables without moving the task or sending anything.
- [x] 1.4 Create `src/domain/auto-advance.ts` with the pure path resolver (`resolveAutoAdvance(workflow, fromColumnId)`) including the configured-first rule, workflow-order fallback, empty-list and self-transition dead ends, cascade to the first instructed stage, last-reachable stop, and the visited-stage guard; verify `tests/domain/auto-advance.test.ts` covers each case and asserts the captured destination and instruction.
- [x] 1.5 Add a host command test proving the auto-mode mutation is scoped to the task's Hub and that moving, editing, or reading the task leaves `autoMode` unchanged; verify `tests/host/hub-commands.test.ts` or a focused new case passes.

## 2. Host stage-instruction admission

- [x] 2.1 Create `src/host/stage-instruction.ts` exposing one admission path (entry identity, reviewed instruction, target resolution, execution-context validation, send with the record's request identity, marker clearing) and route `KanbanApp.runInstruction` through it; verify every existing instruction test in `tests/host/app.test.ts` passes unchanged and each rejection sends nothing.
- [x] 2.2 Route the confirmed-transition drain's `mode: 'run'` send through the same path, keeping the pending record id as the request identity and the existing failure recording; verify `tests/host/legacy-pending.test.ts`, the pending retry/recovery cases in `tests/host/app.test.ts`, and `tests/host/move-override.test.ts` pass.
- [x] 2.3 Remove the duplicated marker-clearing from the two callers and prove the single behavior: a successful send clears the current entry, a failed send keeps it, and a resolved or replaced entry is rejected with the existing error; verify with focused host tests for each case.
- [x] 2.4 Prove the five-second client path is unchanged: a `task.runInstruction` from the existing countdown still sends the exact instruction to the first open conversation and creates one when none is open; verify the existing auto-run and instruction client/host suites pass without edits.

## 3. Host automatic advance

- [x] 3.1 Create `src/host/auto-advance.ts` with `AutoAdvanceCoordinator`, injected ports (`tasks`, `facts`, `resolveTarget`, `admit`, `dispatch`, `schedule`, `report`), turn-end reason filtering, the settle tick, and the in-memory `(sessionId, seq)` dedupe; verify `tests/host/auto-advance.test.ts` drives the settle tick deterministically and covers `completed` versus every other reason.
- [x] 3.2 Implement the idle gate (all open conversations `running === false` and `awaitingReply === false`, fail closed on a read error) and the admission guards (unresolved operation, unresolved confirmed transition, unresolved current entry, disabled auto mode); verify tests show no admission for each condition and that no pause is recorded for a guard.
- [x] 3.3 Implement admission: resolve the destination through the domain resolver, resolve the target as the first open conversation or create one with the existing allow-undecided path, persist one transition with `origin: 'auto'`, captured text, concrete session id, and `status: 'waiting'`, then dispatch through the app's serialized path; verify a host test asserts one transition, one conversation at most, the move, the send, and the captured instruction.
- [x] 3.4 Implement the pause writers and clearers: record `turn-error`, `turn-blocked`, `turn-aborted`, `turn-max-tokens`, and `advance-failed`; clear on an admitted advance, on disable, and on any move; verify tests for every writer, every clearer, and that reading/acknowledging a conversation does not clear.
- [x] 3.5 Implement the no-catch-up rule and restart behavior: only live observed turn ends trigger, an undelivered persisted transition is dispatched on initialization, and a turn that ended while unobserved is not replayed; verify with a restart test and a duplicate-event test that no second advance is admitted.
- [x] 3.6 Wire the coordinator into `KanbanApp` and `src/index.ts` so `observe` forwards `turn/end`, the coordinator shares the app's serialized command path, and disposal releases listeners and timers; verify a disposal test, a no-listener-after-close test, and `pnpm test` for the existing host suites.

## 4. Client auto-mode control

- [x] 4.1 Create `src/client/auto-mode.tsx` with the pure `autoModeView` derivation (failed admitted advance, admitted advance, unresolved entry, no next stage, persisted pause, armed) and `CardAutoModeControl` with pressed state, accessible name, always-visible off state, and selection-mode omission; verify `tests/client/auto-mode.test.tsx` covers every derived state and the accessible contract.
- [x] 4.2 Compose the control into `TaskCard`'s context region and feed the derived entries into the status strip, including the pointer-down exclusion so the toggle neither opens the drawer nor starts a drag; verify `tests/client/task-card.test.tsx` and the existing board interaction tests.
- [x] 4.3 Wire the toggle through `board.tsx`'s existing `run` path with an in-flight busy state and error reporting, and keep `TaskCard`'s interface narrow; verify `tests/client/board.test.tsx` asserts the command payload and that a failed toggle leaves the pressed state unchanged.
- [x] 4.4 Add the drawer mirror: `DrawerAutoModeToggle` in the header actions, `AutoModeNotice` above the section panel for admitted, failed, and paused states, and no section change; verify `tests/client/auto-mode.test.tsx` renders the drawer cases and the drawer stays in its current section.
- [x] 4.5 Add card and drawer styles for the chip, the pressed and paused tones, and the notice using host theme tokens, with no new action row and unchanged card height; verify `pnpm test:browser` appearance assertions and a light/dark contrast check in the browser harness.

## 5. Verification, documentation, and gates

- [x] 5.1 Extend the browser harness fixture (`tests/browser/fake-api.ts`, `tests/browser/harness.tsx`) with an auto-mode scenario and add `tests/browser/auto-mode.spec.ts` for the chip, the status strip reasons, the drawer toggle and notice, keyboard activation, and both appearances; verify `pnpm test:browser` passes and writes the screenshots under `.verification/`.
- [x] 5.2 Add a deterministic real-composition lane for the automatic path: a new `tests/e2e-dsh/kanban-auto-mode.e2e.template.ts` and replay override, registered in `scripts/e2e-dsh.mjs` with its own env var and `--only` value; verify `node scripts/e2e-dsh.mjs --checkout <checkout> --check` and the lane complete with `DSH_SNAPSHOT=replay` and no real-model call.
- [x] 5.3 Verify the isolation and timing contract in the real lane: enabling auto mode, completing a replayed turn, observing the card move and the next instruction sent, and confirming no five-second countdown is armed and no second conversation is created.
- [x] 5.4 Update `README.md` (card controls, drawer header, automatic advance behavior, pause and failure, no catch-up) and any affected operations guidance; verify no statement contradicts the specs and the five-second behavior description is unchanged.
- [x] 5.5 Run `pnpm check` and verify host and client typechecks, the full vitest suite, and the build pass; run `pnpm test:browser` and verify the plugin-owned harness passes.
- [x] 5.6 Run `openspec validate add-auto-advance-mode --strict` and verify both spec deltas and every artifact validate, then re-read the change artifacts for consistency with the final implementation.

## 6. Verification follow-ups

- [x] 6.1 Require the resolved source stage (`fromColumnId`) at admission and re-resolve the destination against the current workflow; a moved task is skipped and a changed destination records `advance-failed` (CR02, CR05).
- [x] 6.2 Count pending Kanban decision questions as waiting in the idle gate (CR03).
- [x] 6.3 Add `operation.dismiss` recovery and automatic-origin recovery wording/actions in the drawer (CR04, CR06).
- [x] 6.4 Tag pause writes with the observed stage and forget queued settles when auto mode is disabled (CR14, CR15).
- [x] 6.5 Reset admission text to the reviewed instruction, restore the entry-then-instruction error order, and restore the recursive JSON value schema (CR12, CR13).
- [x] 6.6 Add the advancing chip state, remove the dead card selector, and track in-flight auto-mode commands per task (CR09, CR10, CR11).
- [x] 6.7 Align `autoModeView` precedence/copy with design and document the actual coordinator ports, revalidation, pause identity, dismissal, and forget behavior (CR08, CR17).
- [x] 6.8 Fix the docs contradiction and register/document the auto-mode e2e lane; make the e2e workflow terminal at review (CR07, CR16).
- [x] 6.9 Re-run `pnpm check`, the full `pnpm test:browser`, the real auto-mode lane on the pinned checkout, and `openspec validate --strict` (CR01).
