# hubs Specification

## Purpose
Define Hubs as the logical, name-only segregation boundary for Kanban projects, boards, workflows, and task work, independent of native DSH workspaces.

## Requirements

### Requirement: Hub as a logical segregation boundary

A Hub SHALL group a project registry and zero or more boards. A Hub SHALL have a nonempty name and no other required metadata. A Hub SHALL NOT have a filesystem root, SHALL NOT map to a native DSH workspace, and SHALL NOT change project paths, Git roots, worktrees, conversations, session grouping, or sandbox behavior. The term workspace SHALL remain reserved for the native DSH workspace.

#### Scenario: Create a Hub without filesystem configuration
- **WHEN** the user creates a Hub with a name
- **THEN** the Hub exists without a root folder or containment validation
- **AND** no native DSH workspace is created, renamed, or moved by Hub creation

#### Scenario: Keep native workspace semantics unchanged
- **WHEN** a task in a Hub starts or changes its effective directory
- **THEN** its native DSH workspace behavior is the same as before Hubs existed
- **AND** the Hub does not become a native workspace boundary

### Requirement: Hub-owned projects and boards

Each project SHALL belong to exactly one Hub. Each board SHALL belong to exactly one Hub. Every task SHALL belong to exactly one board and one project in that same Hub. A project, board, or task SHALL NOT be shared with or moved to another Hub.

#### Scenario: Scope projects to the active Hub
- **WHEN** the user selects a Hub
- **THEN** its project configuration lists only projects owned by that Hub

#### Scenario: Scope boards to the active Hub
- **WHEN** the user selects a Hub
- **THEN** its board tabs list only boards owned by that Hub

#### Scenario: Reject a project from another Hub
- **WHEN** a task creation or edit would reference a project that is not in the task's Hub
- **THEN** the operation is rejected without changing the task

#### Scenario: Do not move a task between Hubs
- **WHEN** the user requests moving a task to a board in another Hub
- **THEN** the operation is not offered and the task remains in its original board and Hub

### Requirement: Hub creation and naming

The plugin SHALL create a Hub from a required nonempty name. Hub names SHALL be unique after trimming, compared case-insensitively across the installation. A failed validation SHALL leave the Hub collection unchanged and report the conflict or invalid name.

#### Scenario: Create a Hub
- **WHEN** the user submits a valid Hub name
- **THEN** the Hub is created, appears in the Hub tabs, and has no boards or projects until added

#### Scenario: Reject an empty name
- **WHEN** the user submits a Hub name containing only whitespace
- **THEN** no Hub is created and the form reports that a name is required

#### Scenario: Reject a duplicate name
- **WHEN** the user submits a name that matches another Hub case-insensitively
- **THEN** no Hub is created and the form reports the name conflict

#### Scenario: Rename a Hub
- **WHEN** the user saves a valid new name for an existing Hub
- **THEN** the Hub tabs show the new name
- **AND** the Hub's boards, projects, tasks, conversations, and worktrees are unchanged

### Requirement: Hub deletion

The plugin SHALL allow deleting a Hub only when none of its boards contains a task. The last remaining Hub SHALL NOT be deleted. Deleting an eligible Hub SHALL remove the Hub, its empty boards, and its task-free project registrations, and SHALL retain project directories, worktrees, Git branches, native conversations, and native workspaces. The confirmation SHALL identify the Hub, its board count, and its project count before the user confirms.

#### Scenario: Delete an empty Hub
- **WHEN** another Hub exists and no board in the target Hub has a task
- **THEN** the Hub, its empty boards, and its task-free project registrations are removed after confirmation
- **AND** directories, worktrees, branches, native conversations, and native workspaces are retained

#### Scenario: Block deletion when a board has tasks
- **WHEN** any board in the target Hub contains a task
- **THEN** the Hub is not deleted and the plugin reports how many tasks block it

#### Scenario: Protect the last Hub
- **WHEN** the user attempts to delete the last remaining Hub
- **THEN** the delete action is unavailable and the plugin explains that at least one Hub must exist

#### Scenario: Delete the active Hub
- **WHEN** the active Hub is deleted and another Hub exists
- **THEN** the plugin selects the first remaining Hub and presents it without leaving a stale Hub tab

### Requirement: Hub selection and persistence

The Kanban page SHALL present Hubs as tabs above the active board. The active Hub SHALL be retained across reloads in browser local storage. When the persisted Hub no longer exists, the plugin SHALL select the first available Hub. The active board for each Hub SHALL also be retained, falling back to the first board when the remembered board is unavailable. Changing the active Hub SHALL NOT stop, move, or otherwise affect task execution.

#### Scenario: Show Hub tabs
- **WHEN** more than one Hub exists
- **THEN** the Kanban page shows one tab per Hub
- **AND** the active Hub is visibly selected

#### Scenario: Restore the active Hub after reload
- **WHEN** the user reloads the page after selecting a Hub
- **THEN** the same Hub is active if it still exists

#### Scenario: Fall back from a deleted Hub
- **WHEN** the persisted active Hub no longer exists
- **THEN** the first available Hub becomes active
- **AND** the page does not render an empty or stale selection

#### Scenario: Switching Hubs does not affect execution
- **WHEN** the user switches from one Hub to another while a task is running
- **THEN** the task continues running
- **AND** its conversations and worktree are unchanged

### Requirement: Hub attention aggregation

