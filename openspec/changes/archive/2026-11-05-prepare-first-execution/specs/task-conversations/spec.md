# Spec Delta

## ADDED Requirements

### Requirement: Model selection for the first conversation

When the execution preparation defined by Execution preparation before a task's first execution in `kanban-board` creates a task's first conversation and DSH's native model selector is available, the preparation SHALL present that native model selector for the created conversation before the first execution is admitted. The selector SHALL show the deployment default selection while the conversation has no recorded selection, and presenting it SHALL NOT submit a selection. When the user chooses a different model or reasoning effort, the selection SHALL apply to that conversation and SHALL follow DSH's native behavior for the deployment default. When DSH's native model selector is not available, the preparation SHALL omit the model step and the conversation SHALL use the deployment default. The selection SHALL NOT be persisted on the task, SHALL NOT be presented for later conversations, and SHALL NOT be presented when the task already has a conversation.

#### Scenario: Show the default without submitting

- **WHEN** the preparation presents the native model selector for a conversation with no recorded selection
- **THEN** the selector shows the deployment default model
- **AND** no model selection is submitted to the host
- **AND** the conversation will use the deployment default

#### Scenario: Choose another model

- **WHEN** the user chooses a different model or reasoning effort in the native selector
- **THEN** that selection applies to the created conversation
- **AND** the deployment default follows DSH's native behavior

#### Scenario: Omit the model step when the selector is unavailable

- **WHEN** DSH's native model selector is not composed in the running host
- **THEN** the preparation omits the model step
- **AND** the first conversation uses the deployment default
- **AND** the rest of the preparation and the execution proceed

#### Scenario: Model step without a worktree question

- **WHEN** the task already has a ready worktree, is a folder project, or has a recorded base-project choice, and the task has no conversation
- **THEN** the preparation presents the model step only
- **AND** the first conversation is created in the task's current effective directory

#### Scenario: Do not offer a model for later conversations

- **WHEN** a task already has a conversation
- **THEN** no preparation and no model step is presented
- **AND** later conversations are not changed

## MODIFIED Requirements

### Requirement: Nested native conversation tabs

A task SHALL begin with no native DSH conversation in its Conversations section. The section SHALL provide an explicit start action that creates the first distinct native DSH conversation as a tab within the same task, and a plus action that creates another distinct native DSH conversation. The first conversation SHALL be created only by that explicit start action, by the execution preparation that precedes a task's first execution, or by a stage instruction that needs a conversation and finds none open, including a stage instruction dispatched from a card, a confirmed transition, or an automatic advance. When the execution preparation creates the first conversation, it SHALL do so after the worktree choice is resolved and before the move or run action is applied. For a Git-backed task without a worktree, the explicit start action SHALL remain unavailable until the worktree choice is resolved as defined by `worktree-management`. The first conversation SHALL use the task's current effective directory at creation time.

#### Scenario: Open a newly created task

- **WHEN** a user opens a newly created task's Conversations section
- **THEN** no native conversation tab exists
- **AND** an explicit start action and a plus action are available, subject to the worktree choice

#### Scenario: Start the first conversation

- **WHEN** the user starts the first conversation
- **THEN** a native DSH conversation tab is added
- **AND** its native session uses the task's current effective directory

#### Scenario: Add another continuous conversation

- **WHEN** the user selects the plus action in a task that already has a conversation
- **THEN** a new native DSH conversation is added as another tab associated with that same task

#### Scenario: Prepare the first conversation

- **WHEN** an execution preparation runs for a task that has no conversation
- **THEN** the first native DSH conversation is created after the worktree choice is resolved
- **AND** it is created before the move or run action is applied
- **AND** it uses the task's current effective directory

#### Scenario: A stage instruction creates the first conversation

- **WHEN** a stage instruction needs a conversation, the task has no open conversation, and no execution preparation applies, for example a dispatched confirmed transition or an automatic advance
- **THEN** the first native DSH conversation is created in the task's current effective directory
- **AND** the stage instruction is sent to it

#### Scenario: An automatic advance creates the first conversation

- **WHEN** an automatic advance needs a conversation and the task has no open conversation
- **THEN** one native DSH conversation is created
- **AND** the destination instruction is sent to it

#### Scenario: Withhold the explicit start until the worktree choice

- **WHEN** the user requests the explicit first start for a Git-backed task with no worktree, no recorded base-project choice, and no conversation
- **THEN** no conversation is created
- **AND** the Conversations section presents the pending worktree choice

#### Scenario: Start the first conversation after a worktree choice

- **WHEN** the task has a ready worktree, an attached worktree, or a recorded base-project choice
- **THEN** the explicit start creates the first conversation at the task's current effective directory

### Requirement: Task drawer sections

Opening a task card SHALL display a task drawer with a header showing the task title, the project, and the task's execution status, and Conversations, Info, Git, and Notes sections. The execution status SHALL remain visible while the user inspects any of those sections. Conversations SHALL contain the task's native DSH chats, Info SHALL expose the task's title and Markdown description, Git SHALL expose its simplified worktree controls, and Notes SHALL expose its shared task notes. The workflow stage control SHALL be presented in the drawer's compact toolbar and SHALL list every workflow stage in workflow order, including the current stage. Stages that the active board's workflow does not permit from the current stage SHALL remain selectable and SHALL be presented with lower visual emphasis than permitted stages, with the restriction also available to assistive technology. Selecting a permitted stage SHALL move the task immediately; when the task has no conversation and the destination has an entry instruction, the execution preparation defined by Execution preparation before a task's first execution in `kanban-board` SHALL be presented first, and the task SHALL NOT move until that preparation completes. Selecting a restricted stage SHALL require the explicit confirmation defined by the Explicit confirmation for a restricted transition requirement; when the confirmed destination would start the task's first execution, that preparation SHALL follow the confirmation and precede the move. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement in `kanban-board`; the drawer SHALL present that countdown notice above its section panel and SHALL expose the same cancel action. The drawer SHALL NOT insert text into the composer for a stage change.

