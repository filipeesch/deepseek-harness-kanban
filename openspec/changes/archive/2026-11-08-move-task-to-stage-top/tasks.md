# Tasks

## 1. Domain placement primitives

- [x] 1.1 Add `src/domain/placement.ts` with the `Placement` value type and the single anchor mapping (absent start, `null` end, id before), and verify it with a unit test covering all three cases plus an empty destination.
- [x] 1.2 Add `src/domain/task-order.ts` with the shared position-then-creation-time comparator, reuse it in `placeTask`, in task creation normalization (including the legacy board aggregate's equivalent sort), and in the board's visible-task ordering, then verify the domain and client suites pass.
- [x] 1.3 Change `placeTask` to accept a `Placement` instead of a raw anchor, preserving the fallback to the destination end for an anchor that no longer exists, and verify `tests/domain/hub-operations.test.ts` covers start, end, anchored, and missing-anchor placement.

## 2. Host placement policy

- [x] 2.1 Map the persisted transition anchor through the placement mapping in the host drain and document the absent/`null`/id meaning on `Command` and `PendingTransition`, then verify a host test showing an unanchored move lands at position 0, a `null` anchor at the end, and an anchored move before its anchor.
- [x] 2.2 Add a host test proving a pending transition persisted without an anchor is dispatched to the top after a reload, and verify it passes.
- [x] 2.3 Verify the automatic advance inherits the start placement by extending the auto-advance host test to assert the advanced task is first in the destination column.

## 3. Client placement intent

- [x] 3.1 Update `useMoveRequest` so an omitted anchor means "no position requested", a supplied `null` is sent as the destination end, and the optimistic move carries a `Placement`; verify with the client move-request tests asserting the command payloads and optimistic placement.
- [x] 3.2 Remove the implicit `null` default from `board.tsx` and `BoardMoves.moveTo`, render the optimistic card from its `Placement`, and verify the drawer preview places a moved task at the top in a client or browser test.
- [x] 3.3 Verify dragging still keeps the exact dropped position by running the drag-related client and browser tests and confirming a drop after the last card sends `beforeTaskId: null`.

## 4. Validation and release

- [x] 4.1 Run `pnpm check` (host and client typechecks, vitest, build) and resolve every failure.
- [x] 4.2 Run `pnpm test:browser` and confirm the drawer, drag, and auto-mode browser specs pass with the new placement.
- [x] 4.3 Run the available isolated verification for the affected scenarios (the real-composition lane when an installed, built DSH checkout is available; otherwise the fresh isolated web instance drawer smoke) and record the screenshots and short report under `.verification/`.
- [x] 4.4 Bump `version` in `package.json` for the published artifact and verify the release workflow inputs still reference `releases/latest/download/dsh-kanban.tgz`.
