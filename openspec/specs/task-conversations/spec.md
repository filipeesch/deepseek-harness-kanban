# Task Conversations Specification

## Purpose

Provide a task-centered drawer that contains continuous native DSH conversations while keeping every conversation aligned with the task's effective project directory and aware of its Hub and board context.

## Requirements
### Requirement: Task drawer sections

Opening a task card SHALL display a task drawer with a header showing the task title, the project, and the task's execution status, and Conversations, Info, Git, and Notes sections. The execution status SHALL remain visible while the user inspects any of those sections. Conversations SHALL contain the task's native DSH chats, Info SHALL expose the task's title and Markdown description, Git SHALL expose its simplified worktree controls, and Notes SHALL expose its shared task notes. The workflow stage control SHALL be presented in the drawer's compact toolbar and SHALL list every workflow stage in workflow order, including the current stage. Stages that the active board's workflow does not permit from the current stage SHALL remain selectable and SHALL be presented with lower visual emphasis than permitted stages, with the restriction also available to assistive technology. Selecting a permitted stage SHALL move the task immediately; when the task has no conversation and the destination has an entry instruction, the execution preparation defined by Execution preparation before a task's first execution in `kanban-board` SHALL be presented first, and the task SHALL NOT move until that preparation completes. Selecting a restricted stage SHALL require the explicit confirmation defined by the Explicit confirmation for a restricted transition requirement; when the confirmed destination would start the task's first execution, that preparation SHALL follow the confirmation and precede the move. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement in `kanban-board`; the drawer SHALL present that countdown notice above its section panel and SHALL expose the same cancel action. The drawer SHALL NOT insert text into the composer for a stage change.

The drawer header SHALL also present the task's auto-mode control defined by Auto mode on a task card in `kanban-board`, with the same pressed state, effect, indication, and enabled or disabled behavior as the card control, including the held state while the task has pending user work. The drawer SHALL present the automatic-advance state above its section panel without changing sections: the destination stage while an advance is admitted, a failure when an admitted advance failed, and the pause reason when auto mode is paused. The drawer SHALL NOT present a separate entry for the held state above its section panel, because the mirrored control presents it. The drawer SHALL present the automatic-advance state with the same meaning as the card status strip and SHALL NOT make reading or acknowledging a conversation clear a pause.

#### Scenario: Open a task from the board
- **WHEN** a user opens a card on the Kanban board
- **THEN** the drawer header shows the task title, its project, and its execution status
- **AND** the drawer provides Conversations, Info, Git, and Notes without replacing the card interaction with a separate main-chat navigation flow
- **AND** the compact toolbar provides the complete workflow stage control in workflow order

#### Scenario: List the complete workflow
- **WHEN** the user opens the drawer for a task
- **THEN** the stage control lists every workflow stage in workflow order
- **AND** the current stage is included

#### Scenario: Present restricted stages with lower emphasis
- **WHEN** the active board's workflow does not permit a transition from the current stage to another listed stage
- **THEN** that stage is presented with lower visual emphasis than permitted stages
- **AND** it remains selectable
- **AND** its restriction is available to assistive technology without adding visible explanatory text

#### Scenario: Change stage from the drawer
- **WHEN** the user selects a permitted destination from the drawer's stage control
- **THEN** the same workflow transition rules apply as for a board drop
- **AND** the task moves immediately after any required first-execution preparation
- **AND** the drawer stays in its current section
- **AND** an instructed destination presents the countdown notice with the stage and remaining time
- **AND** the composer is not changed

#### Scenario: Prepare the first execution from the drawer
- **WHEN** the user selects a permitted instructed destination for a task that has no conversation
- **THEN** the execution preparation is presented before the task moves
- **AND** the task remains in its current stage until the preparation completes
- **AND** canceling the preparation leaves the task in its current stage and the drawer in its current section

#### Scenario: Change to a restricted stage from the drawer
- **WHEN** the user selects a destination that the workflow does not permit from the current stage
- **THEN** the same explicit confirmation applies as for a restricted board drop
- **AND** the task remains in its current stage until the user confirms
- **AND** canceling leaves the task in its current stage and the stage control at its current value
- **AND** after confirmation, any required first-execution preparation is presented before the move
- **AND** after confirmation, an instructed destination presents the countdown notice instead of writing to the composer

#### Scenario: Cancel a drawer countdown
- **WHEN** the user cancels from the drawer's countdown notice
- **THEN** no instruction is sent
- **AND** the task stays in the destination stage at the same position
- **AND** the drawer stays in its current section
- **AND** the card exposes the stage run action for the unresolved entry

#### Scenario: Change to an uninstructed stage
- **WHEN** the user selects a destination without an entry instruction
- **THEN** the task moves after any required confirmation
- **AND** the drawer stays in its current section
- **AND** no countdown is armed
- **AND** no composer draft is created by the change

#### Scenario: Execution status stays visible across sections
- **WHEN** a task is running an owned agent and the user switches between the drawer's sections
- **THEN** the drawer header still presents the task's execution status on every section

#### Scenario: Execution status follows a delegated subagent
- **WHEN** the task's assistant turn ends while an owned subagent descendant is still running
- **THEN** the drawer header keeps presenting the execution status

#### Scenario: Execution status clears when the turn ends
- **WHEN** the assistant turn of the only active conversation ends and no owned subagent descendant is running
- **THEN** the drawer header stops presenting the execution status without a reload

#### Scenario: Toggle auto mode from the drawer
- **WHEN** the user activates the auto-mode control in the drawer header
- **THEN** the setting changes exactly as the card control changes it
- **AND** the drawer stays in its current section
- **AND** the task's stage and position are unchanged

#### Scenario: Mirror the held auto-mode state
- **WHEN** the open task has auto mode enabled and pending user work
- **THEN** the drawer's mirrored auto-mode control presents the held state
- **AND** no separate entry for that state is added above the section panel

#### Scenario: Present an admitted automatic advance
- **WHEN** an automatic advance is admitted for the open task
- **THEN** the drawer presents the destination stage above its section panel
- **AND** the drawer does not change sections

#### Scenario: Present a paused automatic advance
- **WHEN** auto mode is paused for the open task
- **THEN** the drawer presents the pause reason above its section panel
- **AND** reading the conversation does not clear it

#### Scenario: Present a failed automatic advance
- **WHEN** an admitted automatic advance fails for the open task
- **THEN** the drawer presents the failure above its section panel
- **AND** the stage run action remains available for an unresolved destination entry

