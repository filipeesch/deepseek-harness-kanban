# Proposal

## Why

The Kanban header spends 172px above the columns before a single card is visible: a decorative subtitle, a title on its own row, and one full row each for Hub tabs and board tabs. Measured in the plugin-owned browser harness at a 1400px viewport, the toolbar alone is 844px wide, and 398px of it is the project `<select>`, which sizes itself to the longest project name. The board area is the reason the page exists, so its chrome should be compact and layered instead of stacked. This follows the same reasoning the plugin already applied to the task drawer in `2026-11-08-compact-task-drawer-header`.

## What Changes

- Remove the header subtitle ("Hubs, boards, and workflows"); the Kanban title stays at its current size.
- Move the Hub tabs onto the title row, so the header becomes two rows: title plus Hub tabs plus the page toolbar, then the board tabs below. The header goes from 172px to 107px (-38%).
- Present the board tabs as compact chips sized about 20% smaller than today, while the board row keeps its current 31px height so nothing above the columns shifts again.
- Give every control in the first row the same 32px height: the presentation switch, the filter control, the select-cards action, and the configuration action. The project `<select>` no longer stretches to its longest option.
- Replace the always-visible search field and project `<select>` with one filter control in the toolbar. It opens a popover holding the search input and the project select, filters live with no apply step, and carries a footer with a discreet clear icon and a close icon. Clearing also closes the popover.
- Indicate an active filter on the filter control with an accent dot, and with a numeral when both search and project are active. There is no separate clear button in the header: the filter control is the single entry point for filtering.
- Add no keyboard shortcut for search; the filter control is reached by pointer, matching the current affordance count for the toolbar's other actions.
- Extract the popover behaviour that `ClosedConversationsMenu` implements inline into a reusable `Popover` primitive, and migrate that menu to it, so focus, `Escape`, and outside-click handling live in one place.
- Split `HubNav` into `HubTabRow` and `BoardTabRow` parts so the header can place the two rows on different lines without a layout mode flag.
- Move header, tab, and presentation-switch styles out of the 180-line `styles/base.ts` into a `styles/header.ts` module, matching the existing per-area style modules. The presentation switch currently lives in `workflow-view/styles.ts` although it is a header control.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: a compact header composition requirement is added; the board filter control and its active-filter indication are added; `Text search and project filtering` is modified so the two filters are reached through the filter control; and `Board header clears collapsed-sidebar window chrome` is modified to drop the removed subtitle and to cover the Hub tabs, which are now leading content on the title row.

`hubs` needs no delta: its requirement to present Hubs as tabs above the active board stays satisfied, because the title row still sits above the board body. `Board selection and persistence` also stays satisfied, since the board row remains below the Hub row and switching boards still resets the filters.

## Impact

- Client: `src/client/board/board-header.tsx` becomes the owner of the two-row layout and gains `hubTabs` and `boardTabs` slots; `src/client/hub-nav.tsx` splits into `HubTabRow`, `BoardTabRow`, and the shared `ScopeTab`; a new `src/client/board/board-filter-control.tsx` holds the funnel trigger, the active indicator, and the popover; a new `src/client/popover.tsx` provides the primitive that `src/client/closed-conversations.tsx` migrates to; `src/client/board.tsx` changes only in how it wires the two navigation slots; `src/client/icons.tsx` gains `FilterIcon` and `FilterClearIcon` through its existing glyph adapter.
- Styles: new `src/client/styles/header.ts` registered in `src/client/styles/index.ts`; `.kb-hint` stays because dialogs and cards still use it, while the header-only `.kb-search` rule is deleted.
- Behaviour preserved: no filter control in selection mode, the presentation switch keeps its accessible name, and the filters keep applying to the workflow diagram presentation as they do today.
- Tests: six call sites query the search box and project select directly and must open the filter control first — `tests/client/board.test.tsx`, `tests/client/state.test.tsx`, `tests/bridge/plugin.test.tsx`, and `tests/browser/card-motion.spec.ts`. `tests/client/board.test.tsx` asserts the header's CSS rule as a literal string and needs a structural assertion instead. New browser coverage covers the two-row geometry, the control heights, the board chips, the active-filter indication, and the popover's focus and `Escape` behaviour.
- Verification: the plugin-owned isolated lanes only — `pnpm check` and `pnpm test:browser` with screenshots under `.verification/`. No host API changes, so no deprecated-API exposure is added.
