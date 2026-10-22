# Task Conversations Specification

## Purpose

Provide a task-centered drawer that contains continuous native DSH conversations while keeping every conversation aligned with the task's effective project directory.

## Requirements

### Requirement: Task drawer sections
Opening a task card SHALL display a task drawer with Conversations, Info, Git, and Notes sections. Conversations SHALL contain the task's native DSH chats, Info SHALL expose its task details, Git SHALL expose its scoped worktree controls, and Notes SHALL expose its shared task notes.

#### Scenario: Open a task from the board
- **WHEN** a user opens a card on the Kanban board
- **THEN** the task drawer provides Conversations, Info, Git, and Notes without replacing the card interaction with a separate main-chat navigation flow

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
