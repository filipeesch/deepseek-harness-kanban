# Spec Delta

## MODIFIED Requirements

### Requirement: Execution preparation before a task's first execution

When a user move into an instructed stage or a card run action would start a task's first execution — the task has no native conversation — the system SHALL present one execution preparation before that execution starts. The preparation SHALL contain only the worktree choice defined by the Worktree choice before a card's first execution requirement in `worktree-management` when that choice applies, and it SHALL NOT present a model selection step. The worktree question SHALL be answered before the move is applied, and answering it SHALL close the preparation immediately. The remaining preparation — admitting the worktree creation as a background context operation and creating the task's first conversation once that worktree is ready — SHALL continue after the move or run action is applied, SHALL NOT hold the card, and SHALL NOT start an agent execution by itself. When the task already has a conversation, or when no worktree choice applies, the system SHALL NOT present the preparation and SHALL follow the move and run behavior defined by their own requirements. A restricted-transition confirmation SHALL be presented before the preparation; canceling that confirmation SHALL present nothing else. The preparation SHALL NOT change the task's stage or position by itself. Canceling the preparation SHALL leave the task's stage and position unchanged and SHALL NOT create a worktree, a branch, or a conversation. A preparation that fails after the move SHALL keep the move and the unresolved entry, SHALL report the failure in the card status region, SHALL report a failure the host recorded in the drawer operation status and the Git section, and SHALL NOT create the first conversation. The preparation SHALL NOT be presented for a same-stage reorder or by an automatic advance. A worktree binding in the preparing or error state SHALL block the first execution as defined by `worktree-management`.

The first execution described here SHALL mean execution of an agent stage instruction, not a scripted script. A scripted stage's Play action and a move into a scripted stage SHALL NOT create a native conversation or present a model selector through this preparation. Its working directory SHALL follow the task-or-project selection defined by `scripted-steps`.

#### Scenario: Prepare the first instructed drop

- **WHEN** the user drops a task that has no conversation on a permitted stage with an entry instruction
- **THEN** the board presents the worktree question before moving the task
- **AND** the task remains in its source stage and position while that question is open
- **AND** answering it moves the task to the dropped position
- **AND** no agent instruction is sent by the preparation

#### Scenario: Prepare the first run from a card

- **WHEN** the user activates the run action on a card whose task has no conversation
- **THEN** the board presents the worktree question before creating a conversation or admitting the instruction
- **AND** the task's stage and position are unchanged while that question is open
- **AND** answering it proceeds with the run, which creates the worktree in the background and then the first conversation

#### Scenario: Present the preparation after a restricted confirmation

- **WHEN** the confirmed destination would start the task's first execution
- **THEN** the restricted-transition confirmation is presented first
- **AND** the worktree question is presented only after that confirmation
- **AND** canceling the preparation leaves the task in its current stage and position

#### Scenario: Skip the preparation when the task has a conversation

- **WHEN** a task already has a conversation and the user drops it on an instructed stage or activates its run action
- **THEN** no execution preparation is presented
- **AND** the move or run behavior follows its own requirement

#### Scenario: Skip the preparation when nothing applies

- **WHEN** the task has no conversation but no worktree choice applies, because it already has a ready worktree, recorded a base-project choice, belongs to a folder project, or its project never creates worktrees
- **THEN** no execution preparation is presented
- **AND** the move or run behavior follows its own requirement

#### Scenario: Prepare the worktree choice without a model step

- **WHEN** the task has no conversation and no worktree, and the board names no default model
- **THEN** the preparation presents the worktree question only
- **AND** no native model selector is presented before the first execution
- **AND** the first conversation uses the board's default model when the board names an available one and the deployment default otherwise

#### Scenario: No provisioning before the answer

- **WHEN** the worktree question is open
- **THEN** no worktree, branch, conversation, or Git command is started by the preparation

#### Scenario: Cancel before any resource exists

- **WHEN** the user cancels the preparation while the worktree question is open
- **THEN** no worktree, branch, or conversation is created
- **AND** the task's stage, position, and conversations are unchanged
- **AND** no agent instruction is sent

