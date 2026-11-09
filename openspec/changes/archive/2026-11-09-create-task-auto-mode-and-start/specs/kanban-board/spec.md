# Spec Delta

## ADDED Requirements

### Requirement: Automatic first execution on task creation
The system SHALL prepare a task's first execution immediately after its creation when the active board's initial stage has an entry instruction and the creation kept the Start execution now option enabled. The preparation SHALL be a host admission that does not depend on the creating board remaining mounted, SHALL present no dialog, SHALL NOT ask the worktree choice, and SHALL NOT present the native model selector. For a Git-backed project, the preparation SHALL create the task's default worktree using its title-derived defaults and SHALL wait until that worktree is ready. For a folder project, the task SHALL use its project directory. The preparation SHALL then create the task's first conversation and SHALL arm the five-second countdown defined by Timed stage instruction after a move for the created entry; expiry SHALL send the stage instruction through the same admission as a user run action. While the preparation runs, the card and the drawer SHALL present a preparing state, and the card's run action SHALL NOT be available. Canceling the countdown SHALL keep the created worktree and conversation, SHALL leave the unresolved entry, and SHALL expose the card's run action. A failed preparation or send SHALL keep the card and the unresolved entry, SHALL report the failure on the card and in the drawer, SHALL expose the run action, and SHALL NOT retry automatically. The preparation and the countdown SHALL NOT be persisted: a reload or plugin restart before the send SHALL send nothing and SHALL leave the entry unresolved. The agent tool surface SHALL prepare and dispatch the first execution in the same call as defined by the product-tools specification.

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
- **AND** the failure is reported on the card and in the drawer
- **AND** the card exposes the run action
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
- **AND** the card exposes the run action after reload

#### Scenario: Do not prepare without the start option
- **WHEN** a task is created in an instructed initial stage with Start execution now disabled
- **THEN** no worktree, first conversation, preparation, or countdown is created
- **AND** the card exposes the run action for the unresolved entry

## MODIFIED Requirements

### Requirement: Top-level task creation
The active board SHALL provide one New task action at the top of its workflow's configured initial column. It SHALL collect a title, description, and project from the active Hub's project registry, an Auto mode option that is off by default, and, only when the initial stage has an entry instruction, a Start execution now option that is on by default. The project input SHALL start unselected and SHALL be required; the board SHALL NOT preselect a project, including when a project filter is active. Saving a new task SHALL place it in the active board's configured initial stage and SHALL record the selected auto-mode value. When the initial stage has an entry instruction and the Start execution now option remains enabled, saving SHALL start the automatic first execution defined by Automatic first execution on task creation. Otherwise, saving SHALL NOT create a native DSH conversation, a workspace, or an agent execution. The board header SHALL NOT provide a separate New task action.

#### Scenario: Open task creation from the board
- **WHEN** the user selects the New task action at the top of the active board's configured initial column
- **THEN** the creation experience provides title, description, project, and Auto mode inputs without asking the user to choose a stage
- **AND** it presents Start execution now only when the initial stage has an entry instruction
- **AND** the project input is unselected
- **AND** the project list contains only projects owned by the active Hub

#### Scenario: Create into a customized initial stage
- **WHEN** the user saves a new task, the active board's workflow has a configured initial stage, and the start option does not apply or is disabled
- **THEN** the task is created in that stage with the supplied title, description, project, and auto-mode value
- **AND** the task belongs to the active board
- **AND** no native DSH conversation or workspace is created
- **AND** task creation does not initiate an agent execution

#### Scenario: Create a task with auto mode
- **WHEN** the user enables Auto mode in the New task dialog and saves
- **THEN** the task is persisted with auto mode enabled
- **AND** its stage and position are unchanged
- **AND** no agent execution starts unless Start execution now also applies

#### Scenario: Create and start the first execution
- **WHEN** the user saves a new task in an initial stage with an entry instruction and keeps Start execution now enabled
- **THEN** the task is created in that stage
- **AND** the automatic first execution defined by Automatic first execution on task creation prepares the task and arms the countdown
- **AND** the card presents the task in that stage

#### Scenario: Capture a task without starting
- **WHEN** the initial stage has an entry instruction and the user disables Start execution now
- **THEN** no native DSH conversation, workspace, worktree, or agent execution is created
- **AND** the selected auto-mode value is persisted
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: No start option without an entry instruction
- **WHEN** the active board's initial stage has no entry instruction
- **THEN** the dialog does not present Start execution now
- **AND** task creation does not initiate an agent execution

#### Scenario: Require an explicit project choice
- **WHEN** the user opens New task with one or more registered Hub projects and does not select a project
- **THEN** the task cannot be created
- **AND** no project is silently chosen from the project list or the active project filter

#### Scenario: No task creation without a board
- **WHEN** the active Hub has no boards
- **THEN** the board surface presents the create-board empty state
- **AND** no New task action is available

#### Scenario: Start the first conversation after creation
- **WHEN** the user opens a newly created task's Conversations section and its creation did not start the first execution
- **THEN** the task has no native conversation
- **AND** the section presents the explicit start state defined by `task-conversations`

