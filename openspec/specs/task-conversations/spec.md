# Task Conversations Specification

## Purpose

Provide a task-centered drawer that contains continuous native DSH conversations while keeping every conversation aligned with the task's effective project directory.

## Requirements

### Requirement: Task drawer sections
Opening a task card SHALL display a task drawer with a header showing the task title, the project, and the task's execution status, and Conversations, Info, Git, and Notes sections. The execution status SHALL remain visible while the user inspects any of those sections. Conversations SHALL contain the task's native DSH chats, Info SHALL expose the task's title and Markdown description, Git SHALL expose its simplified worktree controls, and Notes SHALL expose its shared task notes. The workflow stage control SHALL be presented in the drawer's compact toolbar and SHALL list only the transitions permitted from the current stage. Changing the stage SHALL move the task immediately; an instructed destination SHALL follow the Drawer stage change prefills the stage instruction requirement.

#### Scenario: Open a task from the board
- **WHEN** a user opens a card on the Kanban board
- **THEN** the drawer header shows the task title, its project, and its execution status
- **AND** the drawer provides Conversations, Info, Git, and Notes without replacing the card interaction with a separate main-chat navigation flow
- **AND** the compact toolbar provides the permitted workflow transitions

#### Scenario: Change stage from the drawer
- **WHEN** the user selects a permitted destination from the drawer's stage control
- **THEN** the same workflow transition rules apply as for a board drop
- **AND** the task moves immediately
- **AND** an instructed destination inserts the stage instruction into the active conversation composer rather than opening a confirmation

#### Scenario: Execution status stays visible across sections
- **WHEN** a task is running an assistant turn and the user switches between the drawer's sections
- **THEN** the drawer header still presents the task's execution status on every section

#### Scenario: Execution status clears when the turn ends
- **WHEN** the task's assistant turn ends while the drawer is open
- **THEN** the drawer header stops presenting the turn execution status without a reload


### Requirement: Drawer execution status detail
The drawer header SHALL present the task's turn execution status with the same meaning as the board card, including the background activity detail when the task owns unsettled background work. That background detail SHALL name the task's unsettled activities and SHALL stop being presented when no background activity remains. The background detail SHALL be visually secondary to the turn execution status.

#### Scenario: Show background activity detail
- **WHEN** the user opens the drawer for a task that owns unsettled jobs, subagents, or schedules
- **THEN** the drawer header presents the background activity detail with the labels of those activities

#### Scenario: Clear the background detail
- **WHEN** the last background activity for the open task settles
- **THEN** the drawer header stops presenting the background activity detail without a reload

#### Scenario: Working status takes precedence visually
- **WHEN** a task is running an assistant turn and also owns background activity
- **THEN** the drawer header presents both facts with the turn execution status visually primary

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
The task drawer SHALL be resizable within defined minimum and maximum bounds and SHALL persist its width across reloads. Clicking the board background SHALL close the drawer, while clicks inside a native overlay or portal, or on the resize handle, SHALL NOT close it. Escape SHALL close the drawer. Closing SHALL preserve unsaved Info drafts for that task. Selecting another task card SHALL switch the drawer to that task.

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
- **WHEN** the drawer is open and the user presses Escape
- **THEN** the drawer closes and any unsaved Info draft for that task is retained

#### Scenario: Switch tasks
- **WHEN** the drawer is open and the user activates another task card
- **THEN** the drawer displays the newly selected task without a separate chat navigation flow

### Requirement: Nested native conversation tabs
A task SHALL begin with one native DSH conversation in its Conversations section. The section SHALL provide a plus action that creates another distinct native DSH conversation as a nested tab within the same task.

#### Scenario: Open a newly created task
- **WHEN** a user opens a newly created task's Conversations section
- **THEN** one initial native conversation tab and a plus action are available

#### Scenario: Add another continuous conversation
- **WHEN** the user selects the plus action in a task's Conversations section
- **THEN** a new native DSH conversation is added as another tab associated with that same task

### Requirement: Continuous sessions retain separate histories
Each conversation tab SHALL represent a continuous native DSH session with its own retained identity and history. Switching between task conversation tabs or reopening the task drawer SHALL return to those existing sessions instead of replacing them with newly created sessions.

#### Scenario: Return to a previous conversation tab
- **WHEN** a user switches from one task conversation tab to another and then returns
- **THEN** the original tab still represents the same session with its prior messages

#### Scenario: Reopen a task containing multiple conversations
- **WHEN** a user closes and later reopens a task drawer containing multiple conversations
- **THEN** the task still provides its existing conversation sessions and their histories

### Requirement: Shared effective task directory
Every conversation associated with a task SHALL use the same effective task directory, resolved from its base project path or equivalent project subdirectory within its worktree. A newly added conversation SHALL inherit the task's current effective directory. A successful directory migration SHALL update the existing sessions without replacing them or discarding their histories.