### Requirement: Drawer execution status detail
The drawer header SHALL present the task's agent execution status with the same meaning as the board card, including the background activity detail when the task owns unsettled background work. Agent execution SHALL include the task conversations' own assistant turns and their owned subagent descendants. The background activity detail SHALL cover jobs and schedules only, SHALL name the task's unsettled activities, and SHALL stop being presented when no background activity remains. The background detail SHALL be visually secondary to the agent execution status.

#### Scenario: Show background activity detail
- **WHEN** the user opens the drawer for a task that owns unsettled jobs or schedules
- **THEN** the drawer header presents the background activity detail with the labels of those activities

#### Scenario: A running subagent is execution, not background detail
- **WHEN** the main assistant turn has ended and an owned subagent descendant is still running
- **THEN** the drawer header presents the agent execution status
- **AND** it does not present that subagent as background activity detail

#### Scenario: Clear the background detail
- **WHEN** the last background activity for the open task settles
- **THEN** the drawer header stops presenting the background activity detail without a reload

#### Scenario: Working status takes precedence visually
- **WHEN** a task is running an owned agent and also owns background activity
- **THEN** the drawer header presents both facts with the agent execution status visually primary

### Requirement: Read-only task information with inline editing
The Info section SHALL display the task title and the Markdown-rendered description as read-only content by default. An Edit action SHALL turn both title and description into editable inputs with Save and Cancel actions. Saving SHALL use the existing task edit behavior, SHALL NOT message any conversation or start an agent, and SHALL preserve the current revision-conflict handling. The Info section SHALL NOT duplicate the project already shown in the drawer header, SHALL NOT show the explanatory editing sentence, and SHALL NOT show the effective agent directory.

#### Scenario: Read task information
- **WHEN** the user opens the Info section for a task with a Markdown description
- **THEN** the title and rendered Markdown description are shown as read-only content
- **AND** the project is visible in the drawer header rather than duplicated in Info

#### Scenario: Edit and save task information
- **WHEN** the user activates Edit, changes the title or description, and selects Save
- **THEN** the task text is updated without messaging a conversation or starting an agent

#### Scenario: Cancel editing
- **WHEN** the user activates Edit, changes a field, and selects Cancel
- **THEN** the displayed values return to the saved task content without a write

#### Scenario: Preserve an unsaved Info draft
- **WHEN** the user edits Info without saving and switches to another drawer section or closes the drawer
- **THEN** reopening that task's Info section restores the unsaved draft for that task

### Requirement: Conversation tab titles and rename
Each conversation tab SHALL display its native DSH session title when one exists and `Agent N` otherwise. Renaming a tab SHALL rename the native session and update the tab, and SHALL NOT create a plugin-owned label. Closed-conversation entries SHALL use the same title or fallback.

#### Scenario: Rename a conversation tab
- **WHEN** the user renames a conversation tab
- **THEN** the native session title is updated and the tab shows the accepted title
- **AND** the native DSH session list reflects the same title

#### Scenario: Use the fallback title
- **WHEN** a conversation has no native session title
- **THEN** its tab shows `Agent N` based on its position in the task

#### Scenario: Preserve a title for a closed conversation
- **WHEN** a conversation with a native title is closed and later listed for reopening
- **THEN** the closed entry uses that title rather than a new plugin label

### Requirement: Drawer resizing, dismissal, and draft retention
The task drawer SHALL be resizable within defined minimum and maximum bounds and SHALL persist its width across reloads. Clicking the board background SHALL close the drawer, while clicks inside a native overlay or portal, or on the resize handle, SHALL NOT close it. Escape SHALL close the drawer unless a conversation popover is open, in which case Escape SHALL dismiss that popover without closing the drawer. Closing SHALL preserve unsaved Info drafts for that task. Selecting another task card SHALL switch the drawer to that task.

#### Scenario: Resize and persist the drawer
- **WHEN** the user drags the drawer's resize handle to a new width
- **THEN** the drawer uses that width within its bounds
- **AND** the width is restored after a reload

#### Scenario: Close by clicking the board background
- **WHEN** the drawer is open and the user clicks the board background outside the drawer
- **THEN** the drawer closes

#### Scenario: Interact with a native overlay
- **WHEN** the drawer is open and the user interacts with a native menu, picker, or overlay outside the drawer panel
- **THEN** the drawer remains open

#### Scenario: Close with Escape
- **WHEN** the drawer is open and no conversation popover is open and the user presses Escape
- **THEN** the drawer closes and any unsaved Info draft for that task is retained

#### Scenario: Switch tasks
- **WHEN** the drawer is open and the user activates another task card
- **THEN** the drawer displays the newly selected task without a separate chat navigation flow

### Requirement: Nested native conversation tabs

A task SHALL begin with no native DSH conversation in its Conversations section. The section SHALL provide an explicit start action, presented as the agent-preset cards, that creates the first distinct native DSH conversation as a tab within the same task, and a plus action that opens the same preset choice to create another distinct native DSH conversation. The first conversation SHALL be created only by that explicit choice, by the execution preparation that precedes a task's first execution, or by a stage instruction that needs a conversation and finds none open, including a stage instruction dispatched from a card, a confirmed transition, or an automatic advance. When the execution preparation creates the first conversation, it SHALL do so after the worktree choice is resolved and before the move or run action is applied. For a Git-backed task without a worktree, the explicit start action SHALL remain unavailable until the worktree choice is resolved as defined by `worktree-management`. The first conversation SHALL use the task's current effective directory at creation time. A conversation created from a card SHALL receive the card's preset; conversations created by the execution preparation or a stage instruction use the host default.

#### Scenario: Open a newly created task

- **WHEN** a user opens a newly created task's Conversations section
- **THEN** no native conversation tab exists
- **AND** the agent-preset cards and the plus action are available, subject to the worktree choice

#### Scenario: Start the first conversation

- **WHEN** the user selects a preset card as the first conversation's start action
- **THEN** a native DSH conversation tab is added
- **AND** the card's preset is selected on that conversation
- **AND** its native session uses the task's current effective directory

#### Scenario: Add another continuous conversation

- **WHEN** the user selects the plus action in a task that already has a conversation and then selects a preset card
- **THEN** a new native DSH conversation is added as another tab associated with that same task
- **AND** the card's preset is selected on that conversation

