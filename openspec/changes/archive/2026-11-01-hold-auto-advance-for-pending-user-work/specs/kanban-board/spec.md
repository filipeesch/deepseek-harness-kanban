# Spec Delta

## ADDED Requirements

### Requirement: Pending user work

Pending user work SHALL mean any input a task's conversation still owes the user's counterpart: an unanswered structured question round, an unanswered native question, a pending approval or permission request, and a user message queued for the next turn. Pending user work SHALL be evaluated for every conversation of the task, including a conversation whose tab is closed and a conversation the client has never displayed. A message the host itself queued as a stage instruction SHALL NOT count as pending user work.

Pending user work SHALL be derived from the conversations' durable state and SHALL NOT be persisted with the task, so it cannot outlive the input it describes. Submitting a structured question round, answering with an ordinary chat reply, answering a native question, deciding an approval, or losing a queued message SHALL consume the corresponding item. An unreadable conversation state SHALL NOT be treated as idle: the host SHALL NOT admit an advance from that evaluation and SHALL report the failure. The auto-mode control MAY keep its previous state, because an unreadable state cannot be presented as a specific kind of pending work.

#### Scenario: An unanswered question round is pending
- **WHEN** a conversation of the task has a structured question round with no answer
- **THEN** the task has pending user work

#### Scenario: An unanswered native question is pending
- **WHEN** a conversation of the task has a native question awaiting the user
- **THEN** the task has pending user work

#### Scenario: A pending approval is pending
- **WHEN** a conversation of the task has an approval or permission request awaiting the user
- **THEN** the task has pending user work

#### Scenario: A queued user message is pending
- **WHEN** a conversation of the task holds a user message queued for the next turn
- **THEN** the task has pending user work

#### Scenario: A closed conversation still counts
- **WHEN** a conversation with pending user work has its tab closed
- **THEN** the task still has pending user work

#### Scenario: A host-queued stage instruction is not user work
- **WHEN** the only queued message in a conversation is a stage instruction the host queued itself
- **THEN** the task does not have pending user work because of that message

#### Scenario: Consuming the last item ends the pending state
- **WHEN** the last outstanding item of pending user work in the task is consumed
- **THEN** the task no longer has pending user work
- **AND** no stored record had to be cleared

#### Scenario: Unreadable state is not idle
- **WHEN** a conversation's state cannot be read while pending user work is being evaluated
- **THEN** no automatic advance is admitted for that evaluation
- **AND** the failure is reported
- **AND** the control is not required to present a pending-work kind for it

## MODIFIED Requirements

### Requirement: Auto mode on a task card

A task SHALL have an optional auto-mode setting that is disabled unless the user enables it, is persisted with the task, and is independent of its stage, position, and conversations. The card SHALL present the setting as an always-visible toggle that also indicates its state, SHALL expose its pressed state and purpose to assistive technology, and SHALL NOT open the task drawer or begin a drag when activated. The control SHALL NOT be presented in selection mode.

Enabling auto mode SHALL arm the task and SHALL NOT move it, change its position, or send an instruction; the next completed turn remains the only trigger. Disabling it SHALL stop future automatic advances and SHALL NOT retract an advance that is already admitted. A user movement of the task SHALL preserve the setting. The indicator SHALL distinguish disabled, armed, advancing, held, and paused. A paused state SHALL be explained in the status region defined by Task card status strip. A held state SHALL be presented by the control itself, including its accessible name, and SHALL NOT add a status-region entry, because it is derived from pending user work rather than a recorded cause. Held SHALL mean the task has pending user work as defined by Pending user work, and the state SHALL clear when that work is consumed, SHALL NOT be persisted, and SHALL NOT require a user action. Reading a conversation SHALL NOT change the setting and SHALL NOT clear a pause.

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

#### Scenario: Present the held state
- **WHEN** an armed task has pending user work
- **THEN** the auto-mode control presents the held state
- **AND** the card's status region presents no entry for that state

#### Scenario: Clear the held state when pending work is consumed
- **WHEN** the task's last pending user work is consumed
- **THEN** the auto-mode control stops presenting the held state without a reload
- **AND** the task's stage and position are unchanged by the change

#### Scenario: Reading does not change auto mode
- **WHEN** the user opens and reads a task conversation
- **THEN** auto mode keeps its setting and paused state

### Requirement: Automatic advance after a completed turn

