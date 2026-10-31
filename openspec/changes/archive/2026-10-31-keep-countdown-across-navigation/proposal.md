# Proposal

## Why

The five-second countdown for an instructed stage move is reconciled against the visible board, so switching to another board or Hub cancels a pending instruction the user already committed to. The send path also depends on a command runner captured by the mounted board, which makes the armed window sensitive to navigation and to the board being mounted. Users expect the window to keep running while they move around the app.

## What Changes

- **One reconciliation owner.** The client plugin generation keeps the shared auto-run controller and reconciles it against every task in every Hub. The board view stops reconciling the shared controller; only its standalone fallback reconciles, from the full snapshot, while the board owns it.
- **Mount-independent execution.** The auto-run command port is created at the client composition root over the native client bridge, so an expiry no longer depends on a mounted board. The `onRunReady` callback and the mutable runner binding are removed.
- **The countdown survives navigation.** Switching board or Hub, hiding the Kanban panel, filtering the card, or opening another conversation leaves the window running. Only a changed or removed entry marker (for example a successful user prompt or a deletion), a newer instructed entry, or Cancel stops it.
- **Product rules unchanged.** The window stays fixed at five seconds, targets the task's first open conversation (creating one when none is open), reports failures on the card and in the drawer notice, never retries automatically, and is not persisted: reload, app restart, and plugin restart send nothing and restore the run action.
- **Cleanup.** Remove the board-scoped reconciliation of the shared controller and the `onRunReady`/`autoRunRunner` plumbing. Keep the controller cohesive and leave the rest of the board composition unchanged.
- No host command, wire schema, persisted data, or migration changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: the timed stage instruction keeps running when the user switches board or Hub, and the armed window no longer depends on the board being mounted or visible.

## Impact

- **Client:** `src/client.tsx` (root-owned controller and command port; remove the runner binding), `src/client/board.tsx` (remove `onRunReady`; reconcile only the owned fallback from the full snapshot).
- **Specs:** a `kanban-board` delta only; `task-conversations`, host APIs, and persisted data are unchanged.
- **Verification:** the hidden panel and filtered card cases already have coverage; the delta adds explicit board and Hub navigation evidence to the existing lanes during implementation.
