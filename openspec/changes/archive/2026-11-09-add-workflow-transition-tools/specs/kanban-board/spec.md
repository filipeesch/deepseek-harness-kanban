# Spec Delta

## ADDED Requirements

### Requirement: Recorded transition for the next advance

A task SHALL be able to record at most one transition for its current stage. The recorded transition SHALL name an existing stage that the current stage's configured transitions list. A recording SHALL be rejected when the current stage does not configure transitions, when the named stage is the task's current stage, or when the named stage is not one of the configured targets. Recording, replacing, or clearing a recorded transition SHALL NOT move the task, change its position, send a message, or change auto mode, and SHALL be available while auto mode is disabled.

The recorded transition SHALL be the destination of the next automatic advance and the target of the drawer's next-stage action while it resolves. It SHALL be discarded when the task leaves the stage it was recorded for, including a manual move, a confirmed transition, and an automatic advance; a same-stage reorder SHALL preserve it. A recorded transition SHALL no longer resolve when its target stage no longer exists or when the current stage no longer lists it as a configured target.

#### Scenario: Record a transition

- **WHEN** a task in a stage that configures two targets records one of them
- **THEN** the task stores that transition as the one it will follow next
- **AND** its stage and position are unchanged
- **AND** no message is sent and no agent execution starts

#### Scenario: Replace a recorded transition

- **WHEN** a task with a recorded transition records the other configured target
- **THEN** the recorded transition becomes the newly named target
- **AND** the task's stage and position are unchanged

#### Scenario: Clear a recorded transition

- **WHEN** a task with a recorded transition records no target
- **THEN** the task has no recorded transition
- **AND** its stage and position are unchanged

#### Scenario: Reject a target the stage does not configure

- **WHEN** a recording names a stage that is not one of the current stage's configured targets
- **THEN** the recording is rejected without changing the task
- **AND** any previously recorded transition is preserved

#### Scenario: Reject a recording without configured transitions

- **WHEN** a recording is attempted for a stage that does not configure transitions
- **THEN** the recording is rejected without changing the task

#### Scenario: Record while auto mode is disabled

- **WHEN** a task without auto mode records a transition
- **THEN** the recording is stored
- **AND** auto mode remains disabled

#### Scenario: Discard the recording on leaving the stage

- **WHEN** a task with a recorded transition moves to another stage
- **THEN** the task no longer has a recorded transition

#### Scenario: Preserve the recording across a same-stage reorder

- **WHEN** a task with a recorded transition is reordered inside its stage
- **THEN** the recorded transition is preserved

### Requirement: Transition briefing for an instructed stage

When a stage configures two or more transition targets and the host sends that stage's entry instruction, the send SHALL include a host-generated briefing after the instruction. The briefing SHALL list every configured target with its stage name and its authored condition when the stage authored one, SHALL name the recorded transition when the task already recorded one for that stage, SHALL name the target that applies when nothing is recorded, and SHALL name the tool that records the choice. The briefing SHALL be derived from the active workflow at the moment of sending and SHALL appear on every send path: the card run action, the timed stage instruction after a move, a confirmed transition, and an automatic advance. A stage that configures fewer than two targets SHALL produce no briefing, and its message SHALL contain only the entry instruction.

#### Scenario: Include the briefing with two or more targets

- **WHEN** the host sends the entry instruction of a stage that configures two or more targets
- **THEN** the message contains the instruction followed by the transition briefing

#### Scenario: Omit the briefing with one target

- **WHEN** the host sends the entry instruction of a stage that configures exactly one target
- **THEN** the message contains only the entry instruction

#### Scenario: Omit the briefing without configured transitions

- **WHEN** the host sends the entry instruction of a stage that does not configure transitions
- **THEN** the message contains only the entry instruction

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

- **WHEN** the workflow changes between the admission of an instruction and its send
- **THEN** the briefing reflects the targets the stage configures at the moment of sending

#### Scenario: Include the briefing on every send path

