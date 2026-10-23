# Spec Delta

## MODIFIED Requirements

### Requirement: Execution activity is independent of workflow and attention
The board SHALL represent task execution state independently of the task's workflow stage and of its unread, awaiting-reply, and failure attention indicators. Execution state SHALL consist of two distinct facts. Turn execution SHALL mean that at least one of the task's conversations is running an assistant turn. Background activity SHALL mean that the task owns unsettled work other than a turn, such as jobs, subagents, or schedules. Both facts SHALL aggregate across all of the task's conversations rather than only the currently selected conversation. Completing or failing an execution SHALL NOT, by itself, redefine the task's workflow stage. A task SHALL be presented as running a turn only while an assistant turn is active; background work that outlives the turn SHALL be presented as background activity instead.

#### Scenario: Activity in a nonselected task conversation
- **WHEN** a task conversation is executing while another task tab is selected
- **THEN** the board still represents that task's execution state

#### Scenario: Execution completion does not imply workflow completion
- **WHEN** an execution finishes in a task whose workflow stage is In Progress
- **THEN** the task remains in In Progress unless a separate stage change is requested

#### Scenario: Background work after the turn ends
- **WHEN** an assistant turn ends in a task while a job, subagent, or schedule owned by that task is still unsettled
- **THEN** the board no longer presents the task as running a turn
- **AND** the board presents that remaining work as background activity

#### Scenario: All execution activity settles
- **WHEN** the last turn and the last background activity for a task have settled
- **THEN** the board presents neither a turn execution state nor background activity for that task

### Requirement: Coexisting attention indicators across task conversations
The board SHALL aggregate attention information across all conversations belonging to a task. It SHALL distinguish blue unread-message indicators, orange awaiting-reply indicators, and red failure indicators. Simultaneously applicable indicators SHALL coexist rather than collapse to a single highest-priority indicator. Those attention indicators SHALL also coexist with the turn execution and background activity presentation rather than replacing one another. Background activity SHALL present a count of the task's unsettled activities; counts are not required for the blue, orange, or red attention indicators.

#### Scenario: Attention from a nonselected conversation
- **WHEN** an unread message, awaiting-reply state, or failure is present in a task conversation that is not selected
- **THEN** the corresponding task-level attention indicator is still represented on the board

#### Scenario: Multiple attention states coexist with activity
- **WHEN** a task has unread messages, a conversation awaiting a reply, a conversation with a failure, a conversation running an assistant turn, and unsettled background activity
- **THEN** blue, orange, and red attention indicators are all represented together
- **AND** the turn execution state and the background activity count are represented separately from those attention indicators

### Requirement: Bulk task deletion
The board SHALL provide an explicit selection mode that presents a selection control on each card and disables card dragging while active. The user SHALL be able to select multiple tasks across visible stages. A bulk deletion SHALL require one confirmation and SHALL apply the individual task deletion semantics to each eligible task. A task SHALL be skipped when any of its conversations is active through a running turn or unsettled background work, it has a pending operation or transition, or its worktree has local changes. The board SHALL report skipped tasks and their reasons, and SHALL leave those tasks selected. Leaving selection mode SHALL clear the selection.

#### Scenario: Enter selection mode and select tasks
- **WHEN** the user enters selection mode and activates cards in more than one stage
- **THEN** the board marks the selected tasks and disables dragging for them

#### Scenario: Delete eligible tasks
- **WHEN** the user confirms deletion of a selection whose tasks are eligible
- **THEN** each eligible task is deleted with the individual deletion semantics and the selection is cleared

#### Scenario: Skip a task with a running conversation
- **WHEN** the user confirms deletion of a selection that includes a task with a running turn or unsettled background work
- **THEN** that task is not deleted, its reason is reported, and it remains selected

#### Scenario: Skip a task with local worktree changes
- **WHEN** the user confirms deletion of a selection that includes a task whose worktree has local changes
- **THEN** that task is not deleted, its reason is reported, and it remains selected

#### Scenario: Leave selection mode
- **WHEN** the user leaves selection mode
- **THEN** the selection is cleared and normal card dragging is restored

## ADDED Requirements

### Requirement: Truthful and self-healing turn execution state
The board SHALL stop presenting a task's turn execution state when the assistant turn ends, without requiring another session event, a reload, or any user action. The board SHALL NOT present a turn as running when no task conversation is running an assistant turn. When an activity update is missed or a transient read fails, the board SHALL recover the correct execution state within at most two seconds. Background activity SHALL NOT be presented as a running turn.

#### Scenario: Turn end clears the card
- **WHEN** the assistant turn of the only active task conversation ends
- **THEN** the card stops presenting the turn execution state without user action and without waiting for another session event

#### Scenario: A missed activity update self-heals
- **WHEN** the last activity update for a conversation is missed or a transient read fails
- **THEN** the board presents the correct execution state within two seconds

#### Scenario: Background work never reads as a turn
- **WHEN** the only active work for a task is a job, subagent, or schedule
- **THEN** the task is not presented as running a turn

### Requirement: Visible execution state on task cards
A task card SHALL present turn execution through a visible working indicator and a distinct card accent rather than a text label alone. The indicator SHALL remain legible in the host's light and dark appearances and SHALL follow the host theme. The working state SHALL be announced to assistive technology when it begins, and periodic animation updates SHALL NOT be announced. The card SHALL follow the host's reduced-motion preference by keeping the indicator and accent visible without animation. When the task owns background activity, the card SHALL present a separate background indicator that shows the number of unsettled activities and makes their labels available on hover and to assistive technology. The background indicator SHALL be visually quieter than the working indicator, and it SHALL be present on its own when no turn is running.

#### Scenario: Card shows a running turn
- **WHEN** a task is running an assistant turn
- **THEN** its card shows the working indicator and the card accent
- **AND** the working state is announced once to assistive technology

#### Scenario: Card shows background work only
- **WHEN** a task's turn has ended and it still owns unsettled background work
- **THEN** its card shows the background indicator with the activity count and no working indicator

#### Scenario: Background labels are available
- **WHEN** the user points at or focuses the background indicator
- **THEN** the labels of the task's unsettled activities are available
- **AND** the labels are exposed to assistive technology

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion
- **THEN** the working indicator and card accent remain visible without animation

#### Scenario: Theme appearance
- **WHEN** the host application uses its light or dark appearance
- **THEN** the working and background indicators remain legible and use host theme colors