### Requirement: Timed stage instruction after a move
When a permitted move changes a task's stage to a stage with an entry instruction, or a task created directly in an instructed initial stage completes the automatic first-execution preparation defined by Automatic first execution on task creation, the system SHALL arm one five-second countdown for that entry. The countdown SHALL be armed for board drops, drawer stage changes, and the automatic creation preparation. It SHALL NOT be armed for a same-stage reorder, for a creation whose Start execution now option is disabled, or for a move into a stage without an entry instruction. When the task has no conversation, the countdown SHALL be armed only after the first-execution preparation (the interactive preparation defined by Execution preparation before a task's first execution or the automatic creation preparation) completes, and the conversation that preparation created SHALL be the target. The target SHALL be the task's first open conversation in conversation order; when no conversation is open, the system SHALL create a new conversation and use it. When the five seconds elapse without cancellation, the system SHALL send only that stage's entry instruction to the target. Cancel SHALL stop only the automatic send: the task's stage, position, and unresolved entry SHALL remain, and the card's run action SHALL be available. A new instructed entry for the task SHALL replace the pending countdown for the previous entry. The countdown SHALL be canceled without sending when a successful user prompt resolves the entry, when the task is deleted, or when the entry marker is removed for any other reason. The card SHALL present the countdown as a control that cancels when activated. The drawer for the task SHALL present a matching countdown notice above its section panel with the same cancel action. Both notices SHALL identify the stage whose instruction will run. A countdown SHALL continue when its card is not rendered, when the Kanban panel is not visible, or when the user switches to another board or Hub. The automatic send SHALL NOT depend on the board that armed it being mounted or visible. Unsent composer text or attachments in the target conversation SHALL NOT prevent the send and SHALL remain unchanged. The countdown SHALL NOT be persisted: a reload or plugin restart SHALL send nothing and SHALL leave the entry unresolved with its run action available. A failed timed send SHALL stop the countdown, report the failure on the card and in the drawer notice, restore the run action for the unresolved entry, and SHALL NOT retry automatically. When admission reports that the entry was already resolved, the countdown SHALL end without reporting a failure. The delay SHALL be fixed at five seconds and SHALL NOT be configurable.

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

### Requirement: Auto mode on a task card
A task SHALL have an optional auto-mode setting that is disabled unless the user enables it, including while creating the task, is persisted with the task, and is independent of its stage, position, and conversations. The card SHALL present the setting as an always-visible toggle that also indicates its state, SHALL expose its pressed state and purpose to assistive technology, and SHALL NOT open the task drawer or begin a drag when activated. The control SHALL NOT be presented in selection mode.

Enabling auto mode SHALL arm the task and SHALL NOT move it, change its position, or send an instruction; the next completed turn remains the only trigger. Enabling it while creating a task SHALL persist the setting and SHALL NOT by itself start the first execution; the Start execution now option and Automatic first execution on task creation govern that execution. Disabling it SHALL stop future automatic advances and SHALL NOT retract an advance that is already admitted. A user movement of the task SHALL preserve the setting. The indicator SHALL distinguish disabled, armed, advancing, held, and paused. A paused state SHALL be explained in the status region defined by Task card status strip. A held state SHALL be presented by the control itself, including its accessible name, and SHALL NOT add a status-region entry, because it is derived from pending user work rather than a recorded cause. Held SHALL mean the task has pending user work as defined by Pending user work, and the state SHALL clear when that work is consumed, SHALL NOT be persisted, and SHALL NOT require a user action. Reading a conversation SHALL NOT change the setting and SHALL NOT clear a pause.

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

### Requirement: General board configuration with worktree base path
The Kanban configuration experience SHALL include a General section that is presented first and opened by default. The General section SHALL provide an optional worktree base path used as the parent directory for future task worktree destinations across all Hubs and boards. A non-empty worktree base path SHALL be an absolute path; saving SHALL require it to resolve to an existing directory and SHALL retain that canonical directory. Saving an empty worktree base path SHALL remove the configured value. When no worktree base path is configured, future worktree destinations for Git-backed tasks SHALL be derived beside the project's Git repository as defined by `worktree-management`. Changing or clearing the worktree base path SHALL NOT move, remove, or rename any existing worktree or branch.

#### Scenario: Save a worktree base path
- **WHEN** the user saves an existing absolute directory as the worktree base path
- **THEN** the canonical directory is retained as the global worktree base path
- **AND** future task worktree destinations across every Hub and board use it as their default parent

#### Scenario: Reject a non-existent worktree base path
- **WHEN** the user saves a worktree base path that does not resolve to an existing directory
- **THEN** the setting is not saved and the user sees an actionable error

#### Scenario: Clear the worktree base path
- **WHEN** the user saves the General section with an empty worktree base path
- **THEN** the installation has no configured worktree base path
- **AND** future worktree destinations for Git-backed tasks derive beside the project's Git repository
- **AND** every existing worktree, branch, and recorded destination remains unchanged

#### Scenario: Derive beside the repository without a base path
- **WHEN** no worktree base path is configured and a Git-backed task needs a worktree destination
- **THEN** the destination is derived beside the project's Git repository as defined by `worktree-management`

#### Scenario: Existing worktrees survive a base path change
- **WHEN** the user changes or clears the worktree base path while tasks have existing worktrees
- **THEN** every existing worktree, branch, and recorded destination remains unchanged

### Requirement: Task card status strip
The board SHALL present a card's unresolved context operation, confirmed transition, and automatic-advance state in one status region below the activity region. Each status SHALL carry a tone that distinguishes a failure from a pending state and SHALL present a short label that names the state. A destructive operation's label SHALL use task-deletion or worktree-removal language and SHALL distinguish checking, queued, in progress, and failed states rather than exposing a raw phase token. A status SHALL remain visible while its operation or transition is unresolved. The automatic-advance status SHALL name the destination stage while an advance is admitted, name a failure when an admitted advance failed, and name the pause reason when auto mode is paused. The status region SHALL NOT report the held state defined by Auto mode on a task card, which the auto-mode control presents instead. A run-action admission failure SHALL be reported in the same status region. A failure of the automatic first-execution preparation on task creation SHALL be reported in the same status region. When a card has more than one such fact, the status region SHALL present them together without replacing one with another.

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
