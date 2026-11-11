# Spec Delta

## MODIFIED Requirements

### Requirement: Auto mode on a task card

A task SHALL have an optional auto-mode setting that is disabled unless the user enables it, including while creating the task, is persisted with the task, and is independent of its stage, position, and conversations. The card SHALL present the setting as an always-visible toggle that also indicates its state, SHALL expose its pressed state and purpose to assistive technology, and SHALL NOT open the task drawer or begin a drag when activated. The control SHALL NOT be presented in selection mode.

Enabling auto mode SHALL arm the task and SHALL NOT move it, change its position, or send an instruction; the next completed turn remains the only trigger. Enabling it while creating a task SHALL persist the setting and SHALL NOT by itself start the first execution; the Start execution now option and Automatic first execution on task creation govern that execution. Disabling it SHALL stop future automatic advances and SHALL NOT retract an advance that is already admitted. A user movement of the task SHALL preserve the setting. The indicator SHALL distinguish disabled, armed, advancing, held, and paused. A paused state SHALL be explained in the status region defined by Task card status strip. A held state SHALL be presented by the control itself, including its accessible name, and SHALL NOT add a status-region entry, because it is derived from pending user work rather than a recorded cause. Held SHALL mean the task has pending user work as defined by Pending user work, and the state SHALL clear when that work is consumed, SHALL NOT be persisted, and SHALL NOT require a user action. The control SHALL name the stage the next completed turn reaches: the recorded transition's stage while that transition resolves, otherwise the default destination. A recorded transition that no longer resolves SHALL be presented as a pause with the `transition-stale` reason, and reading a conversation SHALL NOT change the setting or clear that pause.

The paused state SHALL also present a pause requested by the agent as defined by Agent-requested task pause, and a task carrying that pause SHALL keep auto mode enabled. Activating the control while the task carries a recorded pause — the agent pause or a diagnostic pause — SHALL resume the task and SHALL NOT disable auto mode, whatever the recorded reason; activating it in every other state SHALL toggle the setting as before. A pause derived from a recorded transition that no longer resolves is not a recorded pause, so that presentation SHALL keep the setting toggle. Because a recorded pause resumes when the control is activated, the control SHALL present a task carrying a recorded pause as not pressed even while auto mode is enabled, so the pressed state continues to describe the action the control performs. Resuming SHALL NOT move the task, change its position, send an instruction, or start an execution, and the next completed turn SHALL remain the only trigger.

#### Scenario: Auto mode is disabled by default

- **WHEN** a task is created without enabling Auto mode
- **THEN** its auto mode is disabled
- **AND** the card presents the auto-mode control in its disabled state

#### Scenario: Enable auto mode while creating

- **WHEN** the user enables Auto mode in the New task dialog and saves
- **THEN** the task is persisted with auto mode enabled
- **AND** its stage and position are unchanged
- **AND** no instruction is sent and no agent execution starts unless Start execution now also applies

#### Scenario: Enable auto mode

- **WHEN** the user enables auto mode on a card
- **THEN** the task is armed
- **AND** its stage and position are unchanged
- **AND** no instruction is sent and no agent execution starts

#### Scenario: Disable auto mode

- **WHEN** the user activates the control of an armed task
- **THEN** auto mode is disabled and future automatic advances stop
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

#### Scenario: Present the recorded destination

- **WHEN** an armed task has a recorded transition that still resolves
- **THEN** the control names that transition's stage as the destination of the next completed turn

#### Scenario: Present a stale recorded transition

- **WHEN** an armed task has a recorded transition that no longer resolves
- **THEN** the control presents a pause whose label states that the recorded transition is no longer valid
- **AND** the task's stage and position are unchanged

#### Scenario: Present a pause requested by the agent

- **WHEN** a task carries the agent-requested pause
- **THEN** the control presents the paused state
- **AND** auto mode remains enabled
- **AND** the control presents the recorded reason in its tooltip and its accessible name

#### Scenario: Resume a paused task from the control

