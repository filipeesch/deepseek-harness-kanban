# Spec Delta

## MODIFIED Requirements

### Requirement: Recorded transition for the next advance

A task SHALL be able to record at most one transition for its current stage. The recorded transition SHALL name an existing stage that the current stage's configured transitions list and SHALL carry a reason written by the agent. A recording SHALL be rejected when the current stage does not configure transitions, when the named stage is the task's current stage, when the named stage is not one of the configured targets, or when it names no reason. The reason SHALL be nonempty after trimming; a blank reason SHALL be rejected, and a reason longer than the accepted length SHALL be rejected rather than truncated. Clearing a recording SHALL require no reason. Recording, replacing, or clearing a recorded transition SHALL NOT move the task, change its position, send a message, or change auto mode, and SHALL be available while auto mode is disabled.

A recorded transition that carries a reason SHALL make the task advance at the end of its next completed turn, whether or not auto mode is enabled, and SHALL be the destination of that advance and of the drawer's next-stage action while it resolves. A recording stored without a reason — which an earlier release allowed — SHALL NOT advance the task by itself and SHALL remain the destination of an advance that auto mode admits. It SHALL be discarded when the task leaves the stage it was recorded for, including a manual move, a confirmed transition, and an automatic advance; a same-stage reorder SHALL preserve it. A recorded transition SHALL no longer resolve when its target stage no longer exists or when the current stage no longer lists it as a configured target. A recording that no longer resolves SHALL advance nothing, and SHALL pause auto mode only as defined by Automatic advance destination and dispatch.

The reason SHALL travel with the recording until the advance is dispatched and SHALL NOT outlive it: the recording no longer exists once the task leaves the stage, and the advance that consumed it carries the reason only in the context message it delivers.

#### Scenario: Record a transition

- **WHEN** a task in a stage that configures two targets records one of them with a reason
- **THEN** the task stores that transition and its reason as the one it will follow next
- **AND** its stage and position are unchanged
- **AND** no message is sent and no agent execution starts

#### Scenario: Reject a declaration without a reason

- **WHEN** a recording names a target and no reason, or a reason that is blank after trimming
- **THEN** the recording is rejected without changing the task
- **AND** any previously recorded transition is preserved

#### Scenario: Reject a reason over the accepted length

- **WHEN** a recording names a reason longer than the accepted length
- **THEN** the recording is rejected without changing the task
- **AND** the stored reason is never a silent truncation of what the agent wrote

#### Scenario: Replace a recorded transition

- **WHEN** a task with a recorded transition records the other configured target with a reason
- **THEN** the recorded transition becomes the newly named target with the new reason
- **AND** the task's stage and position are unchanged

#### Scenario: Clear a recorded transition

- **WHEN** a task with a recorded transition records no target
- **THEN** the task has no recorded transition
- **AND** its stage and position are unchanged
- **AND** no reason is required

#### Scenario: Reject a target the stage does not configure

- **WHEN** a recording names a stage that is not one of the current stage's configured targets
- **THEN** the recording is rejected without changing the task
- **AND** any previously recorded transition is preserved

#### Scenario: Reject a recording without configured transitions

- **WHEN** a recording is attempted for a stage that does not configure transitions
- **THEN** the recording is rejected without changing the task

#### Scenario: Record while auto mode is disabled

- **WHEN** a task without auto mode records a transition with a reason
- **THEN** the recording is stored
- **AND** auto mode remains disabled

#### Scenario: Arm the next completed turn without auto mode

- **WHEN** a task without auto mode records a transition and its next turn completes
- **THEN** the task advances to the recorded stage
- **AND** auto mode remains disabled

#### Scenario: Do not move before the turn ends

- **WHEN** a task records a transition during a turn
- **THEN** its stage and position are unchanged for the rest of that turn
- **AND** the advance happens at the end of the completed turn, or not at all when the turn ends otherwise

#### Scenario: Disarm the advance by clearing the recording

- **WHEN** a task without auto mode clears its recorded transition and its next turn completes
- **THEN** the task does not advance

#### Scenario: Keep a recording without a reason inert

- **WHEN** a task carries a transition recorded without a reason and its auto mode is disabled
- **THEN** its next completed turn advances nothing
- **AND** auto mode, when the user enables it, still uses that recording as its destination

#### Scenario: Discard the recording on leaving the stage

- **WHEN** a task with a recorded transition moves to another stage
- **THEN** the task no longer has a recorded transition
- **AND** its reason is discarded with it

#### Scenario: Preserve the recording across a same-stage reorder

- **WHEN** a task with a recorded transition is reordered inside its stage
- **THEN** the recorded transition and its reason are preserved

### Requirement: Automatic advance destination and dispatch

A completed turn SHALL advance the task when its auto mode is enabled or when a reason-carrying recorded transition for its current stage resolves. A recording stored without a reason arms nothing, as the recording requirement states. The advance SHALL NOT be admitted while the task owes the user anything as defined by Pending user work, while a context operation is pending, or while a confirmed transition is already recorded.

