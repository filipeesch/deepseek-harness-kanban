# Spec Delta

## MODIFIED Requirements

### Requirement: Task drawer sections

Opening a task card SHALL display a task drawer with a header and Conversations, Info, Git, Notes, and History sections. The header SHALL present the task title on one line with an ellipsis when it does not fit, the task's project as a chip beside the title, the section navigation, the workflow stage control, and the task's remaining header actions. The title's full text SHALL remain available through its tooltip, and the project SHALL NOT be repeated on a second header line. Conversations SHALL contain the task's native DSH chats, Info SHALL expose the task's title and Markdown description, Git SHALL expose its simplified worktree controls, Notes SHALL expose its shared task notes, and History SHALL present the task's recorded flow as defined by the History table in the task drawer requirement in `task-history`.

The section navigation SHALL be presented in the header as icon-only tabs. Each tab SHALL keep the section name in its accessible name and SHALL expose that name as a tooltip; the Conversations tab SHALL extend both with the activity facts defined by Drawer conversation activity indicator. The selected section SHALL be visibly distinguishable, and the tabs SHALL keep their keyboard navigation. The drawer SHALL keep the task title, the section navigation, and the conversation controls visible at every supported drawer width; when the available width cannot present them in one row, the header SHALL wrap into two rows instead of hiding a control.

The workflow stage control SHALL be presented in the drawer header and SHALL list every workflow stage in workflow order, including the current stage. Stages that the active board's workflow does not permit from the current stage SHALL remain selectable and SHALL be presented with lower visual emphasis than permitted stages, with the restriction also available to assistive technology. Selecting a permitted stage SHALL move the task immediately; when the task has no conversation and the destination has an entry instruction, the worktree question defined by Execution preparation before a task's first execution in `kanban-board` SHALL be presented first, the task SHALL move once that question is answered, and the remaining preparation SHALL continue in the background without holding the task. Selecting a restricted stage SHALL require the explicit confirmation defined by the Explicit confirmation for a restricted transition requirement; when the confirmed destination would start the task's first execution, that question SHALL follow the confirmation and precede the move. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement in `kanban-board`; the drawer SHALL present that countdown notice above its section panel and SHALL expose the same cancel action. The drawer SHALL NOT insert text into the composer for a stage change.

The header SHALL also present the task's auto-mode control defined by Auto mode on a task card in `kanban-board`, with the same pressed state, effect, indication, and enabled or disabled behavior as the card control, including the held state while the task has pending user work. The auto-mode control's accessible name and tooltip SHALL carry the automatic-advance state, including the destination stage while an advance is admitted, the failure when an admitted advance failed, and the pause reason when auto mode is paused. The drawer SHALL NOT add a separate automatic-advance notice above its section panel, SHALL NOT add a separate entry for the held state, and SHALL NOT make reading or acknowledging a conversation clear a pause. An admitted or failed advance SHALL remain presented through the task's transition status as before.

The drawer SHALL additionally expose the current scripted execution state and its applicable Stop and Play controls as defined by `scripted-steps`, independently of Auto mode and of whether a native conversation exists. These controls and their action-local progress SHALL remain available without selecting a conversation or changing the current section. Their execution ownership SHALL follow the durable activation or control state of the current entry rather than a later saved stage mode; an owned active run SHALL keep Stop after a saved agent/manual mode change. Play SHALL not substitute an agent instruction when the latest configuration is no longer valid scripted configuration and SHALL instead explain the configuration or new-entry action required. A script failure or trust request SHALL NOT be presented as a failed or unread conversation turn. A stage change through the header SHALL revoke the prior scripted run when the move is accepted and SHALL admit a scripted destination's entry subject to its own authorization, without an agent countdown, model preparation, or composer mutation. The section list, ordinary agent countdown, conversation controls, and automatic-advance status behavior SHALL otherwise remain unchanged.

#### Scenario: Open a task from the board

- **WHEN** a user opens a card on the Kanban board
- **THEN** the drawer header shows the task title, its project as a chip beside the title, and the section navigation
- **AND** the workflow stage control is part of that header
- **AND** the drawer provides Conversations, Info, Git, Notes, and History without replacing the card interaction with a separate main-chat navigation flow
- **AND** History is presented after Notes
- **AND** the project is not repeated on a second header line

