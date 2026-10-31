# Task Conversations Specification

## Purpose

Provide a task-centered drawer that contains continuous native DSH conversations while keeping every conversation aligned with the task's effective project directory and aware of its Hub and board context.

## Requirements

### Requirement: Task drawer sections
Opening a task card SHALL display a task drawer with a header showing the task title, the project, and the task's execution status, and Conversations, Info, Git, and Notes sections. The execution status SHALL remain visible while the user inspects any of those sections. Conversations SHALL contain the task's native DSH chats, Info SHALL expose the task's title and Markdown description, Git SHALL expose its simplified worktree controls, and Notes SHALL expose its shared task notes. The workflow stage control SHALL be presented in the drawer's compact toolbar and SHALL list every workflow stage in workflow order, including the current stage. Stages that the active board's workflow does not permit from the current stage SHALL remain selectable and SHALL be presented with lower visual emphasis than permitted stages, with the restriction also available to assistive technology. Selecting a permitted stage SHALL move the task immediately; selecting a restricted stage SHALL require the explicit confirmation defined by the Explicit confirmation for a restricted transition requirement. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement in `kanban-board`; the drawer SHALL present that countdown notice above its section panel and SHALL expose the same cancel action. The drawer SHALL NOT insert text into the composer for a stage change.

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
- **AND** the task moves immediately
- **AND** the drawer stays in its current section
- **AND** an instructed destination presents the countdown notice with the stage and remaining time
- **AND** the composer is not changed

#### Scenario: Change to a restricted stage from the drawer
- **WHEN** the user selects a destination that the workflow does not permit from the current stage
- **THEN** the same explicit confirmation applies as for a restricted board drop
- **AND** the task remains in its current stage until the user confirms
- **AND** canceling leaves the task in its current stage and the stage control at its current value
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
A task SHALL begin with no native DSH conversation in its Conversations section. The section SHALL provide an explicit start action that creates the first distinct native DSH conversation as a tab within the same task, and a plus action that creates another distinct native DSH conversation. The first conversation SHALL be created only by that explicit start action or by a stage instruction that needs a conversation and finds none open. For a Git-backed task without a worktree, the explicit start action SHALL remain unavailable until the worktree choice is resolved as defined by `worktree-management`. The first conversation SHALL use the task's current effective directory at creation time.

#### Scenario: Open a newly created task
- **WHEN** a user opens a newly created task's Conversations section
- **THEN** no native conversation tab exists
- **AND** an explicit start action and a plus action are available, subject to the worktree choice

#### Scenario: Start the first conversation
- **WHEN** the user starts the first conversation
- **THEN** a native DSH conversation tab is added
- **AND** its native session uses the task's current effective directory

#### Scenario: Add another continuous conversation
- **WHEN** the user selects the plus action in a task that already has a conversation
- **THEN** a new native DSH conversation is added as another tab associated with that same task

#### Scenario: A stage instruction creates the first conversation
- **WHEN** a stage instruction needs a conversation and the task has no open conversation
- **THEN** the first native DSH conversation is created in the task's current effective directory
- **AND** the stage instruction is sent to it

#### Scenario: Withhold the explicit start until the worktree choice
- **WHEN** the user requests the explicit first start for a Git-backed task with no worktree, no recorded base-project choice, and no conversation
- **THEN** no conversation is created
- **AND** the Conversations section presents the pending worktree choice

#### Scenario: Start the first conversation after a worktree choice
- **WHEN** the task has a ready worktree, an attached worktree, or a recorded base-project choice
- **THEN** the explicit start creates the first conversation at the task's current effective directory

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
Task conversation tabs and their peeked subagent conversations SHALL reuse the native DSH session header, chat transcript, composer, and execution rather than introducing a replacement shell or agent runtime. Embedding those conversations in a drawer SHALL preserve the host's applicable tools, execution, permissions, mode selection, and native subagent navigation behavior.

#### Scenario: Render the native conversation surface
- **WHEN** a user opens a task conversation in the drawer
- **THEN** the drawer presents the host's native session header, transcript, and composer
- **AND** it does not present a plugin-owned replacement for those native components

#### Scenario: Use native chat inside a task tab
- **WHEN** a user sends a message through a task's embedded native conversation
- **THEN** the request is handled as a native DSH conversation turn subject to the host's applicable execution and permission behavior

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