#### Scenario: Cancel after provisioning

- **WHEN** the user tries to cancel the preparation after the worktree question was answered
- **THEN** the preparation is already closed and cannot be cancelled
- **AND** the background worktree creation continues
- **AND** a running checkout can be cancelled from the operation status defined by Visible operation status and recovery in `task-conversations`

#### Scenario: Continue in the background after the move

- **WHEN** the user answers the worktree question and the task moves
- **THEN** the card presents a preparing state while the worktree is admitted and created
- **AND** the first conversation is created once the worktree is ready
- **AND** the timed stage instruction is armed only after that conversation exists

#### Scenario: Failure after the move is reported on the card

- **WHEN** the background worktree creation or the first conversation fails after the task moved
- **THEN** the task remains in the destination stage with the unresolved entry
- **AND** the failure is reported in the card status region
- **AND** a failure the host recorded is also reported in the drawer operation status and the Git section
- **AND** the run action remains unavailable while a recorded operation is unresolved

#### Scenario: Reload during the background preparation

- **WHEN** the panel reloads or the plugin restarts after the worktree creation was admitted and before the first conversation exists
- **THEN** the worktree creation finishes on the host
- **AND** no first conversation is created
- **AND** no instruction is sent
- **AND** the entry remains unresolved with the run action available

#### Scenario: Do not prepare a conversation for script execution

- **WHEN** a task with no conversation enters a scripted stage or uses its Play action
- **THEN** this agent execution preparation is not presented
- **AND** the absence of a conversation does not by itself prevent authorized scripted execution

### Requirement: Automatic first execution on task creation

The system SHALL prepare a task's first execution immediately after its creation when the active board's initial stage has an entry instruction and the creation kept the Start execution now option enabled. The preparation SHALL present no dialog, SHALL NOT ask the worktree choice, and SHALL NOT present a native model selector. For a Git-backed project, the preparation SHALL admit the task's default worktree, derived from its title-derived defaults, as a background context operation on the host, and SHALL wait until that worktree is ready. For a folder project, the task SHALL use its project directory. The preparation SHALL then create the task's first conversation and SHALL arm the five-second countdown defined by Timed stage instruction after a move for the created entry; expiry SHALL send the stage instruction through the same admission as a user run action. The worktree creation SHALL NOT depend on the creating board remaining mounted; the first conversation and the countdown SHALL belong to the board that started the creation, SHALL be abandoned when it unmounts or the plugin restarts, and SHALL leave the created worktree in place. While the preparation runs, the card and the drawer SHALL present a preparing state, and the card's run action SHALL NOT be available. Canceling the countdown SHALL keep the created worktree and conversation, SHALL leave the unresolved entry, and SHALL expose the card's run action. A failed preparation or send SHALL keep the card and the unresolved entry, SHALL report the failure on the card and in the drawer, SHALL expose the run action once the recorded operation is resolved, and SHALL NOT retry automatically. The countdown SHALL NOT be persisted: a reload or plugin restart before the send SHALL send nothing and SHALL leave the entry unresolved. The agent tool surface SHALL prepare and dispatch the first execution in the same call as defined by the product-tools specification, sharing the same background worktree admission and waiting for it.

This preparation SHALL apply only to an agent entry instruction. A scripted initial entry SHALL follow `scripted-steps` instead and SHALL NOT acquire the default worktree, conversation, model selection, or five-second countdown described here merely because it executes code.

#### Scenario: Prepare and arm after creation

- **WHEN** a task is created in an instructed initial stage with Start execution now enabled and the task has no conversation
- **THEN** the preparation creates the default worktree for a Git-backed project or uses the project directory for a folder project
- **AND** the first conversation is created after the worktree is ready
- **AND** the five-second countdown is armed for the created entry
- **AND** no preparation dialog and no native model selector are presented

#### Scenario: Use the repository-sibling worktree default

- **WHEN** no worktree base path is configured and the created task's project is Git-backed
- **THEN** the preparation creates the worktree at the repository-sibling default defined by `worktree-management`
- **AND** the first conversation uses that worktree directory

