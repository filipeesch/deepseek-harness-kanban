# Tasks

## 1. Shared entry policy and host contracts

- [x] 1.1 Create `src/domain/stage-entry.ts` with `entryInstruction(column)` and `hasUnresolvedEntry(task, columnId)`; use them in `placeTask` and `store.createTask`; verify `pnpm run typecheck` passes and the policy suite in 5.1 covers empty, whitespace-only, matching, and stale markers.
- [x] 1.2 Use the shared policy in the card action and for the `runInstruction` instruction lookup; verify a card without an instruction renders no action and the host still rejects an empty current instruction.
- [x] 1.3 Add required `expectedEnteredAt` to `task.runInstruction` in `shared/types.ts` and `remote.ts`; update the client command builder; verify the wire schema accepts the field and rejects a request without it.
- [x] 1.4 Enforce the entry identity in `KanbanApp.runInstruction` before target resolution and add the `INSTRUCTION_ALREADY_RESOLVED` rejection; verify the host guard tests in 5.5 reject a stale timestamp and a replaced entry without creating a conversation.
- [x] 1.5 Reduce `task.move` to `{ taskId, columnId, beforeTaskId? }` in the command union, wire schema, and `move()`; remove the run/worktree creation branches; verify the move-only and wire tests in 5.6 create no run record, no conversation, and no worktree.
- [x] 1.6 Keep the legacy `PendingTransition` fields in the strict schema, `drainPending`, `initialize`, and the drawer retry path, marked as legacy; verify the seeded legacy suite in 5.7 still reads and retries persisted records without a data migration.

## 2. Client auto-run controller

- [x] 2.1 Add `src/client/auto-run.ts` with an injected clock/scheduler and command runner, immutable per-task records, and `arm`, `cancel`, `runNow`, `reconcile`, `subscribe`, `getSnapshot`, and `dispose`; verify the lifecycle tests in 5.2 cover arm, replacement, cancel, expiry, independence, and disposal.
- [x] 2.2 Implement `runNow` and the shared execution path: a successful send removes the record, a failure keeps a `failed` record, and `INSTRUCTION_ALREADY_RESOLVED` ends silently; verify the failure tests in 5.4 and that no duplicate send occurs.
- [x] 2.3 Implement `reconcile(tasks)` so a deleted task, removed marker, or replaced marker drops the record without sending; verify the reconciliation tests in 5.3 and confirm a changed instruction is left to fail at admission.
- [x] 2.4 Add the `useCountdown(deadline)` hook with a short interval and whole-second output; verify the jsdom countdown tests in 5.8 derive the remaining seconds, stop at zero, and honor reduced motion without an animated indicator.

## 3. Client surfaces

- [x] 3.1 Replace `RunInstructionButton` with a card instruction action that renders the countdown control, the sending state, the failure state with the play action, and the idle play action from the controller record; verify the jsdom tests in 5.8 and 5.10 for each state, cancel activation, the stable accessible name, and that the action never opens the drawer.
- [x] 3.2 Add the drawer auto-run notice above the section panel with the stage, remaining seconds, target label, Cancel, sending state, and failure text; verify the drawer tests in 5.8 and 5.9 keep the section unchanged and expose the same cancel.
- [x] 3.3 Remove the drawer prefill: delete `src/client/instruction-draft.ts`, the `draftPort` prop, the `client.tsx` draft binding and attach effect, the prefill state/timers/Replace action, and the `.kb-prefill*` styles; verify 5.11 finds no composer initialization calls and no draft API reference.
- [x] 3.4 Wire the client composition: own one controller for the injected generation, subscribe to snapshots for reconciliation while the panel is hidden, dispose it with the generation, and pass it to `BoardView` (with a standalone fallback); arm after a successful `applyMove` for board and drawer moves and pass records/callbacks to the cards and drawer; verify the client UI tests in 5.8 through 5.10 for instructed drop, drawer change, cancel, manual prompt, same-stage reorder, and task creation.
- [x] 3.5 Style the card countdown and drawer notice with host tokens, reduced-motion handling, and keyboard focus retention on the stable control; verify the focus test in 5.8 and the appearance lane in 6.2 in light and dark.

## 4. Test support and harness

- [x] 4.1 Create `tests/support/in-memory-board.ts` with one command contract for move, marker creation with a deterministic `enteredAt`, run identity enforcement, host busy/context-operation parity, exact instruction text, and marker clearing; verify both fakes wrap it and no marker/identity logic is duplicated.
- [x] 4.2 Refactor `tests/client/helpers.ts` to wrap the shared contract, add the second instructed column, and derive fixture markers through it; verify the client suite passes after the payload migration in 5.12.
- [x] 4.3 Extend `tests/browser/fake-api.ts` with the shared contract, an instructed column, move/run recording, and failure mode; verify the harness builds and the existing browser specs still pass under `pnpm test:browser`.
- [x] 4.4 Add `tests/e2e-dsh/auto-run.replay.override.json` with exactly the two scripted assistant turns and pass it through the template environment as an override-only replay script with an absent base fixture; the scaffold consumption check remains in 6.4.
- [x] 4.5 Add `--only auto-run` to `scripts/e2e-dsh.mjs`, and update `tests/e2e-dsh/README.md` and `AGENTS.md` for the new lane; verify `node scripts/e2e-dsh.mjs --checkout <pinned-checkout> --check` passes.

## 5. Cheap automated coverage