#### Scenario: Prepare the first conversation

- **WHEN** an execution preparation runs for a task that has no conversation
- **THEN** the first native DSH conversation is created after the worktree choice is resolved
- **AND** it is created before the move or run action is applied
- **AND** it uses the task's current effective directory

#### Scenario: A stage instruction creates the first conversation

- **WHEN** a stage instruction needs a conversation, the task has no open conversation, and no execution preparation applies, for example a dispatched confirmed transition or an automatic advance
- **THEN** the first native DSH conversation is created in the task's current effective directory
- **AND** the stage instruction is sent to it

#### Scenario: An automatic advance creates the first conversation

- **WHEN** an automatic advance needs a conversation and the task has no open conversation
- **THEN** one native DSH conversation is created
- **AND** the destination instruction is sent to it

#### Scenario: Withhold the explicit start until the worktree choice

- **WHEN** the user requests the explicit first start for a Git-backed task with no worktree, no recorded base-project choice, and no conversation
- **THEN** no conversation is created
- **AND** the Conversations section presents the pending worktree choice

#### Scenario: Start the first conversation after a worktree choice

- **WHEN** the task has a ready worktree, an attached worktree, or a recorded base-project choice
- **THEN** the card start creates the first conversation at the task's current effective directory

### Requirement: Model selection for the first conversation

When the execution preparation defined by Execution preparation before a task's first execution in `kanban-board` creates a task's first conversation and DSH's native model selector is available, the preparation SHALL present that native model selector for the created conversation before the first execution is admitted. The selector SHALL show the deployment default selection while the conversation has no recorded selection, and presenting it SHALL NOT submit a selection. When the user chooses a different model or reasoning effort, the selection SHALL apply to that conversation and SHALL follow DSH's native behavior for the deployment default. When DSH's native model selector is not available, the preparation SHALL omit the model step and the conversation SHALL use the deployment default. The selection SHALL NOT be persisted on the task, SHALL NOT be presented for later conversations, and SHALL NOT be presented when the task already has a conversation.

#### Scenario: Show the default without submitting

- **WHEN** the preparation presents the native model selector for a conversation with no recorded selection
- **THEN** the selector shows the deployment default model
- **AND** no model selection is submitted to the host
- **AND** the conversation will use the deployment default

#### Scenario: Choose another model

- **WHEN** the user chooses a different model or reasoning effort in the native selector
- **THEN** that selection applies to the created conversation
- **AND** the deployment default follows DSH's native behavior

#### Scenario: Omit the model step when the selector is unavailable

- **WHEN** DSH's native model selector is not composed in the running host
- **THEN** the preparation omits the model step
- **AND** the first conversation uses the deployment default
- **AND** the rest of the preparation and the execution proceed

#### Scenario: Model step without a worktree question

- **WHEN** the task already has a ready worktree, is a folder project, or has a recorded base-project choice, and the task has no conversation
- **THEN** the preparation presents the model step only
- **AND** the first conversation is created in the task's current effective directory

#### Scenario: Do not offer a model for later conversations

- **WHEN** a task already has a conversation
- **THEN** no preparation and no model step is presented
- **AND** later conversations are not changed

### Requirement: Continuous sessions retain separate histories
Each conversation tab SHALL represent a continuous native DSH session with its own retained identity and history. Switching between task conversation tabs or reopening the task drawer SHALL return to those existing sessions instead of replacing them with newly created sessions. Within a mounted task drawer, returning to a conversation that was already visited SHALL reuse its already-open native Session without opening it or downloading its history again.

#### Scenario: Return to a previous conversation tab
- **WHEN** a user switches from one task conversation tab to another and then returns
- **THEN** the original tab still represents the same session with its prior messages

#### Scenario: Reopen a task containing multiple conversations
- **WHEN** a user closes and later reopens a task drawer containing multiple conversations
- **THEN** the task still provides its existing conversation sessions and their histories

#### Scenario: Reuse a warm conversation without reopening it
- **WHEN** a user returns to a conversation tab that was already visited while the same task drawer stayed open
- **THEN** the tab still represents the same session with its prior messages
- **AND** the conversation is not opened again from its history before it is presented

### Requirement: Shared effective task directory
Every conversation associated with a task SHALL use the same effective task directory, resolved from its base project path or equivalent project subdirectory within its worktree. A newly added conversation SHALL inherit the task's current effective directory. A successful directory migration SHALL update the existing sessions without replacing them or discarding their histories.

#### Scenario: Add a tab after worktree activation
- **WHEN** a task is using /worktrees/task-42/services/api and the user adds another conversation tab
- **THEN** that new conversation uses /worktrees/task-42/services/api as its effective agent directory

#### Scenario: Preserve sessions across a directory migration
- **WHEN** all task conversations are idle and a requested directory migration successfully completes
- **THEN** every conversation uses the new task directory and retains the same native session identity and prior history

### Requirement: Reuse the native DSH conversation experience

Task conversation tabs SHALL render the host's public native conversation window — its Session header, View tabs, transcript, composer, Session statistics, and execution — rather than introducing a replacement shell or agent runtime. Embedding the window in a drawer SHALL preserve the host's applicable tools, execution, permissions, mode selection, View selection, and native subagent navigation behavior.

#### Scenario: Render the native conversation surface

- **WHEN** a user opens a task conversation in the drawer
- **THEN** the drawer presents the host's native conversation window
- **AND** it does not present a plugin-owned replacement for the header, transcript, or composer

#### Scenario: Use native chat inside a task tab

- **WHEN** a user sends a message through a task's embedded native conversation
- **THEN** the request is handled as a native DSH conversation turn subject to the host's applicable execution and permission behavior

#### Scenario: Follow native subagent navigation

- **WHEN** the user selects a subagent in the window's native lineage or subagent catalog
- **THEN** the host's native DSH navigation applies
- **AND** the plugin does not open a drawer-local subagent peek

### Requirement: No new bidirectional main-chat shortcuts
The plugin SHALL NOT add dedicated task-card-to-main-chat or main-chat-to-task-card navigation shortcuts as part of this capability. This exclusion SHALL NOT remove or disable existing native DSH navigation or the approved product tools in ordinary DSH chats.

#### Scenario: Access a task without a new main-chat shortcut
- **WHEN** the plugin exposes the task drawer and its conversation tabs
- **THEN** it provides no new dedicated action to open those task conversations in the main chat or jump from the main chat back to their card