- **WHEN** a stage instruction is sent by the card run action, the timed stage instruction after a move, a confirmed transition, or an automatic advance
- **THEN** the message includes the briefing whenever the stage configures two or more targets

## MODIFIED Requirements

### Requirement: YAML workflow configuration

Each board SHALL support its own workflow configuration in YAML, including the initial stage, grouped columns, allowed transitions with an optional condition for each target, optional stage entry instructions, each stage's stored placement, and the board's default presentation. A transition entry SHALL be authored either as a bare target identifier or as a mapping that carries the target identifier and an optional condition. Both forms SHALL be accepted, neither form SHALL be deprecated, both forms SHALL describe the same transition, and a single list MAY mix them. The condition SHALL describe when that transition is followed; it SHALL NOT change which transitions the workflow permits. The active board's workflow SHALL be used for rendering, transitions, and task creation. The product SHALL honor configured transition restrictions by requiring explicit confirmation before a restricted transition can proceed, and it SHALL honor column grouping. This version SHALL NOT implement WIP limits and SHALL NOT introduce reusable workflow templates.

#### Scenario: Render a configured column group

- **WHEN** the active board's workflow groups multiple stages together
- **THEN** the board presents those stages as a group while retaining each stage as a distinct task destination

#### Scenario: Reject a prohibited transition

- **WHEN** a user requests a move that the active board's workflow does not permit from its current stage and does not confirm the override
- **THEN** the task remains in its current stage
- **AND** the prohibited move does not initiate an agent execution

#### Scenario: Restricted transition requires confirmation

- **WHEN** a user requests a move that the active board's workflow does not permit
- **THEN** the board asks for explicit confirmation before moving the task
- **AND** the task remains in its current stage until the user confirms
- **AND** the request does not initiate an agent execution

#### Scenario: Do not enforce a WIP capacity

- **WHEN** a user makes an otherwise permitted move into a stage that already contains tasks
- **THEN** the board does not reject the move because of a WIP capacity limit

#### Scenario: Validate against the active board's workflow

- **WHEN** the user edits the workflow of the active board
- **THEN** the editor validates that board's YAML
- **AND** no other board's workflow is read or replaced

#### Scenario: Reject an unsupported default presentation

- **WHEN** a workflow configuration sets a default presentation other than the column board or the workflow diagram
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Accept a bare transition identifier

- **WHEN** a stage configures a transition as a bare target identifier
- **THEN** the workflow is accepted and the transition is drawn and followed as before

#### Scenario: Accept a transition with a condition

- **WHEN** a stage configures a transition as a mapping with a target identifier and a condition
- **THEN** the workflow is accepted and the condition is kept with that transition

#### Scenario: Accept a mixed transition list

- **WHEN** one stage mixes bare target identifiers and conditioned transitions in the same list
- **THEN** the workflow is accepted and every entry describes one transition

#### Scenario: Reject a transition to an unknown stage

- **WHEN** a stage configures a transition whose target stage does not exist
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Keep the permitted set unchanged by a condition

- **WHEN** a stage configures the same targets with and without conditions
- **THEN** the same requests are permitted and the same requests require confirmation

### Requirement: Automatic advance destination and dispatch

The automatic advance destination SHALL be the stage of the task's recorded transition for its current stage while that transition resolves. Otherwise it SHALL be the first entry of the current stage's configured transitions, or the stage that follows the current stage in workflow order when the stage does not configure transitions. There SHALL be no default destination when the configured list is empty or the resolved stage is the current stage.

When the destination is the recorded transition, the advance SHALL move the task exactly to that stage and SHALL NOT continue resolution beyond it. While the default destination has no entry instruction, resolution SHALL continue from that destination. Resolution SHALL stop at the first stage that has an entry instruction, or at the last reachable stage when no reachable stage has one. A stage already visited during the same resolution SHALL NOT be revisited. The resolved destination and its entry instruction SHALL be captured when the advance is admitted, so a workflow edit after admission SHALL NOT change that advance.

A recorded transition that no longer resolves SHALL NOT be replaced by the default destination. The host SHALL NOT advance the task and SHALL pause auto mode with the `transition-stale` reason defined by Auto mode on a task card.

