# Spec Delta

## MODIFIED Requirements

### Requirement: First-turn task context
The plugin SHALL inject a native task-context message into the first model step of a task conversation before the first user message. The context SHALL contain the task title, task identifier, description, workflow stage at first contact, the owning Hub name, and the owning board name. The message SHALL be a native context message with a plugin-owned source, SHALL NOT be a user-authored chat message, and SHALL NOT start a turn. It SHALL appear as a context row in the conversation. The context SHALL be injected at most once per conversation; later turns and stage instructions SHALL NOT repeat it. Each new conversation SHALL receive its own first-turn context. A conversation with existing user messages SHALL NOT receive a new first-turn context, and conversations whose first message predates this behavior SHALL NOT be backfilled.

#### Scenario: First question in the initial column
- **WHEN** the user sends the first message in a task conversation while the task is in the initial stage
- **THEN** the first model request contains the injected task-context message before the user's message
- **AND** the context identifies the task's Hub and board
- **AND** the conversation shows the context row
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
