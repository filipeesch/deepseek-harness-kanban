# Tasks

## 1. Policy and tokens

- [x] 1.1 Add `src/domain/card-presence.ts` exporting the dominance policy from attention facts to the dominant state, with the fixed priority list exported beside it; verify `tests/domain/card-presence.test.ts` passes and covers each state alone plus the full order error, attention, running, unread, none
- [x] 1.2 Declare `--kb-state-unread`, `--kb-state-attention`, `--kb-state-error`, `--kb-state-running`, and `--kb-state-tint` on `.dsh-kanban` with the dark-appearance override, and point `styles/base.ts`, `styles/cards.ts`, and `styles/sharing.ts` at them; verify no attention hex literal remains under `src/client/styles/` and the appearance browser spec still reads the same token values
- [x] 1.3 Remove the unused `.kb-legend` rule; verify a repository search finds no `.kb-legend` and `pnpm vitest run tests/client/styles.test.ts` passes

## 2. Card surface

- [x] 2.1 Derive the presence inside `BoardCard` from props it already receives and render it as `data-presence` on the card while keeping `data-working`; verify `tests/client/task-card.test.tsx` asserts `data-presence` for every dominant state and `tests/client/board-card-render.test.tsx` still asserts that only the changed card re-renders
- [x] 2.2 Paint the card surface with the dominant state's tint at the `--kb-state-tint` share and keep every active mark presented; verify a browser spec asserts a distinct computed background per dominant state, that a failure plus unread card still shows its unread mark, and that an attended-free card has no tint
- [x] 2.3 Add the accent-colored border to a running card beside the existing trailing bar, with one shared pulse; verify `tests/browser/running-status.spec.ts` asserts both accent surfaces and that the reduced-motion case keeps both visible with no animation
- [x] 2.4 Keep the card height stable across states; verify the existing equal-height assertion in `tests/browser/running-status.spec.ts` still passes for a board mixing idle, running, tinted, and untinted cards

## 3. Marks and diagram zoom

- [x] 3.1 Publish the bounded inverse zoom as `--kb-mark-scale` on the canvas on every viewport change; verify `tests/client/mark-scale.test.ts` covers the bound and `tests/browser/card-presence.spec.ts` asserts the variable changes with zoom without a card re-render
- [x] 3.2 Position the marks at the trailing edge of the context row and counter-scale them with the 3.5x bound from the zoom variable; verify browser assertions at zoom 1, 0.5, and 0.2 read a constant size above the bound and at most 3.5x at the minimum zoom
- [x] 3.3 Present no mark for agent execution and keep the three accessible names at every zoom; verify `tests/client/task-card.test.tsx` asserts no running mark and the unread, awaiting-reply, and failure names

## 4. Board-wide mark all as read

- [x] 4.1 Add `markRead` to `ConversationReadTracker` and `ConversationReadState`; verify a client test acknowledges only the requested conversation and leaves a sibling conversation unread
- [x] 4.2 Add `ClientBridge.markAllRead(sessionIds)` that acknowledges the recorded settled turn of each given session, flushes the record once, and publishes; verify a bridge test clears exactly those sessions, persists across a reload of the bridge, and changes nothing else
- [x] 4.3 Pass the capability from `src/client.tsx` into a new optional `BoardViewProps` handler and render the header action enabled from `projectScopeActivity` for the active board; verify a board test asserts the action is unavailable when nothing is unread or failed, calls the handler with exactly the active board's session ids, and is absent in selection mode
- [x] 4.4 Add the action's icon and accessible name; verify a header test asserts the name states the effect and that no confirmation dialog appears on activation

## 5. Refactoring and cleanup

- [x] 5.1 Move `cardStatusEntries` and `CardStatusEntry` into `src/client/card-status-entries.ts` with no behavior change and update its call sites; verify `pnpm run typecheck` passes and `tests/client/task-card.test.tsx` keeps passing unchanged
- [x] 5.2 Confirm the card module now holds only components and remove its dead imports; verify `pnpm run typecheck` and a search for unused imports reports nothing

## 6. Verification

- [x] 6.1 Add browser contrast coverage for every tinted surface in both appearances; verify the appearance spec measures the title, the project name, and the status text on the failure, awaiting-reply, running, and unread cards and asserts at least 4.5:1 on each
- [x] 6.2 Capture screenshots of the board and the diagram at zoom 1, 0.5, and 0.2 in light and dark under `.verification/`; verify the files exist and contain no credentials, tokens, or owner data
- [x] 6.3 Run `pnpm check` and confirm the host and client typechecks, vitest, and the build all pass
- [x] 6.4 Run `pnpm test:browser` and confirm every browser spec passes, including the new zoom and contrast cases
- [ ] 6.5 Run the fresh isolated web instance flow from `AGENTS.md` and confirm the board paints the tint and the header action clears the board; verify the report under `.verification/` and remove `$SMOKE_HOME` afterwards
- [x] 6.6 Ask a reviewer subagent to validate the UI and the UX against the screenshots at all three zooms; verify it reports either no blocking finding or a findings list addressed before the change is considered met
