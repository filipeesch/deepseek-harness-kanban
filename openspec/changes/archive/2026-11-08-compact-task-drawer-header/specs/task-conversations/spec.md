# Spec Delta

## MODIFIED Requirements

### Requirement: Task drawer sections

Opening a task card SHALL display a task drawer with a header and Conversations, Info, Git, and Notes sections. The header SHALL present the task title on one line with an ellipsis when it does not fit, the task's project as a chip beside the title, the section navigation, the workflow stage control, and the task's remaining header actions. The title's full text SHALL remain available through its tooltip, and the project SHALL NOT be repeated on a second header line. Conversations SHALL contain the task's native DSH chats, Info SHALL expose the task's title and Markdown description, Git SHALL expose its simplified worktree controls, and Notes SHALL expose its shared task notes.

The section navigation SHALL be presented in the header as icon-only tabs. Each tab SHALL keep the section name in its accessible name and SHALL expose that name as a tooltip; the Conversations tab SHALL extend both with the activity facts defined by Drawer conversation activity indicator. The selected section SHALL be visibly distinguishable, and the tabs SHALL keep their keyboard navigation. The drawer SHALL keep the task title, the section navigation, and the conversation controls visible at every supported drawer width; when the available width cannot present them in one row, the header SHALL wrap into two rows instead of hiding a control.

The workflow stage control SHALL be presented in the drawer header and SHALL list every workflow stage in workflow order, including the current stage. Stages that the active board's workflow does not permit from the current stage SHALL remain selectable and SHALL be presented with lower visual emphasis than permitted stages, with the restriction also available to assistive technology. Selecting a permitted stage SHALL move the task immediately; when the task has no conversation and the destination has an entry instruction, the execution preparation defined by Execution preparation before a task's first execution in `kanban-board` SHALL be presented first, and the task SHALL NOT move until that preparation completes. Selecting a restricted stage SHALL require the explicit confirmation defined by the Explicit confirmation for a restricted transition requirement; when the confirmed destination would start the task's first execution, that preparation SHALL follow the confirmation and precede the move. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement in `kanban-board`; the drawer SHALL present that countdown notice above its section panel and SHALL expose the same cancel action. The drawer SHALL NOT insert text into the composer for a stage change.

The header SHALL also present the task's auto-mode control defined by Auto mode on a task card in `kanban-board`, with the same pressed state, effect, indication, and enabled or disabled behavior as the card control, including the held state while the task has pending user work. The auto-mode control's accessible name and tooltip SHALL carry the automatic-advance state, including the destination stage while an advance is admitted, the failure when an admitted advance failed, and the pause reason when auto mode is paused. The drawer SHALL NOT add a separate automatic-advance notice above its section panel, SHALL NOT add a separate entry for the held state, and SHALL NOT make reading or acknowledging a conversation clear a pause. An admitted or failed advance SHALL remain presented through the task's transition status as before.

#### Scenario: Open a task from the board
- **WHEN** a user opens a card on the Kanban board
- **THEN** the drawer header shows the task title, its project as a chip beside the title, and the section navigation
- **AND** the workflow stage control is part of that header
- **AND** the drawer provides Conversations, Info, Git, and Notes without replacing the card interaction with a separate main-chat navigation flow
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

## ADDED Requirements

### Requirement: Drawer conversation activity indicator

The drawer SHALL present the task's agent execution status and unsettled background activity through a single activity indicator on the Conversations section tab. The indicator SHALL remain visible while the user inspects any of the drawer's sections. It SHALL be presented as a dot without text, and it SHALL pulse while at least one agent owned by the task's conversations is running or while the task owns unsettled background work. The indicator SHALL NOT visually distinguish agent execution from background activity. Its accessible name and tooltip SHALL name the facts behind the indicator, including the labels of the task's unsettled background activities, and SHALL stop reporting background activity when none remains. Agent execution SHALL include the task conversations' own assistant turns and their owned subagent descendants, and a running owned subagent SHALL NOT be reported as background activity. The drawer header SHALL NOT present a separate Working or Background line, and the indicator SHALL NOT introduce a second live region for this state.

