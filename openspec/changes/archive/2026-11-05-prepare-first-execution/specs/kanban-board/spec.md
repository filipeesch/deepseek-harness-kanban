# Spec Delta

## ADDED Requirements

### Requirement: Execution preparation before a task's first execution

When a user move into an instructed stage or a card run action would start a task's first execution — the task has no native conversation — the system SHALL present one execution preparation before applying the move or admitting the instruction. The preparation SHALL contain the worktree choice defined by the Worktree choice before a card's first execution requirement in `worktree-management` when that choice applies, and the model selection defined by Model selection for the first conversation in `task-conversations` when DSH's native model selector is available. When the task already has a conversation, or when neither part applies, the system SHALL NOT present the preparation and SHALL follow the current move and run behavior. A restricted-transition confirmation SHALL be presented before the preparation; canceling that confirmation SHALL present nothing else. The preparation SHALL NOT start an agent execution and SHALL NOT change the task's stage or position. Completing the preparation SHALL leave the move or run action to proceed as defined by its own requirement. Canceling the preparation after it created a worktree or the first conversation SHALL keep those resources and SHALL leave the task's stage and position unchanged. The preparation SHALL NOT be presented for a same-stage reorder or by an automatic advance.

#### Scenario: Prepare the first instructed drop

- **WHEN** the user drops a task that has no conversation on a permitted stage with an entry instruction
- **THEN** the board presents the execution preparation before moving the task
- **AND** the task remains in its source stage and position until the preparation completes
- **AND** no agent instruction is sent by the preparation

#### Scenario: Prepare the first run from a card

- **WHEN** the user activates the run action on a card whose task has no conversation
- **THEN** the board presents the execution preparation before creating a conversation or admitting the instruction
- **AND** the task's stage and position are unchanged throughout the preparation

#### Scenario: Present the preparation after a restricted confirmation

- **WHEN** the confirmed destination would start the task's first execution
- **THEN** the restricted-transition confirmation is presented first
- **AND** the preparation is presented only after that confirmation
- **AND** canceling the preparation leaves the task in its current stage and position

#### Scenario: Skip the preparation when the task has a conversation

- **WHEN** a task already has a conversation and the user drops it on an instructed stage or activates its run action
- **THEN** no execution preparation is presented
- **AND** the move or run behavior follows its own requirement

#### Scenario: Skip the preparation when nothing applies

- **WHEN** the task has no conversation but neither a worktree choice nor a model selection applies
- **THEN** no execution preparation is presented
- **AND** the move or run behavior follows its own requirement

#### Scenario: Cancel before any resource exists

- **WHEN** the user cancels the preparation before a worktree or the first conversation has been created
- **THEN** no worktree, branch, or conversation is created
- **AND** the task's stage, position, and conversations are unchanged

#### Scenario: Cancel after provisioning

- **WHEN** the user cancels the preparation after it created a worktree or the first conversation
- **THEN** the created worktree and conversation are kept
- **AND** the task's stage and position are unchanged
- **AND** no agent instruction is sent

## MODIFIED Requirements

### Requirement: Direct stage manipulation on the board

The board SHALL move tasks between workflow stages only through drag and drop. A task card SHALL NOT provide an independent stage selector. A drag SHALL present a distinct dragged representation and a drop indicator. Dropping on a permitted stage SHALL move the task immediately, whether or not that stage has an entry instruction, except when the drop would start the task's first execution: that drop SHALL present the execution preparation defined by Execution preparation before a task's first execution, and the move SHALL follow the preparation. Hovering a restricted stage during a drag SHALL present a distinct warning affordance. Dropping on a restricted stage SHALL require explicit confirmation before moving the task; canceling SHALL leave the task's stage and position unchanged. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement; neither the drop nor a restricted-move confirmation SHALL initiate an execution. Dropping within the current stage SHALL reorder the task relative to its neighbors without arming a new timed instruction. A prohibited or canceled drop SHALL leave the task unchanged. The board SHALL offer worktree creation during a drop only through that execution preparation. The host's automatic advance, defined by Automatic advance after a completed turn, SHALL NOT be presented as board stage manipulation, SHALL NOT add a card stage selector, and SHALL NOT require a confirmation.

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

