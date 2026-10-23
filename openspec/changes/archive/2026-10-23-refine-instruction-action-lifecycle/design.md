## Context

The card instruction action is a shortcut for an instructed stage. It should appear only for the unresolved entry into that stage, not remain available indefinitely. The action's prompt and any manually sent prompt must hide it without board stage/position changes.

## Decisions

### Persisted entry marker

Add `instructionPending?: { columnId: string; enteredAt: number }` to `Task`. The marker is set when a task enters a stage with a nonempty entry instruction and is cleared when a successful user prompt is observed. The marker is optional in the persisted schema; existing boards load without it.

### Entry and reset rules

- A move between different stages creates a marker for an instructed destination and clears any marker for an uninstructed destination.
- A same-stage reorder leaves the marker unchanged.
- Leaving and returning creates a new marker.
- A task created directly in an instructed initial stage gets a marker.
- Existing tasks already in an instructed stage without a marker do not show the action until their next entry.

### Prompt detection

The host observes `user/message` events whose source kind is `user`. Any such event in a session belonging to the task clears the marker when its time is at or after the marker's `enteredAt` and the marker still matches the task's current column. Injected `kanban-task` context messages, tool events, and assistant events do not clear it. Admission failures do not clear it.

On start, the host reconciles each unresolved marker against durable session history so a prompt logged just before a restart does not leave the action visible.

### Client presentation

`RunInstructionButton` renders only when the current column has an entry instruction and `task.instructionPending.columnId` matches that column. It continues to send only the exact instruction to the first open conversation. The task-context row follows the native Chat's loaded history; the plugin adds no separate older-message loader or paging control.

### Column width

The default column slot changes from 300px to 240px (20% narrower); the minimum changes from 260px to 208px. Content-driven column heights and horizontal board scrolling remain unchanged.

## Risks

- The marker is persisted board state. The field is optional and no data-version bump is needed, but the schema and validation must accept existing states.
- Event delivery can be delayed. The host compares event time with the entry time and reconciles after restart; a prompt sent before the entry does not clear the new marker.
- The action no longer remains available after a manual prompt; the drawer and composer remain the path to send another message.

## Verification

Host tests cover entry, prompt clearing, ignored context events, admission failure, reorder, leave/re-enter, and restart reconciliation. Client tests cover marker visibility and card action behavior. A style test and the browser layout test cover the narrower columns. Run typecheck, Vitest, browser tests, build, and OpenSpec validation.
