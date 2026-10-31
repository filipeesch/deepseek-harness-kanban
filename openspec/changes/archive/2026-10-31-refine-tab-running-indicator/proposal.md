# Proposal

## Why

When tasks are working, the Hub and board tabs present a single hard-coded green dot that reads as a generic "online" status, does not follow the host appearance, merges agent execution with background work, and says nothing about how much work is in flight. It is also inconsistent with the working presentation already used on cards and in the drawer header.

## What Changes

- Replace the green activity dot on the Hub tab and the board tab with a pulsing ring in the host accent that carries a numeric count of running tasks.
- Define the counted unit: one task counts once when it has a running agent turn, an owned subagent still running, or unsettled background work such as jobs or schedules. The count aggregates across the tab scope (all boards of a Hub, all tasks of a board).
- Show the numeral whenever the scope has running tasks, including a count of one, and keep it tabular so the tab label does not shift as the count changes.
- Expose the affected task titles on hover, and announce the count in the tab's accessible name.
- Respect the host's reduced-motion preference by keeping the ring visible without animation.
- Add the awaiting-reply attention indicator to both tab rows so a card that needs the user's reply is visible from the header, and place the three attention indicators (unread, awaiting reply, failure) before the running ring and its count.
- Remove the hard-coded green activity dot styling.
- Leave the card and drawer working presentation unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `hubs`: The Hub attention aggregation requirement changes to describe the running-task ring and count presentation instead of a generic execution indicator.
- `kanban-board`: The board attention aggregation requirement changes the same way for the board tab.

## Impact

- `src/client/board.tsx` tab rendering and scope aggregation helpers.
- `src/client/hub-view.ts` scope attention projection.
- `src/client/activity-styles.ts` and `src/client/styles.ts` indicator styling.
- New client projection and tab navigation presentation modules.
- Client and browser tests that assert the current green dot or the current tab status labels.
- Hub and board attention aggregation specs; no host API, storage, or command changes.
