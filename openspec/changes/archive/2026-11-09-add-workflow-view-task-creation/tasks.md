# Tasks

## 1. Shared task creation hook

- [x] 1.1 Create `src/client/use-task-creation.ts` holding the New task open state, the project-registry enablement, and the first-execution handoff moved out of `board.tsx`, receiving opening the task, the auto-run controller, and the latest snapshot as arguments; the creation command and its receipt validation stay in `NewTaskDialog`, which the hook mounts, as `design.md` records `forms.tsx` as unchanged; verify `pnpm check` passes and the existing creation cases in `tests/client/board.test.tsx` pass without behavioral change.
- [x] 1.2 In `board.tsx`, instantiate the hook once, mount its dialog in place of the current creation dialog slot, and feed the column board's button renderer from its enablement and open action; verify the board's New task tests still pass, including unavailable-without-projects and the project-filter-does-not-preselect case.
- [x] 1.3 Document the hook as board-owned with one instance and record the reason in its module comment; verify the comment names the two consumers and `pnpm check` passes.

## 2. Container creation extraction

- [x] 2.1 Move the New Hub and New Board dialog states, their closers, and their created-id handoffs out of `board.tsx` into `src/client/use-creation-dialogs.ts`, keeping active-Hub and board selection in the component and task creation out of the hook; verify `pnpm check` passes and the Hub and board creation tests pass.
- [x] 2.2 Confirm the board component no longer holds creation dialog state for either concern; verify by grepping `board.tsx` for the moved state setters and finding none, with `pnpm check` still green.

## 3. Diagram plumbing

- [x] 3.1 Add an optional creation callback to the stage callbacks contract and an initial-stage flag to the canvas stage model, derived in `workflow-view.tsx` from the workflow's configured initial stage; verify `pnpm check` passes and the existing `tests/client/workflow-view.test.tsx` suite passes.
- [x] 3.2 Include the initial-stage flag in the canvas node signature; verify with a test that changes the configured initial stage and asserts the flag reaches the stage node without any other layout change forcing a re-sync.
- [x] 3.3 Have `board.tsx` supply the diagram's creation port from the shared hook's open action and enablement; verify a board-level test opens the dialog through the port and asserts the hook's open path was used.

## 4. Stage header action

- [x] 4.1 Extend the workflow-view stub canvas so its stage header renders the creation control the way the real stage node does; verify the existing stub-based tests still pass, giving later tasks a harness that exercises the real component path.
- [x] 4.2 Render the icon control in `StageNodeView`'s header for the flagged stage only, with an accessible name and a matching native tooltip carrying the same label, positioned beside the card count without changing the header's arrangement; verify tests assert the accessible name, its presence on the initial stage and absence from the other two, and the unchanged header structure.
- [x] 4.3 Isolate the press from the stage drag by cancelling pointer propagation at the control and marking it non-draggable and non-panning; verify a test activates the control and asserts no stage move, no resize, no arrow adjustment, no stored workflow change, and no placement-history entry.
- [x] 4.4 Keep the control available while the layout is locked and while card selection is active, and unavailable when the Hub holds no registered project — a published placeholder owns no directory and is not one — while a board whose own scope allows nothing keeps the control so that the dialog can explain the refusal; verify tests covering those states in both presentations, with the locked diagram still refusing stage moves.
- [x] 4.5 Keep the control present when the search or project filter hides every card of the initial stage; verify a test filters the stage to its empty state and still finds the enabled control.
- [x] 4.6 Activate the control from the keyboard; verify a test focuses it and activates it, asserting the creation path opened, the stage did not move, and the task drawer did not open, and a board-level test that the shared dialog takes the keyboard when it opens and hands it back to the control when dismissed.
- [x] 4.7 Press the control on the real canvas with layout editing unlocked; verify a browser test in which a drag begun on the control leaves the stage where it stood and stores nothing, the same drag on the stage title does move it, and keyboard activation opens the dialog and returns focus to the control.

## 5. Presentational cleanups

- [x] 5.1 Define the words both presentations must agree on — the empty-stage sentence and the name of the creation action — once in `src/client/board-copy.ts`, imported by the column board, the stage node and the shared creation hook, keeping the wording unchanged; verify each literal appears in exactly one source file and both presentations still render it in tests.
- [x] 5.2 Remove the unused column argument from the New task button renderer and its call site; verify `pnpm check` passes and the column board tests pass.

## 6. Validation

- [x] 6.1 Run `pnpm check` and confirm host and client typechecks, vitest, and the build are green.
- [x] 6.2 Run `pnpm test:browser` and confirm the plugin-owned Playwright lane is green, capturing light and dark appearance evidence for the new header control under `.verification/` with the host theme state and contrast asserted.
- [x] 6.3 Run the isolated real-composition lane with `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only board` against an installed and built DSH checkout, extending that lane's check to reach the workflow presentation rather than adding a new lane; verify the action is present on the initial stage only and creates a task, with `MISSING_CREDENTIAL` accepted as the send outcome.
- [x] 6.4 Bump `version` in `package.json` for the release this change publishes, since a released version is never reused; verify the value is new against the published tags.