#### Scenario: Add a tab after worktree activation
- **WHEN** a task is using /worktrees/task-42/services/api and the user adds another conversation tab
- **THEN** that new conversation uses /worktrees/task-42/services/api as its effective agent directory

#### Scenario: Preserve sessions across a directory migration
- **WHEN** all task conversations are idle and a requested directory migration successfully completes
- **THEN** every conversation uses the new task directory and retains the same native session identity and prior history

### Requirement: Reuse the native DSH conversation experience
Task conversation tabs SHALL reuse the native DSH chat experience and execution rather than introducing a replacement agent runtime. Embedding those conversations in a drawer SHALL preserve the host's applicable tool, execution, and permission behavior.

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
The plugin SHALL inject a native task-context message into the first model step of a task conversation before the first user message. The context SHALL contain the task title, task identifier, description, and workflow stage at first contact. The message SHALL be a native context message with a plugin-owned source, SHALL NOT be a user-authored chat message, and SHALL NOT start a turn. It SHALL appear as a context row in the conversation. The context SHALL be injected at most once per conversation; later turns and stage instructions SHALL NOT repeat it. Each new conversation SHALL receive its own first-turn context. A conversation with existing user messages SHALL NOT receive a new first-turn context, and conversations whose first message predates this behavior SHALL NOT be backfilled.

#### Scenario: First question in the initial column
- **WHEN** the user sends the first message in a task conversation while the task is in the initial stage
- **THEN** the first model request contains the injected task-context message before the user's message
- **AND** the conversation shows the context row
- **AND** the user's message contains only the text the user sent
- **AND** the task-context message does not start a turn

#### Scenario: First stage instruction in a blank conversation
- **WHEN** a stage instruction is sent or inserted as the first message of a task conversation
- **THEN** the first model request contains the injected task-context message before the instruction
- **AND** the instruction message contains only the stage instruction
- **AND** the context row is visible in the conversation

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

### Requirement: Drawer stage change prefills the stage instruction
The drawer's stage control SHALL move the task immediately under the same transition rules as a board drop. When the destination stage has an entry instruction, the drawer SHALL switch to the Conversations section and insert only that instruction into the composer of the active conversation; the instruction SHALL NOT be submitted and no agent execution SHALL start. If no conversation tab is active, the first open conversation SHALL be used. If the task has no open conversation, the drawer SHALL report that no conversation is available and SHALL NOT insert an instruction. Existing composer text and attachments SHALL be preserved; the drawer SHALL offer an explicit Replace action that clears both and inserts the instruction. The composer SHALL be focused after a successful insertion. A destination without an entry instruction SHALL only move the task.

#### Scenario: Change to an instructed stage from Conversations
- **WHEN** the user selects an instructed destination while the Conversations section is active
- **THEN** the task moves immediately
- **AND** only the destination instruction is inserted into the active conversation's composer
- **AND** the instruction is not submitted and no agent starts
- **AND** the composer is focused

#### Scenario: Change to an instructed stage from another drawer section
- **WHEN** the user selects an instructed destination while Info, Git, or Notes is active
- **THEN** the task moves immediately
- **AND** the drawer switches to Conversations
- **AND** only the instruction is inserted into the active conversation's composer

#### Scenario: Preserve an existing draft
- **WHEN** the target composer already has text or attachments
- **THEN** the drawer does not overwrite them
- **AND** it offers an explicit Replace action
- **AND** declining leaves the existing draft unchanged

#### Scenario: Replace an existing draft
- **WHEN** the user chooses Replace for a composer with text or attachments
- **THEN** the existing text and attachments are cleared
- **AND** only the stage instruction is inserted
- **AND** the instruction is not submitted

#### Scenario: No open conversation
- **WHEN** the user selects an instructed destination and every conversation tab is closed
- **THEN** the task moves immediately
- **AND** the drawer reports that no conversation is available for the instruction
- **AND** no instruction is submitted

#### Scenario: Change to an uninstructed stage
- **WHEN** the user selects a destination without an entry instruction
- **THEN** the task moves immediately
- **AND** no composer draft or agent execution is created by the change

### Requirement: Native conversation lineage

The plugin SHALL treat a task's native conversation lineage as its retained top-level conversation sessions plus their direct and nested native subagent descendants whose session header records `origin: subagent`. It SHALL use this lineage for ownership decisions, including shared-worktree protection and owned worktree-workspace cleanup. It SHALL NOT add subagent descendants to the task's conversation tabs, retained session IDs, or closed-conversation list, and SHALL NOT attempt to move or archive them through generic session operations. Archiving a parent conversation SHALL gate its descendant sessions according to native DSH behavior. A session forked from a task conversation or from a subagent descendant SHALL NOT be treated as owned by this lineage.

#### Scenario: A subagent descendant is not a conversation tab

- **WHEN** a task conversation has a native subagent child
- **THEN** the task drawer still shows only the task's retained top-level conversation tabs
- **AND** the child is not persisted as a task session ID or closed-conversation entry

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

