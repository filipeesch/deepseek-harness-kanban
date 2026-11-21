## MODIFIED Requirements

### Requirement: First-turn task context

The plugin SHALL inject a durable task-context message into the first model step of a task conversation before the first message of the conversation, whatever that message's source. The context SHALL contain the task title, task identifier, description, workflow stage at first contact, the owning Hub name, and the owning board name. It SHALL also contain the workflow map defined by `stage-orientation`, including task-specific state for this task, as a first-contact snapshot, regardless of the conversation's preset. The durable message SHALL identify the stage entry it describes when the task has one. It SHALL NOT require a startup tool call. The context SHALL distinguish absent descriptions from authored text and SHALL NOT include other stages' full instructions, scripts, or the exact YAML. The message SHALL be a plugin-sourced native message, SHALL NOT be a user-authored chat message or a system prompt, and SHALL NOT start a turn.

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
- **AND** the stage-instruction context message contains the orientation block defined by `stage-orientation`, the stage instruction and, when the stage configures two or more transition targets, the transition briefing defined by `kanban-board`
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

- **WHEN** the workflow map exceeds the 16 KiB first-contact budget
- **THEN** the context names each omitted stage and omits it whole without truncating an authored description or condition
- **AND** the summary tool provides authorized continuation or paginated record reads

#### Scenario: Inject workflow context for every task preset

- **WHEN** the first model step of a task conversation starts using any preset
- **THEN** the existing task-context message contains the workflow map for the task's board
- **AND** it identifies the current stage, stage descriptions and route conditions, project scope, sharing state, and automatic-mode state available at first contact
- **AND** the agent does not need to call a summary tool to obtain that initial context

#### Scenario: Do not pretend the first-contact snapshot is current

- **WHEN** the workflow or task changes after the first context message was delivered
- **THEN** the original context remains labeled as a first-contact snapshot and is not silently replaced
- **AND** current transition choices are read through the transition discovery tool before a routing decision

### Requirement: Stage instruction delivery as context

When a task's current stage has an entry instruction and the host delivers that instruction to a task conversation, the host SHALL deliver exactly one plugin-sourced native message and SHALL NOT send it as a user prompt. The message SHALL start the turn that executes the instruction. Its durable source SHALL identify the stage-instruction producer, the delivery identity, and the stage entry it follows when the task has one. Its model-facing content SHALL be the orientation block defined by `stage-orientation`, then the entry instruction, then the reason the recorded transition carried when the advance consumed one, then an identified scripted handoff block when one is pending for this entry, then the transition briefing defined by `kanban-board` when that briefing applies.

The reason SHALL appear only when the delivery follows a transition the agent declared for the stage the task left, and SHALL be presented as its own block that names the stage the task came from and quotes the reason the agent recorded. A delivery that consumed no recorded reason SHALL contain no reason block.

The message SHALL declare the host's notice context form with a one-line summary. The summary SHALL name the entering stage and, when a transition destination applies, that destination — the task's recorded transition while it resolves, otherwise the first configured transition, otherwise the next stage in workflow order. A stage with no applicable destination SHALL produce a summary that names only the entering stage. The summary SHALL be bounded by the host's notice-summary limit and SHALL NOT include the reason block.

The plugin SHALL claim the message with an exclusive Chat Definition and SHALL present it with the host's native context-injection presentation as part of the transcript flow: one collapsed row that expands to the orientation block and the full instruction text, including the declared-reason block, scripted handoff block, and briefing when they apply. If that presentation is unavailable, an inline fallback row SHALL preserve the full text. The row SHALL be visible wherever the task conversation is rendered, including the task drawer and ordinary native DSH chat.

The delivery SHALL NOT be recorded as user input. It SHALL NOT be presented as a user message, SHALL NOT count as pending user work, and SHALL NOT derive a conversation title.

A delivery SHALL be admitted at most once per delivery identity. Before delivering, the host SHALL read the conversation's durable log and SHALL NOT deliver another message when a stage-instruction message with the same identity is already delivered or still pending. A delivery that has a recorded failure SHALL report the failure, SHALL leave the stage entry unresolved, and SHALL NOT be retried automatically, including after a host restart. A durable scripted handoff whose admission was interrupted or uncertain without a recorded delivery failure SHALL instead be reconciled on startup using its same delivery identity: the host SHALL first recognize already-recorded or pending context and SHALL resume only the interrupted admission when needed. This reconciliation SHALL NOT rerun the source script, duplicate accepted context, or turn a recorded failure into an automatic retry.