#### Scenario: Preserve ordinary native chat access
- **WHEN** a user uses an ordinary DSH chat outside a task drawer
- **THEN** native chat navigation remains available and this capability does not disable approved board tools or structured question forms there

### Requirement: First-turn task context
The plugin SHALL inject a durable task-context message into the first model step of a task conversation before the first user message. The context SHALL contain the task title, task identifier, description, workflow stage at first contact, the owning Hub name, and the owning board name. The message SHALL be a plugin-sourced native message, SHALL NOT be a user-authored chat message or a system prompt, and SHALL NOT start a turn.

The conversation SHALL present the context as an inline visible context row using the host's native context-row presentation. If that presentation is unavailable, an inline fallback row SHALL preserve the context text. The row SHALL be part of the transcript flow, SHALL appear at the injected message's position, and SHALL scroll with the transcript rather than remaining fixed over it. It SHALL be visible wherever the task conversation is rendered, including the drawer and ordinary native DSH chat. The context SHALL be injected at most once per conversation; later turns and stage instructions SHALL NOT repeat it. Each new conversation SHALL receive its own first-turn context. A conversation with existing user messages SHALL NOT receive a new first-turn context, and conversations whose first message predates this behavior SHALL NOT be backfilled.

#### Scenario: First question in the initial column
- **WHEN** the user sends the first message in a task conversation while the task is in the initial stage
- **THEN** the first model request contains the injected task-context message before the user's message
- **AND** the context identifies the task's Hub and board
- **AND** the conversation shows the inline context row at the injected message's position
- **AND** the user's message contains only the text the user sent
- **AND** the task-context message does not start a turn

#### Scenario: First stage instruction in a blank conversation
- **WHEN** a stage instruction is sent or inserted as the first message of a task conversation
- **THEN** the first model request contains the injected task-context message before the instruction
- **AND** the instruction message contains only the stage instruction
- **AND** the context row is visible in the conversation

#### Scenario: Use the task's board context
- **WHEN** an agent reads the first-turn task context
- **THEN** it can identify the task's board and Hub without inferring them from the native workspace
- **AND** board-scoped tools can resolve the task's board from the conversation

#### Scenario: Scroll with the transcript
- **WHEN** the user scrolls the conversation containing the task-context row
- **THEN** the row moves with the transcript content
- **AND** it does not remain pinned over the transcript

#### Scenario: Visible in ordinary native chat
- **WHEN** a task conversation containing the injected task context is opened in ordinary native DSH chat
- **THEN** the inline context row is visible there as well
- **AND** the presentation is the same as in the drawer

#### Scenario: Later stage instruction
- **WHEN** the user runs or sends a stage instruction after the conversation's first message
- **THEN** the instruction is sent without repeating the task context
- **AND** the task-context row is not added again

#### Scenario: New conversation after an existing one
- **WHEN** the user creates another task conversation and sends its first message
- **THEN** that conversation receives its own first-turn task-context message
- **AND** the existing conversation is unchanged

#### Scenario: Resume a conversation with history
- **WHEN** a task conversation whose first message already exists is resumed
- **THEN** no new task-context message is injected
- **AND** the durable history and existing context row remain

### Requirement: Fork adoption into the task conversation
When a native DSH conversation fork is created or resumed, the plugin SHALL adopt it as another conversation of the task that retains its direct parent conversation when the fork records a direct parent session, does not record `origin: subagent`, is not already associated with a task, and its direct parent is a retained conversation of that task. The plugin SHALL NOT adopt a fork of a subagent descendant, a fork of a session that no task retains, or a session already associated with a task. Adoption SHALL be idempotent and SHALL NOT attach the same session to a task twice.

Adoption SHALL align the fork's effective directory with the task's effective directory before associating it. When that alignment fails, the plugin SHALL NOT associate the fork and SHALL report the failure. Adoption SHALL associate the fork through the same conversation-retention path as an explicit conversation creation, so the new conversation appears as an open conversation tab after the task's existing conversations and receives the task's normal conversation behavior. The plugin SHALL NOT select the adopted conversation automatically and SHALL NOT change the native DSH navigation that follows a fork.

When the task has a pending context operation at adoption time, the plugin SHALL retry adoption for a bounded interval and SHALL report the failure when the task remains unavailable. An adoption failure SHALL NOT fail, cancel, or roll back the native fork.

#### Scenario: Adopt a fork of a task conversation
- **WHEN** a user branches a retained conversation of a task
- **THEN** the fork is associated with that same task as a new conversation
- **AND** the task drawer shows it as an open conversation tab after the existing conversations

#### Scenario: Adopt a fork when its session is resumed
- **WHEN** a fork of a task conversation that is not yet associated with any task is resumed
- **THEN** the plugin adopts it into that task

#### Scenario: Do not adopt a fork of a subagent descendant
- **WHEN** a user branches a native subagent descendant of a task conversation
- **THEN** the fork remains foreign
- **AND** the task conversation tabs, session IDs, and closed-conversation list are unchanged

#### Scenario: Do not adopt a fork with no task-retained direct parent
- **WHEN** a fork's direct parent session is not a retained conversation of any task
- **THEN** the plugin does not associate the fork with a task

#### Scenario: Do not adopt the same session twice
- **WHEN** an adoption is announced again for a session already associated with a task
- **THEN** the plugin leaves the task conversation list unchanged

#### Scenario: Align the fork directory before associating it
- **WHEN** a fork of a task conversation has an effective directory that differs from the task's effective directory
- **THEN** the plugin moves the fork to the task's effective directory before associating it
- **AND** the adopted conversation can execute in the task directory

#### Scenario: A failed directory alignment leaves the fork foreign
- **WHEN** the plugin cannot move a fork to the task's effective directory
- **THEN** the plugin does not associate the fork with the task
- **AND** it reports the failure without canceling the native fork

#### Scenario: Retry while the task is busy
- **WHEN** a fork is created while the task has a pending context operation
- **THEN** the plugin retries adoption for a bounded interval
- **AND** it associates the fork if the task becomes available within that interval
- **AND** it reports the failure and leaves the fork foreign when the task remains unavailable

#### Scenario: Do not select the adopted conversation automatically
- **WHEN** a fork is adopted while the task drawer is open on another conversation
- **THEN** the adopted conversation is appended without changing the active conversation
- **AND** the native DSH navigation that followed the fork is unchanged