The task SHALL be placed at the top of the destination stage, before every card that stage already contains. When the destination has an entry instruction, that instruction SHALL be sent to the task's first open conversation, followed by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies; when no conversation is open, a new conversation SHALL be created and used as the target. The submitted message SHALL contain the stage instruction and, when it applies, the briefing. The advance SHALL NOT create more than one conversation beyond that target. The destination entry SHALL remain unresolved until a prompt is sent.

#### Scenario: Use the recorded transition

- **WHEN** the current stage configures multiple permitted transitions, the task recorded one of them, and a completed turn advances the task
- **THEN** the task moves to the stage of the recorded transition

#### Scenario: Stop at the recorded destination

- **WHEN** the recorded transition names a stage without an entry instruction and a later reachable stage has one
- **THEN** the task moves exactly to the recorded stage
- **AND** no later stage is crossed and no instruction is sent

#### Scenario: Pause on a recorded transition that no longer resolves

- **WHEN** a completed turn would advance a task whose recorded transition is no longer a configured target of its current stage
- **THEN** no advance is admitted
- **AND** auto mode is paused with the `transition-stale` reason
- **AND** the task remains in its current stage

#### Scenario: Use the first configured transition

- **WHEN** the current stage configures multiple permitted transitions, no transition is recorded, and a completed turn advances the task
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

- **WHEN** the instruction cannot be sent after the task moved
- **THEN** the task stays in the destination
- **AND** the destination entry remains unresolved
- **AND** the card exposes the stage run action for that entry

### Requirement: Run a stage instruction from a card

When a task's current stage has an entry instruction, its card SHALL expose a run action only while the current entry into that stage is unresolved. The entry SHALL be unresolved when a persisted entry marker exists for the current stage and no successful user prompt has been sent in any open conversation of the task since that entry. The marker SHALL be created on every move into an instructed stage, including a task created directly in an instructed initial stage. A same-stage reorder SHALL NOT reset the marker; leaving and re-entering the stage SHALL create a new marker. A successful user prompt in any open conversation SHALL clear the marker. An admission failure SHALL NOT clear it. A task already in an instructed stage without a marker SHALL NOT show the action until its next entry. While the timed instruction for the entry is counting down or being sent, the card SHALL expose the countdown control defined by the Timed stage instruction after a move requirement instead of the run action; canceling that countdown or a failed timed send SHALL expose the run action for the same unresolved entry. When visible, the action SHALL send the stage's entry instruction to the task's first open conversation in conversation order, followed by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies. When the task has no conversation, activating the action SHALL first present the execution preparation defined by Execution preparation before a task's first execution; when no conversation is open after the preparation, the action SHALL create a new conversation and use that conversation as the target. The action SHALL carry the entry identity it was displayed for — the entry's stage and entry timestamp — and the host SHALL reject a request for an entry that has been resolved or replaced. The action SHALL NOT move the task or change its position, SHALL NOT offer a conversation picker, and SHALL NOT be available in selection mode. It SHALL be unavailable while the task has an unresolved context operation or confirmed transition. The submitted message SHALL contain the stage instruction and, when it applies, the transition briefing; the conversation's first-turn task context supplies the task context. Admission failures SHALL be reported without changing the stage or position and without creating another conversation beyond the resolved target.

#### Scenario: Show the action after a transition

- **WHEN** a card enters a stage with an entry instruction and no prompt has been sent since that entry
- **THEN** the card exposes the countdown control for that entry
- **AND** no instruction is sent before the countdown ends
- **AND** the card exposes the run action if the countdown is canceled or its send fails
- **AND** the task's stage and position are that of the transition

#### Scenario: Restore the action after the countdown ends without sending

- **WHEN** the countdown for an unresolved entry is canceled or its send fails
- **THEN** the card exposes the run action for the same entry
- **AND** the task's stage and position are unchanged

#### Scenario: Countdown replaces the run action