A scripted handoff block SHALL identify the source stage and execution, the named exit, the output message, and its delivery provenance. It SHALL remain separate from an agent-declared reason: a script result SHALL NOT fabricate a declaration or populate the agent's recorded-transition reason. The block SHALL accompany the destination's own instruction within the same identified native context message, not as a second user prompt or a second model turn. Its message SHALL NOT be included in the collapsed summary, SHALL NOT derive a conversation title, and SHALL NOT repeat the conversation's first-turn task context. Known secret values SHALL be redacted before persistence or display as defined by `scripted-steps`. A source recovery or delivery retry SHALL preserve the same delivery identity, and a handoff bound to another stage entry SHALL NOT be injected here. At actual native admission, after every awaited conversation resume, execution-context check, and durable-log read, the host SHALL confirm that both the destination entry identity and the handoff delivery identity are still authorized for the task. The final identity check and context enqueue SHALL be serialized with entry replacement. Matching only the stage identifier or finding no duplicate message SHALL NOT authorize delivery into an entry that has been replaced.

#### Scenario: Deliver the instruction as context

- **WHEN** the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, or the first execution of a task created by an agent delivers a stage instruction
- **THEN** the conversation receives one plugin-sourced stage-instruction message
- **AND** that message starts the turn that executes the instruction
- **AND** its content is the orientation block, then the entry instruction, then the declared transition's reason when one applies, then the scripted handoff when one applies, then the transition briefing when the stage configures two or more targets

#### Scenario: Include the declared reason

- **WHEN** an advance follows a transition the agent declared and the destination stage has an entry instruction
- **THEN** the delivered message contains the reason block after the instruction
- **AND** the block names the stage the task came from and quotes the recorded reason
- **AND** the scripted handoff, when it applies, follows the reason block
- **AND** the transition briefing, when it applies, follows those context blocks

#### Scenario: Omit the reason without a declared transition

- **WHEN** a stage instruction is delivered for a move or an advance that consumed no recorded reason
- **THEN** the delivered message contains no reason block
- **AND** its content is the orientation block, then the instruction followed by any pending scripted handoff and then the briefing when that briefing applies

#### Scenario: Do not record user input

- **WHEN** a stage instruction is delivered
- **THEN** no user message records it
- **AND** the conversation's pending user work does not count it
- **AND** no conversation title is derived from it

#### Scenario: Present the native context row

- **WHEN** a delivered stage instruction is displayed in a task conversation
- **THEN** it appears as a collapsed context-injection row at its position in the transcript
- **AND** expanding the row shows the orientation block, the instruction text, the declared-reason block, scripted handoff, and briefing when they apply
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

#### Scenario: Deliver a scripted result with the destination instruction

- **WHEN** a saved scripted result selects an agent destination while Auto mode is disabled
- **THEN** the destination conversation receives its own entry instruction and one identified handoff block in the same native context message
- **AND** the block contains the named exit and redacted message without pretending an agent declared a transition
- **AND** Auto mode remains disabled
- **AND** no user message, queued user work, or second model turn is created for the handoff

#### Scenario: Reconcile an interrupted scripted admission

- **WHEN** the host restarts with a durable scripted handoff whose native admission was interrupted and has no recorded delivery failure
- **THEN** recovery checks the same delivery identity against recorded and pending native context
- **AND** it resumes only the unfinished admission when no prior admission exists
- **AND** it does not run the source script again

#### Scenario: Keep an actual scripted delivery failure manual after restart

- **WHEN** a scripted handoff has a recorded delivery failure and the host restarts
- **THEN** the failure and unresolved destination entry remain visible
- **AND** no automatic delivery retry is performed
- **AND** a user-requested retry retains the same delivery identity

#### Scenario: Do not duplicate a recovered scripted handoff

- **WHEN** host recovery retries delivery of a scripted handoff whose native context identity is already recorded or pending
- **THEN** no second context message or handoff block is delivered
- **AND** the source script is not executed again to recover that delivery

#### Scenario: Reject combined context when admission awaits outlive the entry

- **WHEN** native instruction admission awaits conversation or log reads and the task leaves and reenters the same stage before final admission
- **THEN** the replaced destination entry identity causes the old instruction and handoff request to be rejected
- **AND** neither the stale prompt nor its context is enqueued even when the stage identifier matches and no duplicate delivery exists