The drawer header SHALL also present the task's auto-mode control defined by Auto mode on a task card in `kanban-board`, with the same pressed state, effect, indication, and enabled or disabled behavior as the card control, including the held state while the task has pending user work. The drawer SHALL present the automatic-advance state above its section panel without changing sections: the destination stage while an advance is admitted, a failure when an admitted advance failed, and the pause reason when auto mode is paused. The drawer SHALL NOT present a separate entry for the held state above its section panel, because the mirrored control presents it. The drawer SHALL present the automatic-advance state with the same meaning as the card status strip and SHALL NOT make reading or acknowledging a conversation clear a pause.

#### Scenario: Open a task from the board
- **WHEN** a user opens a card on the Kanban board
- **THEN** the drawer header shows the task title, its project, and its execution status
- **AND** the drawer provides Conversations, Info, Git, and Notes without replacing the card interaction with a separate main-chat navigation flow
- **AND** the compact toolbar provides the complete workflow stage control in workflow order

#### Scenario: List the complete workflow
- **WHEN** the user opens the drawer for a task
- **THEN** the stage control lists every workflow stage in workflow order
- **AND** the current stage is included

#### Scenario: Present restricted stages with lower emphasis
- **WHEN** the active board's workflow does not permit a transition from the current stage to another listed stage
- **THEN** that stage is presented with lower visual emphasis than permitted stages
- **AND** it remains selectable
- **AND** its restriction is available to assistive technology without adding visible explanatory text

#### Scenario: Change stage from the drawer
- **WHEN** the user selects a permitted destination from the drawer's stage control
- **THEN** the same workflow transition rules apply as for a board drop
- **AND** the task moves immediately after any required first-execution preparation
- **AND** the drawer stays in its current section
- **AND** an instructed destination presents the countdown notice with the stage and remaining time
- **AND** the composer is not changed

#### Scenario: Prepare the first execution from the drawer
- **WHEN** the user selects a permitted instructed destination for a task that has no conversation
- **THEN** the execution preparation is presented before the task moves
- **AND** the task remains in its current stage until the preparation completes
- **AND** canceling the preparation leaves the task in its current stage and the drawer in its current section

#### Scenario: Change to a restricted stage from the drawer
- **WHEN** the user selects a destination that the workflow does not permit from the current stage
- **THEN** the same explicit confirmation applies as for a restricted board drop
- **AND** the task remains in its current stage until the user confirms
- **AND** canceling leaves the task in its current stage and the stage control at its current value
- **AND** after confirmation, any required first-execution preparation is presented before the move
- **AND** after confirmation, an instructed destination presents the countdown notice instead of writing to the composer

#### Scenario: Cancel a drawer countdown
- **WHEN** the user cancels from the drawer's countdown notice
- **THEN** no instruction is sent
- **AND** the task stays in the destination stage at the same position
- **AND** the drawer stays in its current section
- **AND** the card exposes the stage run action for the unresolved entry

#### Scenario: Change to an uninstructed stage
- **WHEN** the user selects a destination without an entry instruction
- **THEN** the task moves after any required confirmation
- **AND** the drawer stays in its current section
- **AND** no countdown is armed
- **AND** no composer draft is created by the change

#### Scenario: Execution status stays visible across sections
- **WHEN** a task is running an owned agent and the user switches between the drawer's sections
- **THEN** the drawer header still presents the task's execution status on every section

#### Scenario: Execution status follows a delegated subagent
- **WHEN** the task's assistant turn ends while an owned subagent descendant is still running
- **THEN** the drawer header keeps presenting the execution status

#### Scenario: Execution status clears when the turn ends
- **WHEN** the assistant turn of the only active conversation ends and no owned subagent descendant is running
- **THEN** the drawer header stops presenting the execution status without a reload

#### Scenario: Toggle auto mode from the drawer
- **WHEN** the user activates the auto-mode control in the drawer header
- **THEN** the setting changes exactly as the card control changes it
- **AND** the drawer stays in its current section
- **AND** the task's stage and position are unchanged

#### Scenario: Mirror the held auto-mode state
- **WHEN** the open task has auto mode enabled and pending user work
- **THEN** the drawer's mirrored auto-mode control presents the held state
- **AND** no separate entry for that state is added above the section panel

#### Scenario: Present an admitted automatic advance
- **WHEN** an automatic advance is admitted for the open task
- **THEN** the drawer presents the destination stage above its section panel
- **AND** the drawer does not change sections

#### Scenario: Present a paused automatic advance
- **WHEN** auto mode is paused for the open task
- **THEN** the drawer presents the pause reason above its section panel
- **AND** reading the conversation does not clear it

#### Scenario: Present a failed automatic advance
- **WHEN** an admitted automatic advance fails for the open task
- **THEN** the drawer presents the failure above its section panel
- **AND** the stage run action remains available for an unresolved destination entry