#### Scenario: Keep the header compact at a narrow width

- **WHEN** the drawer is narrow enough that the title, section navigation, and conversation controls cannot share one row
- **THEN** the header wraps into two rows
- **AND** no header control or section is hidden
- **AND** the title truncates with an ellipsis instead of wrapping

#### Scenario: Present icon-only section navigation

- **WHEN** the user inspects the drawer header
- **THEN** each section is an icon-only tab
- **AND** each tab keeps its section name in its accessible name and tooltip
- **AND** the Conversations tab extends both with its activity facts
- **AND** the selected section is visibly distinguishable
- **AND** arrow-key navigation between the tabs keeps working

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
- **AND** the task moves immediately after any required worktree question is answered
- **AND** the drawer stays in its current section
- **AND** an instructed destination presents the countdown notice with the stage and remaining time once the task's first conversation exists
- **AND** the composer is not changed

#### Scenario: Prepare the first execution from the drawer

- **WHEN** the user selects a permitted instructed destination for a task that has no conversation
- **THEN** the worktree question is presented before the task moves
- **AND** the task remains in its current stage while that question is open
- **AND** canceling leaves the task in its current stage and the drawer in its current section
- **AND** answering it moves the task and continues the preparation in the background

#### Scenario: Change to a restricted stage from the drawer
- **WHEN** the user selects a destination that the workflow does not permit from the current stage
- **THEN** the same explicit confirmation applies as for a restricted board drop
- **AND** the task remains in its current stage until the user confirms
- **AND** canceling leaves the task in its current stage and the stage control at its current value
- **AND** after confirmation, the worktree question is presented before the move when the destination would start the task's first execution
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
- **WHEN** the open task is running an owned agent or owns unsettled background work and the user switches between the drawer's sections
- **THEN** the conversation activity indicator remains visible on the Conversations section tab on every section

#### Scenario: Execution status follows a delegated subagent
- **WHEN** the task's assistant turn ends while an owned subagent descendant is still running
- **THEN** the conversation activity indicator keeps presenting the agent execution state

#### Scenario: Execution status clears when the turn ends
- **WHEN** the last owned agent and the last background activity of the open task have settled
- **THEN** the conversation activity indicator stops presenting that state without a reload

#### Scenario: Toggle auto mode from the drawer
- **WHEN** the user activates the auto-mode control in the drawer header
- **THEN** the setting changes exactly as the card control changes it
- **AND** the drawer stays in its current section
- **AND** the task's stage and position are unchanged

#### Scenario: Mirror the held auto-mode state
- **WHEN** the open task has auto mode enabled and pending user work
- **THEN** the drawer's auto-mode control presents the held state
- **AND** the control's accessible name states what the user still owes the task
- **AND** no separate entry for that state is added above the section panel

#### Scenario: Present an admitted automatic advance
- **WHEN** an automatic advance is admitted for the open task
- **THEN** the auto-mode control's accessible name and tooltip name the destination stage
- **AND** the drawer does not add a separate notice above the section panel
- **AND** the drawer does not change sections

#### Scenario: Present a paused automatic advance
- **WHEN** auto mode is paused for the open task
- **THEN** the auto-mode control's accessible name and tooltip carry the pause reason
- **AND** the drawer does not add a separate notice above the section panel
- **AND** reading the conversation does not clear it

#### Scenario: Present a failed automatic advance
- **WHEN** an admitted automatic advance fails for the open task
- **THEN** the auto-mode control carries the failure state
- **AND** the task transition status keeps presenting the failure
- **AND** the stage run action remains available for an unresolved destination entry

#### Scenario: Control a script from the current drawer section

- **WHEN** the user inspects Info, Git, Notes, or History for a task in a scripted stage
- **THEN** the current scripted state and applicable Stop or Play action remain reachable
- **AND** invoking that action does not change the selected section, insert a composer draft, or create a conversation

### Requirement: Next-stage action in the drawer header

