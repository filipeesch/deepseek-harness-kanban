# Task Conversations Specification

## Purpose

Provide a task-centered drawer that contains continuous native DSH conversations while keeping every conversation aligned with the task's effective project directory.

## Requirements

### Requirement: Task drawer sections
Opening a task card SHALL display a task drawer with a header showing the task title and project, and Conversations, Info, Git, and Notes sections. Conversations SHALL contain the task's native DSH chats, Info SHALL expose the task's title and Markdown description, Git SHALL expose its simplified worktree controls, and Notes SHALL expose its shared task notes. The workflow stage control SHALL be presented in the drawer's compact toolbar and SHALL list only the transitions permitted from the current stage.

#### Scenario: Open a task from the board
- **WHEN** a user opens a card on the Kanban board
- **THEN** the drawer header shows the task title and project
- **AND** the drawer provides Conversations, Info, Git, and Notes without replacing the card interaction with a separate main-chat navigation flow
- **AND** the compact toolbar provides the permitted workflow transitions

#### Scenario: Change stage from the drawer
- **WHEN** the user selects a permitted destination from the drawer's stage control
- **THEN** the same workflow transition rules apply as for a board drop
- **AND** an instructed destination requires the Move and run / Move only / Cancel confirmation

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