#### Scenario: Present the preparing state

- **WHEN** the automatic first-execution preparation is running for a created task
- **THEN** the card and the drawer present a preparing state
- **AND** the card's run action is unavailable
- **AND** no instruction is sent before the countdown is armed

#### Scenario: Cancel the countdown

- **WHEN** the user cancels the countdown armed after the creation preparation
- **THEN** no instruction is sent
- **AND** the created worktree and conversation remain
- **AND** the entry remains unresolved and the card exposes the run action

#### Scenario: Failed preparation keeps the card

- **WHEN** the worktree or the first conversation cannot be prepared during creation
- **THEN** the card and the unresolved entry remain in the initial stage
- **AND** the failure is reported on the card
- **AND** a failure the host recorded is also reported in the drawer
- **AND** the card exposes the run action once the recorded operation is resolved
- **AND** no automatic retry occurs

#### Scenario: Failed timed send keeps the card

- **WHEN** the timed send after the creation preparation fails
- **THEN** the card and the unresolved entry remain in the initial stage
- **AND** the failure is reported on the card and in the drawer
- **AND** the card exposes the run action
- **AND** no automatic retry occurs

#### Scenario: Reload before the send

- **WHEN** the board reloads or the plugin restarts during the preparation or the countdown
- **THEN** no instruction is sent automatically
- **AND** the entry remains unresolved
- **AND** the worktree creation already admitted finishes on the host
- **AND** no first conversation is created once the creating board is gone
- **AND** the card exposes the run action after reload

#### Scenario: Do not prepare without the start option

- **WHEN** a task is created in an instructed initial stage with Start execution now disabled
- **THEN** no worktree, first conversation, preparation, or countdown is created
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: Do not apply agent creation preparation to a scripted entry

- **WHEN** a task is created directly in a scripted initial stage
- **THEN** this agent first-execution preparation is not performed
- **AND** scripted execution is governed by its own authorization and execution contract

### Requirement: Direct stage manipulation on the board

The task card SHALL NOT provide an independent stage selector. A user SHALL change a task's stage through board drag and drop or through the stage control in the open task drawer. A stage change that requests no position, including a drawer stage change and a confirmed restricted drawer change, SHALL place the task at the top of the destination stage. A drag SHALL present a distinct dragged representation and a drop indicator, and a drop SHALL place the task at the dropped position, including before a chosen card and after the last card of the destination stage. Dropping on a permitted stage SHALL move the task immediately, whether or not that stage has an entry instruction, except when the drop would start the task's first execution: that drop SHALL present the worktree choice defined by Execution preparation before a task's first execution, the move SHALL follow that answer, and the remaining preparation SHALL continue after the move without holding the card. Hovering a restricted stage during a drag SHALL present a distinct warning affordance. Dropping on a restricted stage SHALL require explicit confirmation before moving the task; canceling SHALL leave the task's stage and position unchanged. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement; neither the drop, the drawer stage change, nor a restricted-move confirmation SHALL initiate an agent execution at the time of the move. Dropping within the current stage SHALL reorder the task relative to its neighbors without arming a new timed instruction. A prohibited or canceled change SHALL leave the task unchanged. The board SHALL offer worktree creation during a drop only through that execution preparation. The host's automatic advance, defined by Automatic advance after a completed turn, SHALL NOT be presented as board stage manipulation, SHALL NOT add a card stage selector, and SHALL NOT require a confirmation.

An accepted stage change SHALL durably revoke the scripted execution that owns the previous entry and record any new scripted activation intent in the same operation that places the task into its new entry, before requesting cancellation or reading files, capturing code, resolving credentials, or asking for trust. The previous run SHALL be canceled and its late results invalidated before that execution can move the task again. A refused or canceled move SHALL NOT stop it. Entering a scripted destination SHALL admit its new scripted entry, subject to local trust, regardless of Auto mode and without the agent countdown or conversation preparation. A same-stage reorder SHALL preserve the current scripted entry and SHALL NOT restart its program. The configured destination rules and explicit confirmation for a restricted user move SHALL remain in force.