#### Scenario: Adopt a fork of a closed conversation as open
- **WHEN** a user branches a closed conversation of a task
- **THEN** the fork is adopted as an open conversation tab
- **AND** the original closed conversation remains closed

### Requirement: Visible operation status and recovery

The task drawer SHALL show the task's current context operation above its section tabs for every operation kind, including create, attach, return, remove, and delete. The status SHALL distinguish queued, waiting, in progress, and failed states; SHALL state which steps completed and which remain; and SHALL offer Retry when the recorded operation can resume. It SHALL offer Return only when returning the task's conversations to the base project is permitted; it SHALL NOT offer Return once native conversation archiving has begun. It SHALL offer a force action when a deletion or worktree removal failed the sharing preflight with `SHARED_WORKTREE`. The status SHALL remain visible from the Conversations, Info, Git, and Notes sections and SHALL use user-facing language rather than a raw error code as its primary explanation. A destructive confirmation SHALL close when the host accepts the operation; if that operation later fails, reopening the confirmation SHALL present the recorded failure and its recovery instead of presenting the task as deleted.

#### Scenario: A failed deletion is visible from every section

- **WHEN** a deletion fails before moving any conversation, removing the worktree, or archiving a conversation
- **THEN** opening the task drawer shows the failed operation above the tabs from any section
- **AND** the status states that no chats were moved and no worktree or archive change completed
- **AND** Retry and Return are available when their preconditions permit

#### Scenario: Waiting for idle is visible

- **WHEN** a context operation is waiting for every task conversation to become idle
- **THEN** the status explains that it is waiting and remains visible outside Conversations and Git
- **AND** it does not present the operation as failed

#### Scenario: Queued deletion is visible

- **WHEN** an accepted deletion is waiting for its turn in the destructive-operation queue
- **THEN** the status identifies the operation as queued rather than waiting for idle or in progress
- **AND** the status remains visible outside Conversations and Git

#### Scenario: Return is unavailable after archiving starts

- **WHEN** a failed deletion has already archived at least one native conversation
- **THEN** the status does not offer Return as a recovery action
- **AND** it directs the user to retry the recorded deletion instead

#### Scenario: Force recovery is offered for a shared checkout

- **WHEN** a deletion or worktree removal failed with `SHARED_WORKTREE`
- **THEN** the operation status offers the force action
- **AND** the force confirmation lists the affected tasks and conversations before the action can proceed

#### Scenario: Confirmation reopens with the recorded failure

- **WHEN** an accepted destructive operation later failed and the user reopens its confirmation
- **THEN** the confirmation presents the recorded failure and recovery actions
- **AND** it does not present the operation as completed

#### Scenario: Operation copy follows the operation kind

- **WHEN** the current operation is a worktree creation, attachment, return, removal, or task deletion
- **THEN** the status uses copy and recovery actions appropriate to that kind and phase
- **AND** it does not describe a deletion as a "worktree operation" or report a "conversations switched" count as the primary explanation

### Requirement: Conversation tab attention indicators
Each open conversation tab in the Conversations section SHALL present that conversation's blue unread, orange awaiting-reply, and red failure indicators, with the same meaning as the attention indicators defined by Coexisting attention indicators across task conversations in `kanban-board`. The indicators SHALL be scoped per conversation so a task with several conversations shows which conversation is pending, SHALL update live while the drawer is open, and SHALL be available to assistive technology as part of the tab's accessible name. Updates SHALL reflect the final state after a burst of activity, including while many conversations run concurrently; a bounded coalescing delay of no more than a few hundred milliseconds is permitted, and no update may be dropped. Closed-conversation entries SHALL NOT present attention indicators.

#### Scenario: Show which conversation is pending
- **WHEN** a task has several open conversation tabs with different attention states
- **THEN** each tab presents its own conversation's attention indicators
- **AND** a tab without attention presents none

#### Scenario: Update the tab live
- **WHEN** an open conversation gains an unread, awaiting-reply, or failure state while the drawer is open
- **THEN** its tab presents the corresponding indicator without a reload

#### Scenario: Present the final state after a burst
- **WHEN** several conversations change attention state in quick succession while the drawer is open
- **THEN** every affected tab eventually presents that conversation's final attention state without a reload
- **AND** a bounded delay before the final state is presented is acceptable

#### Scenario: Clear the read indicators on the viewed tab
- **WHEN** the active conversation is read and its blue and red indicators clear
- **THEN** its tab stops presenting those indicators
- **AND** the other conversation tabs keep their own indicators

#### Scenario: Expose the indicators to assistive technology
- **WHEN** assistive technology reads a conversation tab with pending attention
- **THEN** the tab's accessible name includes the applicable unread, awaiting-reply, or failure states

#### Scenario: Closed entries show no indicators
- **WHEN** a conversation tab is closed, including one whose turn settles after the close
- **THEN** its closed-conversation entry presents no attention indicators

### Requirement: Conversation attention acknowledgment
The drawer SHALL acknowledge a conversation's last settled assistant turn when the conversation's native content is mounted in the Conversations section and the page is visible, and when the conversation's tab is closed. While the content remains mounted and the page visible, a turn that settles SHALL be acknowledged when it settles. Acknowledgment SHALL be per conversation, SHALL NOT acknowledge another conversation of the same task, and SHALL persist across reloads and plugin restarts. Closing a tab SHALL acknowledge only the turn settled at the moment of closing; a turn that settles after the close SHALL remain unread at the task level. Content that is not visible SHALL NOT acknowledge a turn that settles while it is not being read.

#### Scenario: Acknowledge the viewed conversation
- **WHEN** a conversation with an unread or failed settled turn is displayed in the Conversations section
- **THEN** that conversation's blue and red indicators clear
- **AND** the acknowledgment persists after a reload

#### Scenario: Keep the other conversations unread
- **WHEN** two conversations have unread settled turns and only one is displayed
- **THEN** only the displayed conversation is acknowledged
- **AND** the other conversation stays unread

#### Scenario: A settle while watching is acknowledged
- **WHEN** a turn settles while its conversation content is mounted and the page is visible
- **THEN** the conversation does not present unread or failure indicators for that turn

#### Scenario: Do not acknowledge while the page is hidden
- **WHEN** the page is hidden while the conversation content is mounted and a turn settles
- **THEN** the conversation presents its unread or failure indicator until the page becomes visible again

