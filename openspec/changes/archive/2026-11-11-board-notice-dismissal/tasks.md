# Tasks

## 1. Host contract

- [x] 1.1 Add a `reason` field (`folder` | `unresolved`) to `RetainedCheckout` in `src/shared/types.ts` and to the snapshot schema in `src/remote.ts`, and project it from the host registry; verify the typecheck passes and the snapshot-shape assertion in `tests/host/app.test.ts` includes the reason.
- [x] 1.2 Add `{ type: 'retainedCheckout.dismiss'; paths: string[] }` to the `Command` union, its zod entry in `CommandSchema`, a dispatch case in `app.execute`, and an exclusion in `scopedCommand`; verify a host test proves a dismissed path is absent from the next snapshot and that an unknown path is ignored without an error.
- [x] 1.3 Report a folder project's retained checkout from `resolveDeletionTarget` with its reason instead of `'none'`, carry it through `destructive-operation`, and store it in `retainCheckout`; verify `tests/host/deletion-target.test.ts` and `tests/host/deletion-unavailable-context.test.ts` cover both reasons.

## 2. Host pruning

- [x] 2.1 Extract the duplicated `entryExists` helpers in `src/host/worktrees.ts` and `src/host/destructive-operation.ts` into one host path helper and reuse it at both sites; verify `tests/worktrees/coordinator.test.ts` and `tests/host/background-deletion.test.ts` still pass.
- [x] 2.2 Schedule a bounded-interval prune from `app.snapshot` that removes retained entries whose directory no longer exists and publishes the change without awaiting the check; verify a host test that fakes a missing directory sees the entry disappear without a user action, and that a path recorded while a check is running survives it.

## 3. Client notice model

- [x] 3.1 Create `src/client/notices/model.ts` with the `BoardNotice` view model and the pure builders for retained entries, the command failure, operations, and relocations, including the dismissible/non-dismissible classification; verify with a new `tests/client/notice-model.test.ts` that covers grouping and that failures and relocations carry no dismiss.
- [x] 3.2 Create `src/client/notices/use-board-notices.ts` with the injected dismissal ports and the optimistic pending dismissal; verify a client test shows a dismissed retained path disappears before the snapshot returns and reappears when the command rejects.
- [x] 3.3 Remove the `retained` callback, `pendingRetained`, and the retained branch of `reconcile` from `useDestructiveOperations`, and drop the client's folder-project inference; verify the updated `tests/client/background-deletion.test.tsx` and `tests/client/folder-project-drawer.test.tsx` observe retention only from the host snapshot.

## 4. Client surfaces

- [x] 4.1 Split `DestructiveOperationsNotice` into an operations group without a dismiss control and a retained group with its own heading, per-row control, and dismiss-all shown when more than one entry is reported; verify a component test asserts both groups and that the operations group exposes no dismiss control.
- [x] 4.2 Add `src/client/notices/dismiss-button.tsx` as the single icon-only control with an accessible name and tooltip, and the focus hand-off to the next dismissible notice or the board body; verify a test that activates it from the keyboard and asserts where focus lands when other notices remain and when none do.
- [x] 4.3 Rewire `BoardView` to the notice hook and the ports so it no longer owns `dismissedRetained` or forwards ten notice props; verify `tests/client/board.test.tsx` and `tests/client/state.test.tsx` pass and that `src/client/board.tsx` contains no retained-dismissal state.

## 5. Team-changes banner

- [x] 5.1 Move `ShareBanner` into `src/client/notices/team-banner.tsx`, compute the Hub's pending-team signature from `HubSharingView`, store the dismissed signature in `BoardPageState`, and dismiss through the port; verify a test that an unchanged signature keeps the banner hidden and a changed one restores it.

## 6. Module naming

- [x] 6.1 Move the page-level notice composition to `src/client/board/notice-stack.tsx`, the board error notice to `src/client/notices/board-error-notice.tsx`, and the frame and empty-state components to `src/client/board/board-frames.tsx`; verify `pnpm check` typechecks with no module left named `board-notices` for two different roles.

## 7. Verification

- [x] 7.1 Update the browser harness and fake API for the retained scenario, the dismiss command, and the banner signature, and add `tests/browser/notice-dismissal.spec.ts` covering the per-row control, dismiss-all, dismissal surviving a remount, and a notice that must not be dismissible; verify with `pnpm test:browser`.
- [x] 7.2 Confirm the notice appearance in both host themes and update the existing browser appearance expectations for the new control; verify by running `pnpm test:browser` and inspecting the screenshots under `.verification/`.
- [x] 7.3 Update `tests/e2e-dsh/kanban-deletion.e2e.template.ts` for the retained group and its dismiss control; verify with the isolated deletion lane: `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --check --only deletion`.
- [x] 7.4 Run `openspec validate board-notice-dismissal --strict` and `pnpm check`; verify both pass and the deltas still match the delivered behavior.