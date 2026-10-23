# Spec Delta

## MODIFIED Requirements

### Requirement: Task drawer sections
Opening a task card SHALL display a task drawer with a header showing the task title, the project, and the task's execution status, and Conversations, Info, Git, and Notes sections. The execution status SHALL remain visible while the user inspects any of those sections. Conversations SHALL contain the task's native DSH chats, Info SHALL expose the task's title and Markdown description, Git SHALL expose its simplified worktree controls, and Notes SHALL expose its shared task notes. The workflow stage control SHALL be presented in the drawer's compact toolbar and SHALL list only the transitions permitted from the current stage.

#### Scenario: Open a task from the board
- **WHEN** a user opens a card on the Kanban board
- **THEN** the drawer header shows the task title, its project, and its execution status
- **AND** the drawer provides Conversations, Info, Git, and Notes without replacing the card interaction with a separate main-chat navigation flow
- **AND** the compact toolbar provides the permitted workflow transitions

#### Scenario: Change stage from the drawer
- **WHEN** the user selects a permitted destination from the drawer's stage control
- **THEN** the same workflow transition rules apply as for a board drop
- **AND** an instructed destination requires the Move and run / Move only / Cancel confirmation

#### Scenario: Execution status stays visible across sections
- **WHEN** a task is running an assistant turn and the user switches between the drawer's sections
- **THEN** the drawer header still presents the task's execution status on every section

#### Scenario: Execution status clears when the turn ends
- **WHEN** the task's assistant turn ends while the drawer is open
- **THEN** the drawer header stops presenting the turn execution status without a reload

## ADDED Requirements

### Requirement: Drawer execution status detail
The drawer header SHALL present the task's turn execution status with the same meaning as the board card, including the background activity detail when the task owns unsettled background work. That background detail SHALL name the task's unsettled activities and SHALL stop being presented when no background activity remains. The background detail SHALL be visually secondary to the turn execution status.

#### Scenario: Show background activity detail
- **WHEN** the user opens the drawer for a task that owns unsettled jobs, subagents, or schedules
- **THEN** the drawer header presents the background activity detail with the labels of those activities

#### Scenario: Clear the background detail
- **WHEN** the last background activity for the open task settles
- **THEN** the drawer header stops presenting the background activity detail without a reload

#### Scenario: Working status takes precedence visually
- **WHEN** a task is running an assistant turn and also owns background activity
- **THEN** the drawer header presents both facts with the turn execution status visually primary
