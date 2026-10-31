# Spec Delta

## MODIFIED Requirements

### Requirement: Task card layout

The board SHALL render each task as a card composed of distinct regions in a fixed order: a title region, a context region, an activity region, and a status region. The context region SHALL present the task's project name, the auto-mode control defined by Auto mode on a task card, and its unread, awaiting-reply, and failure attention indicators. The activity region SHALL present turn execution, background activity, and the stage run action defined by Run a stage instruction from a card. The status region SHALL present unresolved context-operation, confirmed-transition, and automatic-advance state as defined by Task card status strip.

The project name SHALL remain visible on every card, SHALL be visually quieter than the title, and SHALL expose the complete name when the available width truncates it. The title SHALL NOT be clamped to a fixed number of lines. In selection mode the card SHALL present its selection control at the leading edge of the context region. The whole card surface SHALL remain activatable as defined by Open a task drawer, except for nested controls, which SHALL perform their own action without opening the drawer.

#### Scenario: Present the card regions in order
- **WHEN** a task card renders
- **THEN** the title, the context region, the activity region, and the status region appear in that order
- **AND** the project name, the auto-mode control, and the attention indicators are in the context region, not the activity region
- **AND** turn execution and background activity are in the activity region, not the context region

#### Scenario: Keep a long title readable
- **WHEN** a task title is wider than the card
- **THEN** the title wraps onto additional lines without a fixed line clamp
- **AND** the complete title remains available to assistive technology

#### Scenario: Keep a long project name available
- **WHEN** a project name is wider than the context region
- **THEN** the context region truncates the visible name
- **AND** the complete project name is available on hover and to assistive technology

#### Scenario: Place the selection control
- **WHEN** the board is in selection mode
- **THEN** each card presents its selection control at the leading edge of the context region
- **AND** the card does not overlay the control on the title region
- **AND** the auto-mode control is not presented in selection mode

#### Scenario: Place the auto-mode control
- **WHEN** a task card renders outside selection mode
- **THEN** the auto-mode control appears in the context region
- **AND** it stays on one line with the project name and the attention indicators
- **AND** activating it does not open the task drawer and does not begin a drag

#### Scenario: Omit an empty status region
- **WHEN** a card has no unresolved context operation, confirmed transition, automatic-advance state, or run-action failure
- **THEN** the card presents no status-region content

### Requirement: Task card status strip

The board SHALL present a card's unresolved context operation, confirmed transition, and automatic-advance state in one status region below the activity region. Each status SHALL carry a tone that distinguishes a failure from a pending state and SHALL present a short label that names the state. A destructive operation's label SHALL use task-deletion or worktree-removal language and SHALL distinguish queued, in progress, and failed states rather than exposing a raw phase token. A status SHALL remain visible while its operation or transition is unresolved. The automatic-advance status SHALL name the destination stage while an advance is admitted, name a failure when an admitted advance failed, and name the pause reason when auto mode is paused. A run-action admission failure SHALL be reported in the same status region. When a card has more than one such fact, the status region SHALL present them together without replacing one with another.

#### Scenario: Report a failed operation
- **WHEN** a card's task has a context operation in a failed phase
- **THEN** the status region presents a failure-toned status naming the failure

#### Scenario: Report a pending deletion
- **WHEN** a card's task has a queued or in-progress deletion or worktree removal
- **THEN** the status region presents a pending-toned status that names the destructive action and its queued or in-progress state
- **AND** it does not present the raw operation phase as the label

#### Scenario: Report a failed deletion
- **WHEN** a card's task has a failed deletion or worktree removal
- **THEN** the status region presents a failure-toned status that names the destructive action as needing attention

#### Scenario: Report a pending transition
- **WHEN** a card's task has a confirmed transition that is not settled
- **THEN** the status region presents a pending-toned status naming the pending confirmation

#### Scenario: Report an advancing task
- **WHEN** a card's task has an admitted automatic advance that is not settled
- **THEN** the status region presents a pending-toned status naming the destination stage
- **AND** it does not present the advance as a user confirmation

#### Scenario: Report a failed automatic advance
- **WHEN** an admitted automatic advance fails
- **THEN** the status region presents a failure-toned status that names the automatic advance as needing attention
- **AND** the card still exposes the stage run action for an unresolved destination entry

#### Scenario: Report a paused automatic advance
- **WHEN** auto mode is paused
- **THEN** the status region presents a short label naming the pause reason
- **AND** the label distinguishes a turn that did not complete from an advance that could not be admitted

#### Scenario: Present multiple statuses together
- **WHEN** a task has both an unresolved operation and a confirmed transition
- **THEN** the status region presents both statuses
- **AND** neither status replaces the other

