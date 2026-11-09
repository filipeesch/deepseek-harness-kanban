# Spec Delta

## MODIFIED Requirements

### Requirement: Next-stage action in the drawer header

The drawer header SHALL offer an action that moves the task to the destination that resolves for its current stage: the task's recorded transition while that transition resolves, otherwise the stage that follows the current stage in workflow order. The action SHALL follow the same move rules as the drawer's stage control: a restricted transition SHALL require the same explicit confirmation, a first execution SHALL present the same execution preparation before the move, and an instructed destination SHALL arm the same timed stage instruction and present the same countdown notice with its cancel action. A recorded transition that no longer resolves SHALL make the action refuse without moving the task, presenting the same explanation used for the `transition-stale` pause. The action SHALL be unavailable while the task has an unresolved operation or confirmed transition or while a move is in flight. The action SHALL NOT be presented when no destination resolves. Its accessible name and tooltip SHALL name the destination stage and SHALL identify a destination that requires confirmation.

#### Scenario: Advance to the next stage

- **WHEN** the user activates the next-stage action on a task that records no transition and is not in the last workflow stage
- **THEN** the task moves to the next stage in workflow order
- **AND** the drawer stays in its current section
- **AND** an instructed destination presents the countdown notice instead of writing to the composer

#### Scenario: Use the recorded transition

- **WHEN** the user activates the next-stage action on a task whose recorded transition still resolves
- **THEN** the task moves to the stage of that recorded transition
- **AND** the drawer stays in its current section

#### Scenario: Refuse a recorded transition that no longer resolves

- **WHEN** the user activates the next-stage action on a task whose recorded transition no longer resolves
- **THEN** the move is refused and the failure is presented in the drawer
- **AND** the task remains in its current stage and position
- **AND** no instruction is sent

#### Scenario: Name the recorded destination

- **WHEN** the next-stage action is presented for a task with a recorded transition that resolves
- **THEN** its accessible name and tooltip name the recorded destination stage

#### Scenario: Confirm a restricted next stage

- **WHEN** the destination requires confirmation and the user activates the next-stage action
- **THEN** the same explicit confirmation is presented as for a restricted board drop
- **AND** the task remains in its current stage until the user confirms or cancels
- **AND** canceling leaves the task in its current stage

#### Scenario: Prepare a first execution before advancing

- **WHEN** the task has no conversation and the destination stage has an entry instruction
- **THEN** the execution preparation is presented before the task moves
- **AND** the task remains in its current stage until the preparation completes or is canceled

#### Scenario: Hide the action in the last stage

- **WHEN** the task is in the last workflow stage and records no transition that resolves
- **THEN** the next-stage action is not presented

#### Scenario: Disable the action during an unresolved operation

- **WHEN** the task has an unresolved context operation or confirmed transition, or a move is in flight
- **THEN** the next-stage action is unavailable

#### Scenario: Name the destination for assistive technology

- **WHEN** the next-stage action is presented
- **THEN** its accessible name and tooltip name the destination stage
- **AND** a destination that requires confirmation is identified as such

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
- **AND** the instruction message contains the stage instruction and, when the stage configures two or more transition targets, the transition briefing defined by `kanban-board`
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