- **WHEN** the user activates the control of a task that carries a recorded pause for any reason
- **THEN** the pause is cleared and the task returns to armed
- **AND** auto mode is not disabled
- **AND** the task's stage and position are unchanged
- **AND** no instruction is sent and no agent execution starts

#### Scenario: Present a paused task as not pressed

- **WHEN** an enabled task carries a recorded pause
- **THEN** the control presents itself as not pressed
- **AND** its accessible name states the pause before the action the activation performs

#### Scenario: Keep the setting toggle for a derived stale pause

- **WHEN** an enabled task has a recorded transition that no longer resolves and carries no recorded pause
- **THEN** the control presents itself as pressed
- **AND** activating it disables auto mode instead of resuming

### Requirement: Task card status strip

The board SHALL present a card's unresolved context operation, confirmed transition, and automatic-advance state in one status region below the activity region. Each status SHALL carry a tone that distinguishes a failure from a pending state and SHALL present a short label that names the state. A destructive operation's label SHALL use task-deletion or worktree-removal language and SHALL distinguish checking, queued, in progress, and failed states rather than exposing a raw phase token. A status SHALL remain visible while its operation or transition is unresolved. The automatic-advance status SHALL name the destination stage while an advance is admitted, name a failure when an admitted advance failed, and name the pause reason when auto mode is paused, distinguishing a pause requested by the agent from a diagnostic pause. The status region SHALL NOT report the held state defined by Auto mode on a task card, which the auto-mode control presents instead. A run-action admission failure SHALL be reported in the same status region. A failure of the automatic first-execution preparation on task creation SHALL be reported in the same status region. When a card has more than one such fact, the status region SHALL present them together without replacing one with another.

A pause requested by the agent SHALL present the reason the agent recorded, and a diagnostic pause recorded for the same task SHALL remain presented beside it, so a turn that failed while the task was paused is not hidden by the pause.

#### Scenario: Report a failed operation
- **WHEN** a card's task has a context operation in a failed phase
- **THEN** the status region presents a failure-toned status naming the failure

#### Scenario: Report a pending deletion
- **WHEN** a card's task has a queued or in-progress deletion or worktree removal
- **THEN** the status region presents a pending-toned status that names the destructive action and its queued or in-progress state
- **AND** it does not present the raw operation phase as the label

#### Scenario: Report a destructive preflight
- **WHEN** a card's task has an admitted deletion or worktree removal whose preflight is running
- **THEN** the status region presents a pending-toned status naming the destructive action as being checked
- **AND** it does not present the raw preflight phase as the label

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

#### Scenario: Report a pause requested by the agent
- **WHEN** a task carries the agent-requested pause
- **THEN** the status region presents a pending-toned status whose label contains the reason the agent recorded
- **AND** the label identifies the pause as requested rather than as a failure

#### Scenario: Present an agent pause beside an advance in flight
- **WHEN** an automatic advance is admitted or has failed while the task carries the agent-requested pause
- **THEN** the status region presents the advance state and the agent's reason together
- **AND** the auto-mode control's tooltip and accessible name carry both

#### Scenario: Present an agent pause and a failed turn together
- **WHEN** a task carries the agent-requested pause while a diagnostic pause is also recorded
- **THEN** the status region presents both statuses
- **AND** neither replaces the other

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

#### Scenario: Report a creation preparation failure
- **WHEN** the automatic first-execution preparation for a newly created task fails
- **THEN** the status region reports the failure
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: Clear a resolved status
- **WHEN** the operation, confirmed transition, or automatic-advance state resolves
- **THEN** the corresponding status is no longer presented in the status region
- **AND** reading a conversation does not clear an automatic-advance pause by itself

### Requirement: Automatic advance after a completed turn
When a conversation of a task with auto mode enabled ends a turn whose reason is `completed`, and no open conversation of the task is running a turn, and the task has no pending user work as defined by Pending user work, and the task does not carry the pause requested by the agent, the host SHALL admit exactly one automatic advance. The host SHALL perform the advance without requiring the board to be mounted, without a confirmation, without a conversation picker, and without arming the timed stage instruction. An admitted advance SHALL be durable: reloading the board SHALL NOT cancel it, and a host restart SHALL dispatch it when it had not been dispatched.

