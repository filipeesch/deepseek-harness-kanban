# Proposal

## Why

The board renders every list from the snapshot it holds, so a card that changes stage, a card that is created, and every card that must make room for them change position in one paint. Nothing carries the eye from the old position to the new one: a move the user just performed reads as a jump cut, and the jump is hardest to follow exactly when the board is busiest — long columns, an automatic advance, or a team-sync update.

The Host's own keyed lists (chat flow, workspace rows, model lists) already answer this with a small keyed-row FLIP animator, so the board is the remaining surface without that interaction language. The plugin's only motion today is the task drawer's entrance and exit.

## What Changes

- Add board-level card motion. A card glides from its previous position to its new one, including across workflow columns, while the neighboring cards glide to close the gap it left and open the gap it entered.
- A card that appears fades in briefly. A card that leaves fades out as an inert copy that does not delay the React unmount, does not accept interaction, and does not extend the board's scroll range.
- Motion covers any change to card membership or order regardless of origin: drag and drop, the drawer stage control, a confirmed restricted move, an automatic advance, a team-sync update, deletion, and task creation. A content-only reflow (a card growing taller because a status line appeared) settles immediately and is never animated.
- Motion settles immediately on a view replacement — changing Hub, changing board, or changing the search or project filter — and on a batch above a fixed threshold, so a filter change never launches dozens of cards.
- `prefers-reduced-motion` removes the motion entirely, entry and exit fades included. No new motion setting is added to Configuration.
- Copy the Host's keyed-row animation pattern into a plugin-owned module instead of importing a Harness Client package, following the Host's plugin practices.
- Include the cleanups the new seam makes safe: one shared reduced-motion helper used by the task drawer and the card motion, the drag ghost's inline CSS moved to a `kb-drag-ghost` class, and the empty-column note fading in instead of popping.
- Extract the column projection into a pure module so the rendered order and the animated order read one source of truth.

No behavior becomes breaking: card data, commands, persisted state, focus handling, click activation, and the drag-and-drop contract are unchanged.

## Capabilities

### New Capabilities

None. This change modifies an existing capability only.

### Modified Capabilities

- `kanban-board`: adds a requirement for animated card movement, entry, and exit on the active board, with reduced-motion handling and view-replacement and batch suppression. The requirement also states that motion never changes board data, focus, activation, or the drag-and-drop contract.

## Impact

- Client composition: `src/client/board.tsx` (render the motion frame, pass the ordered card ids and the view reset key), and the column projection extracted into `src/client/board-columns.ts`.
- New client module: `src/client/card-motion/` (pure layout diff, a Web Animations port, the React frame, the reduced-motion helper).
- Card rendering: `src/client/task-card.tsx` keeps its props and memoization; the frame reads the existing `data-task-id` marker.
- Styles: `src/client/styles.ts`, `src/client/card-styles.ts`, or a dedicated motion style module for the positioned motion overlay and the drag-ghost class.
- Drag: `src/client/useCardDrag.ts` uses the `kb-drag-ghost` class instead of an inline style string.
- No change to the Host, the plugin protocol, storage schemas, or `BoardState`. No new runtime dependency.
- Tests: pure unit coverage for the layout diff and the column projection, jsdom coverage for the frame gates, a Playwright scenario for real geometry and animation presence, and the style contract test.
- Documentation and release: README behavior note and the `package.json` version bump for the published artifact.
