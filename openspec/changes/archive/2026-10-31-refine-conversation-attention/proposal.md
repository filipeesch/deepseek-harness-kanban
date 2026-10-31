# Proposal

## Why

Task notifications are not trustworthy. The blue unread dot appears as soon as the
main agent's turn ends, even while a delegated background subagent is still working,
so delegation reads as completed work. The red failure dot never clears, even after
the failing conversation is opened, because nothing acknowledges the failure fact.
"Working" disappears while a subagent works and its label is visually oversized, and
none of the indicators survive a reload because unread comes from per-client native
turn transitions rather than from a durable conversation fact.

## What Changes

- Reclassify execution. A conversation SHALL be working while its own assistant turn
  or any owned subagent descendant is running. Background activity SHALL mean jobs
  and schedules only; a running subagent SHALL no longer be presented as background
  work.
- Replace the transient blue indicator with a durable per-conversation notification:
  the last settled turn becomes a conversation fact (turn sequence plus outcome), and
  unread and failure are derived from it together with a per-conversation read
  acknowledgment. The blue and red indicators SHALL appear only when every agent in
  the conversation is idle.
- Acknowledge a conversation when its mounted native content is visible, and when its
  tab is closed; the acknowledgment SHALL persist across reloads and plugin restarts.
  Existing settled turns without a stored acknowledgment SHALL read as unread.
- Carry per-conversation attention in the snapshot and aggregate it to task attention
  on the client. Board and Hub attention aggregation keep their current meaning.
- Present the blue unread, orange awaiting-reply, and red failure dots on every open
  conversation tab, so a drawer with several conversations shows which one is
  pending. Closed-conversation entries SHALL NOT present attention dots.
- Present "Working" at the same text size as the background chip (10.5px), at weight
  600, without added letter-spacing.
- **BREAKING** (internal contract): the snapshot's attention changes from a
  task-keyed aggregate to per-conversation facts, and `BackgroundKind` drops
  `subagent`. Host and client ship together, so no mixed-version compatibility is
  required.
- Refactor the attention path while it is being touched: the host coordinator stops
  aggregating presentation, the failure read becomes a settled-turn read shared by
  both indicators, the client reminder tracker becomes a read-acknowledgment tracker
  over an injected storage port, and one attention-dot component serves cards and
  conversation tabs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: execution classification (working includes subagent descendants,
  background excludes them), durable conversation attention derivation and
  acknowledgment, aggregated attention indicators, and the card's working and
  background presentation.
- `task-conversations`: per-conversation attention dots on conversation tabs,
  acknowledgment of a conversation when it is viewed or closed, and the drawer
  execution detail losing the subagent labels.

## Impact

- Host: the attention coordinator, the native session facts reader, the snapshot
  projection, the wire snapshot schema, and the shared attention types.
- Client: the bridge projection, a new read-acknowledgment tracker with a storage
  port, the activity presentation module, the task card, the drawer conversation
  tabs and closed list, and the board attention consumers.
- Specs: `kanban-board` and `task-conversations`. `hubs` keeps its aggregation
  requirement unchanged because it aggregates task attention without defining it.
- No new dependency, no native DSH change, no new host service, and no persisted task
  field. Batch deletion, worktree coordination, and execution admission keep their
  current semantics; deletion keeps using native conversation idleness, which already
  includes descendants.
- Tests and browser fixtures that build a task-keyed attention snapshot are expected
  to change with the contract; they are updated in the implementation phase.