The destination SHALL be the stage of the task's recorded transition for its current stage while that transition resolves. Otherwise, and only for a task whose auto mode is enabled, it SHALL be the first entry of the current stage's configured transitions, or the stage that follows the current stage in workflow order when the stage does not configure transitions. There SHALL be no default destination when the configured list is empty or the resolved stage is the current stage.

When the destination is the recorded transition, the advance SHALL move the task exactly to that stage and SHALL NOT continue resolution beyond it. While the default destination has no entry instruction, resolution SHALL continue from that destination. Resolution SHALL stop at the first stage that has an entry instruction, or at the last reachable stage when no reachable stage has one. A stage already visited during the same resolution SHALL NOT be revisited. The resolved destination and its entry instruction SHALL be captured when the advance is admitted, so a workflow edit after admission SHALL NOT change that advance.

A recorded transition that no longer resolves SHALL NOT be replaced by the default destination. The host SHALL NOT advance the task. When the task's auto mode is enabled, the host SHALL pause auto mode with the `transition-stale` reason defined by Auto mode on a task card; a task whose auto mode is disabled SHALL stay in its stage without recording a pause.

The task SHALL be placed at the top of the destination stage, before every card that stage already contains. When the destination has an entry instruction, that instruction SHALL be delivered to the task's first open conversation as the stage-instruction context message defined by Stage instruction delivery as context in `task-conversations`, followed by the reason the recorded transition carried and then by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies; when no conversation is open, a new conversation SHALL be created and used as the target. The delivered context message SHALL contain the stage instruction, the declared reason when one applies, and, when it applies, the briefing. An advance that consumed no recorded reason SHALL deliver no reason block. The advance SHALL NOT create more than one conversation beyond that target. The destination entry SHALL remain unresolved until a prompt or a stage instruction is delivered.

#### Scenario: Use the recorded transition

- **WHEN** the current stage configures multiple permitted transitions, the task recorded one of them, and a completed turn advances the task
- **THEN** the task moves to the stage of the recorded transition

#### Scenario: Advance on a declared transition without auto mode

- **WHEN** a task whose auto mode is disabled has a reason-carrying recorded transition for its current stage and its turn completes
- **THEN** the task moves to the stage of the recorded transition
- **AND** auto mode remains disabled

#### Scenario: Do not advance without auto mode or a recording

- **WHEN** a task whose auto mode is disabled has no reason-carrying recorded transition and its turn completes
- **THEN** no advance is admitted
- **AND** the task's stage and position are unchanged

#### Scenario: Hold the advance while the task owes the user

- **WHEN** a completed turn ends for a task whose auto mode is disabled and whose reason-carrying recorded transition resolves, and the task has pending user work
- **THEN** no advance is admitted
- **AND** the recorded transition is preserved

#### Scenario: Deliver the declared reason with the instruction

- **WHEN** an advance follows a recorded transition and the destination has an entry instruction
- **THEN** the delivered context message is the entry instruction, then the recorded reason, then the briefing when it applies

#### Scenario: Stop at the recorded destination

- **WHEN** the recorded transition names a stage without an entry instruction and a later reachable stage has one
- **THEN** the task moves exactly to the recorded stage
- **AND** no later stage is crossed and no instruction is sent

#### Scenario: Pause on a recorded transition that no longer resolves

- **WHEN** a completed turn would advance a task whose auto mode is enabled and whose recorded transition is no longer a configured target of its current stage
- **THEN** no advance is admitted
- **AND** auto mode is paused with the `transition-stale` reason
- **AND** the task remains in its current stage

#### Scenario: Do not pause a stale recording without auto mode

- **WHEN** a completed turn would advance a task whose auto mode is disabled and whose recorded transition no longer resolves
- **THEN** no advance is admitted
- **AND** no pause is recorded
- **AND** the task remains in its current stage

#### Scenario: Use the first configured transition

- **WHEN** the current stage configures multiple permitted transitions, no transition is recorded, auto mode is enabled, and a completed turn advances the task
- **THEN** the task moves to the first configured transition's stage

#### Scenario: Fall back to workflow order

- **WHEN** the current stage does not configure transitions, no transition is recorded, auto mode is enabled, and a completed turn advances the task
- **THEN** the task moves to the next stage in workflow order

#### Scenario: Cross a stage without an instruction

- **WHEN** the next stage has no entry instruction and a later reachable stage has one
- **THEN** the task moves to that later stage in one advance
- **AND** that stage's instruction is delivered

#### Scenario: Stop at the last reachable stage

- **WHEN** no reachable stage ahead has an entry instruction
- **THEN** the task moves to the last reachable stage
- **AND** no instruction is sent

#### Scenario: Place at the top of the destination

- **WHEN** an advance is dispatched to a destination stage that already contains tasks
- **THEN** the task is placed before every existing card of that stage
- **AND** the existing cards retain their relative order

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

