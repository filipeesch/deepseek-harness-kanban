# Spec Delta

## ADDED Requirements

### Requirement: Transition discovery and recording tools

The plugin SHALL expose `list_allowed_transitions` and `set_next_transition`. `list_allowed_transitions` SHALL resolve the task from the calling task conversation or from an explicit task identifier and SHALL return the task's current stage, every target that stage configures with its condition, the target that applies when nothing is recorded, and the currently recorded transition. `set_next_transition` SHALL accept the same task scope and an optional target stage: a provided target SHALL be one of the current stage's configured targets, and an omitted target SHALL clear the recording. Both tools SHALL report the current stage, the configured targets, and the recorded transition after the call. A stage that does not configure transitions SHALL be reported as having no configurable transitions instead of inventing a target set. Neither tool SHALL move the task, change its position, send a message, or change auto mode, and both SHALL be available while auto mode is disabled. A rejected target SHALL leave the task and its recorded transition unchanged.

#### Scenario: List the configured transitions

- **WHEN** an agent calls `list_allowed_transitions` for a task whose stage configures two targets with conditions
- **THEN** the result contains the current stage and both targets with their conditions
- **AND** it contains the target that applies when nothing is recorded

#### Scenario: Return the recorded transition

- **WHEN** the task already recorded a transition and the agent calls either tool
- **THEN** the result reports that recorded transition

#### Scenario: Report a stage without configured transitions

- **WHEN** the agent calls `list_allowed_transitions` for a task whose stage does not configure transitions
- **THEN** the result states that the stage configures no transitions
- **AND** no target is returned

#### Scenario: Record a transition

- **WHEN** an agent calls `set_next_transition` with a target that the current stage configures
- **THEN** the task records that transition
- **AND** the result reports the recorded transition and the remaining targets
- **AND** the task's stage and position are unchanged

#### Scenario: Clear the recording

- **WHEN** an agent calls `set_next_transition` without a target
- **THEN** the task's recorded transition is cleared
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

- **WHEN** an agent records or clears a transition
- **THEN** the task's stage and position are unchanged
- **AND** no message is sent and no agent execution starts
- **AND** auto mode keeps its setting

#### Scenario: Resolve the task from the conversation

- **WHEN** an agent calls either tool inside a task conversation without a task identifier
- **THEN** the plugin resolves the task that owns the conversation

#### Scenario: Require a task scope outside a task conversation

- **WHEN** an agent calls either tool in an ordinary DSH chat without a task identifier
- **THEN** the tool rejects the request with an actionable error

## MODIFIED Requirements

### Requirement: Restricted board tool surface

The plugin SHALL expose tools for discovering Hubs, boards, and projects; reading board and task information; creating tasks; editing task titles and descriptions; creating, listing, and tag-aware updating of shared task notes; reading the transitions available from a task's current stage and recording the transition that task will follow next through `list_allowed_transitions` and `set_next_transition`; and administering the boards of a Hub through `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`, together with an extended `get_board_summary`. Its product tool surface SHALL NOT include moving tasks, deleting tasks, deleting notes, sending messages to other cards, Hub creation, rename, or deletion, decision-ledger tools, or a plugin-owned TODO checklist. Recording a transition SHALL NOT be treated as moving a task.

#### Scenario: Discover available product operations

- **WHEN** an agent receives the plugin's board and note tools
- **THEN** Hub, board, and project discovery, board and task reading, task creation, task text editing, shared note creation, listing, and tag-aware updating, transition discovery and recording, board creation, board rename, board workflow reading and writing, and empty-board deletion are available operations
- **AND** board movement, task deletion, note deletion, inter-card messaging, Hub administration, decision-ledger operations, and a plugin-owned TODO checklist are not exposed as part of that tool surface

#### Scenario: Inspect the board administration tool names

- **WHEN** an agent receives the plugin's board administration tools
- **THEN** the surface contains `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`
- **AND** no tool creates, renames, or deletes a Hub

#### Scenario: Do not move a task by recording a transition

- **WHEN** an agent records the transition a task will follow next
- **THEN** the task remains in its current stage and position
- **AND** the recorded transition only decides the destination of a later advance