- **WHEN** a move into an instructed stage arms the countdown
- **THEN** the card exposes the countdown control instead of the run action
- **AND** the run action is exposed again only after the countdown is canceled or the send fails

#### Scenario: Hide the action after any prompt

- **WHEN** a successful user prompt is sent in any open conversation of the task while the card remains in the instructed stage
- **THEN** the run action is no longer shown
- **AND** the task's stage and position are unchanged

#### Scenario: Report an admission failure

- **WHEN** the run action is activated and the instruction cannot be admitted
- **THEN** the failure is reported on the board
- **AND** the task's stage and position are unchanged
- **AND** the failed request does not implicitly start another run
- **AND** the run action remains available for the same entry

#### Scenario: Do not reset on same-stage reorder

- **WHEN** the card is reordered within the instructed stage
- **THEN** the entry marker is unchanged
- **AND** the action remains hidden if a prompt was already sent for that entry

#### Scenario: Reset on leaving and re-entering

- **WHEN** the card leaves the instructed stage and later enters it again
- **THEN** a new unresolved entry is created
- **AND** the action is shown again by the new countdown and returns after cancel or failure

#### Scenario: New task in an instructed initial stage

- **WHEN** a task is created directly in an instructed initial stage
- **THEN** the card exposes the run action until a prompt is sent
- **AND** no countdown is armed by the creation
- **AND** the task is not moved by the action

#### Scenario: Existing task without an entry marker

- **WHEN** a task is already in an instructed stage without an entry marker
- **THEN** the card does not expose the run action
- **AND** the action becomes available only after its next entry

#### Scenario: Run an instruction from a card

- **WHEN** the user activates the run action on a card whose stage has an entry instruction and whose first conversation is open
- **THEN** the stage instruction is sent to that first open conversation
- **AND** the task's stage and position are unchanged
- **AND** no conversation picker is presented

#### Scenario: Include the transition briefing

- **WHEN** the user activates the run action on a card whose stage configures two or more targets
- **THEN** the sent message contains the stage instruction followed by the transition briefing

#### Scenario: Prepare the first run from a card

- **WHEN** the user activates the run action on a card whose task has no conversation
- **THEN** the execution preparation is presented before a conversation is created or the instruction is admitted
- **AND** after the preparation the instruction is sent to the conversation created by it
- **AND** the task's stage and position are unchanged

#### Scenario: Run the instruction again

- **WHEN** a stage instruction has already been admitted and the card later re-enters that instructed stage
- **THEN** a new unresolved entry is created
- **AND** the action is available and sends the current stage instruction again to the resolved target

#### Scenario: Run when every conversation is closed

- **WHEN** the user activates the run action and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** the stage instruction is sent to that new conversation
- **AND** the task's stage and position are unchanged

#### Scenario: Reject a changed instruction

- **WHEN** the stage's entry instruction changes after the card action was displayed and the user activates the action
- **THEN** the run is rejected
- **AND** the task, its stage, and its conversations are unchanged
- **AND** the user can review and run the current instruction

#### Scenario: Reject a resolved or replaced entry

- **WHEN** a run request carries an entry identity that has since been resolved or replaced
- **THEN** the request is rejected
- **AND** no instruction is sent
- **AND** the task's stage, position, and conversations are unchanged

#### Scenario: Action unavailable while the task is busy

- **WHEN** the task has an unresolved context operation, a confirmed transition, or selection mode is active
- **THEN** the run action is unavailable
- **AND** no instruction is sent

#### Scenario: No action without an entry instruction

- **WHEN** a card's current stage has no entry instruction
- **THEN** the card does not expose the run action

### Requirement: Auto mode on a task card

A task SHALL have an optional auto-mode setting that is disabled unless the user enables it, is persisted with the task, and is independent of its stage, position, and conversations. The card SHALL present the setting as an always-visible toggle that also indicates its state, SHALL expose its pressed state and purpose to assistive technology, and SHALL NOT open the task drawer or begin a drag when activated. The control SHALL NOT be presented in selection mode.

