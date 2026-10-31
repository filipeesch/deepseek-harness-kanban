# Spec Delta

## MODIFIED Requirements

### Requirement: Task drawer sections
Opening a task card SHALL display a task drawer with a header showing the task title, the project, and the task's execution status, and Conversations, Info, Git, and Notes sections. The execution status SHALL remain visible while the user inspects any of those sections. Conversations SHALL contain the task's native DSH chats, Info SHALL expose the task's title and Markdown description, Git SHALL expose its simplified worktree controls, and Notes SHALL expose its shared task notes. The workflow stage control SHALL be presented in the drawer's compact toolbar and SHALL list every workflow stage in workflow order, including the current stage. Stages that the active board's workflow does not permit from the current stage SHALL remain selectable and SHALL be presented with lower visual emphasis than permitted stages, with the restriction also available to assistive technology. Selecting a permitted stage SHALL move the task immediately; selecting a restricted stage SHALL require the explicit confirmation defined by the Explicit confirmation for a restricted transition requirement. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement in `kanban-board`; the drawer SHALL present that countdown notice above its section panel and SHALL expose the same cancel action. The drawer SHALL NOT insert text into the composer for a stage change.

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
- **AND** the task moves immediately
- **AND** the drawer stays in its current section
- **AND** an instructed destination presents the countdown notice with the stage and remaining time
- **AND** the composer is not changed

#### Scenario: Change to a restricted stage from the drawer
- **WHEN** the user selects a destination that the workflow does not permit from the current stage
- **THEN** the same explicit confirmation applies as for a restricted board drop
- **AND** the task remains in its current stage until the user confirms
- **AND** canceling leaves the task in its current stage and the stage control at its current value
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

### Requirement: Drawer execution status detail
The drawer header SHALL present the task's agent execution status with the same meaning as the board card, including the background activity detail when the task owns unsettled background work. Agent execution SHALL include the task conversations' own assistant turns and their owned subagent descendants. The background activity detail SHALL cover jobs and schedules only, SHALL name the task's unsettled activities, and SHALL stop being presented when no background activity remains. The background detail SHALL be visually secondary to the agent execution status.

#### Scenario: Show background activity detail
- **WHEN** the user opens the drawer for a task that owns unsettled jobs or schedules
- **THEN** the drawer header presents the background activity detail with the labels of those activities

#### Scenario: A running subagent is execution, not background detail
- **WHEN** the main assistant turn has ended and an owned subagent descendant is still running
- **THEN** the drawer header presents the agent execution status
- **AND** it does not present that subagent as background activity detail

#### Scenario: Clear the background detail
- **WHEN** the last background activity for the open task settles
- **THEN** the drawer header stops presenting the background activity detail without a reload

#### Scenario: Working status takes precedence visually
- **WHEN** a task is running an owned agent and also owns background activity
- **THEN** the drawer header presents both facts with the agent execution status visually primary

## ADDED Requirements

### Requirement: Conversation tab attention indicators
Each open conversation tab in the Conversations section SHALL present that conversation's blue unread, orange awaiting-reply, and red failure indicators, with the same meaning as the attention indicators defined by Coexisting attention indicators across task conversations in `kanban-board`. The indicators SHALL be scoped per conversation so a task with several conversations shows which conversation is pending, SHALL update live while the drawer is open, and SHALL be available to assistive technology as part of the tab's accessible name. Closed-conversation entries SHALL NOT present attention indicators.

#### Scenario: Show which conversation is pending
- **WHEN** a task has several open conversation tabs with different attention states
- **THEN** each tab presents its own conversation's attention indicators
- **AND** a tab without attention presents none

#### Scenario: Update the tab live
- **WHEN** an open conversation gains an unread, awaiting-reply, or failure state while the drawer is open
- **THEN** its tab presents the corresponding indicator without a reload

#### Scenario: Clear the read indicators on the viewed tab
- **WHEN** the active conversation is read and its blue and red indicators clear
- **THEN** its tab stops presenting those indicators
- **AND** the other conversation tabs keep their own indicators

#### Scenario: Expose the indicators to assistive technology
- **WHEN** assistive technology reads a conversation tab with pending attention
- **THEN** the tab's accessible name includes the applicable unread, awaiting-reply, or failure states

#### Scenario: Closed entries show no indicators
- **WHEN** a conversation tab is closed, including one whose turn settles after the close
- **THEN** its closed-conversation entry presents no attention indicators

### Requirement: Conversation attention acknowledgment
The drawer SHALL acknowledge a conversation's last settled assistant turn when the conversation's native content is mounted in the Conversations section and the page is visible, and when the conversation's tab is closed. While the content remains mounted and the page visible, a turn that settles SHALL be acknowledged when it settles. Acknowledgment SHALL be per conversation, SHALL NOT acknowledge another conversation of the same task, and SHALL persist across reloads and plugin restarts. Closing a tab SHALL acknowledge only the turn settled at the moment of closing; a turn that settles after the close SHALL remain unread at the task level. Content that is not visible SHALL NOT acknowledge a turn that settles while it is not being read.

#### Scenario: Acknowledge the viewed conversation
- **WHEN** a conversation with an unread or failed settled turn is displayed in the Conversations section
- **THEN** that conversation's blue and red indicators clear
- **AND** the acknowledgment persists after a reload

#### Scenario: Keep the other conversations unread
- **WHEN** two conversations have unread settled turns and only one is displayed
- **THEN** only the displayed conversation is acknowledged
- **AND** the other conversation stays unread

#### Scenario: A settle while watching is acknowledged
- **WHEN** a turn settles while its conversation content is mounted and the page is visible
- **THEN** the conversation does not present unread or failure indicators for that turn

#### Scenario: Do not acknowledge while the page is hidden
- **WHEN** the page is hidden while the conversation content is mounted and a turn settles
- **THEN** the conversation presents its unread or failure indicator until the page becomes visible again

#### Scenario: Close acknowledges the current settled turn
- **WHEN** the user closes a conversation tab
- **THEN** that conversation's last settled turn is acknowledged

#### Scenario: A turn after the close stays unread
- **WHEN** a closed conversation settles another turn after its tab was closed
- **THEN** the task-level attention presents that turn as unread or failed
- **AND** the closed-conversation entry presents no attention indicators