#### Scenario: Move to an uninstructed stage by drag and drop
- **WHEN** the user drops a task on a permitted stage that has no entry instruction
- **THEN** the task appears in that stage immediately
- **AND** the task appears at the dropped position
- **AND** the move does not initiate an agent execution
- **AND** no timed instruction is armed

#### Scenario: Change the stage from the drawer
- **WHEN** the user selects a permitted destination in the open task drawer's stage control
- **THEN** the task appears at the top of the destination stage immediately
- **AND** the task is placed before every card that stage already contained
- **AND** the board presents the new position without a board drag
- **AND** the change does not initiate an agent execution

#### Scenario: Confirm a restricted drawer change
- **WHEN** the user confirms the restricted-transition confirmation for a destination selected in the open task drawer
- **THEN** the task appears at the top of the destination stage
- **AND** the change does not initiate an agent execution

#### Scenario: Reorder within the current stage
- **WHEN** the user drops a task at a new position within its current stage
- **THEN** the task is placed at that position and the new order is retained
- **AND** no new timed instruction is armed
- **AND** a countdown already active for the current entry remains active

#### Scenario: Drop on an instructed stage
- **WHEN** the user drops a task that already has a conversation on a permitted stage that has an entry instruction
- **THEN** the task moves to that stage immediately
- **AND** the task appears at the dropped position
- **AND** the drop does not initiate an agent execution
- **AND** a five-second countdown for that entry is armed
- **AND** the card exposes the countdown control

#### Scenario: Prepare the first instructed drop
- **WHEN** the user drops a task that has no conversation on a permitted stage that has an entry instruction
- **THEN** the board presents the worktree question before moving the task
- **AND** the task remains in its source stage and position while that question is open
- **AND** after the answer the task moves to the dropped position
- **AND** the countdown for that entry is armed once its first conversation exists

#### Scenario: Prepare the first instructed drawer change
- **WHEN** the user selects a permitted instructed destination in the drawer's stage control for a task that has no conversation
- **THEN** the board presents the worktree question before moving the task
- **AND** the task remains in its source stage and position while that question is open
- **AND** after the answer the task moves to the top of the destination stage
- **AND** the countdown for that entry is armed once its first conversation exists

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
- **AND** the task remains in its current stage and position while the question is open
- **AND** after the answer the task moves and the worktree is created in the background

#### Scenario: Advance without board manipulation
- **WHEN** an automatic advance moves a task
- **THEN** the card does not present a stage selector
- **AND** no confirmation or drop indicator is shown

#### Scenario: Move away from an active scripted entry

- **WHEN** a permitted or explicitly confirmed user move changes the stage of a task whose scripted script is running
- **THEN** the task moves through the normal placement pipeline
- **AND** the previous program and its linked Bash work are canceled
- **AND** a late result from that execution cannot move the task or deliver a handoff

#### Scenario: Recover a placed entry before script capture

- **WHEN** the host crashes after accepting a move into a scripted stage but before reading its external script
- **THEN** the stored placement and the activation intent describe the same destination entry
- **AND** startup continues capture and authorization for that entry without fabricating a second move
- **AND** the revoked source run cannot act on the new entry

### Requirement: Task card status strip

The board SHALL present a card's unresolved context operation, confirmed transition, and automatic-advance state in one status region below the activity region. Each status SHALL carry a tone that distinguishes a failure from a pending state and SHALL present a short label that names the state. A destructive operation's label SHALL use task-deletion or worktree-removal language and SHALL distinguish checking, queued, in progress, and failed states rather than exposing a raw phase token. A background worktree creation's label SHALL name the step it is in — admitting the worktree, creating the checkout, preparing the first conversation, or needing attention — and SHALL NOT expose a raw operation phase. A status SHALL remain visible while its operation or transition is unresolved. The automatic-advance status SHALL name the destination stage while an advance is admitted, name a failure when an admitted advance failed, and name the pause reason when auto mode is paused, distinguishing a pause requested by the agent from a diagnostic pause. The status region SHALL NOT report the held state defined by Auto mode on a task card, which the auto-mode control presents instead. A run-action admission failure SHALL be reported in the same status region. A failure of the automatic first-execution preparation on task creation SHALL be reported in the same status region. When a card has more than one such fact, the status region SHALL present them together without replacing one with another.