The drawer header SHALL offer an action that moves the task to the destination that resolves for its current stage: the task's recorded transition while that transition resolves, otherwise the stage that follows the current stage in workflow order. The action SHALL follow the same move rules as the drawer's stage control: a restricted transition SHALL require the same explicit confirmation, a first execution SHALL present the same worktree question before the move, and an instructed destination SHALL arm the same timed stage instruction and present the same countdown notice with its cancel action. A recorded transition that no longer resolves SHALL make the action refuse without moving the task, presenting the same explanation used for the `transition-stale` pause. The action SHALL be unavailable while the task has an unresolved operation or confirmed transition or while a move is in flight. The action SHALL NOT be presented when no destination resolves. Its accessible name and tooltip SHALL name the destination stage and SHALL identify a destination that requires confirmation.

#### Scenario: Advance to the next stage

- **WHEN** the user activates the next-stage action on a task that records no transition and is not in the last workflow stage
- **THEN** the task moves to the next stage in workflow order
- **AND** the drawer stays in its current section
- **AND** an instructed destination presents the countdown notice instead of writing to the composer

#### Scenario: Use the recorded transition

- **WHEN** the user activates the next-stage action on a task whose recorded transition still resolves
- **THEN** the task moves to the stage of that recorded transition
- **AND** the drawer stays in its current section

#### Scenario: Refuse a recorded transition that no longer resolves

- **WHEN** the user activates the next-stage action on a task whose recorded transition no longer resolves
- **THEN** the move is refused and the failure is presented in the drawer
- **AND** the task remains in its current stage and position
- **AND** no instruction is sent

#### Scenario: Name the recorded destination

- **WHEN** the next-stage action is presented for a task with a recorded transition that resolves
- **THEN** its accessible name and tooltip name the recorded destination stage

#### Scenario: Confirm a restricted next stage

- **WHEN** the destination requires confirmation and the user activates the next-stage action
- **THEN** the same explicit confirmation is presented as for a restricted board drop
- **AND** the task remains in its current stage until the user confirms or cancels
- **AND** canceling leaves the task in its current stage

#### Scenario: Prepare a first execution before advancing

- **WHEN** the task has no conversation and the destination stage has an entry instruction
- **THEN** the worktree question is presented before the task moves
- **AND** the task remains in its current stage while that question is open
- **AND** answering it moves the task and continues the preparation in the background

#### Scenario: Hide the action in the last stage

- **WHEN** the task is in the last workflow stage and records no transition that resolves
- **THEN** the next-stage action is not presented

#### Scenario: Disable the action during an unresolved operation

- **WHEN** the task has an unresolved context operation or confirmed transition, or a move is in flight
- **THEN** the next-stage action is unavailable

#### Scenario: Name the destination for assistive technology

- **WHEN** the next-stage action is presented
- **THEN** its accessible name and tooltip name the destination stage
- **AND** a destination that requires confirmation is identified as such

### Requirement: Nested native conversation tabs

A task SHALL begin with no native DSH conversation in its Conversations section. The section SHALL provide an explicit start action, presented as the agent-preset cards, that creates the first distinct native DSH conversation as a tab within the same task, and a plus action that opens the same preset choice to create another distinct native DSH conversation. The first conversation SHALL be created only by that explicit choice, by the execution preparation that follows a first-execution move or run action and its worktree question, including the automatic first-execution preparation on task creation, by a stage instruction that needs a conversation and finds none open, including a stage instruction dispatched from a card, a confirmed transition, or an automatic advance, or by a cross-card message delivery that needs a conversation and finds none open. When an execution preparation creates the first conversation, it SHALL do so after the worktree is ready and after the move or run action is applied, and the conversation SHALL use that directory. For a Git-backed task without a worktree, the explicit start action SHALL remain unavailable until the worktree choice is resolved as defined by `worktree-management`. The first conversation SHALL use the task's current effective directory at creation time. A conversation created from a card SHALL receive the card's preset; conversations created by the execution preparation, including the automatic creation preparation, by a stage instruction, or by a cross-card message delivery use the board's default model when the board names one and the deployment default otherwise, and SHALL use the board's default agent preset when the board names one and the host default preset otherwise.

A scripted entry SHALL NOT create a conversation, select a preset or model, or start a model turn solely to execute code. A task whose first execution is scripted SHALL remain able to have zero native conversations. When that execution later selects an agent destination whose instruction needs a conversation, the host SHALL create or resolve only the conversation required by that instruction using the normal directory and board-model and board-preset rules; the scripted handoff SHALL accompany the instruction. A script or manual destination SHALL receive or retain its handoff without creating a conversation.

