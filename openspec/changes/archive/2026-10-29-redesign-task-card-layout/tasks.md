# Tasks

## 1. Foundation: card styles and component extraction

- [x] 1.1 Create `src/client/card-styles.ts` exporting `cardStyles` and move the `.kb-card*` rules plus the card-only `.kb-background` chip out of `styles.ts` and `activity-styles.ts` verbatim; import and concatenate `cardStyles` in `styles.ts` alongside `activityStyles`. Verify `pnpm typecheck` passes and the browser harness renders cards with unchanged appearance.
- [x] 1.2 Create `src/client/task-card.tsx` with a presentational `TaskCard` that mirrors the current markup and receives task, column, project name, attention, selection state, the auto-run controller, and the `onOpen` / `onToggleSelect` / `onBeginDrag` / `shouldSuppressClick` handlers. Verify the harness board renders identical cards and opening, dragging, and selection still work.
- [x] 1.3 Replace `renderCard` in `BoardView` with `TaskCard`, passing the project name resolved from board state and keeping the `key` in the map. Verify `src/client/board.tsx` no longer contains card markup and the board still renders and filters tasks.

## 2. Card anatomy

- [x] 2.1 Restructure the card DOM so the open button wraps only the title region while the context, activity, and status regions are siblings inside the card root, keeping the open button's covering overlay so any non-control area still opens the drawer. Verify clicking the title, the empty card area, the context label, and the activity background chip all open the drawer, while the selection control toggles selection and the run action performs its own action.
- [x] 2.2 Build `CardContext` with the project label and the unread, awaiting-reply, and failure attention dots, replacing `.kb-card-meta` and `.kb-card-signals`. Verify a card shows the project name and all three dots together, and that a long project name truncates with its full name in the title and accessible name.
- [x] 2.3 Move the selection control inline as the first element of the context region, remove the absolute checkbox positioning and the title-button left padding, and keep the selection-mode label/`aria-pressed` toggle behavior. Verify selection mode shows the checkbox inline, toggles selection when the card is activated, and disables dragging.
- [x] 2.4 Update the card drag exclusion list to `.kb-card-activity` (plus the existing input, select, textarea, and anchor exclusions) and keep `data-working` only on the card root. Verify dragging starts from the title, the context row, and empty card areas, the activity controls (background chip and run action) do not start a drag, and the working accent still renders.
- [x] 2.5 Remove the now-unused `.kb-attention` wrapper, the empty attention row, and the `.kb-card-check` positioning rules; verify no card markup renders an always-present empty wrapper and the card has no dead class references in `src`.

## 3. Activity strip

- [x] 3.1 Add the background summarizer to `activity.tsx`: one kind yields `<count> <kind>` and two or more kinds yield `<total> activities`, with the full label list in the chip title and accessible name; delete the unused `standalone` branch and `backgroundChipText`. Verify the summarizer output for zero, one, and multiple kinds against the card fixture, seeing `1 job` on a single-kind card and `2 activities` on a card with a job and a subagent.
- [x] 3.2 Build `CardActivity` as one non-wrapping, height-reserved row ordered working badge, background chip, trailing run action, with the chip bounded and ellipsized as a safety valve. Verify idle, working, and background-only cards share one height and the strip stays on one line.
- [x] 3.3 Render `CardInstructionAction` at the trailing edge of the activity region and remove the separate action row. Verify a card with a run action or countdown keeps the same height as the same card without it, and the countdown still cancels.
- [x] 3.4 Remove the card variant of `TaskActivity`, moving the working badge and persistent `role="status"` announcement into `CardActivity`, and leave the drawer variant untouched. Verify the drawer header still shows the working badge and background labels, and the card has exactly one live region.

## 4. Status strip