The task drawer SHALL show the task's current context operation above its section tabs for every operation kind, including create, attach, return, remove, and delete. The status SHALL distinguish waiting, in progress, and failed states; SHALL state which steps completed and which remain; and SHALL offer Retry when the recorded operation can resume. It SHALL offer Return only when returning the task's conversations to the base project is permitted; it SHALL NOT offer Return once native conversation archiving has begun. The status SHALL remain visible from the Conversations, Info, Git, and Notes sections and SHALL use user-facing language rather than a raw error code as its primary explanation. A failed destructive confirmation SHALL also present its failure and recovery in the confirmation surface.

#### Scenario: A failed deletion is visible from every section

- **WHEN** a deletion fails before moving any conversation, removing the worktree, or archiving a conversation
- **THEN** opening the task drawer shows the failed operation above the tabs from any section
- **AND** the status states that no chats were moved and no worktree or archive change completed
- **AND** Retry and Return are available when their preconditions permit

#### Scenario: Waiting for idle is visible

- **WHEN** a context operation is waiting for every task conversation to become idle
- **THEN** the status explains that it is waiting and remains visible outside Conversations and Git
- **AND** it does not present the operation as failed

#### Scenario: Return is unavailable after archiving starts

- **WHEN** a failed deletion has already archived at least one native conversation
- **THEN** the status does not offer Return as a recovery action
- **AND** it directs the user to retry the recorded deletion instead

#### Scenario: Operation copy follows the operation kind

- **WHEN** the current operation is a worktree creation, attachment, return, removal, or task deletion
- **THEN** the status uses copy and recovery actions appropriate to that kind and phase
- **AND** it does not describe a deletion as a "worktree operation" or report a "conversations switched" count as the primary explanation

### Requirement: Native conversation status row
In the Conversations section, the task drawer SHALL render a compact status row beneath the active conversation's tab strip for the active conversation only. The row SHALL render the host's actual native agent-mode, subagent, and background-job header actions, including their native labels, counts, and popovers. The row SHALL follow the selected conversation tab, SHALL update when that session's native actions update, and SHALL be hidden when no native action renders. It SHALL NOT aggregate subagent or background-job activity from other conversations of the task; board-level task activity remains separate. It SHALL NOT appear in the Info, Git, or Notes sections.

#### Scenario: Show the native actions for the active conversation
- **WHEN** the active task conversation has native mode, subagent, or background-job actions
- **THEN** the status row shows those native actions with their native labels and counts
- **AND** the row is positioned beneath the conversation tab strip rather than replacing the task drawer header

#### Scenario: Hide the row when no action renders
- **WHEN** the active conversation has no native mode, subagent, or background-job action to render
- **THEN** the status row is hidden and does not reserve an empty band

#### Scenario: Follow the selected conversation
- **WHEN** the user switches from one conversation tab to another
- **THEN** the status row reflects the newly selected conversation's native actions
- **AND** subagent or background-job activity from the previous or other conversations is not merged into that row

#### Scenario: Keep task sections free of the row
- **WHEN** the user opens the Info, Git, or Notes section
- **THEN** the conversation status row is not shown

#### Scenario: Open a native status popover
- **WHEN** the user opens a native subagent or background-job popover from the status row
- **THEN** the native popover renders as it does in an ordinary DSH chat
- **AND** interacting with that popover does not close the task drawer

### Requirement: Read-only agent mode
The drawer SHALL display the active conversation's native agent mode read-only through the native mode action. It SHALL NOT provide a mode picker or any control that changes a conversation's mode. Mode selection remains outside this capability.

#### Scenario: Display the mode without a picker
- **WHEN** the active conversation has a native agent mode
- **THEN** the status row shows the native read-only mode label
- **AND** the drawer offers no mode selection control

#### Scenario: Do not attempt a mode change
- **WHEN** the active conversation is blank or started
- **THEN** the plugin does not call a preset selection API and does not present a mode-change action

### Requirement: Native status actions without a DSH change
The plugin SHALL render the host's native agent-mode, subagent, and background-job header-action components in the status row. It SHALL NOT reimplement their labels, counts, popovers, or selection behavior, and SHALL NOT require a DSH change for this surface. The plugin SHALL be compatible with the pinned DSH release; when the expected native entries are unavailable, the row SHALL be hidden without a plugin-owned fallback.

#### Scenario: Render the host's native components
- **WHEN** the pinned DSH host registers the native header actions
- **THEN** the row renders those native components, not a plugin replica
- **AND** their native popovers and actions remain available

#### Scenario: Do not fake missing native actions
- **WHEN** the expected native header-action entries are unavailable
- **THEN** the row is hidden
- **AND** the plugin does not display a plugin-owned mode, count, or job/subagent fallback in their place

#### Scenario: Stay on the pinned host
- **WHEN** the plugin is installed on its pinned DSH release
- **THEN** the status row works without a DSH patch or a new DSH release
- **AND** the plugin does not claim support for a different host layout
