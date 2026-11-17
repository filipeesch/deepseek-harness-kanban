# Spec Delta

## MODIFIED Requirements

### Requirement: First-turn task context

The plugin SHALL inject a durable task-context message into the first model step of a task conversation before the first message of the conversation, whatever that message's source. The context SHALL contain the task title, task identifier, description, workflow stage at first contact, the owning Hub name, and the owning board name. It SHALL also contain the compact workflow summary defined by the board workflow read payload, including task-specific state for this task, as a first-contact snapshot, regardless of the conversation's preset. It SHALL NOT require a startup tool call. The context SHALL distinguish absent descriptions from authored text and SHALL NOT include other stages' full instructions, scripts, or the exact YAML. The message SHALL be a plugin-sourced native message, SHALL NOT be a user-authored chat message or a system prompt, and SHALL NOT start a turn.

The conversation SHALL present the context as an inline visible context row using the host's native context-row presentation. If that presentation is unavailable, an inline fallback row SHALL preserve the context text. The row SHALL be part of the transcript flow, SHALL appear at the injected message's position, and SHALL scroll with the transcript rather than remaining fixed over it. It SHALL be visible wherever the task conversation is rendered, including the drawer and ordinary native DSH chat. The context SHALL be injected at most once per conversation; later turns and stage instructions SHALL NOT repeat it. Each new conversation SHALL receive its own first-turn context. A conversation with existing messages SHALL NOT receive a new first-turn context, and conversations whose first message predates this behavior SHALL NOT be backfilled.

#### Scenario: First question in the initial column

- **WHEN** the user sends the first message in a task conversation while the task is in the initial stage
- **THEN** the first model request contains the injected task-context message before the user's message
- **AND** the context identifies the task's Hub and board
- **AND** the conversation shows the inline context row at the injected message's position
- **AND** the user's message contains only the text the user sent
- **AND** the task-context message does not start a turn

#### Scenario: First stage instruction in a blank conversation

- **WHEN** a stage instruction is delivered as the first message of a task conversation
- **THEN** the first model request contains the injected task-context message before the instruction
- **AND** the stage-instruction context message contains the stage instruction and, when the stage configures two or more transition targets, the transition briefing defined by `kanban-board`
- **AND** both the task-context row and the stage-instruction row are visible in the conversation

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
- **THEN** the instruction is delivered without repeating the task context
- **AND** the task-context row is not added again

#### Scenario: New conversation after an existing one

- **WHEN** the user creates another task conversation and sends its first message
- **THEN** that conversation receives its own first-turn task-context message
- **AND** the existing conversation is unchanged

#### Scenario: Resume a conversation with history

- **WHEN** a task conversation whose first message already exists is resumed
- **THEN** no new task-context message is injected
- **AND** the durable history and existing context row remain

#### Scenario: Preserve access to an oversized snapshot

- **WHEN** the compact workflow projection exceeds the 6 KiB first-contact budget
- **THEN** the context identifies omitted content without silently truncating an authored description or condition
- **AND** the summary tool provides authorized continuation or paginated record reads

#### Scenario: Inject workflow context for every task preset

- **WHEN** the first model step of a task conversation starts using any preset
- **THEN** the existing task-context message contains the compact workflow snapshot for the task's board
- **AND** it identifies the current stage, stage descriptions and route conditions, project scope, sharing state, and automatic-mode state available at first contact
- **AND** the agent does not need to call a summary tool to obtain that initial context

#### Scenario: Do not pretend the first-contact snapshot is current

- **WHEN** the workflow or task changes after the first context message was delivered
- **THEN** the original context remains labeled as a first-contact snapshot and is not silently replaced
- **AND** current transition choices are read through the transition discovery tool before a routing decision