The host SHALL evaluate pending user work when the completed turn ends and SHALL re-evaluate it when the advance is admitted, and SHALL NOT admit the advance when pending user work exists at either evaluation. Consuming pending user work SHALL NOT itself move the task; only an observed completed turn triggers an advance. A blocked advance SHALL NOT record a pause and SHALL NOT be dropped silently: the task SHALL present the held state defined by Auto mode on a task card, and the next completed turn SHALL re-evaluate the task.

A turn ending for any other reason SHALL NOT advance the task. The host SHALL NOT admit an advance while the task has an unresolved context operation, an unresolved confirmed transition, or an unresolved entry for its current stage; those conditions SHALL NOT be recorded as a pause and the next completed turn SHALL re-evaluate them. The host SHALL NOT admit an advance while the task carries the agent-requested pause defined by Agent-requested task pause; that pause SHALL NOT be recorded again or cleared by the evaluation, and a later completed turn SHALL re-evaluate it without advancing.

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

#### Scenario: Do not advance a task paused by the agent
- **WHEN** a completed turn ends while the task carries the pause requested by the agent
- **THEN** no advance is admitted
- **AND** the task remains in its current stage
- **AND** the recorded pause and its reason are unchanged

#### Scenario: Re-evaluate the agent pause at admission
- **WHEN** the pause requested by the agent is recorded after the completed turn was evaluated and before the advance is admitted
- **THEN** no advance is admitted
- **AND** the task's stage and position are unchanged

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

### Requirement: Automatic advance pause and failure
A pause SHALL be recorded with the task when a turn ends for a reason other than `completed`, or when an advance cannot be admitted before a durable transition exists. The pause SHALL identify its reason, SHALL be presented on the card and in the task drawer, SHALL persist across reloads and restarts, and SHALL NOT be cleared by reading or acknowledging a conversation. The pause SHALL be cleared when an advance is admitted, when auto mode is disabled, or when the task moves.

An admitted advance that fails SHALL be reported through the task's transition state rather than as a new pause, SHALL keep auto mode enabled, and SHALL NOT be retried automatically. Auto mode SHALL remain armed after a pause, so the next completed turn attempts an advance again.

The pause described here SHALL be a diagnostic record, distinct from the pause requested by the agent defined by Agent-requested task pause. A turn that ends for a reason other than `completed` while the task carries the agent-requested pause SHALL record its diagnostic reason without replacing, shortening, or clearing the agent's reason, and the card SHALL present both. Clearing a diagnostic record SHALL NOT clear the agent-requested pause. Resuming the agent-requested pause SHALL clear any diagnostic record held for the same task, and the task SHALL then advance on its next completed turn like any other armed task.

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

#### Scenario: Keep the agent reason when a paused turn fails
- **WHEN** a turn ends with `error` while the task carries the pause requested by the agent
- **THEN** the diagnostic pause is recorded beside the agent-requested pause
- **AND** the agent's recorded reason is still presented

#### Scenario: Resume clears the diagnostic record
- **WHEN** the paused task is resumed after a diagnostic pause was also recorded
- **THEN** both records are cleared
- **AND** the next completed turn attempts an advance

## ADDED Requirements

### Requirement: Agent-requested task pause

A task SHALL support a pause requested by the agent that suspends its automatic advance while leaving auto mode enabled. The pause SHALL be persisted with the task, SHALL carry a reason written by the agent, and SHALL survive reloads, restarts, and reading a conversation.

The reason SHALL be required and SHALL be nonempty after trimming. A blank reason SHALL be rejected. A reason longer than the accepted length SHALL be rejected with an actionable error, and the recorded reason SHALL never be a silent truncation of what the agent asked for. The recorded reason SHALL be presented in the card status region and in the auto-mode control's tooltip and accessible name.