### Requirement: Native conversation lineage
The plugin SHALL treat a task's native conversation lineage as its retained top-level conversation sessions plus their direct and nested native subagent descendants whose session header records `origin: subagent`. It SHALL use this lineage for ownership decisions, including shared-worktree protection and owned worktree-workspace cleanup. It SHALL NOT add subagent descendants to the task's conversation tabs, retained session IDs, or closed-conversation list, and SHALL NOT attempt to move or archive them through generic session operations.

A subagent descendant MAY be retained transiently and displayed as an in-drawer peek. That transient reference SHALL NOT be recorded as a task session ID, tab, or closed-conversation entry, and SHALL be released when the peek ends. Archiving a parent conversation SHALL gate its descendant sessions according to native DSH behavior. A session forked from a task conversation or from a subagent descendant SHALL NOT be treated as owned by this lineage.

#### Scenario: A subagent descendant is not a conversation tab
- **WHEN** a task conversation has a native subagent child
- **THEN** the task drawer still shows only the task's retained top-level conversation tabs
- **AND** the child is not persisted as a task session ID or closed-conversation entry

#### Scenario: An in-drawer peek does not persist the child
- **WHEN** the user peeks a native subagent descendant and then leaves the peek
- **THEN** the child's transient reference is released
- **AND** the task's conversation tabs, session IDs, and closed-conversation list are unchanged

#### Scenario: A direct or nested subagent descendant is owned
- **WHEN** a task conversation spawns a subagent child, and that child spawns another subagent child
- **THEN** both descendants belong to the task's conversation lineage for ownership decisions

#### Scenario: A fork remains foreign
- **WHEN** a session was forked from a task conversation but its header does not record `origin: subagent`
- **THEN** the plugin does not treat the fork as an owned descendant

#### Scenario: Archiving a parent gates its descendants
- **WHEN** task deletion archives a top-level task conversation that has subagent descendants
- **THEN** the plugin does not archive or move those descendants individually
- **AND** native archived-parent behavior gates their execution until the native lifecycle changes

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

### Requirement: Native conversation session header
In the Conversations section, the task drawer SHALL render the host's native session header for the active conversation above the native transcript and beneath the task conversation tab strip. The header SHALL use the host's native session title and ancestry, lineage control, header actions, and non-store utilities. It SHALL follow the active conversation, including a peeked subagent conversation, and SHALL update when that session's native header entries change. It SHALL NOT appear in the Info, Git, or Notes sections.

The header SHALL use the host's native components and SHALL NOT reimplement their labels, counts, popovers, lineage, or navigation. When the native session-header entry is unavailable, the drawer SHALL fall back to the host's native header-action row rather than a plugin replica. A native header entry that requires a native store instance the drawer cannot access SHALL be omitted instead of being rendered against an isolated store.

#### Scenario: Show the native session header for the active conversation
- **WHEN** the user opens the Conversations section for a task conversation
- **THEN** the drawer shows the host's native session title, ancestry, lineage control, header actions, and non-store utilities
- **AND** the header sits beneath the task conversation tab strip and above the native transcript

#### Scenario: Follow the active conversation
- **WHEN** the user switches from one task conversation tab to another or peeks a subagent conversation
- **THEN** the native session header shows the newly active session's native header entries
- **AND** native header entries from the previous or other conversations are not merged into it

#### Scenario: Keep task sections free of the header
- **WHEN** the user opens the Info, Git, or Notes section
- **THEN** the native session header is not shown

#### Scenario: Open a native header popover
- **WHEN** the user opens a native subagent, job, or other header popover
- **THEN** the native popover renders as it does in an ordinary DSH chat
- **AND** interacting with that popover does not close the task drawer

#### Scenario: Fall back without a native header entry
- **WHEN** the pinned host does not register the native session-header entry
- **THEN** the drawer shows the compact native-action row as a fallback
- **AND** it does not render a plugin-owned replica of a native label, count, or popover

#### Scenario: Omit a store-backed header entry
- **WHEN** a native header entry depends on a native store instance the drawer cannot access
- **THEN** that entry is omitted
- **AND** the drawer does not present a control backed by an isolated store that cannot affect the real native surface

### Requirement: Native agent mode selection for blank conversations
The drawer SHALL present the host's native agent-preset picker for a blank top-level task conversation. The picker SHALL select that conversation's preset through the host's native preset roster and selection behavior. It SHALL be available only while the conversation is blank; after the first turn starts, the drawer SHALL present the host's native read-only mode label for that conversation. The picker SHALL NOT appear for a started conversation or for a peeked subagent conversation.

The plugin SHALL NOT store a task-level default mode or a plugin-owned preset. Each new conversation SHALL start from the host default or the mode selected for that blank conversation. A native selection refusal SHALL be reported through the host picker's native feedback.

