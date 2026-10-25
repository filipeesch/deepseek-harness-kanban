# Tasks

## 1. Shared transition policy and contracts

- [x] 1.1 Add `TransitionAccess`, `transitionAccess`, and `transitionDestinations` to `src/domain/transitions.ts`, keeping `canTransition` as the predicate; verify with a unit test covering reorder, allowed, restricted, unknown stage, and workflow order.
- [x] 1.2 Switch the board, drawer, and host to the shared classifier, remove `permittedDestinations`, and drop the `workflow.ts` re-export if no consumer remains; verify `rg "permittedDestinations"` is empty and `pnpm run typecheck` passes.
- [x] 1.3 Add `overrideTransition` to `task.move`, `transitionOverride` to `PendingTransition`, the strict board-state pending schema, and the remote `CommandSchema`; verify `CommandSchema.parse` accepts the flag and `BoardStateSchema` round-trips a pending transition with it.
- [x] 1.4 Add `tests/domain/transitions.test.ts` for reorder/allowed/restricted/null, omitted versus `[]` restrictions, grouped workflow order, parser parity, and `canTransition` equivalence; update the `workflow.ts` import if the re-export is removed; verify `pnpm exec vitest run tests/domain/transitions.test.ts tests/domain/workflow.test.ts` passes.

## 2. Host admission and pending completion

- [x] 2.1 Update `KanbanApp.move` to admit a restricted cross-stage move only when `overrideTransition === true`, persist `transitionOverride` only for a restricted admission, and keep same-stage and allowed behavior unchanged; verify host tests for reject-without-flag, accept-with-flag, and allowed-without-flag.
- [x] 2.2 Update `drainPending` to honor `transitionOverride` and keep normal `canTransition` checks for non-override pending moves; the existing from/target invariant already binds the source. Verify retry/restart and externally-moved-source tests.
- [x] 2.3 Confirm a restricted move sends no agent instruction and leaves `placeTask` and `instructionPending` semantics unchanged; verify the existing movement-never-runs tests plus a restricted instructed-stage case.
- [x] 2.4 Add `tests/host/move-override.test.ts` using the in-memory fixture: reject without consent, accept with consent, pending-flag capture via `store.subscribe`, allowed and same-stage no-flag behavior, retry, restart via a reopened store and new app, normal pending recheck, source changed, placement, instructed no-send, busy, and unchanged workflow; verify `pnpm exec vitest run tests/host/move-override.test.ts` passes.
- [x] 2.5 Add command and state schema tests for `overrideTransition` and `transitionOverride`, including old pending transitions without the field and unknown-field rejection; verify `pnpm exec vitest run tests/domain/schema.test.ts tests/host/app.test.ts` passes.

## 3. Client move-request hook

- [x] 3.1 Create `src/client/useMoveRequest.ts` with injected `run`, latest state, and immediate-error callback; expose `optimistic`, `move`, `confirmation`, `pending`, `error`, `canRetry`, `confirm`, and `cancel`; verify `pnpm run typecheck` and the hook unit tests.
- [x] 3.2 Implement the immediate `reorder`/`allowed` path with optimistic placement cleared in `finally`; verify a restricted request does not call the command until confirmed and an allowed or reorder request calls it once.
- [x] 3.3 Implement the deferred confirmation promise, cancel resolution, unmount cleanup, concurrent-request refusal, and the single-settle guard; verify cancel resolves `false`, unmount resolves `false`, a concurrent restricted request is refused, and a double confirm settles once.
- [x] 3.4 Implement confirm revalidation for a missing task, missing destination, changed source, missing drop anchor, busy state, and a now-allowed transition; verify stale context sets `canRetry` to false, a transient rejection stays retryable, and retry re-reads the latest state.
- [x] 3.5 Integrate the hook into `board.tsx`, replacing the local `applyMove`/`moveTo` move handling while preserving the drawer's `onMove` and drag's `onDrop` contracts; verify `tasksForColumn` uses the hook's optimistic state and `pnpm run typecheck` passes.
- [x] 3.6 Add `tests/client/move-request.test.tsx` for immediate/reorder, restricted confirmation, cancel, confirm success, host failure and retry, stale source/destination, busy, now-allowed, unmount, double confirm, optimistic cleanup, and the absence of an agent command; verify `pnpm exec vitest run tests/client/move-request.test.tsx` passes.

## 4. Confirmation dialog and board drag

