# Spec Delta

## ADDED Requirements

### Requirement: Stage instruction delivery as context

When a task's current stage has an entry instruction and the host delivers that instruction to a task conversation, the host SHALL deliver exactly one plugin-sourced native message and SHALL NOT send it as a user prompt. The message SHALL start the turn that executes the instruction. Its durable source SHALL identify the stage-instruction producer and the delivery identity. Its model-facing content SHALL be the entry instruction followed by the transition briefing defined by `kanban-board` when that briefing applies.

The message SHALL declare the host's notice context form with a one-line summary. The summary SHALL name the entering stage and, when a transition destination applies, that destination — the task's recorded transition while it resolves, otherwise the first configured transition, otherwise the next stage in workflow order. A stage with no applicable destination SHALL produce a summary that names only the entering stage. The summary SHALL be bounded by the host's notice-summary limit.

The plugin SHALL claim the message with an exclusive Chat Definition and SHALL present it with the host's native context-injection presentation as part of the transcript flow: one collapsed row that expands to the full instruction text. If that presentation is unavailable, an inline fallback row SHALL preserve the instruction text. The row SHALL be visible wherever the task conversation is rendered, including the task drawer and ordinary native DSH chat.

The delivery SHALL NOT be recorded as user input. It SHALL NOT be presented as a user message, SHALL NOT count as pending user work, and SHALL NOT derive a conversation title.

A delivery SHALL be admitted at most once per delivery identity. Before delivering, the host SHALL read the conversation's durable log and SHALL NOT deliver another message when a stage-instruction message with the same identity is already delivered or still pending. A delivery that fails SHALL report the failure, SHALL leave the stage entry unresolved, and SHALL NOT be retried automatically.

#### Scenario: Deliver the instruction as context

- **WHEN** the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, or the first execution of a task created by an agent delivers a stage instruction
- **THEN** the conversation receives one plugin-sourced stage-instruction message
- **AND** that message starts the turn that executes the instruction
- **AND** its content is the entry instruction followed by the transition briefing when the stage configures two or more targets

#### Scenario: Do not record user input

- **WHEN** a stage instruction is delivered
- **THEN** no user message records it
- **AND** the conversation's pending user work does not count it
- **AND** no conversation title is derived from it

#### Scenario: Present the native context row

- **WHEN** a delivered stage instruction is displayed in a task conversation
- **THEN** it appears as a collapsed context-injection row at its position in the transcript
- **AND** expanding the row shows the instruction text
- **AND** the plugin Definition delegates to the host renderer, with an inline fallback that keeps the text visible

#### Scenario: Name the stage and its target in the summary

- **WHEN** the summary is composed for a task whose stage configures transition targets and whose recorded transition resolves
- **THEN** the summary names the entering stage and the recorded target
- **AND** the summary stays within the host's notice-summary limit

#### Scenario: Name the default target without a recording

- **WHEN** the summary is composed for a stage that configures transition targets and the task has no recorded transition for that stage
- **THEN** the summary names the entering stage and the first configured target

#### Scenario: Name the next stage without configured transitions

- **WHEN** the summary is composed for a stage that configures no transition and a later stage exists in workflow order
- **THEN** the summary names the entering stage and that next stage

#### Scenario: Omit the target when none applies

- **WHEN** the summary is composed for a stage with no applicable destination — no recorded transition, no configured transition, and no later stage in workflow order
- **THEN** the summary names only the entering stage

#### Scenario: Visible in ordinary native chat

- **WHEN** a task conversation containing a delivered stage instruction is opened in ordinary native DSH chat
- **THEN** the context-injection row is visible there as well
- **AND** the presentation is the same as in the drawer

#### Scenario: Deliver at most once per identity

- **WHEN** a delivery is repeated with an identity already recorded or still pending in the conversation
- **THEN** no second stage-instruction message is delivered
- **AND** the conversation keeps the first message

#### Scenario: Report a failed delivery

- **WHEN** a stage-instruction delivery fails
- **THEN** the failure is reported
- **AND** the stage entry remains unresolved
- **AND** no automatic retry occurs

## MODIFIED Requirements

### Requirement: First-turn task context

The plugin SHALL inject a durable task-context message into the first model step of a task conversation before the first message of the conversation, whatever that message's source. The context SHALL contain the task title, task identifier, description, workflow stage at first contact, the owning Hub name, and the owning board name. The message SHALL be a plugin-sourced native message, SHALL NOT be a user-authored chat message or a system prompt, and SHALL NOT start a turn.

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
