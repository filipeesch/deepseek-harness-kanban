## Why

The card instruction action currently remains visible for every card in an instructed stage, even after the stage instruction has already been sent. It should be an entry affordance: visible after a transition into the instructed stage until a prompt is sent in that stage. The board also uses wider columns than needed; a 20% reduction gives the board more usable horizontal space.

## What Changes

- Persist a per-task entry marker for the current instructed stage.
- Show the card instruction action only while that entry is unresolved.
- Clear the marker after any successful user prompt in any open conversation of the task; keep it after an admission failure.
- Reset the marker on each transition into an instructed stage, including creation in an instructed initial stage; do not reset on a same-stage reorder.
- Reconcile unresolved markers against durable session history after restart.
- Reduce the default workflow column width from 300px to 240px (20%), with the minimum reduced proportionally.

## Impact

- Affected specs: `kanban-board`
- Affected code: task schema, store, host move/observe/initialize logic, card action visibility, board CSS, and focused tests.
- Adds a small persisted task field; the board data version remains 2 because the field is optional and existing states migrate by default.
