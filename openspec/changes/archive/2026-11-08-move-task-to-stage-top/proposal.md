# Proposal

## Why

A stage change made from the task drawer, or by the host's automatic advance, currently appends the task to the bottom of the destination stage. The task that just moved is usually the one the user needs next, but it lands behind older cards and has to be dragged by hand.

Drag and drop already carries an explicit position, so the gap is limited to the two moves that express no position intent: the drawer stage change and the automatic advance.

## What Changes

- A stage change with no requested position SHALL place the task at the top of the destination stage. That covers the drawer stage control, including a confirmed restricted transition, and the host automatic advance.
- Drag and drop SHALL keep honoring the dropped position, including a drop after the last card.
- The placement SHALL be resolved atomically by the host inside the transition transaction. Absent `beforeTaskId` means start, `null` means end, and a task id means immediately before that task. No command, persisted-transition, or shared-document schema field is added.
- **BREAKING** for command callers other than this plugin's client: `task.move` without `beforeTaskId` now places the task at the start of the destination instead of the end. Callers that want the end must send `beforeTaskId: null`.
- An unanchored pending transition persisted before this change SHALL also be placed at the start when it is dispatched. No migration is introduced.
- The board SHALL preview an unanchored drawer move at the top of the destination before the host confirms it.
- The placement policy SHALL be expressed as a domain value type (`Placement`) instead of the optional/nullable anchor, and `placeTask` SHALL consume it. A shared ordering comparator SHALL replace the position plus creation-time sort duplicated between domain and client.
- The `Direct stage manipulation on the board` requirement SHALL acknowledge the drawer stage control and state the placement rule; today it claims stage changes happen only through drag and drop, while the timed-instruction requirement already specs drawer changes.
- The `Automatic advance destination and dispatch` requirement SHALL place the task at the top of the resolved destination instead of the last position.
- Unchanged: the card run/play action, execution preparation, timed stage instruction, workflow configuration, and position normalization.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: the placement of a drawer stage change and of an automatic advance moves from the end to the top of the destination stage, and the direct stage manipulation requirement acknowledges the drawer stage control and the explicit drop position.

## Impact

- Domain: `placeTask` gains a `Placement` input; new placement and shared task-ordering modules replace the anchor interpretation now inline in `placeTask` and the client.
- Host: the transition drain translates the persisted anchor into a `Placement`; automatic advance admission stays anchor-free and therefore inherits the start placement.
- Client: the move request keeps the anchor as an optional intent, sends an explicit `null` for a drop after the last card, and previews the start placement optimistically.
- Persistence and sharing: no schema, storage, synchronization, or protocol field change. Only the meaning of an absent anchor changes, which is documented on the command and the persisted transition.
- Tests: domain placement and ordering, host move and automatic-advance placement, client command payloads and optimistic placement, and the isolated browser and real-composition lanes.