A pause requested by the agent SHALL present the reason the agent recorded, and a diagnostic pause recorded for the same task SHALL remain presented beside it, so a turn that failed while the task was paused is not hidden by the pause.

The same status region SHALL present scripted execution state defined by `scripted-steps`, including awaiting approval, running, stopped, and a recoverable execution or handoff failure. Awaiting approval SHALL be presented as a pending status whose label states that the executable version needs approval, and SHALL NOT be presented as an executor failure, an agent turn, or an Auto mode pause. Stopped SHALL NOT be reported as an executor error or an Auto mode pause. These states SHALL coexist with applicable operation, transition, and conversation-derived facts without replacing them, and SHALL NOT disappear merely because a conversation was read.

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

#### Scenario: Report a background worktree creation
- **WHEN** a card's task has a worktree creation admitted or running in the background
- **THEN** the status region presents a pending-toned status naming the creation step in progress
- **AND** it does not present the raw operation phase or the phase token for Git as the label

#### Scenario: Report a failed background creation
- **WHEN** a card's task has a worktree creation that failed
- **THEN** the status region presents a failure-toned status naming the creation as needing attention
- **AND** the task's stage and position are unchanged

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
- **AND** the card exposes the run action for the unresolved entry once the recorded operation is resolved

#### Scenario: Clear a resolved status
- **WHEN** the operation, confirmed transition, or automatic-advance state resolves
- **THEN** the corresponding status is no longer presented in the status region
- **AND** reading a conversation does not clear an automatic-advance pause by itself

#### Scenario: Report a stopped or failed script separately from Auto mode

- **WHEN** a scripted execution is stopped or fails without a configured error route
- **THEN** the status region identifies the scripted state and its available recovery
- **AND** it does not fabricate an Auto mode pause or a failed conversation turn
- **AND** the applicable Play action remains available without requiring a stage change

#### Scenario: Report a pending executable approval

- **WHEN** a task's current scripted entry awaits approval
- **THEN** the status region presents a pending status stating that the executable version needs approval
- **AND** it does not present the approval as a failure, an agent turn, or an Auto mode pause

### Requirement: Run a stage instruction from a card

When a task's current stage has an entry instruction, its card SHALL expose a run action only while the current entry into that stage is unresolved. The entry SHALL be unresolved when a persisted entry marker exists for the current stage and no successful user prompt has been sent in any open conversation of the task since that entry. The marker SHALL be created on every move into an instructed stage, including a task created directly in an instructed initial stage. A same-stage reorder SHALL NOT reset the marker; leaving and re-entering the stage SHALL create a new marker. A successful user prompt in any open conversation SHALL clear the marker, and a successful stage-instruction delivery for that entry SHALL clear it as well. An admission failure SHALL NOT clear it. A task already in an instructed stage without a marker SHALL NOT show the action until its next entry. While the timed instruction for the entry is counting down or being sent, the card SHALL expose the countdown control defined by the Timed stage instruction after a move requirement instead of the run action; canceling that countdown or a failed timed send SHALL expose the run action for the same unresolved entry. When visible, the action SHALL deliver the stage's entry instruction to the task's first open conversation in conversation order as the stage-instruction context message defined by Stage instruction delivery as context in `task-conversations`, followed by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies. When the task has no conversation, activating the action SHALL first present the worktree choice defined by Execution preparation before a task's first execution; answering it SHALL start the run, which SHALL admit the worktree creation in the background, create a conversation once the worktree is ready, and admit the instruction to that conversation. When no conversation is open after that preparation, the action SHALL create a new conversation and use that conversation as the target. The action SHALL carry the entry identity it was displayed for — the entry's stage and entry timestamp — and the host SHALL reject a request for an entry that has been resolved or replaced. The action SHALL NOT move the task or change its position, SHALL NOT offer a conversation picker, and SHALL NOT be available in selection mode. It SHALL be unavailable while the task has an unresolved context operation or confirmed transition. The delivered context message SHALL contain the stage instruction and, when it applies, the transition briefing; the conversation's first-turn task context supplies the task context. Admission failures SHALL be reported without changing the stage or position and without creating another conversation beyond the resolved target.

