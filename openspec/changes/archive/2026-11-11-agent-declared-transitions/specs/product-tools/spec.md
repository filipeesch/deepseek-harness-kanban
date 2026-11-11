# Spec Delta

## MODIFIED Requirements

### Requirement: Restricted board tool surface

The plugin SHALL expose tools for discovering Hubs, boards, and projects; reading board and task information; creating tasks; editing task titles and descriptions; creating, listing, and tag-aware updating of shared task notes; reading the transitions available from a task's current stage and declaring, with a reason, the transition that task will follow next through `list_allowed_transitions` and `set_next_transition`; pausing and resuming a task's automatic advance through `pause_task` and `resume_task`; administering the boards of a Hub through `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`, together with an extended `get_board_summary`; searching, reading, creating, editing, and deleting the Hub's team files through `search_team_files`, `read_team_file`, `create_team_file`, `edit_team_file`, and `delete_team_file`; and sending a message from a task conversation to another task in the same Hub through `send_task_message`. Its product tool surface SHALL NOT include moving tasks, deleting tasks, deleting notes, Hub creation, rename, or deletion, decision-ledger tools, or a plugin-owned TODO checklist. Neither declaring a transition nor pausing a task SHALL move a task during the call; a declared transition SHALL be followed by the task's next completed turn.

#### Scenario: Discover available product operations

- **WHEN** an agent receives the plugin's board and note tools
- **THEN** Hub, board, and project discovery, board and task reading, task creation, task text editing, shared note creation, listing, and tag-aware updating, transition discovery and declaration, task pause and resume, board creation, board rename, board workflow reading and writing, empty-board deletion, team file search, reading, creation, editing, and deletion, and cross-card message sending are available operations
- **AND** board movement, task deletion, note deletion, Hub administration, decision-ledger operations, and a plugin-owned TODO checklist are not exposed as part of that tool surface

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
- **THEN** the task remains in its current stage and position while the call runs
- **AND** the declared transition decides the destination of the advance the next completed turn performs

#### Scenario: Do not move a task by pausing it

- **WHEN** an agent pauses or resumes a task
- **THEN** the task remains in its current stage and position
- **AND** no message is sent and no agent execution starts

#### Scenario: Expose team file operations

- **WHEN** an agent receives the plugin's product tools for a Hub bound to a storage that supports team files
- **THEN** searching, reading, creating, editing, and deleting the Hub's team files are available operations
- **AND** moving a team file to another path, restoring a deleted team file, and browsing the storage outside the team files directory are not exposed

#### Scenario: Expose the cross-card message tool

- **WHEN** an agent receives the plugin's product tools inside a task conversation
- **THEN** `send_task_message` is available as an operation
- **AND** the tool surface still exposes no moving or deleting of tasks and no Hub administration

### Requirement: Transition discovery and recording tools

The plugin SHALL expose `list_allowed_transitions` and `set_next_transition`.

`list_allowed_transitions` SHALL resolve the task from the calling task conversation or from an explicit task identifier and SHALL return the task's current stage, every target that stage configures with its condition, the target that applies when nothing is recorded, and the currently recorded transition together with the reason it carries.

`set_next_transition` SHALL act only on the task that owns the calling conversation: it SHALL offer no task identifier, and a call made outside a task conversation SHALL be rejected. It SHALL accept an optional target stage and an optional reason. A provided target SHALL be one of the current stage's configured targets and SHALL require a nonempty reason; a blank reason SHALL be rejected, and a reason longer than the accepted length SHALL be rejected rather than truncated. An omitted target SHALL clear the recording and SHALL NOT require a reason.

Both tools SHALL report the current stage, the configured targets, and the recorded transition after the call. A stage that does not configure transitions SHALL be reported as having no configurable transitions instead of inventing a target set. Neither tool SHALL move the task during the call, change its position, send a message, or change auto mode, and both SHALL be available while auto mode is disabled. A recorded transition SHALL arm the advance the task performs at the end of its next completed turn, whether or not auto mode is enabled. A rejected target, a rejected reason, or a missing required reason SHALL leave the task and its recorded transition unchanged.

#### Scenario: List the configured transitions

- **WHEN** an agent calls `list_allowed_transitions` for a task whose stage configures two targets with conditions
- **THEN** the result contains the current stage and both targets with their conditions
- **AND** it contains the target that applies when nothing is recorded

#### Scenario: Return the recorded transition

- **WHEN** the task already recorded a transition and the agent calls either tool
- **THEN** the result reports that recorded transition and the reason it carries

#### Scenario: Report a stage without configured transitions

- **WHEN** the agent calls `list_allowed_transitions` for a task whose stage does not configure transitions
- **THEN** the result states that the stage configures no transitions
- **AND** no target is returned

#### Scenario: Record a transition

- **WHEN** an agent calls `set_next_transition` with a target that the current stage configures and a nonempty reason
- **THEN** the task records that transition together with that reason
- **AND** the result reports the recorded transition and the remaining targets
- **AND** the task's stage and position are unchanged

#### Scenario: Reject a declaration without a reason

- **WHEN** an agent calls `set_next_transition` with a target and no reason, or with a reason that is blank after trimming
- **THEN** the tool reports the rejection with an actionable error
- **AND** the task and any previously recorded transition are unchanged

#### Scenario: Reject a reason over the accepted length

- **WHEN** an agent calls `set_next_transition` with a reason longer than the accepted length
- **THEN** the tool reports the rejection
- **AND** the recorded reason is never a silent truncation of what the agent wrote

#### Scenario: Clear the recording

- **WHEN** an agent calls `set_next_transition` without a target
- **THEN** the task's recorded transition is cleared without requiring a reason
- **AND** the result reports that no transition is recorded

#### Scenario: Reject a target the stage does not configure

- **WHEN** an agent calls `set_next_transition` with a target that is not one of the current stage's configured targets
- **THEN** the tool reports the rejection
- **AND** the task and any previously recorded transition are unchanged

#### Scenario: Reject a recording without configured transitions

- **WHEN** an agent calls `set_next_transition` for a task whose stage does not configure transitions
- **THEN** the tool reports that the stage has no configurable transitions
- **AND** the task is unchanged

#### Scenario: Recording does not move the task

- **WHEN** an agent declares or clears a transition
- **THEN** the task's stage and position are unchanged while the call runs
- **AND** no message is sent and no agent execution starts
- **AND** auto mode keeps its setting

#### Scenario: Arm the advance with auto mode disabled

- **WHEN** an agent declares a transition for a task whose auto mode is disabled
- **THEN** the recording is stored and auto mode remains disabled
- **AND** the task's next completed turn advances to the declared stage

#### Scenario: Disarm the advance by clearing with auto mode disabled

- **WHEN** an agent clears the recorded transition of a task whose auto mode is disabled
- **THEN** the task does not advance at the end of its next completed turn

#### Scenario: Resolve the task from the conversation

- **WHEN** an agent calls `set_next_transition` inside a task conversation
- **THEN** the recording applies to the task that owns that conversation
- **AND** the tool offers no way to name another task

#### Scenario: Require a task scope outside a task conversation

- **WHEN** an agent calls `set_next_transition` in an ordinary DSH chat
- **THEN** the tool rejects the request with an actionable error
- **AND** no task records a transition

#### Scenario: Read another task from an ordinary chat

- **WHEN** an agent calls `list_allowed_transitions` with an explicit task identifier
- **THEN** the result describes that task's stage and targets
- **AND** no task state changes