The pause SHALL suspend the automatic advance and SHALL NOT do anything else: it SHALL NOT move the task, change its position, clear or replace the recorded transition, send a message, start an execution, disable auto mode, or retract an advance that was already admitted. The stage run action, the next-stage action, a user drag, and a user-sent prompt SHALL remain available while the task is paused.

A task SHALL be resumed by activating the auto-mode control, by the resume operation of the agent surface, or by a user movement of the task. Sending a prompt from a conversation SHALL NOT resume it. Resuming SHALL clear the pause, SHALL leave auto mode enabled, SHALL NOT move the task or send an instruction, and SHALL NOT cause an advance for a turn that already ended. Disabling auto mode SHALL clear the pause along with the setting. Moving the task SHALL clear the pause and SHALL keep auto mode enabled.

The pause SHALL be requested only while the task's auto mode is enabled. A request against a task whose auto mode is disabled SHALL succeed with a result stating that auto mode is disabled and that the task therefore does not advance, and SHALL NOT record a pause.

#### Scenario: Pause a task with a reason
- **WHEN** the agent pauses a task whose auto mode is enabled and supplies a reason
- **THEN** the pause is persisted with the task and its reason
- **AND** auto mode remains enabled
- **AND** the task's stage, position, and recorded transition are unchanged
- **AND** no message is sent and no agent execution starts

#### Scenario: Report the pause after the call
- **WHEN** the pause or the resume succeeds
- **THEN** the result reports the task, its stage, whether auto mode is enabled, and the pause in effect with its reason

#### Scenario: Reject an empty reason
- **WHEN** the agent requests a pause with a blank reason
- **THEN** the request is rejected with an actionable error
- **AND** no pause is recorded

#### Scenario: Reject an oversized reason
- **WHEN** the agent requests a pause with a reason longer than the accepted length
- **THEN** the request is rejected with an actionable error
- **AND** no pause is recorded
- **AND** no truncated reason is stored

#### Scenario: Do not advance while paused
- **WHEN** a paused task's conversation ends a completed turn
- **THEN** no automatic advance is admitted
- **AND** the task remains in its stage with its pause and reason intact

#### Scenario: Keep the user's actions available
- **WHEN** a task is paused
- **THEN** the stage run action, the next-stage action, and a drag remain available
- **AND** using one of them is not refused because of the pause

#### Scenario: Resume from the auto-mode control
- **WHEN** the user activates the auto-mode control of a paused task
- **THEN** the pause is cleared and auto mode remains enabled
- **AND** the task's stage and position are unchanged

#### Scenario: Resume through the agent surface
- **WHEN** the agent resumes a task that carries the pause
- **THEN** the pause is cleared and auto mode remains enabled
- **AND** the task's stage and position are unchanged

#### Scenario: A user prompt does not resume
- **WHEN** the user sends a prompt in a conversation of a paused task
- **THEN** the pause remains recorded with its reason
- **AND** the completed turn of that prompt does not advance the task

#### Scenario: Resume on a user movement
- **WHEN** the user moves a paused task to another stage or another position
- **THEN** the pause is cleared
- **AND** auto mode remains enabled
- **AND** the next completed turn advances from the new stage

#### Scenario: Resume never advances by itself
- **WHEN** the pause is cleared without a completed turn ending
- **THEN** no advance is admitted
- **AND** the task remains in its stage

#### Scenario: Disabling auto mode clears the pause
- **WHEN** the user disables auto mode on a paused task
- **THEN** the pause is cleared along with the setting
- **AND** no advance is admitted

#### Scenario: Do not retract an admitted advance
- **WHEN** the agent pauses a task with an automatic advance already admitted
- **THEN** the admitted advance is not retracted
- **AND** no later advance is admitted until the task is resumed

#### Scenario: Request a pause with auto mode disabled
- **WHEN** the agent pauses a task whose auto mode is disabled
- **THEN** the call succeeds and reports that the task does not advance because auto mode is disabled
- **AND** no pause is recorded

#### Scenario: The pause does not clear the routing
- **WHEN** the agent pauses a task that has a recorded transition
- **THEN** the recorded transition and its target stage are unchanged
- **AND** clearing the recorded transition does not pause the task
