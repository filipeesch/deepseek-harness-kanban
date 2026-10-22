# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
