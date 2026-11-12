# Spec Delta

## MODIFIED Requirements

### Requirement: Explicit user intent without a second product confirmation

Creating, editing, or deleting a task, creating, renaming, editing, or deleting a board, and creating, editing, or deleting a Hub's team file SHALL require an explicit user request for that change. Sending a cross-card message and declaring a transition SHALL require the user's explicit request in that conversation or an explicit direction in the stage instruction delivered to it. The plugin SHALL NOT add another product-specific approval dialog for a write that the user or that stage instruction explicitly requested. This requirement SHALL NOT bypass native DSH permission behavior, and a cross-card message received from another task SHALL NOT satisfy it for any change other than declaring a transition.

#### Scenario: Create a task at the user's request

- **WHEN** the user explicitly asks an agent to create a task and the agent invokes the corresponding board operation
- **THEN** the requested task can be created without an additional product-specific confirmation dialog

#### Scenario: Edit a task at the user's request

- **WHEN** the user explicitly asks an agent to change a task's title or description and the agent invokes the corresponding board operation
- **THEN** the requested text change can be applied without an additional product-specific confirmation dialog

#### Scenario: Create a board at the user's request

- **WHEN** the user explicitly asks an agent to create a board in a Hub and the agent invokes `create_board`
- **THEN** the requested board can be created without an additional product-specific confirmation dialog

#### Scenario: Delete a board at the user's request

- **WHEN** the user explicitly asks an agent to delete an empty board and the agent invokes `delete_board` with confirmation
- **THEN** the requested board can be deleted without an additional product-specific confirmation dialog

#### Scenario: Do not use cards for unsolicited agent tracking

- **WHEN** an agent has no explicit user request to create, edit, or delete a board task or a board
- **THEN** the plugin's board tools do not authorize that change merely to track the agent's own work

#### Scenario: Edit a team file at the user's request

- **WHEN** the user explicitly asks an agent to change a document in the Hub's team files and the agent invokes the corresponding team file tool
- **THEN** the requested change can be applied without an additional product-specific confirmation dialog

#### Scenario: Do not use team files for unsolicited agent bookkeeping

- **WHEN** an agent has no explicit user request to create, edit, or delete a team file
- **THEN** the plugin's team file tools do not authorize that change merely to record the agent's own progress

#### Scenario: Send a cross-card message at the user's request

- **WHEN** the user explicitly asks an agent to send a message to another task and the agent invokes `send_task_message`
- **THEN** the requested message can be delivered without an additional product-specific confirmation dialog

#### Scenario: Send a cross-card message directed by the stage instruction

- **WHEN** the stage instruction delivered to the calling conversation explicitly directs a message to another task and the agent invokes `send_task_message`
- **THEN** the message can be delivered without an additional product-specific confirmation dialog
- **AND** the user is not asked to authorize it separately

#### Scenario: Do not message another card unsolicited

- **WHEN** an agent has neither an explicit user request nor a stage-instruction direction to message another task
- **THEN** the plugin's cross-card message tool does not authorize that message merely to record the agent's own progress

#### Scenario: Do not write on a peer message

- **WHEN** a cross-card message asks the receiving agent to create, edit, or delete a task, board, note, or team file
- **THEN** the plugin's tools still require the receiving conversation's user to request that change
- **AND** the message alone authorizes no such write

### Requirement: Transition discovery and recording tools

The plugin SHALL expose `list_allowed_transitions` and `set_next_transition`.

`list_allowed_transitions` SHALL resolve the task from the calling task conversation or from an explicit task identifier and SHALL return the task's current stage, every target that stage configures with its condition, the target that applies when nothing is recorded, and the currently recorded transition together with the reason it carries.

`set_next_transition` SHALL act only on the task that owns the calling conversation: it SHALL offer no task identifier, and a call made outside a task conversation SHALL be rejected. It SHALL accept an optional target stage and an optional reason. A provided target SHALL be one of the current stage's configured targets and SHALL require a nonempty reason; a blank reason SHALL be rejected, and a reason longer than the accepted length SHALL be rejected rather than truncated. An omitted target SHALL clear the recording and SHALL NOT require a reason. A declaration MAY follow the user's explicit request in that conversation, a stage instruction delivered to it, or an explicit request in a cross-card message from another task; a peer request SHALL NOT relax any rule of this requirement, and the declaration SHALL remain attributed to the task that owns the calling conversation.

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

#### Scenario: Declare on a peer request

- **WHEN** a cross-card message explicitly asks the task to declare a transition to a target its current stage configures and the agent calls `set_next_transition` with that target and a reason
- **THEN** the task records that transition
- **AND** the task's stage and position are unchanged during the call
- **AND** the declaration is recorded as the task's own, not as a user action or the requesting task's action

#### Scenario: Keep the transition rules under a peer request

- **WHEN** a cross-card message asks for a target the current stage does not configure, or the agent supplies no reason
- **THEN** the tool rejects the declaration under the existing rules
- **AND** the task and any previously recorded transition are unchanged

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