- [x] 4.1 Add `CardStatus` deriving one toned entry per unresolved context operation, confirmed transition, and auto-run admission failure, rendered below the activity region with an icon and a short label. Verify a failed delete card shows a failure-toned line, a pending-transition card shows a pending-toned line, and a card with both shows both.
- [x] 4.2 Move the auto-run admission failure message from `CardInstructionAction` into `CardStatus` (read the auto-run entry in `TaskCard`), keeping the failure announced and the run action available after failure. Verify a failed instruction shows the message in the status region and the run action returns.
- [x] 4.3 Remove the two `Operation:` / `Confirmed action:` hint paragraphs and the inline `.kb-card-error` paragraph. Verify no duplicate status text renders and a card with no unresolved fact has no status content.

## 5. Theming, accessibility, and cleanup

- [x] 5.1 Replace the remaining hardcoded card colors in the new module with the host tokens already used by the plugin (`--color-destructive` with its fallback for failure, the business-primary accent for pending and countdown), leaving the attention dot palette unchanged. Verify the appearance harness shows legible failure and pending tones in light and dark.
- [x] 5.2 Keep the accessibility contract: open button accessible name, title text inside the button, background chip focusable outside the button with count and labels, persistent working announcement, selection control label. Verify keyboard focus reaches the chip and the action, Enter on the card opens the drawer, and the chip's accessible name carries the count and labels.
- [x] 5.3 Remove leftover dead code and duplicated rules: duplicate title rule, duplicated `data-working` attribute, dead `backgroundChipText` branch, unused imports and classes. Verify `pnpm typecheck` and `rg -n "kb-card-meta|kb-card-signals|kb-card-check|kb-attention|backgroundChipText" src` returns no matches.

## 6. Align existing pinned suites and verify the lane

- [x] 6.1 Extend the browser card fixture with a task that owns a job and a subagent so the aggregated count is observable. Verify the harness activity scenario renders the aggregated chip on that card.
- [x] 6.2 Update `tests/browser/running-status.spec.ts`, `tests/browser/appearance.spec.ts`, and `tests/browser/auto-run.spec.ts` for the new selectors, the aggregation copy, and the separate activity region. Verify `pnpm test:browser` passes.
- [x] 6.3 Update `tests/client/activity.test.tsx` and `tests/client/styles.test.ts` for the summarizer, the removed card variant, and the card styles module. Verify `pnpm test` passes.
- [x] 6.4 Update the e2e templates that reference card classes or heights (`tests/e2e-dsh/kanban-board-ux.e2e.template.ts`, `tests/e2e-dsh/kanban-auto-run.e2e.template.ts`). Verify `node scripts/e2e-dsh.mjs --check` completes without template errors.
- [x] 6.5 Run the fast gates and the isolated browser lane (`pnpm check`, `pnpm test:browser`) and confirm both are green without touching the developer's running app or profile.

## 7. Independent review follow-ups

- [x] 7.1 Fix the status-tone contrast by mixing the failure and pending tones toward the host label color, and verify both tones in the appearance lane: light pending 6.81:1, failure 9.14:1; dark pending 10.11:1, failure 5.9:1.
- [x] 7.2 Keep the project label and attention dots hoverable above the overlay, forward context and background-chip activation to the card, and verify hover hit-testing, label activation, and chip activation in the browser lane.
- [x] 7.3 Share the auto-run column lookup and failure fallback (`autoRunEntryForColumn`, `RUN_FAILURE_FALLBACK`) and remove the redundant pointerdown/keydown stops and the leftover `pointer-events` workaround; verify the auto-run suites stay green.
- [x] 7.4 Pin the previously unverified scenarios: cleared status, run failure in the status region, persistent working announcement, inline selection in the browser, and long title/project layout.
- [x] 7.5 Re-run the gates after the review fixes: `pnpm check` (110 files / 1816 tests) and `pnpm test:browser` (32 tests) are green.
- [x] 7.6 Close the focused re-verification minors and nits: the background chip now activates on Enter and Space as well as click, the drawer failure copy uses `RUN_FAILURE_FALLBACK`, the pending-transition fixture is scoped to the appearance scenario, and the 2.1/overlay wording matches the shipped behavior.
