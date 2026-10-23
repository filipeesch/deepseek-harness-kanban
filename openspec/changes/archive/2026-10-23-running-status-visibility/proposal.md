# Proposal

## Why

A task card can keep showing that it is running after the assistant turn has already ended. The board derives that state from a cached native read that is invalidated only by session events and a single short retry; the canonical idle transition, `agent/status`, is never observed. Background work also keeps a conversation "active", so a settled job or subagent has no event that clears the card. The client then ORs that possibly stale value with its own native status, which means neither source can correct the other.

At the same time the only visible cue is a small text pill, so users cannot tell at a glance which cards are executing, what is executing in the background, or trust that the state will stop when the turn does.

## What Changes

- Redefine the card's running state as an assistant turn only. Background work (jobs, subagents, and schedules) becomes a separate, quieter indicator instead of being folded into the same "Running" label.
- Make the host the single owner of turn state. It observes the canonical idle transition and the background lifecycles it can observe, and re-checks on a short bounded interval while anything is active, so a missed edge self-heals. The client stops merging its own native running flag into the card.
- Replace the low-visibility pill with an animated "Working" indicator plus a card accent, and show the same execution status in the task drawer header on every section.
- Show background work as a count chip with activity labels available on hover and in the drawer, so a task whose turn ended but whose job is still running is not silently idle on the board.
- Keep the bulk-deletion skip rule on its existing "any conversation is active" meaning. Only the display meaning changes; deletion safety is unaffected.
- Extend the board's attention contract with background activity and update the strict snapshot schema.
- Refactor the attention path while it is being touched: a host coordinator owns caching, invalidation, and aggregation; native session facts move out of the session port factory; the client attention projection and reminder bookkeeping become independent units; the card and drawer indicators become one presentation module; and the working/background styles are consolidated.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: execution activity is split into turn and background; the card must present a visible working indicator, a card accent, and a background chip; attention indicators coexist with both.
- `task-conversations`: the drawer header shows the task's execution status in addition to the title and project.

## Impact

- Affected host code: the board application and native session ports, the host entry-point wiring, the shared attention type, and the wire snapshot schema.
- Affected client code: the client bridge, the board card, the task drawer header, the shared styles, and new client units for attention projection and activity presentation.
- Unchanged boundaries: no replacement server, no native engine change, no new dependency, no new approval or decision mechanism. Batch deletion, worktree coordination, and conversation execution keep their current semantics.
- Tests: host attention refresh and schedule wake tests, bridge attention tests, board rendering tests, and the browser fixtures are expected to change with the new attention shape.
- The attention wire shape changes. Host and client are one bundled plugin, so there is no mixed-version compatibility requirement.