#### Scenario: Close acknowledges the current settled turn
- **WHEN** the user closes a conversation tab
- **THEN** that conversation's last settled turn is acknowledged

#### Scenario: A turn after the close stays unread
- **WHEN** a closed conversation settles another turn after its tab was closed
- **THEN** the task-level attention presents that turn as unread or failed
- **AND** the closed-conversation entry presents no attention indicators

### Requirement: Closed conversations stay out of the conversation flow
The Conversations section SHALL NOT reserve space in the conversation body for closed conversations. Closed conversations SHALL be reachable from a compact control at the end of the open-conversation tab strip, before the new-conversation action. The control SHALL be presented only when the task has at least one closed conversation and SHALL show a small history icon and the closed-conversation count. Its accessible name SHALL state the number of closed conversations.

Activating the control SHALL open an anchored, non-modal popover listing the task's closed conversations. Each entry SHALL be a button whose visible label is the native DSH session title when one exists and `Agent N` otherwise. Activating an entry SHALL reopen that conversation and select it. A reopen failure SHALL be presented inside the popover and SHALL NOT close it. The popover SHALL close on Escape, on an outside click, and after a successful reopen. While a reopen is pending, Escape and an outside click SHALL NOT dismiss the popover, so that a failure can be presented there. While the popover is open, Escape SHALL dismiss only the popover and SHALL NOT close the task drawer. Escape and an outside click SHALL return focus to the closed-conversations control. A successful reopen SHALL move focus to the reopened conversation tab, falling back to the control when that tab is not available. The popover SHALL be scrollable when its list exceeds the available height.

When every conversation is closed, the section SHALL present a short empty state that points to the closed-conversations control without duplicating the closed list or adding a second reopen action.

#### Scenario: Show the closed-conversations control only when needed
- **WHEN** a task has no closed conversations
- **THEN** the Conversations section does not present the closed-conversations control
- **AND** the conversation body keeps its full height

#### Scenario: Open the closed-conversation list
- **WHEN** a task has closed conversations and the user activates the closed-conversations control
- **THEN** an anchored popover lists those conversations
- **AND** each entry shows the native session title or `Agent N`
- **AND** the conversation body is not resized by the list

#### Scenario: Reopen from the list
- **WHEN** the user activates a closed conversation entry
- **THEN** the conversation is reopened and selected
- **AND** its session and history are preserved
- **AND** the popover closes
- **AND** focus moves to the reopened conversation tab

#### Scenario: Reopen failure stays in the popover
- **WHEN** reopening a closed conversation fails
- **THEN** the failure is presented inside the popover
- **AND** the popover remains open for another attempt

#### Scenario: Keep the popover open while reopening
- **WHEN** a reopen is pending and the user presses Escape or clicks outside the popover
- **THEN** the popover remains open
- **AND** the pending entry is presented as unavailable

#### Scenario: Dismiss the closed-conversation list
- **WHEN** the popover is open and the user presses Escape, or clicks outside it but inside the task drawer
- **THEN** the popover closes
- **AND** focus returns to the closed-conversations control
- **AND** the task drawer remains open

#### Scenario: Empty state points to the control
- **WHEN** every task conversation is closed
- **THEN** the Conversations section presents a short empty state that points to the closed-conversations control
- **AND** it does not repeat the closed list or add a second reopen action

### Requirement: Immediate native conversation opening

Opening a task conversation SHALL present the host's native conversation window without waiting for a Session-catalog refresh or for history opening to settle. The drawer SHALL acquire the native Session and present the hosted window and the conversation close action immediately; history settling SHALL be presented through the host window's native settling state rather than a plugin-owned blocking placeholder. A Session-catalog refresh SHALL be attempted only when the requested Session is unknown to the client catalog, and SHALL be attempted at most once per opening attempt before a failure is reported. A failed history or session opening SHALL be reported by the drawer with the close action available.

#### Scenario: Open a conversation that is already open in DSH

- **WHEN** a user opens a task conversation whose native Session is already open in the DSH main panel
- **THEN** the drawer presents the hosted conversation window immediately
- **AND** it does not acquire the session through a Session-catalog refresh
- **AND** it does not make the history wait again before presenting the conversation

#### Scenario: Open a conversation that is not open anywhere

- **WHEN** a user opens a task conversation that no DSH surface has open
- **THEN** the drawer presents the hosted window and the host's native settling state immediately
- **AND** the transcript is presented when history settles
- **AND** the conversation tab and close action remain available while history settles

#### Scenario: Open a Session missing from the client catalog

- **WHEN** a requested task Session is unknown to the client catalog
- **THEN** the drawer refreshes the catalog once and acquires the Session
- **AND** it presents the hosted conversation window instead of an indefinite placeholder
- **AND** if the Session still cannot be acquired, the failure is reported without trapping the conversation tab

#### Scenario: Close a conversation whose history failed

- **WHEN** the native conversation reports that its history could not open
- **THEN** the drawer reports the failure in the conversation area
- **AND** the conversation's close action remains available in its tab

### Requirement: Attention indicators fill after the drawer's first paint

The drawer SHALL present the conversation tabs and the selected conversation without waiting for every conversation of the task to resolve its attention facts. A tab whose conversation facts are still resolving MAY present no indicator until they resolve. The conversations of the task whose drawer is open SHALL be resolved before unrelated historical conversations. Indicators SHALL appear without a reload, and the final state of a burst of activity SHALL NOT be dropped. Acknowledgment and read behavior SHALL be unchanged.

#### Scenario: Drawer first, indicators later

- **WHEN** the user opens a task drawer while its conversations' attention facts are still resolving
- **THEN** the conversation tabs and the selected conversation are presented
- **AND** each tab presents its indicators as its facts resolve, without a reload

#### Scenario: Prioritize the open task's conversations

- **WHEN** the open task's conversations and other tasks' historical conversations are both unresolved
- **THEN** the open task's conversations are resolved first

#### Scenario: A late indicator does not acknowledge a turn

- **WHEN** a tab presents its unread or failure indicator after the drawer's first paint
- **THEN** presenting that indicator does not itself acknowledge the conversation's settled turn
- **AND** the turn remains unread or failed until the conversation is displayed as defined by Conversation attention acknowledgment

#### Scenario: Keep the final state after a burst

- **WHEN** several conversations of the open task change attention in quick succession
- **THEN** every affected tab eventually presents that conversation's final attention state without a reload

### Requirement: Native conversation window in the task drawer