- [x] 5.1 Add `tests/domain/stage-entry.test.ts` for verbatim instruction bytes, empty/whitespace instructions, and matching, stale, and missing markers; verify `pnpm exec vitest run tests/domain/stage-entry.test.ts`.
- [x] 5.2 Add the controller lifecycle suite in `tests/client/auto-run.test.ts` with a fake scheduler and runner: arm, expiry, cancel, replacement, independent tasks, and disposal; verify the suite sends exactly one command per expiring entry.
- [x] 5.3 Add controller reconciliation tests for a deleted task, removed marker, replaced marker, and an unrelated snapshot; verify none of the cancelling cases sends and the unrelated snapshot keeps the deadline.
- [x] 5.4 Add controller failure tests for a rejected send, a retained `failed` record with no retry, a successful explicit `runNow`, and a silent `INSTRUCTION_ALREADY_RESOLVED`; verify no duplicate command occurs.
- [x] 5.5 Extend `tests/host/app.test.ts` for the entry guard and target: correct identity, stale timestamp, missing marker, leave/re-enter, zero sends and no conversation creation on rejection, first-open/create, unchanged stage and position; verify the suite passes without a real model.
- [x] 5.6 Extend the host and schema tests for move-only `task.move`: no legacy fields, no conversation or worktree, marker set for an instructed destination, same-stage reorder preserved, required `expectedEnteredAt` on the wire, and rejected legacy command fields; verify the host suite and `tests/domain/schema.test.ts`.
- [x] 5.7 Add `tests/host/legacy-pending.test.ts` with seeded `PendingTransition` records for `initialize` `sending` recovery, explicit retry, worktree waiting, and exact frozen text; verify the schema still accepts persisted legacy records and the retry sends once.
- [x] 5.8 Add `tests/client/auto-run-ui.test.tsx` part 1: arm via drag and via drawer, card countdown, drawer banner with stage and seconds, section retention, cancel from both surfaces, and two independent countdowns; verify with Vitest fake timers and no real wait.
- [x] 5.9 Add client UI part 2: manual prompt cancels, a new instructed entry replaces the countdown, same-stage reorder neither arms nor resets, creation in an instructed initial stage does not arm, a hidden card still sends, and unmount/remount sends nothing; verify each scenario in the same suite.
- [x] 5.10 Add client UI part 3: failure and changed-instruction errors on both surfaces with the play action restored, silent already-resolved handling, and stable accessible names/live regions; verify the suite asserts roles and labels rather than CSS.
- [x] 5.11 Update `tests/client/instruction.test.tsx` for the entry identity and the pre-existing-marker play action; delete `tests/client/drawer-prefill.test.tsx` and `tests/client/instruction-draft.test.ts`; replace the bridge prefill assertion with “a stage change never writes to the composer”; verify no `draftPort`, `InstructionDraft`, or prefill references remain.
- [x] 5.12 Migrate every test `task.move` and `task.runInstruction` payload to the new shapes and delete the obsolete legacy command-shape tests in `tests/host/app.test.ts` and `tests/host/product-walkthrough.test.ts`; verify `pnpm run typecheck` and `pnpm test` pass.

## 6. Real rendering and real composition

- [x] 6.1 Add `tests/browser/auto-run.spec.ts` with `page.clock` installed after the board renders: countdown and cancel, expiry sends once, and reload sends nothing; verify with `pnpm test:browser`.
- [x] 6.2 Add countdown appearance coverage in `tests/browser/auto-run.spec.ts` for the card countdown and drawer notice: light/dark contrast, reduced motion, and `.verification/` screenshots; verify all appearance assertions pass under `pnpm test:browser`.
- [x] 6.3 Add `tests/e2e-dsh/kanban-auto-run.e2e.template.ts` with one boot and four flows: send with the plugin's visible task-context row before the instruction in the Kanban panel, cancel with no message, reload with no message and the play action restored, and unsent draft preserved while the instruction is sent; the lane verification is 6.4.
- [ ] 6.4 Run the real-composition lane against the pinned checkout and capture the run evidence under `.verification/`; verify exactly four flows pass with `DSH_SNAPSHOT=replay` and no owner profile or board data is used.
- [x] 6.5 Confirm the e2e lane remains outside `pnpm check` and `pnpm test`; verify `pnpm check` still covers only the host/client typechecks, vitest, and the build, and `pnpm test:browser` remains the separate browser gate.

## 7. Documentation and closeout

- [x] 7.1 Update the README and `docs/operations.md` with the five-second cancelable behavior, card and drawer surfaces, target rule, cancel/failure semantics, reload behavior, move-only command, and the layered verification expectations; verify no prefill or manual-Send description remains.
- [x] 7.2 Run `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm test:browser`, and `openspec validate auto-run-instructed-move --strict`; verify all pass and the cheap suite performs no real-model call.
- [ ] 7.3 Record the browser screenshots and the e2e run under `.verification/`, confirm no tokens, credentials, or owner data are included, and verify the owner's profile and board were never used.

> Environment note: the `--only auto-run` real-composition lane could not execute here. The pinned checkout reports `dsh-v0.2.1-rc.2`, but its installed dependency set is incomplete (`p-limit` is missing and its built `cordis-plugin-include` lacks `bundlePatchPaths`), and the checkout pins pnpm 11.28.5, which cannot be fetched from the configured registry. The template is syntax-transformed, the runner wiring and `--check` pass, and every cheaper lane plus the browser lane passes. Tasks 6.4 and 7.3 remain open for a checkout with complete prerequisites.
