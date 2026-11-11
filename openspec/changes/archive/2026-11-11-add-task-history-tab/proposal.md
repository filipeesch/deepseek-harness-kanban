# Proposal: Task history in the task drawer

## Why

The task drawer shows only the task's current state: its stage, its auto mode, and its worktree. Nothing records how the task reached that state. A person reconstructing "how did this task get here, and when" has to read conversations, card status lines that overwrite each other, and stage markers that hold at most one moment. The task is the durable unit of work, so its flow should be readable in one place, in order, without depending on any conversation being open.

## What Changes

- Add a durable, append-only flow record to each task, written as facts settle: the task's creation with its initial stage, every stage entry, every next-stage intent recorded on the task, every auto mode change, and the outcome of each worktree or context operation. Each entry carries the moment it happened.
- Add a **History** section to the task drawer, after **Notes**, presenting that record as a table with the columns **When**, **Event**, **Detail**, and **In stage**. Rows are shown newest first, the whole list is scrollable, and there is no cap: the record grows with the task and is removed with it.
- Show nothing for time before the feature: tasks created earlier keep an empty history and record from their next event on. No backfill and no inferred timestamps.
- Keep the stage identity as the entry's reference and resolve the stage name from the board's current workflow, so the table follows a stage rename instead of freezing an old name.
- Record only settled facts. Phases of an operation in progress, a transition still being sent, and any other interim state stay in the existing status surfaces and do not become history rows.
- Record one row per occurrence of an auto mode change, including repeated pauses for the same reason.
- Record a row when a next-stage intent is recorded or replaced; clearing an intent adds no row, because a move already records the stage change.
- Keep the task history out of the agent-facing task payloads, so browsing cards with a long-running task does not carry its whole history into the model's context.
- Introduce no new host command and no new client read: the record travels inside the task the snapshot already carries.

## Capabilities

### New Capabilities

- `task-history`: what the plugin records about a task's flow, what it deliberately does not record, and how that record is presented and bounded.

### Modified Capabilities

- `task-conversations`: the *Task drawer sections* requirement gains the History section, its position, and the guarantee that the existing sections keep their behavior.

## Impact

- **Domain**: the task record gains an optional history field, validated by the existing strict task schema; the task operations that produce those facts append to it.
- **Host**: the operation journal is the one place that knows when a worktree or context operation settled, so it reports the outcome there; no new command, route, or permission.
- **Client**: one new drawer section, its icon and table, plus the formatting of local time and time spent in a stage.
- **Compatibility**: the field is optional, so stored Hubs and older clients are unaffected; stage renames migrate the recorded references the same way the task's own stage references are migrated today.
- **Not affected**: team sharing publishes only board workflows and a manifest, never tasks, so the history never leaves the installation; conversation content, notes, and worktree execution are unchanged.
- **Tests**: domain appends per fact, host tests for each writing path, a client component test for the table, and a browser check of the new section.