This action and its unresolved-instruction marker SHALL remain specific to agent entry instructions. An entry owned by durable scripted activation or control state SHALL instead expose its own applicable Stop and Play controls, whose availability SHALL NOT be cleared by an ordinary conversation prompt or by a later saved change to the stage mode. While that scripted ownership remains, a newly saved agent instruction SHALL NOT expose an agent stage-run action or countdown for that entry. Play SHALL be available only when the latest saved configuration is valid scripted configuration; otherwise the interface SHALL explain that scripted configuration or a new stage entry is required and SHALL NOT silently start an agent or manual-mode execution. A pending scripted handoff SHALL be included as its own identified block in an agent instruction delivery as defined by `task-conversations`; it SHALL NOT replace the instruction or be recast as an agent-declared transition reason.

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

- **WHEN** a task is created directly in an instructed initial stage with Start execution now disabled
- **THEN** the card exposes the run action until a prompt is sent
- **AND** no countdown is armed by the creation
- **AND** the task is not moved by the action

#### Scenario: Existing task without an entry marker

- **WHEN** a task is already in an instructed stage without an entry marker
- **THEN** the card does not expose the run action
- **AND** the action becomes available only after its next entry

#### Scenario: Run an instruction from a card

- **WHEN** the user activates the run action on a card whose stage has an entry instruction and whose first conversation is open
- **THEN** the stage instruction is delivered to that first open conversation as a stage-instruction context message
- **AND** no user message records the instruction
- **AND** the task's stage and position are unchanged
- **AND** no conversation picker is presented

#### Scenario: Include the transition briefing

- **WHEN** the user activates the run action on a card whose stage configures two or more targets
- **THEN** the delivered context message contains the stage instruction followed by the transition briefing

#### Scenario: Prepare the first run from a card

- **WHEN** the user activates the run action on a card whose task has no conversation
- **THEN** the worktree question is presented before a conversation is created or the instruction is admitted
- **AND** while the worktree is created the card presents a preparing state
- **AND** after the answer the instruction is delivered to the conversation created once the worktree is ready
- **AND** the task's stage and position are unchanged

#### Scenario: Run the instruction again

- **WHEN** a stage instruction has already been admitted and the card later re-enters that instructed stage
- **THEN** a new unresolved entry is created
- **AND** the action is available and sends the current stage instruction again to the resolved target

#### Scenario: Run when every conversation is closed

- **WHEN** the user activates the run action and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** the stage instruction is delivered to that new conversation
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

#### Scenario: Do not consume scripted Play with a conversation prompt

- **WHEN** an ordinary conversation prompt is sent while the task remains in a scripted stage
- **THEN** it does not resolve, stop, restart, or hide that stage's scripted controls
- **AND** the agent instruction marker does not govern the scripted execution

### Requirement: Timed stage instruction after a move