Enabling auto mode SHALL arm the task and SHALL NOT move it, change its position, or send an instruction; the next completed turn remains the only trigger. Disabling it SHALL stop future automatic advances and SHALL NOT retract an advance that is already admitted. A user movement of the task SHALL preserve the setting. The indicator SHALL distinguish disabled, armed, advancing, held, and paused. A paused state SHALL be explained in the status region defined by Task card status strip. A held state SHALL be presented by the control itself, including its accessible name, and SHALL NOT add a status-region entry, because it is derived from pending user work rather than a recorded cause. Held SHALL mean the task has pending user work as defined by Pending user work, and the state SHALL clear when that work is consumed, SHALL NOT be persisted, and SHALL NOT require a user action. The control SHALL name the stage the next completed turn reaches: the recorded transition's stage while that transition resolves, otherwise the default destination. A recorded transition that no longer resolves SHALL be presented as a pause with the `transition-stale` reason, and reading a conversation SHALL NOT change the setting or clear that pause.

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

#### Scenario: Present the recorded destination

- **WHEN** an armed task has a recorded transition that still resolves
- **THEN** the control names that transition's stage as the destination of the next completed turn

#### Scenario: Present a stale recorded transition

- **WHEN** an armed task has a recorded transition that no longer resolves
- **THEN** the control presents a pause whose label states that the recorded transition is no longer valid
- **AND** the task's stage and position are unchanged

### Requirement: Timed stage instruction after a move

When a permitted move changes a task's stage to a stage with an entry instruction, the system SHALL arm one five-second countdown for that entry. The countdown SHALL be armed for board drops and drawer stage changes. It SHALL NOT be armed for a same-stage reorder, for a task created directly in an instructed initial stage, or for a move into a stage without an entry instruction. When the task has no conversation, the countdown SHALL be armed only after the execution preparation defined by Execution preparation before a task's first execution completes, and the conversation that preparation created SHALL be the target. The target SHALL be the task's first open conversation in conversation order; when no conversation is open, the system SHALL create a new conversation and use it. When the five seconds elapse without cancellation, the system SHALL send that stage's entry instruction to the target, followed by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies. Cancel SHALL stop only the automatic send: the task's stage, position, and unresolved entry SHALL remain, and the card's run action SHALL be available. A new instructed entry for the task SHALL replace the pending countdown for the previous entry. The countdown SHALL be canceled without sending when a successful user prompt resolves the entry, when the task is deleted, or when the entry marker is removed for any other reason. The card SHALL present the countdown as a control that cancels when activated. The drawer for the task SHALL present a matching countdown notice above its section panel with the same cancel action. Both notices SHALL identify the stage whose instruction will run. A countdown SHALL continue when its card is not rendered, when the Kanban panel is not visible, or when the user switches to another board or Hub. The automatic send SHALL NOT depend on the board that armed it being mounted or visible. Unsent composer text or attachments in the target conversation SHALL NOT prevent the send and SHALL remain unchanged. The countdown SHALL NOT be persisted: a reload or plugin restart SHALL send nothing and SHALL leave the entry unresolved with its run action available. A failed timed send SHALL stop the countdown, report the failure on the card and in the drawer notice, restore the run action for the unresolved entry, and SHALL NOT retry automatically. When admission reports that the entry was already resolved, the countdown SHALL end without reporting a failure. The delay SHALL be fixed at five seconds and SHALL NOT be configurable.

#### Scenario: Arm on a board drop
- **WHEN** the user drops a card on a permitted stage with an entry instruction
- **THEN** the card exposes a countdown for that entry
- **AND** no instruction is sent while the countdown is active

#### Scenario: Arm on a drawer stage change
- **WHEN** the user selects a permitted instructed destination from the drawer's stage control
- **THEN** the drawer presents the countdown notice for that entry
- **AND** the card exposes the countdown control for the same entry

#### Scenario: Arm after the first-execution preparation
- **WHEN** a task without a conversation is dropped on a permitted stage with an entry instruction and the execution preparation completes
- **THEN** the countdown for that entry is armed only after the preparation
- **AND** the target is the conversation created by the preparation