#### Scenario: Report a run-action admission failure
- **WHEN** the run action is activated and the instruction cannot be admitted
- **THEN** the status region reports the failure
- **AND** the run action remains available for the same entry

#### Scenario: Clear a resolved status
- **WHEN** the operation, confirmed transition, or automatic-advance state resolves
- **THEN** the corresponding status is no longer presented in the status region
- **AND** reading a conversation does not clear an automatic-advance pause by itself

### Requirement: Direct stage manipulation on the board

The board SHALL move tasks between workflow stages only through drag and drop. A task card SHALL NOT provide an independent stage selector. A drag SHALL present a distinct dragged representation and a drop indicator. Dropping on a permitted stage SHALL move the task immediately, whether or not that stage has an entry instruction. Hovering a restricted stage during a drag SHALL present a distinct warning affordance. Dropping on a restricted stage SHALL require explicit confirmation before moving the task; canceling SHALL leave the task's stage and position unchanged. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement; neither the drop nor a restricted-move confirmation SHALL initiate an execution. Dropping within the current stage SHALL reorder the task relative to its neighbors without arming a new timed instruction. A prohibited or canceled drop SHALL leave the task unchanged. The board SHALL NOT offer worktree creation as part of a drop. The host's automatic advance, defined by Automatic advance after a completed turn, SHALL NOT be presented as board stage manipulation, SHALL NOT add a card stage selector, and SHALL NOT require a confirmation.

#### Scenario: Move to an uninstructed stage by drag and drop
- **WHEN** the user drops a task on a permitted stage that has no entry instruction
- **THEN** the task appears in that stage immediately
- **AND** the move does not initiate an agent execution
- **AND** no timed instruction is armed

#### Scenario: Reorder within the current stage
- **WHEN** the user drops a task at a new position within its current stage
- **THEN** the task is placed at that position and the new order is retained
- **AND** no new timed instruction is armed
- **AND** a countdown already active for the current entry remains active

#### Scenario: Drop on an instructed stage
- **WHEN** the user drops a task on a permitted stage that has an entry instruction
- **THEN** the task moves to that stage immediately
- **AND** the drop does not initiate an agent execution
- **AND** a five-second countdown for that entry is armed
- **AND** the card exposes the countdown control

#### Scenario: Warn while hovering a restricted stage
- **WHEN** the user drags a task over a stage that the workflow does not permit from its current stage
- **THEN** the board presents a distinct warning affordance before the drop
- **AND** the task remains in its current stage until a drop is confirmed

#### Scenario: Restricted drop asks for confirmation
- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage
- **THEN** the board asks for explicit confirmation before moving the task
- **AND** the task remains in its current stage until the user confirms

#### Scenario: Confirm a restricted drop
- **WHEN** the user confirms the restricted-drop confirmation
- **THEN** the task appears in the destination stage at the dropped position
- **AND** the move does not initiate an agent execution
- **AND** if the destination has an entry instruction, its timed instruction is armed

#### Scenario: Prohibited drop
- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage and cancels the confirmation
- **THEN** the task remains in its current stage and its position is unchanged

#### Scenario: Drop without a worktree
- **WHEN** the user drops a task that has no worktree on a permitted stage
- **THEN** the move completes without asking whether to create a worktree

#### Scenario: Advance without board manipulation
- **WHEN** an automatic advance moves a task
- **THEN** the card does not present a stage selector
- **AND** no confirmation or drop indicator is shown

### Requirement: Movement never runs an agent

A user movement of a task, including into a stage with an entry instruction, SHALL update its workflow stage and position without initiating an agent execution at the time of the move. An instructed user move SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement; that scheduled execution is separate from the move. Execution SHALL otherwise require a separate explicit card run action or a user-sent message from the conversation composer. The automatic advance defined by Automatic advance after a completed turn SHALL be the only movement that dispatches the destination instruction itself, SHALL NOT arm the timed stage instruction, and SHALL NOT be available for a task whose auto mode is disabled. Optional worktree creation and directory switching SHALL follow the separate worktree-management requirements.

#### Scenario: Move to a stage without an entry instruction
- **WHEN** the user completes an allowed move to a stage without an entry instruction
- **THEN** the task appears in that stage without an agent execution being initiated by the move
- **AND** no countdown is armed

#### Scenario: Move to an instructed stage
- **WHEN** the user completes an allowed move to a stage with an entry instruction
- **THEN** the task appears in that stage without an agent execution being initiated by the move
- **AND** a five-second countdown is armed for that entry
- **AND** canceling the countdown leaves the task in that stage without an agent execution