- **WHEN** the user drops a task that already has a conversation on a permitted stage that has an entry instruction
- **THEN** the task moves to that stage immediately
- **AND** the drop does not initiate an agent execution
- **AND** a five-second countdown for that entry is armed
- **AND** the card exposes the countdown control

#### Scenario: Prepare the first instructed drop

- **WHEN** the user drops a task that has no conversation on a permitted stage that has an entry instruction
- **THEN** the board presents the execution preparation before moving the task
- **AND** the task remains in its source stage and position until the preparation completes
- **AND** after the preparation the task moves and the countdown for that entry is armed

#### Scenario: Warn while hovering a restricted stage

- **WHEN** the user drags a task over a stage that the workflow does not permit from its current stage
- **THEN** the board presents a distinct warning affordance before the drop
- **AND** the task remains in its current stage until a drop is confirmed

#### Scenario: Restricted drop asks for confirmation

- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage
- **THEN** the board asks for explicit confirmation before moving the task
- **AND** the task remains in its current stage until the user confirms

#### Scenario: Confirm a restricted drop

- **WHEN** the user confirms the restricted-drop confirmation for a task that already has a conversation
- **THEN** the task appears in the destination stage at the dropped position
- **AND** the move does not initiate an agent execution
- **AND** if the destination has an entry instruction, its timed instruction is armed

#### Scenario: Prohibited drop

- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage and cancels the confirmation
- **THEN** the task remains in its current stage and its position is unchanged

#### Scenario: Drop without a worktree

- **WHEN** the user drops a task that has no worktree and no conversation on a permitted instructed stage
- **THEN** the execution preparation asks whether to create a worktree
- **AND** the task remains in its current stage and position until the preparation completes

#### Scenario: Advance without board manipulation

- **WHEN** an automatic advance moves a task
- **THEN** the card does not present a stage selector
- **AND** no confirmation or drop indicator is shown

### Requirement: Run a stage instruction from a card

When a task's current stage has an entry instruction, its card SHALL expose a run action only while the current entry into that stage is unresolved. The entry SHALL be unresolved when a persisted entry marker exists for the current stage and no successful user prompt has been sent in any open conversation of the task since that entry. The marker SHALL be created on every move into an instructed stage, including a task created directly in an instructed initial stage. A same-stage reorder SHALL NOT reset the marker; leaving and re-entering the stage SHALL create a new marker. A successful user prompt in any open conversation SHALL clear the marker. An admission failure SHALL NOT clear it. A task already in an instructed stage without a marker SHALL NOT show the action until its next entry. While the timed instruction for the entry is counting down or being sent, the card SHALL expose the countdown control defined by the Timed stage instruction after a move requirement instead of the run action; canceling that countdown or a failed timed send SHALL expose the run action for the same unresolved entry. When visible, the action SHALL send the stage's entry instruction verbatim to the task's first open conversation in conversation order. When the task has no conversation, activating the action SHALL first present the execution preparation defined by Execution preparation before a task's first execution; when no conversation is open after the preparation, the action SHALL create a new conversation and use that conversation as the target. The action SHALL carry the entry identity it was displayed for — the entry's stage and entry timestamp — and the host SHALL reject a request for an entry that has been resolved or replaced. The action SHALL NOT move the task or change its position, SHALL NOT offer a conversation picker, and SHALL NOT be available in selection mode. It SHALL be unavailable while the task has an unresolved context operation or confirmed transition. The submitted message SHALL contain only the stage instruction; the conversation's first-turn task context supplies the task context. Admission failures SHALL be reported without changing the stage or position and without creating another conversation beyond the resolved target.

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

### Requirement: Timed stage instruction after a move

