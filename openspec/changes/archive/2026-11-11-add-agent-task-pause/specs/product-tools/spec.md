# Spec Delta

## MODIFIED Requirements

### Requirement: Restricted board tool surface

The plugin SHALL expose tools for discovering Hubs, boards, and projects; reading board and task information; creating tasks; editing task titles and descriptions; creating, listing, and tag-aware updating of shared task notes; reading the transitions available from a task's current stage and recording the transition that task will follow next through `list_allowed_transitions` and `set_next_transition`; pausing and resuming a task's automatic advance through `pause_task` and `resume_task`; and administering the boards of a Hub through `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`, together with an extended `get_board_summary`; and searching, reading, creating, editing, and deleting the Hub's team files through `search_team_files`, `read_team_file`, `create_team_file`, `edit_team_file`, and `delete_team_file`. Its product tool surface SHALL NOT include moving tasks, deleting tasks, deleting notes, sending messages to other cards, Hub creation, rename, or deletion, decision-ledger tools, or a plugin-owned TODO checklist. Recording a transition or pausing a task SHALL NOT be treated as moving a task.

#### Scenario: Discover available product operations

- **WHEN** an agent receives the plugin's board and note tools
- **THEN** Hub, board, and project discovery, board and task reading, task creation, task text editing, shared note creation, listing, and tag-aware updating, transition discovery and recording, task pause and resume, board creation, board rename, board workflow reading and writing, empty-board deletion, and team file search, reading, creation, editing, and deletion are available operations
- **AND** board movement, task deletion, note deletion, inter-card messaging, Hub administration, decision-ledger operations, and a plugin-owned TODO checklist are not exposed as part of that tool surface

#### Scenario: Inspect the board administration tool names

- **WHEN** an agent receives the plugin's board administration tools
- **THEN** the surface contains `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`
- **AND** no tool creates, renames, or deletes a Hub

#### Scenario: Inspect the task pause tool names

- **WHEN** an agent receives the plugin's task control tools
- **THEN** the surface contains `pause_task` and `resume_task`
- **AND** no tool turns a task's auto mode on or off

#### Scenario: Do not move a task by recording a transition

- **WHEN** an agent records the transition a task will follow next
- **THEN** the task remains in its current stage and position
- **AND** the recorded transition only decides the destination of a later advance

#### Scenario: Do not move a task by pausing it

- **WHEN** an agent pauses or resumes a task
- **THEN** the task remains in its current stage and position
- **AND** no message is sent and no agent execution starts

#### Scenario: Expose team file operations

- **WHEN** an agent receives the plugin's product tools for a Hub bound to a storage that supports team files
- **THEN** searching, reading, creating, editing, and deleting the Hub's team files are available operations
- **AND** moving a team file to another path, restoring a deleted team file, and browsing the storage outside the team files directory are not exposed

## ADDED Requirements

### Requirement: Task pause tools

The plugin SHALL expose `pause_task` and `resume_task`. Both SHALL resolve the task from the calling task conversation or from an explicit task identifier, so a conversation may pause or resume a task other than its own. Both SHALL report the task, its current stage, whether auto mode is enabled, and the pause in effect with its reason after the call.

`pause_task` SHALL require a reason. A blank reason SHALL be rejected, and a reason longer than the accepted length SHALL be rejected rather than truncated. The pause SHALL suspend the task's automatic advance and SHALL NOT move the task, change its position, clear or replace the recorded transition, send a message, start an execution, or disable auto mode. A task whose auto mode is disabled SHALL NOT be paused: the call SHALL succeed with a result stating that auto mode is disabled and that the task does not advance, and SHALL record nothing.

`resume_task` SHALL clear the pause and SHALL leave auto mode enabled. It SHALL NOT move the task, change its position, send a message, or start an execution, and it SHALL NOT advance the task for a turn that already ended. Resuming a task that carries no pause SHALL succeed with a result stating that the task is not paused and SHALL change nothing.

Neither tool SHALL change the task's recorded transition, and clearing a recorded transition SHALL NOT pause the task. Both tools SHALL be available in a task conversation and in an ordinary DSH chat when the task identifier is provided.

#### Scenario: Pause a task

- **WHEN** an agent calls `pause_task` for a task whose auto mode is enabled with a nonempty reason
- **THEN** the task records the pause and its reason
- **AND** auto mode remains enabled
- **AND** the result reports the pause in effect

#### Scenario: Resolve the pause target from the conversation

- **WHEN** an agent calls either tool inside a task conversation without a task identifier
- **THEN** the plugin resolves the task that owns the conversation

#### Scenario: Resolve another task by identifier

- **WHEN** an agent calls `resume_task` with the identifier of a different task in the same Hub
- **THEN** the plugin resumes that task
- **AND** the calling task is unchanged

#### Scenario: Require a task scope outside a task conversation

- **WHEN** an agent calls either tool in an ordinary DSH chat without a task identifier
- **THEN** the tool rejects the request with an actionable error

#### Scenario: Reject a blank reason

- **WHEN** an agent calls `pause_task` with a blank reason
- **THEN** the tool reports the rejection
- **AND** the task is unchanged

#### Scenario: Reject an oversized reason

- **WHEN** an agent calls `pause_task` with a reason longer than the accepted length
- **THEN** the tool reports the rejection
- **AND** the task is unchanged

#### Scenario: Report a task that does not advance

- **WHEN** an agent calls `pause_task` for a task whose auto mode is disabled
- **THEN** the call succeeds and reports that the task does not advance because auto mode is disabled
- **AND** no pause is recorded

#### Scenario: Resume a paused task

- **WHEN** an agent calls `resume_task` for a task that carries a pause
- **THEN** the pause is cleared and auto mode remains enabled
- **AND** the task's stage and position are unchanged
- **AND** the result reports that no pause is in effect

#### Scenario: Resume a task that is not paused

- **WHEN** an agent calls `resume_task` for a task that carries no pause
- **THEN** the call succeeds and reports that the task is not paused
- **AND** the task is unchanged

#### Scenario: Pausing does not clear the routing

- **WHEN** an agent pauses a task that has a recorded transition
- **THEN** the recorded transition is unchanged
- **AND** clearing the recorded transition later does not pause the task

#### Scenario: Pausing does not move the task

- **WHEN** an agent pauses or resumes a task
- **THEN** the task's stage and position are unchanged
- **AND** no message is sent and no agent execution starts
- **AND** no pending automatic advance is retracted