The Hub tab SHALL present aggregated attention for all tasks in all of its boards. Attention SHALL consist of the unread indicator, the awaiting-reply indicator, the failure indicator, and a running-task indicator. The unread, awaiting-reply, and failure indicators SHALL be presented first, in that order, and the running-task indicator SHALL follow them. The running-task indicator SHALL be presented as a pulsing ring in the host accent with an adjacent numeral, and SHALL be present whenever at least one task in the Hub is running, including when exactly one task is running. The numeral SHALL be the number of running tasks, counting each task once regardless of how many agents, subagents, jobs, or schedules it owns. A task SHALL count as running while it has a running agent turn, an owned subagent still running after the turn ends, or unsettled background work such as jobs or schedules. The numeral SHALL be legible in the host's light and dark appearances, SHALL use tabular figures so the Hub label does not shift as the count changes, and SHALL remain visible without animation when the host prefers reduced motion. Hovering the indicator SHALL expose the titles of the running tasks. The Hub tab's accessible name SHALL include the running-task count. The unread, awaiting-reply, and failure indicators SHALL coexist with the running-task indicator. The running-task indicator SHALL communicate both the presence and the number of running tasks rather than a static status color alone. The running count SHALL clear when no task in the Hub is running. Attention in a Hub that is not active SHALL remain visible on its tab.

#### Scenario: Aggregate unread activity on the Hub tab
- **WHEN** a task in any board of a Hub has unread activity
- **THEN** that Hub's tab presents an unread indicator

#### Scenario: Aggregate awaiting reply on the Hub tab
- **WHEN** a task in any board of a Hub is awaiting the user's reply
- **THEN** that Hub's tab presents an awaiting-reply indicator

#### Scenario: Aggregate execution on the Hub tab
- **WHEN** one task on one board and another task on a different board of the same Hub are running
- **THEN** that Hub's tab presents a running-task indicator
- **AND** its numeral is 2

#### Scenario: Count a task once
- **WHEN** a task has a running agent turn and also owns unsettled jobs
- **THEN** that task contributes 1 to the Hub's running-task count

#### Scenario: Keep counting an owned subagent
- **WHEN** a task's assistant turn ends while an owned subagent descendant is still running
- **THEN** that task still contributes 1 to the Hub's running-task count

#### Scenario: Count background work without an agent
- **WHEN** a task in the Hub owns only unsettled background work and no agent is running
- **THEN** that task contributes 1 to the Hub's running-task count

#### Scenario: Order the running count after the attention indicators
- **WHEN** a Hub tab presents unread, awaiting-reply, and failure indicators together with running tasks
- **THEN** the unread, awaiting-reply, and failure indicators appear first, in that order
- **AND** the running-task indicator appears after them

#### Scenario: Expose the running task titles on hover
- **WHEN** the user hovers the running-task indicator on a Hub tab
- **THEN** the exposed detail lists the titles of the running tasks in that Hub

#### Scenario: Announce the running count to assistive technology
- **WHEN** a Hub tab carries a running-task indicator numbered 2
- **THEN** the tab's accessible name includes that there are 2 running tasks

#### Scenario: Keep the ring visible without animation
- **WHEN** the host prefers reduced motion and a Hub has running tasks
- **THEN** the running-task indicator remains visible without animation

#### Scenario: Clear the Hub indicator
- **WHEN** no task in the Hub has unread activity, is awaiting a reply, has failed, has a running agent, has an owned subagent, or owns unsettled background work
- **THEN** the Hub tab presents no attention or running-task indicator

#### Scenario: Keep every attention indicator alongside the count
- **WHEN** a task in the Hub has unread activity, an awaiting reply, or a failure in addition to running tasks
- **THEN** the Hub tab presents the corresponding attention indicators together with the running-task indicator

#### Scenario: Show attention for an inactive Hub
- **WHEN** a task in a Hub that is not active gains unread activity, awaits a reply, or starts running
- **THEN** that Hub's tab presents the corresponding indicator without requiring the user to select it

### Requirement: Hub bootstrap and migration

The installation SHALL always start with at least one Hub. A fresh installation SHALL create a Hub named `My Hub` with one board named `Kanban` using the default workflow. An installation with the previous single-board state SHALL migrate its workflow, projects, tasks, and notes into a Hub named `My Hub` and one board named from the current workflow name, falling back to `Kanban` when the workflow has no name. Migration SHALL preserve project identities, task identities, session identities, notes, worktree bindings, and the global worktree base path, and SHALL NOT require recadastramento or start any agent. A migration failure SHALL be reported and SHALL NOT silently reset or replace the previous data.

#### Scenario: Bootstrap a fresh installation
- **WHEN** the plugin opens with no prior Kanban state
- **THEN** `My Hub` exists with one `Kanban` board using the default workflow
- **AND** no task, project, or conversation is created

#### Scenario: Migrate the previous state
- **WHEN** the plugin opens with the previous single-board state
- **THEN** `My Hub` contains one board with the previous workflow
- **AND** all previous projects, tasks, and notes remain available with their identities
- **AND** task conversations and worktree bindings are unchanged
- **AND** the global worktree base path is preserved

#### Scenario: Report a migration failure
- **WHEN** the previous state cannot be read or validated during migration
- **THEN** the plugin reports the failure with an actionable message
- **AND** it does not write a replacement Hub or discard the previous data

#### Scenario: Do not repeat migration
- **WHEN** the plugin opens again after a successful migration
- **THEN** the existing Hubs are used without creating another default Hub or board
