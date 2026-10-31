# Tasks

## 1. Composition ownership

- [x] 1.1 In `src/client.tsx`, construct the auto-run controller with `run: command => bridge.api.command(command)`, delete the mutable `autoRunRunner`, and verify no runner binding remains by typechecking the client.
- [x] 1.2 Remove the `onRunReady` prop from `BoardViewProps`, `BoardPage`, and `Main`, and verify with a repository search that no reference remains.
- [x] 1.3 In `src/client/board.tsx`, reconcile only the owned fallback controller from `allTasks(snapshot)` and keep its unmount disposal; verify a provided controller is no longer reconciled by the board through the existing client suite.

## 2. Regression coverage

- [x] 2.1 Update the existing client and bridge tests affected by the removed `onRunReady` prop and the fallback-only reconciliation, and verify the suite passes.
- [x] 2.2 Add coverage for an armed countdown that survives a board or Hub switch in the client suite and in the production composition root, and verify the switch cases fail against the board-scoped reconciliation before the fix and pass after it; the existing composition test covers the hidden panel.

## 3. Gates and real composition

- [x] 3.1 Run the project gates (`pnpm check`) and verify host/client typechecks, unit tests, and the build succeed.
- [x] 3.2 In a fresh isolated profile, move a card on an instructed stage, switch board or Hub before the five seconds elapse, and verify the instruction is sent and the entry resolved; repeat while the Kanban panel is hidden, without touching the developer profile or board data (evidence in `.verification/auto-run-navigation.md`).