- [x] 4.1 Create `TransitionOverrideDialog` using `Modal` with `initialFocus="cancel"`, a neutral primary, pending/problem/`canRetry` states, and the agreed copy; verify its component test covers initial focus, cancel, confirm, the retry label, and the close-only stale state.
- [x] 4.2 Render the dialog from the board's hook state and wire confirm and cancel; verify a restricted select and a restricted drop both open it, cancel leaves stage and position unchanged, and confirm sends `overrideTransition: true`.
- [x] 4.3 Change board `canDrop` to accept every existing column for an idle task, remove `.kb-drop-disabled`, and add the restricted-hover classes from `transitionAccess`; verify drag tests show no dimming and the warning class only on a restricted hover.
- [x] 4.4 Add styles for the confirmation body, neutral primary, muted restricted option, dashed warning column outline, and dashed warning drop indicator; verify `tests/client/styles.test.ts` covers the new selectors and the browser theme lane passes.
- [x] 4.5 Add `tests/client/transition-override-dialog.test.tsx` for copy, initial focus, pending/problem states, retry label, and close-only stale state; extend `tests/client/board.test.tsx` for the restricted select and drop confirmation, warning hover, cancel/confirm/failure, select revert, and the absence of execution; verify `pnpm exec vitest run tests/client/transition-override-dialog.test.tsx tests/client/board.test.tsx tests/client/modal.test.tsx` passes.

## 5. Drawer stage control and prefill

- [x] 5.1 Replace the drawer's permitted-only list with `transitionDestinations`, render every stage in workflow order, keep restricted options enabled with the muted class, and add the accessible restriction hint; verify the drawer lists all stages in order and marks only restricted ones.
- [x] 5.2 Preserve the controlled `movingTo` behavior: the select shows the pending target and is disabled during confirmation, cancel restores the current stage, and confirm updates it after the move; verify the select disabled and value tests.
- [x] 5.3 Verify the existing instruction prefill runs after a confirmed restricted move and does not run on cancel; update `tests/client/drawer-prefill.test.tsx` with restricted instructed-stage and cancel scenarios using the fake draft port; verify `pnpm exec vitest run tests/client/drawer-prefill.test.tsx` passes.
- [x] 5.4 Replace the "omits prohibited transitions" test with full-workflow ordering, muted restricted option, accessible hint, and cancel-revert coverage; verify `pnpm exec vitest run tests/client/board.test.tsx tests/client/drawer-prefill.test.tsx` passes.

## 6. Documentation and specs

- [x] 6.1 Update `README.md` for the full stage control, restricted option treatment, drag warning, and confirmation behavior; verify no statement still claims only permitted stages are shown or moved.
- [x] 6.2 Update `docs/operations.md` with the confirmation lifecycle, retry and restart consent, and the native-select macOS limitation; verify the documented behavior matches the specs.
- [x] 6.3 Run `openspec validate allow-card-move-override --strict` and verify the change, both deltas, and every scenario validate.

## 7. Regression and verification

- [x] 7.1 Add a restricted client fixture and host workflow helper, then update every existing test that asserts prohibited transitions or options are rejected or omitted, plus the command-schema fixture; verify no stale expectation remains and the full suite passes.
- [x] 7.2 Run `pnpm run check` (host/client typechecks, vitest, and build); verify all pass without real-model calls or personal-profile access.
- [x] 7.3 Add `tests/browser/move-override.spec.ts` with a dedicated `scenario=move`, add the primary-button tokens to `tests/browser/theme-fixture.ts`, and assert option order, muted computed styling and contrast in light and dark, dialog focus/copy/neutral primary, and real pointer drag warning plus cancel/confirm; store screenshots under `.verification/`; verify `pnpm test:browser` passes and record the native-popup limitation.
- [x] 7.4 Add `tests/e2e-dsh/kanban-move-override.e2e.template.ts`, the `--only override` runner entry, and the README update; verify `node scripts/e2e-dsh.mjs --checkout <pinned-dsh-checkout> --check` succeeds.
- [ ] 7.5 **Deferred to the release lane.** Run the focused real-composition scenario: cancel and confirm a restricted drawer move in an isolated scaffold with no model call, do not assert native composer prefill (the fake draft-port test covers it), and manually inspect the native select popup once; verify `--only override` passes and no personal profile or credentials are used. The pinned DSH checkout is missing `p-limit@7.3.3`, so run this once that checkout's dependencies are repaired.