When a permitted move changes a task's stage to a stage with an entry instruction, or a task created directly in an instructed initial stage completes the automatic first-execution preparation defined by Automatic first execution on task creation, the system SHALL arm one five-second countdown for that entry. The countdown SHALL be armed for board drops, drawer stage changes, and the automatic creation preparation. It SHALL NOT be armed for a same-stage reorder, for a creation whose Start execution now option is disabled, or for a move into a stage without an entry instruction. When the task has no conversation, the countdown SHALL be armed only after the first conversation exists, which for a task that needed a worktree SHALL be after the background worktree creation is ready; the countdown SHALL NOT be armed from a conversation that does not exist yet. The target SHALL be the task's first open conversation in conversation order; when no conversation is open, the system SHALL create a new conversation and use it. When the five seconds elapse without cancellation, the system SHALL deliver that stage's entry instruction to the target as the stage-instruction context message defined by Stage instruction delivery as context in `task-conversations`, followed by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies. Cancel SHALL stop only the automatic send: the task's stage, position, and unresolved entry SHALL remain, and the card's run action SHALL be available. A new instructed entry for the task SHALL replace the pending countdown for the previous entry. The countdown SHALL be canceled without sending when a successful user prompt resolves the entry, when the task is deleted, or when the entry marker is removed for any other reason. The card SHALL present the countdown as a control that cancels when activated. The drawer for the task SHALL present a matching countdown notice above its section panel with the same cancel action. Both notices SHALL identify the stage whose instruction will run. A countdown SHALL continue when its card is not rendered, when the Kanban panel is not visible, or when the user switches to another board or Hub. The automatic send SHALL NOT depend on the board that armed it being mounted or visible. Unsent composer text or attachments in the target conversation SHALL NOT prevent the send and SHALL remain unchanged. The countdown SHALL NOT be persisted: a reload or plugin restart SHALL send nothing and SHALL leave the entry unresolved with its run action available. A failed timed delivery SHALL stop the countdown, report the failure on the card and in the drawer notice, restore the run action for the unresolved entry, and SHALL NOT retry automatically. When admission reports that the entry was already resolved, the countdown SHALL end without reporting a failure. The delay SHALL be fixed at five seconds and SHALL NOT be configurable.

This countdown SHALL remain specific to agent entry instructions and SHALL NOT schedule scripted polling or delay a scripted entry. When an agent entry has a pending scripted handoff, its message SHALL include that identified handoff block in the order defined by `task-conversations`, in addition to the instruction and applicable briefing. The countdown's non-durable reload behavior SHALL NOT stop or redefine the separate durable recovery of scripted programs.

#### Scenario: Arm on a board drop
- **WHEN** the user drops a card on a permitted stage with an entry instruction
- **THEN** the card exposes a countdown for that entry
- **AND** no instruction is sent while the countdown is active

#### Scenario: Arm on a drawer stage change
- **WHEN** the user selects a permitted instructed destination from the drawer's stage control
- **THEN** the drawer presents the countdown notice for that entry
- **AND** the card exposes the countdown control for the same entry

#### Scenario: Arm after the first-execution preparation
- **WHEN** a task without a conversation is dropped on a permitted stage with an entry instruction and the worktree question has been answered
- **THEN** the countdown for that entry is armed only after that task's first conversation exists
- **AND** the target is the conversation created once the background worktree creation is ready
- **AND** the card presents a preparing state while the worktree and that conversation are pending

#### Scenario: Arm after the creation preparation
- **WHEN** a task is created directly in an instructed initial stage with Start execution now enabled and the automatic first-execution preparation completes
- **THEN** the countdown for the created entry is armed
- **AND** the target is the conversation the preparation created
- **AND** no instruction is sent while the countdown is active

#### Scenario: No countdown for task creation
- **WHEN** a task is created directly in an instructed initial stage with Start execution now disabled
- **THEN** no countdown is armed
- **AND** the card exposes the run action for the new entry

#### Scenario: Send only the instruction on expiry
- **WHEN** the five-second countdown ends without cancellation
- **THEN** the stage's entry instruction and any pending scripted handoff are delivered to the task's first open conversation as a stage-instruction context message, followed by the transition briefing when the stage configures two or more targets
- **AND** the unresolved entry is resolved
- **AND** no conversation picker or confirmation is presented

#### Scenario: Include the briefing with the timed send
- **WHEN** the countdown ends for a stage that configures two or more transition targets
- **THEN** the delivered context message contains the instruction followed by the transition briefing
- **AND** the briefing is derived at the moment of sending

#### Scenario: Create a conversation when none is open
- **WHEN** the countdown ends and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** the stage's entry instruction and any pending scripted handoff are delivered to that new conversation
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

#### Scenario: Continue when the card is not visible
- **WHEN** the card is hidden by search, a project filter, selection mode, or another panel before the countdown ends
- **THEN** the countdown keeps running
- **AND** the instruction is delivered when the remaining time elapses unless it is canceled