When a permitted move changes a task's stage to a stage with an entry instruction, the system SHALL arm one five-second countdown for that entry. The countdown SHALL be armed for board drops and drawer stage changes. It SHALL NOT be armed for a same-stage reorder, for a task created directly in an instructed initial stage, or for a move into a stage without an entry instruction. When the task has no conversation, the countdown SHALL be armed only after the execution preparation defined by Execution preparation before a task's first execution completes, and the conversation that preparation created SHALL be the target. The target SHALL be the task's first open conversation in conversation order; when no conversation is open, the system SHALL create a new conversation and use it. When the five seconds elapse without cancellation, the system SHALL send only that stage's entry instruction to the target. Cancel SHALL stop only the automatic send: the task's stage, position, and unresolved entry SHALL remain, and the card's run action SHALL be available. A new instructed entry for the task SHALL replace the pending countdown for the previous entry. The countdown SHALL be canceled without sending when a successful user prompt resolves the entry, when the task is deleted, or when the entry marker is removed for any other reason. The card SHALL present the countdown as a control that cancels when activated. The drawer for the task SHALL present a matching countdown notice above its section panel with the same cancel action. Both notices SHALL identify the stage whose instruction will run. A countdown SHALL continue when its card is not rendered, when the Kanban panel is not visible, or when the user switches to another board or Hub. The automatic send SHALL NOT depend on the board that armed it being mounted or visible. Unsent composer text or attachments in the target conversation SHALL NOT prevent the send and SHALL remain unchanged. The countdown SHALL NOT be persisted: a reload or plugin restart SHALL send nothing and SHALL leave the entry unresolved with its run action available. A failed timed send SHALL stop the countdown, report the failure on the card and in the drawer notice, restore the run action for the unresolved entry, and SHALL NOT retry automatically. When admission reports that the entry was already resolved, the countdown SHALL end without reporting a failure. The delay SHALL be fixed at five seconds and SHALL NOT be configurable.

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
- **THEN** only the stage's entry instruction is sent to the task's first open conversation
- **AND** the unresolved entry is resolved
- **AND** no conversation picker or confirmation is presented

#### Scenario: Create a conversation when none is open

- **WHEN** the countdown ends and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** only the stage's entry instruction is sent to that new conversation
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
- **THEN** only the stage's entry instruction is sent to the resolved target
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

### Requirement: Explicit confirmation for a restricted transition

When a user requests a transition that the active board's workflow does not permit, the system SHALL require explicit confirmation before moving the task. The confirmation SHALL identify the task, the source stage, and the destination stage, and SHALL state that the override affects only that card and does not change that board's workflow configuration. Cancel SHALL receive the initial action focus. Canceling SHALL leave the task's stage and position unchanged and SHALL NOT send an agent instruction. Confirming SHALL move the task and SHALL NOT modify the workflow configuration or initiate an agent execution. When the confirmed destination would start the task's first execution, the execution preparation defined by Execution preparation before a task's first execution SHALL be presented after the confirmation and before the move; canceling that preparation SHALL leave the task in its current stage and position. If the confirmed move fails, the confirmation SHALL remain the active context, present the failure, and offer a retry that revalidates the task and the active board's workflow; it SHALL NOT present the task as moved. When the task or destination no longer matches the confirmed context, the system SHALL report the failure without offering a retry that cannot succeed.

#### Scenario: Confirm a restricted transition

- **WHEN** the user confirms a restricted transition for a task that already has a conversation
- **THEN** the task moves to the destination stage
- **AND** the board's workflow configuration is unchanged
- **AND** the move does not initiate an agent execution

#### Scenario: Prepare after a restricted confirmation

- **WHEN** the confirmed destination would start the task's first execution
- **THEN** the confirmation is accepted first
- **AND** the execution preparation is presented before the move
- **AND** canceling the preparation leaves the task in its current stage and position

#### Scenario: Cancel a restricted transition

- **WHEN** the user cancels a restricted transition
- **THEN** the task remains in its current stage and position
- **AND** no agent instruction is sent

#### Scenario: Identify the override consequence

- **WHEN** the confirmation is presented
- **THEN** it identifies the task, the source stage, and the destination stage
- **AND** it states that only the card is affected and the workflow is not changed
- **AND** Cancel receives the initial action focus

#### Scenario: Failure remains in the confirmation context

- **WHEN** a confirmed restricted move is rejected
- **THEN** the confirmation remains the active context and presents the failure
- **AND** it offers a retry that revalidates the current task and workflow
- **AND** it does not present the task as moved

#### Scenario: Retry revalidates the confirmed context

- **WHEN** the user retries a rejected restricted move after the blocking condition is resolved
- **THEN** the retry re-reads the current task and workflow before sending the move
- **AND** the move proceeds only when the confirmed source and destination still apply

#### Scenario: Stale context does not offer a pointless retry

- **WHEN** the task has left the confirmed source stage or the destination stage no longer exists
- **THEN** the confirmation reports the changed context
- **AND** it does not offer a retry that cannot succeed