When a conversation of a task with auto mode enabled ends a turn whose reason is `completed`, and no open conversation of the task is running a turn, and the task has no pending user work as defined by Pending user work, the host SHALL admit exactly one automatic advance. The host SHALL perform the advance without requiring the board to be mounted, without a confirmation, without a conversation picker, and without arming the timed stage instruction. An admitted advance SHALL be durable: reloading the board SHALL NOT cancel it, and a host restart SHALL dispatch it when it had not been dispatched.

The host SHALL evaluate pending user work when the completed turn ends and SHALL re-evaluate it when the advance is admitted, and SHALL NOT admit the advance when pending user work exists at either evaluation. Consuming pending user work SHALL NOT itself move the task; only an observed completed turn triggers an advance. A blocked advance SHALL NOT record a pause and SHALL NOT be dropped silently: the task SHALL present the held state defined by Auto mode on a task card, and the next completed turn SHALL re-evaluate the task.

A turn ending for any other reason SHALL NOT advance the task. The host SHALL NOT admit an advance while the task has an unresolved context operation, an unresolved confirmed transition, or an unresolved entry for its current stage; those conditions SHALL NOT be recorded as a pause and the next completed turn SHALL re-evaluate them.

The host SHALL NOT replay a turn that ended while it was not observing the task's conversations. Only a turn end observed while the host is running SHALL trigger an advance.

#### Scenario: Advance after a completed turn
- **WHEN** the only open conversation of an armed task ends a completed turn and the task has no pending user work
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

#### Scenario: Wait while an unanswered question round exists
- **WHEN** a completed turn ends while any conversation of the task has an unanswered structured question round
- **THEN** no advance is admitted
- **AND** no pause reason is recorded
- **AND** the auto-mode control presents the held state

#### Scenario: Wait while a user message is queued
- **WHEN** a completed turn ends while any conversation of the task has a user message queued for the next turn
- **THEN** no advance is admitted
- **AND** no pause reason is recorded

#### Scenario: Wait while a pending approval exists
- **WHEN** a completed turn ends while any conversation of the task has an approval or native question awaiting the user
- **THEN** no advance is admitted
- **AND** no pause reason is recorded

#### Scenario: Wait while a closed conversation has pending user work
- **WHEN** a completed turn ends while a closed conversation of the task has pending user work
- **THEN** no advance is admitted
- **AND** no pause reason is recorded

#### Scenario: Advance after the pending work is consumed
- **WHEN** pending user work is consumed and a later turn ends as `completed` with no pending user work in the task
- **THEN** one automatic advance is admitted

#### Scenario: Consuming pending work does not advance by itself
- **WHEN** the task's last pending user work is consumed without a completed turn ending
- **THEN** no advance is admitted
- **AND** the task remains in its current stage

#### Scenario: Re-validate pending user work at admission
- **WHEN** pending user work appears after the completed turn was evaluated and before the advance is admitted
- **THEN** no advance is admitted
- **AND** the task's stage and position are unchanged
- **AND** the next completed turn re-evaluates the task

#### Scenario: Do not advance a busy task
- **WHEN** a completed turn ends while the task has an unresolved context operation, an unresolved confirmed transition, or an unresolved entry for its current stage
- **THEN** no advance is admitted
- **AND** no pause reason is recorded for that condition

#### Scenario: Advance with the board closed
- **WHEN** a completed turn ends while the Kanban board is not displayed and the task has no pending user work
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

### Requirement: Task card status strip

The board SHALL present a card's unresolved context operation, confirmed transition, and automatic-advance state in one status region below the activity region. Each status SHALL carry a tone that distinguishes a failure from a pending state and SHALL present a short label that names the state. A destructive operation's label SHALL use task-deletion or worktree-removal language and SHALL distinguish queued, in progress, and failed states rather than exposing a raw phase token. A status SHALL remain visible while its operation or transition is unresolved. The automatic-advance status SHALL name the destination stage while an advance is admitted, name a failure when an admitted advance failed, and name the pause reason when auto mode is paused. The status region SHALL NOT report the held state defined by Auto mode on a task card, which the auto-mode control presents instead. A run-action admission failure SHALL be reported in the same status region. When a card has more than one such fact, the status region SHALL present them together without replacing one with another.

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

#### Scenario: Do not report the held state
- **WHEN** an armed task has pending user work
- **THEN** the status region presents no entry for the held state
- **AND** the auto-mode control presents it

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
