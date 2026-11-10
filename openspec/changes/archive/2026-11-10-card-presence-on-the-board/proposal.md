# Proposal

## Why

A task card's state signals are too small and too scattered to read at a glance: three 9px attention dots in the context region, a 3px pulsing bar on the trailing edge, and a text-only status strip. In the workflow diagram the problem is worse, because the canvas fits the whole workflow at zoom levels as low as 0.2, which renders a 9px dot at roughly 2px and the card's pill controls at roughly 5px. Someone scanning a board cannot tell which cards are running, which carry unread messages, which are waiting on them, and which failed without opening each card. There is also no way to dismiss unread state for a whole board at once.

## What Changes

- The task card gains a **painted surface**: a low-saturation tint of the card's dominant attention state, chosen by a fixed priority of error, then awaiting reply, then running, then unread.
- **Attention marks** replace the three dots in the card's context region and are counter-scaled against the diagram zoom, capped at 3.5x, so they keep a readable on-screen size in both the column board and the workflow diagram.
- **Running is expressed by the card's border and its existing trailing accent**, not by a fourth mark. That keeps running distinguishable from unread under `prefers-reduced-motion`, where the pulse is removed and both states would otherwise share one blue.
- **Attention colors become design tokens** shared by the card, the Hub and board tabs, and the drawer's conversation tabs, replacing the hard-coded hex values used today.
- The board header gains a **mark all as read** action, enabled while the active board has any unread or failed settled turn, which acknowledges every settled turn on that board.
- **BREAKING (internal)**: the card's status-entry projection moves out of the card component into its own module. The exported `cardStatusEntries` function keeps its name and behavior.
- Background activity (jobs and schedules) stays off the card; only the drawer's Conversations entry presents it.
- No host API, remote protocol, or persisted schema changes.

## Capabilities

### New Capabilities

None. The behavior belongs to capabilities the project already has.

### Modified Capabilities

- `kanban-board`: task card layout (the context region carries marks, the surface carries the dominant state), coexisting attention indicators (marks gain a size and a zoom rule, the surface gains a contrast-safe tint), execution accent (border and trailing accent carry running; no running mark), and the board header gains the mark-all-read action.
- `task-conversations`: conversation attention acknowledgment gains a board-scoped bulk path that acknowledges settled turns without displaying their conversations.

## Impact

- Client components: `src/client/task-card.tsx`, `src/client/attention-dots.tsx`, `src/client/board-card.tsx`, `src/client/board/board-header.tsx`, `src/client/board.tsx`, `src/client.tsx`, `src/client/icons.tsx`.
- New modules: a pure domain projection for the card presence policy, and a card status-entry module extracted from the card component.
- Read state: `src/client/conversation-read-tracker.ts`, `src/client/conversation-read-state.ts`, and `src/client-bridge.ts` gain a bulk acknowledgment path. The host is untouched.
- Styles: `src/client/styles/cards.ts`, `src/client/styles/base.ts`, and a new token block; the shared `--kb-state-*` tokens replace the literal colors in `src/client/styles/sharing.ts`.
- Workflow diagram: `src/client/workflow-view/` publishes the canvas zoom as a CSS custom property. No new prop reaches the card.
- Tests: client component tests, browser appearance and contrast tests, a reduced-motion test, and new diagram zoom coverage. Screenshots under `.verification/`.
- Not affected: `src/host/`, `src/remote.ts`, `src/shared/types.ts` schema, and any persisted record.