In the Conversations section, the task drawer SHALL render one occurrence of the host's public native conversation window for the active task conversation instead of assembling the conversation chrome itself. The occurrence SHALL use the embedded variant and SHALL take its Session from the retained Session area that wraps it; the plugin SHALL NOT pass a Session identity as an occurrence prop.

The host window SHALL compose the complete native surface: the Session header — title ancestry, View tabs and their More menu, header actions, header utilities, and the right-bar corner — and the conversation body — the active View, transcript, composer, and Session statistics, including the composer statistics footer. The drawer SHALL NOT mount, register, or fabricate any header component, header input, View roster, or pin state. Contributions registered by the host and its plugins SHALL render through the window without per-occurrence registration. The drawer MAY render its own agent-preset card picker outside the window, as defined by Agent-preset cards start task conversations.

View facts SHALL remain per-Session and shared with the main panel: the View roster, unpinned View choices, the active View, and the composer draft SHALL NOT be duplicated by the drawer occurrence. The body SHALL use the View selected for that Session; the plugin SHALL NOT force a View or a conversation phase. An embedded occurrence SHALL omit the leading global-navigation seat and the application window-drag marker, and SHALL NOT inherit the main conversation column's frame clearance.

The drawer SHALL keep the conversation-surface gates around the occurrence: it SHALL track the displayed conversation for read state, SHALL refuse to mount a second live composer for a Session that already has one, and SHALL report an open failure with the close action available. A header contribution that fails SHALL be reported and contained by the host's slot composition; the drawer SHALL NOT substitute a plugin-owned header or fallback row.

The window SHALL follow the active task conversation tab, including switching between root conversations, and SHALL NOT appear in the Info, Git, or Notes sections.

#### Scenario: Show the native window for the active conversation

- **WHEN** the user opens the Conversations section for a task conversation
- **THEN** the drawer renders the host's native conversation window
- **AND** the window shows the Session title and ancestry, View tabs and their More menu, header actions, header utilities, and the right-bar corner
- **AND** the window shows the transcript, composer, and Session statistics footer

#### Scenario: Bind the Session from the retained area

- **WHEN** the drawer renders the window occurrence for a retained root conversation
- **THEN** the occurrence renders that Session's window without receiving a Session identity in its props

#### Scenario: Render the host header extension points

- **WHEN** a host plugin has registered an entry in a header action, utility, View More, or corner extension point
- **THEN** that entry renders in the drawer's window through the host composition
- **AND** the plugin registers no second copy of that entry for the drawer

#### Scenario: Share Views with the main panel

- **WHEN** the user selects a View tab in the drawer's window and the main panel shows the same Session
- **THEN** the main panel shows that View selected as well
- **AND** the drawer mounts no second View roster or stored selection

#### Scenario: Keep the selected View

- **WHEN** the user opens a task conversation whose Session has a selected View other than Chat
- **THEN** the drawer renders that View
- **AND** the plugin does not force the Chat View

#### Scenario: Contain a failing header contribution

- **WHEN** a host header contribution throws while the drawer's window renders
- **THEN** the host composition reports the failure and retires that contribution
- **AND** the rest of the window keeps rendering
- **AND** the drawer does not replace the header with a plugin-owned fallback

#### Scenario: Keep task sections free of the window

- **WHEN** the user opens the Info, Git, or Notes section
- **THEN** the conversation window is not shown

### Requirement: Host compatibility for the conversation window

The client SHALL render the public `conversation.window` occurrence when the running host declares it. When the Factory is not declared, the drawer SHALL present an explicit notice that the DSH version must be updated and SHALL NOT render a blank conversation area, a manually assembled header, or a plugin-owned replica of the window. The plugin SHALL remain installable on the pinned host generation and SHALL NOT require a DSH patch. The manifest pin to the release that declares the Factory is a release-time follow-up; the pinned SDK compiles the window call through a local type bridge only.

#### Scenario: Render on a supported host

- **WHEN** the plugin runs on a DSH host that declares `conversation.window`
- **THEN** the drawer renders the host window without a DSH patch

#### Scenario: Report an unsupported host

- **WHEN** the running DSH host does not declare `conversation.window`
- **THEN** the drawer presents an explicit notice that the DSH version must be updated
- **AND** it does not present an empty conversation area as if the conversation were unavailable

#### Scenario: Do not resurrect the manual header

- **WHEN** the Factory is unavailable
- **THEN** the drawer does not fall back to a hand-assembled native header or a plugin-owned header replica

### Requirement: Close the active conversation from its tab

The Conversations section SHALL present the close action for the active task conversation inside that conversation's tab, to the right of its title. The action SHALL be a control separate from the tab's selection target and SHALL NOT change the selected conversation when activated. It SHALL close the active root conversation and SHALL be disabled while a conversation command is pending. Its accessible name SHALL identify the conversation being closed.

The action SHALL remain reachable while the native conversation body is loading or has failed to open, so that the tab can still be closed. Closing SHALL only hide the conversation from the open-tab strip; it SHALL NOT archive the native session, delete its history, or change the task's session identifiers.

#### Scenario: Close the active conversation

- **WHEN** the user activates the close action in the active conversation's tab
- **THEN** that conversation moves to the closed state
- **AND** its native session and history remain
- **AND** the drawer selects the next open conversation or presents the all-closed empty state

#### Scenario: Keep the selection unchanged

- **WHEN** the user activates the close action inside the active tab
- **THEN** the close action does not first select a different conversation
- **AND** the tab's own selection target remains separate from the close control

#### Scenario: Show the close action only on the active tab

- **WHEN** the task has several open conversation tabs
- **THEN** only the active conversation's tab presents the close action

#### Scenario: Keep the close action available when the native body fails

- **WHEN** the active conversation's native body is loading or fails to open
- **THEN** the close action remains available in the conversation tab
- **AND** activating it closes the conversation rather than trapping the user in the failed view

#### Scenario: Disable the close action while a command is pending

- **WHEN** a conversation close, reopen, or create command is pending
- **THEN** the close action is disabled
- **AND** it becomes available again when the command settles

### Requirement: Agent-preset cards start task conversations

In the Conversations section, when the task has no open conversation, or when the user requests a new conversation with the plus action, the drawer SHALL present the host's native agent-preset roster as selectable cards in the conversation area. The cards SHALL replace the standalone start-conversation button. Activating a card SHALL create a native conversation for the task, select that preset on the created session through the host's native preset selection, and open that conversation.