#### Scenario: Open a newly created task

- **WHEN** a user opens a newly created task's Conversations section and its creation did not start the first execution
- **THEN** no native conversation tab exists
- **AND** the agent-preset cards and the plus action are available, subject to the worktree choice

#### Scenario: Open a created task that started

- **WHEN** a user opens a newly created task whose creation started the agent first-execution preparation
- **THEN** the first native DSH conversation created by the preparation is present as a tab once its worktree is ready
- **AND** it uses the task's effective directory resolved by the preparation

#### Scenario: Start the first conversation

- **WHEN** the user selects a preset card as the first conversation's start action
- **THEN** a native DSH conversation tab is added
- **AND** the card's preset is selected on that conversation
- **AND** its native session uses the task's current effective directory

#### Scenario: Add another continuous conversation

- **WHEN** the user selects the plus action in a task that already has a conversation and then selects a preset card
- **THEN** a new native DSH conversation is added as another tab associated with that same task
- **AND** the card's preset is selected on that conversation

#### Scenario: Prepare the first conversation

- **WHEN** an execution preparation runs for a task that has no conversation and its worktree question is answered
- **THEN** the first native DSH conversation is created after the worktree is ready
- **AND** it is created after the move or run action is applied
- **AND** it uses the task's current effective directory

#### Scenario: Prepare the first conversation on task creation

- **WHEN** the automatic first execution on task creation prepares a task with no conversation
- **THEN** the first native DSH conversation is created after the default worktree is ready
- **AND** it uses the worktree directory, or the project directory for a folder project
- **AND** no preset selector and no model selector are presented
- **AND** the conversation uses the board's default agent preset when the board names one and the host default preset otherwise

#### Scenario: A stage instruction creates the first conversation

- **WHEN** a stage instruction needs a conversation, the task has no open conversation, and no execution preparation applies, for example a dispatched confirmed transition or an automatic advance
- **THEN** the first native DSH conversation is created in the task's current effective directory
- **AND** the stage instruction is sent to it

#### Scenario: An automatic advance creates the first conversation

- **WHEN** an automatic advance needs a conversation and the task has no open conversation
- **THEN** one native DSH conversation is created
- **AND** the destination instruction is sent to it

#### Scenario: A cross-card message creates the first conversation

- **WHEN** a cross-card message delivery needs a conversation and the target task has no open conversation
- **THEN** the first native DSH conversation is created after the task's worktree or base-project preparation completes
- **AND** the cross-card message is delivered to that conversation
- **AND** the conversation uses the board's default model when the board names one and the deployment default otherwise, rather than a card preset
- **AND** it uses the board's default agent preset when the board names one and the host default preset otherwise

#### Scenario: Withhold the explicit start until the worktree choice

- **WHEN** the user requests the explicit first start for a Git-backed task with no worktree, no recorded base-project choice, and no conversation
- **THEN** no conversation is created
- **AND** the Conversations section presents the pending worktree choice

#### Scenario: Start the first conversation after a worktree choice

- **WHEN** the task has a ready worktree, an attached worktree, or a recorded base-project choice
- **THEN** the card start creates the first conversation at the task's current effective directory

#### Scenario: Run a scripted first stage without creating a chat

- **WHEN** a newly created task enters a scripted initial stage
- **THEN** its script-only execution has no native conversation tab
- **AND** the normal explicit native conversation actions remain available under their existing preconditions

#### Scenario: Create a conversation only for a downstream agent instruction

- **WHEN** a scripted output enters an agent stage and the task has no open conversation
- **THEN** one conversation is created in the task's effective directory for that agent instruction
- **AND** the instruction includes the identified scripted handoff
- **AND** no conversation was required for the source script

## REMOVED Requirements

### Requirement: Model selection for the first conversation
**Reason**: The execution preparation no longer presents DSH's native model selector, so there is no preparation-time model step to define. The move is immediate and the remaining preparation runs in the background, where no blocking selector can be shown.
**Migration**: The first conversation uses the board's default model when the board names an available one and the deployment default otherwise, as stated by Nested native conversation tabs and Board default model applies to every new conversation. The native model selector remains available in the conversation itself for the user to change it afterwards.
