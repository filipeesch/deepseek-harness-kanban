# Proposal

## Why

With the plugin installed, an ordinary DSH chat displays **"Kanban updates are unavailable: Only a branch of a conversation of this task can be attached. Retry updates"** directly above its composer. The message is noise: the board feed is healthy, and the quoted failure is the expected refusal of a branch claim the task drawer attempted while the person clicked an ordinary chat. Two independent defects combine. Every rejected board command overwrites the board-feed status, and the feed status strip is mounted in the composer dock that the host renders in every native conversation. Nothing breaks, but the plugin misreports its own health and offers an irrelevant retry action in chats that have nothing to do with the board.

## What Changes

- The board-update status reports only the live board feed's availability. A rejected command, an explicit board read, or a background refresh no longer replaces it. Callers keep reporting their own failures where the action happened, and the board's command-failure notice and the initial-load notice stay as they are.
- The board-update status, its message, and its **Retry updates** action are presented only on the Kanban page. The composer question dock stops receiving the board status node.
- The composer question dock keeps its own question-feed failure with **Retry questions**, and keeps serving every native conversation, including ordinary DSH chats, independently of the board feed.
- The drawer's branch claim keeps its current behavior: a Session the host does not prove attaches nothing and keeps the host's native navigation, now without producing any error surface.
- Cleanups in the same area: the unused `connected` field leaves the bridge status, the bridge reuses the client's existing error-to-problem conversion instead of its private copy, and the status strip becomes its own component with a single mount point.
- No **BREAKING** behavior for native conversations. The observable change is the removal of a misplaced failure banner.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `harness-navigation`: the board-update status and its retry action are page-scoped to Kanban and report only the live board feed; a native conversation, including an ordinary DSH chat, is never presented with a board-update failure.
- `structured-questions`: the composer question dock presents question state and the question feed's own failure with its retry in every conversation, independent of board feed availability, and does not present another surface's status.

## Impact

**Client**

- `src/client-bridge.ts`: the health channel stops recording request failures, `BridgeStatus` loses `connected`, and the local `problem()` gives way to the client's `asProblem()`.
- `src/client/feed-status.tsx` (new) with `src/client.tsx`: the strip becomes a component mounted once, on the Kanban page.
- `src/client/question-dock.tsx`: `status` leaves `QuestionDockServices`, `createQuestionDockServices`, and the bridge port they read; the global dock registration stays.
- `src/client/drawer-navigation-coordinator.ts`: no behavior change; its expected refusals simply stop reaching a status channel.

**Docs and tests**

- `docs/operations.md`: feed-error recovery separates board feed, rejected command, and question failures.
- Vitest: a rejected command leaves the board-update status untouched; the dock carries no other surface's status; the coordinator stays silent on a refusal. The browser and isolated-lane evidence proves an ordinary chat shows no banner.

**Dependencies**

None. No DSH change, no storage format change, no new host API, and no deprecated host surface.
