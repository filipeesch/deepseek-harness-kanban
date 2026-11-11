# Spec Delta

## MODIFIED Requirements

### Requirement: Stage instruction delivery as context

When a task's current stage has an entry instruction and the host delivers that instruction to a task conversation, the host SHALL deliver exactly one plugin-sourced native message and SHALL NOT send it as a user prompt. The message SHALL start the turn that executes the instruction. Its durable source SHALL identify the stage-instruction producer and the delivery identity. Its model-facing content SHALL be the entry instruction, then the reason the recorded transition carried when the advance consumed one, then the transition briefing defined by `kanban-board` when that briefing applies.

The reason SHALL appear only when the delivery follows a transition the agent declared for the stage the task left, and SHALL be presented as its own block that names the stage the task came from and quotes the reason the agent recorded. A delivery that consumed no recorded reason SHALL contain no reason block.

The message SHALL declare the host's notice context form with a one-line summary. The summary SHALL name the entering stage and, when a transition destination applies, that destination — the task's recorded transition while it resolves, otherwise the first configured transition, otherwise the next stage in workflow order. A stage with no applicable destination SHALL produce a summary that names only the entering stage. The summary SHALL be bounded by the host's notice-summary limit and SHALL NOT include the reason block.

The plugin SHALL claim the message with an exclusive Chat Definition and SHALL present it with the host's native context-injection presentation as part of the transcript flow: one collapsed row that expands to the full instruction text, including the reason block and the briefing when they apply. If that presentation is unavailable, an inline fallback row SHALL preserve the full text. The row SHALL be visible wherever the task conversation is rendered, including the task drawer and ordinary native DSH chat.

The delivery SHALL NOT be recorded as user input. It SHALL NOT be presented as a user message, SHALL NOT count as pending user work, and SHALL NOT derive a conversation title.

A delivery SHALL be admitted at most once per delivery identity. Before delivering, the host SHALL read the conversation's durable log and SHALL NOT deliver another message when a stage-instruction message with the same identity is already delivered or still pending. A delivery that fails SHALL report the failure, SHALL leave the stage entry unresolved, and SHALL NOT be retried automatically.

#### Scenario: Deliver the instruction as context

- **WHEN** the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, or the first execution of a task created by an agent delivers a stage instruction
- **THEN** the conversation receives one plugin-sourced stage-instruction message
- **AND** that message starts the turn that executes the instruction
- **AND** its content is the entry instruction, then the declared transition's reason when one applies, then the transition briefing when the stage configures two or more targets

#### Scenario: Include the declared reason

- **WHEN** an advance follows a transition the agent declared and the destination stage has an entry instruction
- **THEN** the delivered message contains the reason block after the instruction
- **AND** the block names the stage the task came from and quotes the recorded reason
- **AND** the transition briefing, when it applies, follows the reason block

#### Scenario: Omit the reason without a declared transition

- **WHEN** a stage instruction is delivered for a move or an advance that consumed no recorded reason
- **THEN** the delivered message contains no reason block
- **AND** its content is the instruction followed by the briefing when that briefing applies

#### Scenario: Do not record user input

- **WHEN** a stage instruction is delivered
- **THEN** no user message records it
- **AND** the conversation's pending user work does not count it
- **AND** no conversation title is derived from it

#### Scenario: Present the native context row

- **WHEN** a delivered stage instruction is displayed in a task conversation
- **THEN** it appears as a collapsed context-injection row at its position in the transcript
- **AND** expanding the row shows the instruction text, the reason block, and the briefing when they apply
- **AND** the plugin Definition delegates to the host renderer, with an inline fallback that keeps the text visible

#### Scenario: Name the stage and its target in the summary

- **WHEN** the summary is composed for a task whose stage configures transition targets and whose recorded transition resolves
- **THEN** the summary names the entering stage and the recorded target
- **AND** the summary stays within the host's notice-summary limit

#### Scenario: Keep the reason out of the summary

- **WHEN** the delivered message carries a reason block
- **THEN** the collapsed summary does not include the reason

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