The roster SHALL use the host's native preset list and selection behavior, excluding presets the native picker would hide: broken presets, and coding-tools-gated presets while developer tools are disabled. The plugin SHALL NOT store a task-level default mode or own a preset.

When the preset selection fails after the conversation was created, the conversation SHALL remain open with the host default, the drawer SHALL report the failure in the conversation area, and the card choice SHALL remain available to retry the selection on that same conversation. A failed roster load SHALL be reported with a retry action. Canceling the plus action's choice SHALL create no conversation; selecting another conversation tab SHALL discard the choice. The drawer SHALL NOT depend on the host's own blank-conversation preset seat or read-only mode label, which remain host-owned and may be absent outside the main panel.

#### Scenario: Show the preset cards for a task without conversations

- **WHEN** the user opens the Conversations section for a task with no open conversation
- **THEN** the drawer shows the host's agent-preset roster as selectable cards in the conversation area
- **AND** it does not show a standalone start-conversation button

#### Scenario: Start a conversation from a card

- **WHEN** the user activates a preset card for a task with no open conversation
- **THEN** a native conversation is created for the task
- **AND** the chosen preset is selected on that conversation through the host's preset selection
- **AND** the drawer opens that conversation's window

#### Scenario: Open the preset choice from the plus action

- **WHEN** the task already has an open conversation and the user activates the plus action
- **THEN** the drawer presents the preset cards in the conversation area
- **AND** activating a card creates another native conversation with that preset and opens it

#### Scenario: Keep the conversation after a preset selection failure

- **WHEN** the preset selection fails after the conversation was created from a card
- **THEN** the conversation remains open with the host default preset
- **AND** the drawer reports the failure in the conversation area
- **AND** the card choice remains available to retry the selection on that same conversation

#### Scenario: Cancel the plus action's choice

- **WHEN** the user cancels the preset choice opened from the plus action
- **THEN** no conversation is created
- **AND** the previously active conversation remains displayed

#### Scenario: Report a roster failure with retry

- **WHEN** the host's agent-preset roster cannot be loaded
- **THEN** the drawer reports the failure in the conversation area
- **AND** it offers a retry action

#### Scenario: Do not persist a task default

- **WHEN** the user starts conversations with different card choices
- **THEN** each conversation uses the preset selected for it
- **AND** the plugin has not written a task-level mode field

### Requirement: Task conversation lineage and ownership

The plugin SHALL treat a task's native conversation lineage as its retained top-level conversation sessions plus their direct and nested native subagent descendants whose session header records `origin: subagent`. A top-level conversation session SHALL include a conversation created for the task and a fork the task adopted. It SHALL use this lineage for ownership decisions, including shared-worktree protection and owned worktree-workspace cleanup. It SHALL NOT add subagent descendants to the task's conversation tabs, retained session IDs, or closed-conversation list, and SHALL NOT attempt to move or archive them through generic session operations.

Archiving a parent conversation SHALL gate its descendant sessions according to native DSH behavior. A fork the plugin has not adopted — including a fork of a subagent descendant and a fork of a session that no task retains — SHALL NOT be treated as owned by this lineage.

#### Scenario: A subagent descendant is not a conversation tab

- **WHEN** a task conversation has a native subagent child
- **THEN** the task drawer still shows only the task's retained top-level conversation tabs
- **AND** the child is not persisted as a task session ID or closed-conversation entry

#### Scenario: A direct or nested subagent descendant is owned

- **WHEN** a task conversation spawns a subagent child, and that child spawns another subagent child
- **THEN** both descendants belong to the task's conversation lineage for ownership decisions

#### Scenario: An adopted fork is a top-level task conversation

- **WHEN** the plugin has adopted a fork of a task conversation
- **THEN** the fork is one of the task's retained top-level conversation sessions
- **AND** it is owned for lineage, task deletion, and shared-worktree protection

#### Scenario: A fork remains foreign

- **WHEN** a fork was created from a subagent descendant or from a session that no task retains
- **THEN** the plugin does not treat the fork as an owned descendant or conversation

#### Scenario: Archiving a parent gates its descendants

- **WHEN** task deletion archives a top-level task conversation that has subagent descendants
- **THEN** the plugin does not archive or move those descendants individually
- **AND** native archived-parent behavior gates their execution until the native lifecycle changes

### Requirement: Warm task conversation surfaces within the open drawer

While a task drawer remains mounted, a conversation tab that has been opened SHALL remain retained when the user switches conversation tabs or moves between the Conversations, Info, Git, and Notes sections. Returning to a visited conversation within that drawer SHALL present the same native Session and its already-open history without re-opening the Session or downloading its history again. Warm retention SHALL start lazily at each conversation's first visit; a tab that was never opened SHALL NOT open its Session in the background. Closing the task drawer or closing the conversation tab SHALL release that retained conversation. Warm retention SHALL NOT acknowledge a settled turn for a conversation whose content is not visible.

#### Scenario: Return to a visited conversation tab

- **WHEN** the user switches from one task conversation tab to another and then back to the first
- **THEN** the first tab presents the same native Session and its prior messages
- **AND** its history is not opened again before the transcript is presented

#### Scenario: Return from another drawer section

- **WHEN** the user opens a task conversation, moves to Info, Git, or Notes, and returns to Conversations
- **THEN** the previously active conversation is presented with its prior messages
- **AND** its history is not opened again before the transcript is presented

#### Scenario: Warm lazily on first visit

- **WHEN** a task has several open conversation tabs and the user has visited only one of them
- **THEN** only the visited conversation is retained while the drawer remains mounted
- **AND** an unvisited tab opens its Session when the user selects it

#### Scenario: Release on drawer close

- **WHEN** the user closes the task drawer and later reopens the task
- **THEN** the task still provides its existing conversation sessions and histories
- **AND** the conversations are acquired again for the reopened drawer

#### Scenario: Release on tab close

- **WHEN** the user closes a visited conversation tab and later reopens it from the closed-conversation list
- **THEN** the reopened conversation keeps the same native Session identity and history
- **AND** its content is acquired again when it becomes active

#### Scenario: Keep an unread turn while warm but not visible

- **WHEN** a retained conversation is not visible because another drawer section is open and its turn settles
- **THEN** the conversation's unread or failure indicator remains
- **AND** the hidden content does not acknowledge the settled turn
