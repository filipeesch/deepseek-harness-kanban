# Spec Delta

## MODIFIED Requirements

### Requirement: Task drawer sections
Opening a task card SHALL display a task drawer with a header showing the task title and project, and Conversations, Info, Git, and Notes sections. Conversations SHALL contain the task's native DSH chats, Info SHALL expose the task's title and Markdown description, Git SHALL expose its simplified worktree controls, and Notes SHALL expose its shared task notes. The workflow stage control SHALL be presented in the drawer's compact toolbar and SHALL list only the transitions permitted from the current stage. Changing the stage SHALL move the task immediately; an instructed destination SHALL follow the Drawer stage change prefills the stage instruction requirement.

#### Scenario: Open a task from the board
- **WHEN** a user opens a card on the Kanban board
- **THEN** the drawer header shows the task title and project
- **AND** the drawer provides Conversations, Info, Git, and Notes without replacing the card interaction with a separate main-chat navigation flow
- **AND** the compact toolbar provides the permitted workflow transitions

#### Scenario: Change stage from the drawer
- **WHEN** the user selects a permitted destination from the drawer's stage control
- **THEN** the same workflow transition rules apply as for a board drop
- **AND** the task moves immediately
- **AND** an instructed destination inserts the stage instruction into the active conversation composer rather than opening a confirmation

## ADDED Requirements

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