- **WHEN** the instruction cannot be delivered after the task moved
- **THEN** the task stays in the destination
- **AND** the destination entry remains unresolved
- **AND** the card exposes the stage run action for that entry

### Requirement: Automatic advance pause and failure

A pause SHALL be recorded with a task whose auto mode is enabled when a turn ends for a reason other than `completed`, or when an advance cannot be admitted before a durable transition exists. A task whose auto mode is disabled SHALL record no pause: a turn that ends for a reason other than `completed` advances nothing, and the recorded transition SHALL survive for the next completed turn. The pause SHALL identify its reason, SHALL be presented on the card and in the task drawer, SHALL persist across reloads and restarts, and SHALL NOT be cleared by reading or acknowledging a conversation. The pause SHALL be cleared when an advance is admitted, when auto mode is disabled, or when the task moves.

An admitted advance that fails SHALL be reported through the task's transition state rather than as a new pause, SHALL keep auto mode enabled when it was enabled, and SHALL NOT be retried automatically. A failed advance that consumed a recorded transition SHALL keep the reason it carried available to the manual retry of that entry. Auto mode SHALL remain armed after a pause, so the next completed turn attempts an advance again.

The pause described here SHALL be a diagnostic record, distinct from the pause requested by the agent defined by Agent-requested task pause. A turn that ends for a reason other than `completed` while the task carries the agent-requested pause SHALL record its diagnostic reason without replacing, shortening, or clearing the agent's reason, and the card SHALL present both. Clearing a diagnostic record SHALL NOT clear the agent-requested pause. Resuming the agent-requested pause SHALL clear any diagnostic record held for the same task, and the task SHALL then advance on its next completed turn like any other armed task.

#### Scenario: Pause after a failed turn

- **WHEN** a turn of an auto-mode task ends with `error`
- **THEN** the task records a pause naming the failed turn
- **AND** the card and the drawer present that reason

#### Scenario: Record no pause without auto mode

- **WHEN** a turn of a task whose auto mode is disabled ends with `error` and the task has a recorded transition
- **THEN** no pause is recorded
- **AND** the recorded transition is preserved
- **AND** the next completed turn advances the task

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

### Requirement: Transition briefing for an instructed stage

When a stage configures two or more transition targets and the host delivers that stage's entry instruction, the delivery SHALL include a host-generated briefing after the instruction and, when the delivery carries a declared transition's reason, after that reason. The briefing SHALL list every configured target with its stage name and its authored condition when the stage authored one, SHALL name the recorded transition when the task already recorded one for that stage, SHALL name the target that applies when nothing is recorded, and SHALL name the tool that records the choice together with its required reason. The briefing SHALL state that the declared transition is followed at the end of the turn. The briefing SHALL be derived from the active workflow at the moment of delivery and SHALL appear on every delivery path: the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, and the first execution of a task created by an agent. A stage that configures fewer than two targets SHALL produce no briefing, and its context message SHALL contain the entry instruction and, when one applies, the declared transition's reason.

#### Scenario: Include the briefing with two or more targets

- **WHEN** the host delivers the entry instruction of a stage that configures two or more targets
- **THEN** the delivered context message contains the instruction followed by the transition briefing

#### Scenario: Place the briefing after the declared reason

- **WHEN** the delivery carries both a declared transition's reason and a briefing
- **THEN** the message orders the instruction, then the reason, then the briefing

#### Scenario: Omit the briefing with one target

- **WHEN** the host delivers the entry instruction of a stage that configures exactly one target
- **THEN** the delivered context message contains the entry instruction and, when one applies, the declared transition's reason
- **AND** it contains no briefing

#### Scenario: Omit the briefing without configured transitions

- **WHEN** the host delivers the entry instruction of a stage that does not configure transitions
- **THEN** the delivered context message contains the entry instruction and, when one applies, the declared transition's reason
- **AND** it contains no briefing

#### Scenario: State the required reason and the end-of-turn timing

- **WHEN** the briefing names the tool that records the choice
- **THEN** it states that recording a destination requires a reason
- **AND** it states that the declared transition is followed at the end of the turn

#### Scenario: List each target with its condition

- **WHEN** the briefing is generated for a stage whose targets carry authored conditions
- **THEN** every target is listed with its stage name and its condition
- **AND** a target without a condition is listed without one

#### Scenario: Name the target that applies without a recording

- **WHEN** the briefing is generated and the task has no recorded transition for that stage
- **THEN** the briefing names the target the host uses when nothing is recorded

#### Scenario: Name the recorded transition

- **WHEN** the briefing is generated and the task already recorded a transition for that stage
- **THEN** the briefing names the recorded transition

#### Scenario: Derive the briefing at send time

- **WHEN** the workflow changes between the admission of an instruction and its delivery
- **THEN** the briefing reflects the targets the stage configures at the moment of delivery

#### Scenario: Include the briefing on every send path

- **WHEN** a stage instruction is delivered by the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, or the first execution of a task created by an agent
- **THEN** the delivered context message includes the briefing whenever the stage configures two or more targets