#### Scenario: Automatic advance is not a user move
- **WHEN** the host completes an automatic advance into a stage with an entry instruction
- **THEN** the destination instruction is dispatched by the advance
- **AND** no five-second countdown is armed
- **AND** no worktree choice is requested by the advance

## ADDED Requirements

### Requirement: Auto mode on a task card

A task SHALL have an optional auto-mode setting that is disabled unless the user enables it, is persisted with the task, and is independent of its stage, position, and conversations. The card SHALL present the setting as an always-visible toggle that also indicates its state, SHALL expose its pressed state and purpose to assistive technology, and SHALL NOT open the task drawer or begin a drag when activated. The control SHALL NOT be presented in selection mode.

Enabling auto mode SHALL arm the task and SHALL NOT move it, change its position, or send an instruction; the next completed turn remains the only trigger. Disabling it SHALL stop future automatic advances and SHALL NOT retract an advance that is already admitted. A user movement of the task SHALL preserve the setting. The indicator SHALL distinguish disabled, armed, advancing, and paused, and a paused state SHALL be explained in the status region defined by Task card status strip. Reading a conversation SHALL NOT change the setting and SHALL NOT clear a pause.

#### Scenario: Auto mode is disabled by default
- **WHEN** a task is created
- **THEN** its auto mode is disabled
- **AND** the card presents the auto-mode control in its disabled state

#### Scenario: Enable auto mode
- **WHEN** the user enables auto mode on a card
- **THEN** the task is armed
- **AND** its stage and position are unchanged
- **AND** no instruction is sent and no agent execution starts

#### Scenario: Disable auto mode
- **WHEN** the user disables auto mode while no advance is in progress
- **THEN** future automatic advances stop
- **AND** the task's stage and position are unchanged

#### Scenario: Disable during an admitted advance
- **WHEN** the user disables auto mode while an automatic advance is already admitted
- **THEN** the admitted advance is not retracted
- **AND** no later advance is admitted

#### Scenario: Preserve auto mode across a manual move
- **WHEN** the user moves a task whose auto mode is enabled
- **THEN** auto mode remains enabled
- **AND** the next completed turn advances from the new stage

#### Scenario: Reading does not change auto mode
- **WHEN** the user opens and reads a task conversation
- **THEN** auto mode keeps its setting and paused state

### Requirement: Automatic advance after a completed turn

When an open conversation of a task with auto mode enabled ends a turn whose reason is `completed`, and no other open conversation of the task is running a turn or awaiting a reply, the host SHALL admit exactly one automatic advance. The host SHALL perform the advance without requiring the board to be mounted, without a confirmation, without a conversation picker, and without arming the timed stage instruction. An admitted advance SHALL be durable: reloading the board SHALL NOT cancel it, and a host restart SHALL dispatch it when it had not been dispatched.

A turn ending for any other reason SHALL NOT advance the task. The host SHALL NOT admit an advance while the task has an unresolved context operation, an unresolved confirmed transition, or an unresolved entry for its current stage; those conditions SHALL NOT be recorded as a pause and the next completed turn SHALL re-evaluate them.

The host SHALL NOT replay a turn that ended while it was not observing the task's conversations. Only a turn end observed while the host is running SHALL trigger an advance.

#### Scenario: Advance after a completed turn
- **WHEN** the only open conversation of an armed task ends a completed turn
- **THEN** one automatic advance is admitted

#### Scenario: Do not advance after a non-completed turn
- **WHEN** a turn ends as `error`, `blocked`, `aborted`, or `max-tokens`
- **THEN** no advance is admitted
- **AND** the task remains in its current stage
- **AND** a pause reason naming the ending is recorded

#### Scenario: Wait for every conversation to become idle
- **WHEN** a completed turn ends while another open conversation of the same task is running a turn or awaiting a reply
- **THEN** no advance is admitted at that moment
- **AND** the next completed turn re-evaluates the task

#### Scenario: Do not advance a busy task
- **WHEN** a completed turn ends while the task has an unresolved context operation, an unresolved confirmed transition, or an unresolved entry for its current stage
- **THEN** no advance is admitted
- **AND** no pause reason is recorded for that condition

#### Scenario: Advance with the board closed
- **WHEN** a completed turn ends while the Kanban board is not displayed
- **THEN** the advance is admitted and dispatched
- **AND** the card shows its result when the board is displayed again

#### Scenario: Keep an admitted advance across a reload
- **WHEN** the user reloads the interface while an admitted advance has not been dispatched
- **THEN** the advance is still dispatched
- **AND** it is not duplicated

#### Scenario: No catch-up after a restart
- **WHEN** the host starts and a task's last turn ended while the host was not observing it
- **THEN** no advance is admitted for that turn
- **AND** the task remains in its stage until its next completed turn