#### Scenario: Show the indicator while an agent runs
- **WHEN** the user opens the drawer for a task whose conversation is running an owned agent
- **THEN** the Conversations section tab presents a pulsing activity dot

#### Scenario: Keep the indicator visible from another section
- **WHEN** the user selects Info, Git, or Notes while the task is running an owned agent
- **THEN** the Conversations section tab keeps presenting the pulsing activity dot

#### Scenario: Name the background activity in the tooltip
- **WHEN** the user opens the drawer for a task that owns unsettled jobs or schedules
- **THEN** the activity indicator pulses
- **AND** its accessible name and tooltip name the labels of those activities

#### Scenario: A running subagent is execution, not background activity
- **WHEN** the main assistant turn has ended and an owned subagent descendant is still running
- **THEN** the activity indicator keeps presenting the execution state
- **AND** the subagent is not named as background activity

#### Scenario: Clear the indicator when the task settles
- **WHEN** the last owned agent and the last background activity of the open task have settled
- **THEN** the activity indicator stops presenting that state without a reload

#### Scenario: Do not duplicate the status as header text
- **WHEN** the task is running an owned agent and also owns background activity
- **THEN** the drawer header presents neither a Working line nor a Background line
- **AND** the single activity indicator carries both facts

### Requirement: Next-stage action in the drawer header

The drawer header SHALL offer an action that moves the task to the next workflow stage in workflow order when one exists. The action SHALL follow the same move rules as the drawer's stage control: a restricted transition SHALL require the same explicit confirmation, a first execution SHALL present the same execution preparation before the move, and an instructed destination SHALL arm the same timed stage instruction and present the same countdown notice with its cancel action. The action SHALL be unavailable while the task has an unresolved operation or confirmed transition or while a move is in flight. The action SHALL NOT be presented when the task is in the last workflow stage. Its accessible name and tooltip SHALL name the destination stage and SHALL identify a destination that requires confirmation.

#### Scenario: Advance to the next stage
- **WHEN** the user activates the next-stage action on a task that is not in the last workflow stage
- **THEN** the task moves to the next stage in workflow order
- **AND** the drawer stays in its current section
- **AND** an instructed destination presents the countdown notice instead of writing to the composer

#### Scenario: Confirm a restricted next stage
- **WHEN** the next stage requires confirmation and the user activates the next-stage action
- **THEN** the same explicit confirmation is presented as for a restricted board drop
- **AND** the task remains in its current stage until the user confirms or cancels
- **AND** canceling leaves the task in its current stage

#### Scenario: Prepare a first execution before advancing
- **WHEN** the task has no conversation and the next stage has an entry instruction
- **THEN** the execution preparation is presented before the task moves
- **AND** the task remains in its current stage until the preparation completes or is canceled

#### Scenario: Hide the action in the last stage
- **WHEN** the task is in the last workflow stage
- **THEN** the next-stage action is not presented

#### Scenario: Disable the action during an unresolved operation
- **WHEN** the task has an unresolved context operation or confirmed transition, or a move is in flight
- **THEN** the next-stage action is unavailable

#### Scenario: Name the destination for assistive technology
- **WHEN** the next-stage action is presented
- **THEN** its accessible name and tooltip name the destination stage
- **AND** a destination that requires confirmation is identified as such

## REMOVED Requirements

### Requirement: Drawer execution status detail

**Reason**: The drawer header no longer carries a second execution-status line that duplicates the board card. The same execution and background facts are now presented by the single activity indicator on the Conversations section tab.

**Migration**: Read the activity dot on the Conversations section tab. Its accessible name and tooltip name agent execution and the labels of unsettled background activities. The board card keeps its separate working indicator, background chip, and attention indicators.