#### Scenario: Send only the instruction on expiry
- **WHEN** the five-second countdown ends without cancellation
- **THEN** the stage's entry instruction is sent to the task's first open conversation, followed by the transition briefing when the stage configures two or more targets
- **AND** the unresolved entry is resolved
- **AND** no conversation picker or confirmation is presented

#### Scenario: Include the briefing with the timed send
- **WHEN** the countdown ends for a stage that configures two or more transition targets
- **THEN** the sent message contains the instruction followed by the transition briefing
- **AND** the briefing is derived at the moment of sending

#### Scenario: Create a conversation when none is open
- **WHEN** the countdown ends and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** the stage's entry instruction is sent to that new conversation
- **AND** the task's stage and position are unchanged

#### Scenario: Cancel from the card
- **WHEN** the user activates the card's countdown control before it ends
- **THEN** no instruction is sent
- **AND** the task remains in the destination stage at the same position
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: Cancel from the drawer
- **WHEN** the user activates the cancel action in the drawer's countdown notice
- **THEN** no instruction is sent
- **AND** the countdown disappears on the card and in the drawer
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: Manual prompt cancels the countdown
- **WHEN** a successful user prompt resolves the entry before the countdown ends
- **THEN** the countdown stops without sending the instruction
- **AND** no second instruction is sent

#### Scenario: New instructed entry replaces the countdown
- **WHEN** the task moves again into another instructed stage before the countdown ends
- **THEN** the previous countdown no longer sends
- **AND** a new countdown for the new entry is armed

#### Scenario: No countdown on a same-stage reorder
- **WHEN** the user reorders the card within its current stage
- **THEN** no new countdown is armed
- **AND** an active countdown for the current entry keeps running

#### Scenario: No countdown for task creation
- **WHEN** a task is created directly in an instructed initial stage
- **THEN** no countdown is armed
- **AND** the card exposes the run action for the new entry

#### Scenario: Continue when the card is not visible
- **WHEN** the card is hidden by search, a project filter, selection mode, or another panel before the countdown ends
- **THEN** the countdown keeps running
- **AND** the instruction is sent when the remaining time elapses unless it is canceled

#### Scenario: Continue across board and Hub switches
- **WHEN** the user switches to another board or Hub before the countdown ends
- **THEN** the countdown keeps running
- **AND** the instruction is sent when the remaining time elapses unless it is canceled
- **AND** the unresolved entry is resolved for the task on its own board

#### Scenario: Send while the Kanban panel is hidden
- **WHEN** the countdown ends while the Kanban panel is not visible and its board is not mounted
- **THEN** the stage's entry instruction is sent to the resolved target
- **AND** the unresolved entry is resolved without requiring the board to be reopened

#### Scenario: Unsent draft does not block the send
- **WHEN** the target conversation has unsent composer text or attachments when the countdown ends
- **THEN** the stage instruction is sent anyway
- **AND** the unsent text and attachments remain unchanged

#### Scenario: Failed timed send restores the run action
- **WHEN** the timed instruction cannot be admitted or sent
- **THEN** the countdown stops
- **AND** the failure is reported on the card and in the drawer notice
- **AND** the run action remains available for the unresolved entry
- **AND** no automatic retry occurs

#### Scenario: Changed instruction fails visibly
- **WHEN** the stage's entry instruction changes before the countdown ends
- **THEN** the timed send is rejected
- **AND** the failure is reported on the card and in the drawer notice
- **AND** the run action remains available for the unresolved entry
- **AND** no replacement instruction is sent automatically

#### Scenario: Already resolved at admission ends silently
- **WHEN** admission reports that the entry was resolved before the timed send
- **THEN** the countdown stops without an error notice
- **AND** no instruction is sent

#### Scenario: Reload does not send
- **WHEN** the board reloads or the plugin restarts while a countdown is active
- **THEN** no instruction is sent automatically
- **AND** the entry remains unresolved
- **AND** the card exposes the run action after reload