### Requirement: Automatic advance destination and dispatch

The automatic advance destination SHALL be the first entry of the current stage's configured `allowed_transitions` when that list is configured, otherwise the stage that follows the current stage in workflow order. There SHALL be no destination when the configured list is empty or the resolved stage is the current stage.

While the resolved destination has no entry instruction, resolution SHALL continue from that destination. Resolution SHALL stop at the first stage that has an entry instruction, or at the last reachable stage when no reachable stage has one. A stage already visited during the same resolution SHALL NOT be revisited. The resolved destination and its entry instruction SHALL be captured when the advance is admitted, so a workflow edit after admission SHALL NOT change that advance.

The task SHALL be placed in the destination as a permitted move places it, at the last position of the destination stage. When the destination has an entry instruction, that instruction SHALL be sent verbatim to the task's first open conversation; when no conversation is open, a new conversation SHALL be created and used as the target. The submitted message SHALL contain only the stage instruction. The advance SHALL NOT create more than one conversation beyond that target. The destination entry SHALL remain unresolved until a prompt is sent.

#### Scenario: Use the first configured transition
- **WHEN** the current stage configures multiple permitted transitions and a completed turn advances the task
- **THEN** the task moves to the first configured transition's stage

#### Scenario: Fall back to workflow order
- **WHEN** the current stage does not configure transitions and a completed turn advances the task
- **THEN** the task moves to the next stage in workflow order

#### Scenario: Cross a stage without an instruction
- **WHEN** the next stage has no entry instruction and a later reachable stage has one
- **THEN** the task moves to that later stage in one advance
- **AND** that stage's instruction is sent

#### Scenario: Stop at the last reachable stage
- **WHEN** no reachable stage ahead has an entry instruction
- **THEN** the task moves to the last reachable stage
- **AND** no instruction is sent

#### Scenario: Never revisit a stage
- **WHEN** the resolution would return to a stage it already visited
- **THEN** resolution stops before the repeat
- **AND** no advance loops

#### Scenario: Capture the instruction at admission
- **WHEN** the destination instruction changes after an advance is admitted
- **THEN** the admitted advance sends the captured instruction
- **AND** the task moves to the captured destination

#### Scenario: Target the first open conversation
- **WHEN** an advance with an instructed destination is dispatched and the task has open conversations
- **THEN** the first open conversation receives the instruction
- **AND** no conversation picker is presented

#### Scenario: Create the target conversation
- **WHEN** an advance with an instructed destination is dispatched and the task has no open conversation
- **THEN** one new conversation is created and receives the instruction
- **AND** no additional conversation is created

#### Scenario: Keep a failed destination entry unresolved
- **WHEN** the instruction cannot be sent after the task moved
- **THEN** the task stays in the destination
- **AND** the destination entry remains unresolved
- **AND** the card exposes the stage run action for that entry

### Requirement: Automatic advance pause and failure

A pause SHALL be recorded with the task when a turn ends for a reason other than `completed`, or when an advance cannot be admitted before a durable transition exists. The pause SHALL identify its reason, SHALL be presented on the card and in the task drawer, SHALL persist across reloads and restarts, and SHALL NOT be cleared by reading or acknowledging a conversation. The pause SHALL be cleared when an advance is admitted, when auto mode is disabled, or when the task moves.

An admitted advance that fails SHALL be reported through the task's transition state rather than as a new pause, SHALL keep auto mode enabled, and SHALL NOT be retried automatically. Auto mode SHALL remain armed after a pause, so the next completed turn attempts an advance again.

#### Scenario: Pause after a failed turn
- **WHEN** a turn ends with `error`
- **THEN** the task records a pause naming the failed turn
- **AND** the card and the drawer present that reason

#### Scenario: Pause after an admission failure
- **WHEN** an advance cannot be admitted before a durable transition exists
- **THEN** the task records a pause naming the admission failure
- **AND** auto mode remains enabled

#### Scenario: Clear the pause on the next advance
- **WHEN** a later completed turn admits an advance
- **THEN** the recorded pause is cleared

#### Scenario: Clear the pause when auto mode is disabled
- **WHEN** the user disables auto mode
- **THEN** the recorded pause is cleared

#### Scenario: Clear the pause on a manual move
- **WHEN** the user moves the paused task
- **THEN** the recorded pause is cleared
- **AND** auto mode remains enabled

#### Scenario: Reading does not clear the pause
- **WHEN** the user opens and reads the conversation whose turn did not complete
- **THEN** the pause remains presented

#### Scenario: No automatic retry
- **WHEN** an admitted advance fails
- **THEN** the plugin does not retry it automatically
- **AND** the task presents the failure with its existing recovery actions