#### Scenario: Show the native picker on a blank task conversation
- **WHEN** a top-level task conversation has not started its first turn
- **THEN** the drawer shows the host's native agent-preset picker
- **AND** the host's native read-only mode label is not shown simultaneously

#### Scenario: Select the mode for that conversation
- **WHEN** the user selects a preset in the native picker for a blank conversation
- **THEN** the plugin invokes the host's native preset selection for that exact session
- **AND** the native session's recorded mode reflects the accepted selection

#### Scenario: Replace the picker after the first turn
- **WHEN** the task conversation starts its first turn
- **THEN** the picker is no longer shown
- **AND** the drawer shows the host's native read-only mode label for that conversation

#### Scenario: Keep the picker out of subagent peeks
- **WHEN** the active view is a peeked subagent conversation
- **THEN** the native mode picker is not shown
- **AND** the drawer does not offer a mode change for the child

#### Scenario: Do not persist a task default
- **WHEN** the user selects a mode for one blank conversation and later creates another conversation
- **THEN** the new conversation starts from the host default or its own native picker choice
- **AND** the plugin has not written a task-level mode field

### Requirement: In-drawer subagent conversation peek
Selecting a subagent row from the host's native lineage or subagent catalog in the drawer SHALL open that child conversation in place inside the task drawer rather than changing the main DSH panel. The child view SHALL use the host's native session header, transcript, and composer. The native breadcrumb/lineage SHALL navigate the child's ancestors inside the drawer, and selecting a task conversation tab SHALL exit the peek.

The peek SHALL be transient: closing the drawer, switching tasks, selecting a root tab, or leaving the Conversations section SHALL clear it. The peeked child SHALL NOT be added to the task's conversation tabs, persisted session IDs, or closed-conversation list, and the task's ownership and cleanup rules SHALL remain unchanged. A target outside the task's owned subagent lineage SHALL NOT be peeked; native DSH navigation SHALL remain in effect for it.

The child view SHALL reuse the host's native composer election: a one-shot child SHALL be read-only, and a continuable child SHALL retain native follow-up and parent-offline behavior.

#### Scenario: Open a subagent in the drawer
- **WHEN** the user selects a subagent row from the active conversation's native lineage or subagent catalog
- **THEN** the child conversation replaces the active transcript inside the task drawer
- **AND** the main DSH panel does not change away from the Kanban board

#### Scenario: Navigate back with the native breadcrumb
- **WHEN** the user activates a parent or root ancestor in the child's native breadcrumb/lineage
- **THEN** the drawer shows that ancestor conversation in place
- **AND** the task tab strip remains the root-session surface

#### Scenario: Exit the peek from a task tab
- **WHEN** the user selects a task conversation tab while a subagent peek is active
- **THEN** the drawer shows that task conversation and clears the peek

#### Scenario: Reset the peek
- **WHEN** the user closes the drawer, switches tasks, or leaves the Conversations section while a peek is active
- **THEN** the next Conversations view does not reopen the peeked child
- **AND** the active root conversation is the starting surface

#### Scenario: Keep the child out of task persistence
- **WHEN** the user peeks a subagent conversation
- **THEN** the child is not added to the task's session IDs, conversation tabs, or closed-conversation list
- **AND** the task's ownership and cleanup behavior is unchanged

#### Scenario: Use the native child composer
- **WHEN** the peeked child is a one-shot subagent
- **THEN** its composer is the native read-only composer
- **AND** when the child is continuable, the native follow-up and parent-offline behavior remains available

#### Scenario: Leave foreign navigation to the host
- **WHEN** a subagent navigation target is not an owned descendant of a task conversation
- **THEN** the plugin does not open it as a drawer peek
- **AND** the host's native DSH navigation remains in effect

### Requirement: Native conversation header host without a DSH change
The plugin SHALL render the host's native session-header, lineage, header-action, and non-store utility components in the drawer. It SHALL NOT reimplement their labels, counts, popovers, lineage, navigation, or mode display, and SHALL NOT require a DSH patch or a new DSH release for this surface. The host integration SHALL be compatible with the pinned DSH release and SHALL guard every native entry it reads.

#### Scenario: Render the host's native components
- **WHEN** the pinned DSH host registers the native session-header and child entries
- **THEN** the drawer renders those native components rather than plugin replicas
- **AND** their native popovers, navigation, and actions remain available

#### Scenario: Guard missing native entries
- **WHEN** an expected native entry is unavailable
- **THEN** the drawer omits or falls back for that entry without crashing the Conversations section
- **AND** it does not invent a plugin-owned replacement for that native component