#### Scenario: Continue across board and Hub switches
- **WHEN** the user switches to another board or Hub before the countdown ends
- **THEN** the countdown keeps running
- **AND** the instruction is delivered when the remaining time elapses unless it is canceled
- **AND** the unresolved entry is resolved for the task on its own board

#### Scenario: Send while the Kanban panel is hidden
- **WHEN** the countdown ends while the Kanban panel is not visible and its board is not mounted
- **THEN** the stage's entry instruction and any pending scripted handoff are delivered to the resolved target
- **AND** the unresolved entry is resolved without requiring the board to be reopened

#### Scenario: Unsent draft does not block the send
- **WHEN** the target conversation has unsent composer text or attachments when the countdown ends
- **THEN** the stage instruction is delivered anyway
- **AND** the unsent text and attachments remain unchanged

#### Scenario: Failed timed send restores the run action
- **WHEN** the timed instruction cannot be admitted or delivered
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

#### Scenario: Keep script recovery separate from the agent countdown

- **WHEN** the host restarts while a scripted script was active and another task had an agent countdown
- **THEN** the script follows scripted recovery from the beginning of its captured program
- **AND** the agent countdown still sends nothing after restart and leaves its instruction entry unresolved

### Requirement: Advance a task from its card

A task card SHALL expose an advance action that moves the task to the next stage in workflow order. The action SHALL present the drawer's next-stage affordance — the same icon, the same accessible name, and the same indication when the next stage requires confirmation — and SHALL use the board's move pipeline, so a restricted next stage requires explicit confirmation, a first execution presents the worktree choice defined by Execution preparation before a task's first execution before the move, and a move into an instructed stage arms the timed stage instruction. The action SHALL be presented only while a next stage exists and the task's current stage authors no decision configuration, because a stage that authors a decision configuration has no next-stage destination and presents the decision gate defined by `decision-steps` instead. It SHALL be hidden while the task's agent execution is running and SHALL be unavailable while the task has an unresolved context operation or a confirmed transition, while selection mode is active, or while a move from the card is in flight. Activating it SHALL NOT open the task drawer, SHALL NOT begin a drag, and SHALL NOT change the task's diagram size or placement.

#### Scenario: Advance to the next stage

- **WHEN** the user activates the card's advance action on a task whose next stage is permitted
- **THEN** the task moves to that stage
- **AND** the task drawer does not open

#### Scenario: Hide while the task is running

- **WHEN** the task's agent execution is running
- **THEN** the card does not present the advance action
- **AND** the action returns when the execution settles

#### Scenario: Confirm a restricted next stage

- **WHEN** the next stage is not permitted from the task's current stage
- **THEN** the board asks for explicit confirmation before moving
- **AND** the accessible name of the action states that the move requires confirmation
- **AND** the task remains in its stage until the user confirms

#### Scenario: Prepare a first execution

- **WHEN** the user activates the advance action on a task that has no conversation
- **THEN** the worktree question is presented before the task moves
- **AND** canceling the preparation leaves the task in its stage
- **AND** answering it moves the task and continues the preparation in the background

#### Scenario: Arm the timed instruction

- **WHEN** the user activates the advance action and the destination stage has an entry instruction
- **THEN** the timed stage instruction is armed exactly as after a board drag
- **AND** the task moves to the destination

#### Scenario: No action without a next stage

- **WHEN** the task is in the last stage of the workflow
- **THEN** the card does not present the advance action

#### Scenario: No action in a decision stage

- **WHEN** the task sits in a stage that authors a decision configuration
- **THEN** the card presents no advance action
- **AND** the decision gate is the authored way to leave the stage

#### Scenario: Unavailable while busy

- **WHEN** the task has an unresolved context operation or a confirmed transition, or selection mode is active
- **THEN** the advance action is unavailable or not presented
- **AND** no move is sent

#### Scenario: Action does not disturb the diagram

- **WHEN** the user advances a task from its card in the workflow diagram
- **THEN** the task moves to the next stage
- **AND** no stage changes size or placement
