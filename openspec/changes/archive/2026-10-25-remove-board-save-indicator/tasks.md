# Tasks

## 1. Remove the global save indicator

- [x] 1.1 Remove the in-flight counter from `src/client/board.tsx`: the `pending` state, the `setPending` increment at the start of `run()`, and the `finally` block that decremented it. Verify `grep -nE "const \[pending|setPending\(" src/client/board.tsx` returns nothing and `pnpm typecheck` passes.
- [x] 1.2 Remove the `Saving change…` element from the board render and delete the `.kb-save-status` rule from `src/client/styles.ts`. Verify `grep -rn "kb-save-status\|Saving change" src` returns nothing and `pnpm typecheck` passes.
- [x] 1.3 Confirm no replacement save indicator or live save region is introduced: the board render adds no new progress element and no new live region. Verify by reviewing the render diff for `src/client/board.tsx`.

## 2. Extract failure classification

- [x] 2.1 Create `src/client/command-failure.ts` with `CommandFailureAdvice` and `adviseCommandFailure({ command, problem, task, priorOperation, allowDiscard })`, porting the current `DISCARD_REQUIRED`, captured-path, and `operation.retry` policy without React or state writes. Verify the module exports both symbols and `pnpm typecheck` passes.
- [x] 2.2 Replace the inline failure branch in `run()` with a single `adviseCommandFailure` call that applies `advice.discard` and `advice.notice` to the existing setters and rethrows the original error. Verify the `run()` body contains no `DISCARD_REQUIRED` policy (the two dialog retry handlers outside the runner stay) and `pnpm typecheck` passes.

## 3. Extract the board notice slot

- [x] 3.1 Create `src/client/board-notices.tsx` exporting `BoardNotices({ loadError, actionError, onRetryLoad })`, rendering the load error, the load retry action, and the action error in the current order and returning `null` when both problems are absent. Verify the component renders no wrapper while idle and `pnpm typecheck` passes.
- [x] 3.2 Replace the inline notice elements in `src/client/board.tsx` with `BoardNotices` at the same position above the board body. Verify the board render no longer contains the inline load-retry button or the two notice expressions, and `pnpm typecheck` passes.

## 4. Verify the integrated result

- [x] 4.1 Run `pnpm typecheck` and `pnpm build` and confirm both pass with the new modules included in the build output.
- [x] 4.2 Review the final diff against `specs/kanban-board/spec.md`: command progress adds no element above the columns, moves and reorders remain optimistic, failures still surface a board-level alert, and error notices keep their flow position.