#### Scenario: Stay on the pinned host
- **WHEN** the plugin is installed on its pinned DSH release
- **THEN** the native session-header host works without a DSH patch or a new DSH release
- **AND** the plugin does not claim support for a different host layout

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

### Requirement: Close the active conversation from its session header
The Conversations section SHALL present the close action for the active task conversation at the end of that conversation's native session header row. The action SHALL be an additional plugin action and SHALL NOT replace or reimplement the host's native header components. The action SHALL close the active root conversation and SHALL be absent while a subagent conversation is peeked. The action SHALL be disabled while a conversation command is pending. Its accessible name SHALL identify the conversation being closed.

The close action SHALL remain reachable while the native conversation body is loading or has failed to open, so that the tab can still be closed. Closing SHALL only hide the conversation from the open-tab strip; it SHALL NOT archive the native session, delete its history, or change the task's session identifiers.

#### Scenario: Close the active conversation
- **WHEN** the user activates the close action in the native session header of the active root conversation
- **THEN** that conversation moves to the closed state
- **AND** its native session and history remain
- **AND** the drawer selects the next open conversation or presents the all-closed empty state

#### Scenario: Hide the close action during a subagent peek
- **WHEN** the drawer is displaying a peeked subagent conversation
- **THEN** the close action is not presented
- **AND** the root conversation tabs are unchanged

#### Scenario: Keep the close action available when the native body fails
- **WHEN** the active conversation's native body is loading or fails to open
- **THEN** the close action remains available in the conversation surface
- **AND** activating it closes the conversation rather than trapping the user in the failed view

#### Scenario: Disable the close action while a command is pending
- **WHEN** a conversation close, reopen, or create command is pending
- **THEN** the close action is disabled
- **AND** it becomes available again when the command settles

### Requirement: Immediate native conversation opening
Opening a task conversation SHALL present the host's native conversation surface without waiting for a Session-catalog refresh or for history opening to settle. The drawer SHALL acquire the native Session and present the native session header, the conversation region, and the conversation close action immediately; history settling and open failures SHALL be presented through the host's native conversation states rather than a plugin-owned blocking placeholder. A Session-catalog refresh SHALL be attempted only when the requested Session is unknown to the client catalog, and SHALL be attempted at most once per opening attempt before a failure is reported. The close action SHALL remain reachable while the native conversation body is settling or has failed to open.

#### Scenario: Open a conversation that is already open in DSH
- **WHEN** a user opens a task conversation whose native Session is already open in the DSH main panel
- **THEN** the drawer presents the native session header and conversation content immediately
- **AND** it does not acquire the session through a Session-catalog refresh
- **AND** it does not make the history wait again before presenting the conversation

#### Scenario: Open a conversation that is not open anywhere
- **WHEN** a user opens a task conversation that no DSH surface has open
- **THEN** the drawer presents the native session header and the host's native settling state immediately
- **AND** the transcript is presented when history settles
- **AND** the conversation tab and close action remain available while history settles

#### Scenario: Open a Session missing from the client catalog
- **WHEN** a requested task Session is unknown to the client catalog
- **THEN** the drawer refreshes the catalog once and acquires the Session
- **AND** it presents the native conversation surface instead of an indefinite placeholder
- **AND** if the Session still cannot be acquired, the failure is reported without trapping the conversation tab

#### Scenario: Close a conversation whose history failed
- **WHEN** the native conversation reports that its history could not open
- **THEN** the host's native failure state is presented in the drawer
- **AND** the conversation's close action remains available

### Requirement: Warm conversation surfaces within the open task drawer
While a task drawer remains mounted, a conversation tab that has been opened SHALL remain retained when the user switches conversation tabs or moves between the Conversations, Info, Git, and Notes sections. Returning to a visited conversation within that drawer SHALL present the same native Session and its already-open history without re-opening the Session or downloading its history again. Warm retention SHALL start lazily at each conversation's first visit; a tab that was never opened SHALL NOT open its Session in the background. Closing the task drawer or closing the conversation tab SHALL release that retained conversation. Warm retention SHALL NOT acknowledge a settled turn for a conversation whose content is not visible, and leaving the Conversations section SHALL still clear a subagent peek as defined by In-drawer subagent conversation peek.

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

#### Scenario: Leaving Conversations still clears a peek
- **WHEN** a subagent conversation is being peeked and the user moves from Conversations to another drawer section
- **THEN** the next Conversations view starts from the active root conversation
- **AND** the peeked child is not reopened
