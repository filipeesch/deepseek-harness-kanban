# Task Messages Specification

## Purpose

Let a task conversation send a user-authorized message to another task in the same Hub and present it as durable conversation context in the target conversation.

## Requirements

### Requirement: Cross-card message tool

The plugin SHALL expose `send_task_message` with a required target task identifier and a required message body. The tool SHALL be available only inside a conversation associated with a task; a call from an ordinary DSH chat, from a session that no task owns, or from a subagent descendant of a task conversation SHALL be rejected with an actionable error without delivering anything. The tool description SHALL require either the user's explicit request in the sending conversation or a stage instruction delivered to that conversation that explicitly directs the message; the plugin SHALL NOT add a deterministic consent check, approval dialog, or persisted consent record. The target SHALL be a task in the sending task's Hub and SHALL NOT be the sending task; any other target SHALL be rejected without delivering anything. A message body that is empty or whitespace-only SHALL be rejected without delivering anything. The plugin SHALL NOT impose a product message-length limit, a delivery-rate limit, or a deferral while the target awaits the user in this version. The result SHALL report the target task, the target conversation, the delivery result, any worktree or conversation created for the delivery, and the target's stage identifier and activity at delivery.

The reported activity SHALL be the per-task activity a card read reports, and it SHALL be reported as unavailable rather than omitted when the native conversation facts cannot be read. A failure to read the target's activity SHALL NOT fail the call and SHALL NOT withhold the delivery.

#### Scenario: Send a message at the user's request

- **WHEN** an agent in a task conversation calls `send_task_message` for another task in the same Hub after the user explicitly asked for that message
- **THEN** one message is delivered to the target task
- **AND** the result reports the target task and its conversation

#### Scenario: Send a handoff directed by the stage instruction

- **WHEN** the stage instruction delivered to the sending conversation explicitly directs a message to another task and the agent calls `send_task_message` without a separate user request
- **THEN** one message is delivered under the same rules
- **AND** the result reports the target task and its conversation

#### Scenario: Reject a call outside a task conversation

- **WHEN** an agent calls `send_task_message` from an ordinary DSH chat or from a session that no task owns
- **THEN** the tool rejects the request with an actionable error
- **AND** nothing is delivered

#### Scenario: Reject a subagent descendant

- **WHEN** an agent calls `send_task_message` from a subagent descendant of a task conversation
- **THEN** the tool rejects the request with an actionable error
- **AND** nothing is delivered

#### Scenario: Reject the sending task

- **WHEN** an agent calls `send_task_message` with the sending task as the target
- **THEN** the tool rejects the request with an actionable error
- **AND** nothing is delivered

#### Scenario: Reject a target in another Hub

- **WHEN** an agent calls `send_task_message` for a task owned by another Hub
- **THEN** the tool rejects the request with an actionable error
- **AND** nothing is delivered

#### Scenario: Reject an empty message

- **WHEN** an agent calls `send_task_message` with a body that is empty or whitespace-only
- **THEN** the tool rejects the request with an actionable error
- **AND** nothing is delivered

#### Scenario: Report created resources

- **WHEN** a delivery creates a worktree or a conversation for the target task
- **THEN** the result reports each created resource
- **AND** the result reports the delivered message

#### Scenario: Report the target's stage and activity

- **WHEN** a message is delivered to a target task that is in a stage and whose conversation is running
- **THEN** the result reports the target's stage identifier
- **AND** the result reports the target's activity, including that its conversation is running

#### Scenario: Report unavailable target activity

- **WHEN** the target's native conversation facts cannot be read during delivery
- **THEN** the message is still delivered
- **AND** the result reports the target's activity as unavailable

#### Scenario: Impose no product limits

- **WHEN** an agent sends a long message while the target awaits the user
- **THEN** the message is still delivered under the same rule
- **AND** the plugin applies no product message-length limit, delivery-rate limit, or deferral

#### Scenario: Do not send for the agent's own bookkeeping

- **WHEN** neither the user nor the sending conversation's stage instruction asked for the message
- **THEN** the tool does not authorize the call merely to record the agent's own progress

### Requirement: Message delivery as conversation context

The plugin SHALL deliver exactly one plugin-sourced native message into the resolved target conversation and SHALL NOT deliver it as a user prompt. The message SHALL use the host's steer semantics: a running target consumes it at its next step, and an idle target starts a new turn with it. The durable source SHALL identify the message producer and a delivery identity derived from the sending conversation and the tool call. The model-facing content SHALL name the sending task's Hub, board, title, and identifier and SHALL contain the message body. The message SHALL declare the host's notice context form with a one-line summary that names the sending task and stays within the host's notice-summary limit. The plugin SHALL deliver at most once per delivery identity: before delivering it SHALL check the target conversation's pending inbox and its durable log and SHALL skip a duplicate. A delivery that fails SHALL report the failure and SHALL NOT retry automatically. The delivery SHALL NOT be recorded as user input, SHALL NOT count as pending user work, and SHALL NOT derive a conversation title.

#### Scenario: Deliver to an idle target

- **WHEN** the target task's conversation is idle and receives a cross-card message
- **THEN** the message starts one new turn in that conversation
- **AND** the conversation receives exactly one message for that delivery

#### Scenario: Deliver to a running target

- **WHEN** the target task's conversation is running and receives a cross-card message
- **THEN** the running agent consumes the message at its next step

#### Scenario: Deduplicate a repeated call

- **WHEN** the same delivery identity reaches the target conversation again
- **THEN** no second message is delivered
- **AND** the original delivery remains unchanged

#### Scenario: Do not count as user input

- **WHEN** a cross-card message is delivered
- **THEN** no user message records it
- **AND** the conversation's pending user work does not count it
- **AND** no conversation title is derived from it

#### Scenario: Report a failed delivery

- **WHEN** the delivery cannot be admitted to the target conversation
- **THEN** the tool reports the failure
- **AND** the delivery is not retried automatically

### Requirement: Target conversation preparation

The plugin SHALL resolve the target task's first open conversation. When the task has no open conversation, the plugin SHALL prepare one before delivering. A worktree binding in the preparing or error state SHALL block the delivery with an actionable error, and the plugin SHALL NOT create a worktree or a conversation. For a Git-backed task with no worktree and no recorded base-project choice, the plugin SHALL create the task's default worktree using the same title-derived defaults as the automatic first execution and SHALL wait until that worktree is ready before creating the conversation. For a task with a ready or attached worktree, a recorded base-project choice, or a folder project, the plugin SHALL use the task's current effective directory. The plugin SHALL create the first conversation through the same conversation-retention behavior as other first-conversation preparation, using the board's default model when the board names one and the deployment default otherwise, and presenting no native model selector. If the worktree or the conversation cannot be prepared, the delivery SHALL fail without sending the message and SHALL report the failure, and a worktree already created SHALL remain. The result SHALL report the created worktree and the created conversation.

#### Scenario: Deliver to the first open conversation

- **WHEN** the target task has more than one open conversation
- **THEN** the message is delivered to the first open conversation in task order
- **AND** no other conversation of the task receives it

#### Scenario: Create the first conversation with a default worktree

- **WHEN** the target task has no conversation and is Git-backed with no worktree and no recorded base-project choice
- **THEN** the task's default worktree is created
- **AND** the first conversation is created after that worktree is ready
- **AND** the message is delivered to that conversation

#### Scenario: Use the base project after the recorded choice

- **WHEN** the target task has no conversation and records the base-project choice
- **THEN** the first conversation is created in the task's current effective directory
- **AND** no worktree is created

#### Scenario: Block on a preparing or error worktree binding

- **WHEN** the target task has no conversation and its worktree binding is preparing or in error
- **THEN** the delivery fails with an actionable error
- **AND** no worktree and no conversation are created
- **AND** nothing is delivered

#### Scenario: Keep a created worktree when the conversation cannot be prepared

- **WHEN** the default worktree is created and the first conversation cannot be created
- **THEN** the delivery fails without sending the message
- **AND** the created worktree remains

#### Scenario: Use the board or deployment default model

- **WHEN** the delivery creates the target task's first conversation
- **THEN** the conversation uses the board's default model when the board names one and the deployment default otherwise
- **AND** no native model selector is presented and no model selection is submitted

### Requirement: Reply model

A target agent SHALL reply by calling `send_task_message` with the sending task as the target. It SHALL send a reply only when the received message explicitly asks for a reply in its text; without such a request, it SHALL reply only when the user in the target conversation explicitly asks. The plugin SHALL NOT add a reply flag, thread identifier, reply record, or automatic reply. The sending agent SHALL include the reply request in the message body when the user, the stage instruction that directed the message, or the need for the outcome of the request requires one. The rule SHALL be agent-use guidance in the tool description, and the plugin SHALL NOT validate or enforce the presence of a reply request deterministically.

#### Scenario: Reply when the message asks

- **WHEN** a received message explicitly asks for a reply and the target agent calls `send_task_message` for the sending task
- **THEN** the reply is delivered to the sending task
- **AND** the reply is an ordinary cross-card message

#### Scenario: Do not reply when the message does not ask

- **WHEN** a received message does not ask for a reply and the user in the target conversation did not ask for one
- **THEN** the target agent sends no reply

#### Scenario: Include the reply request when the user asked for a reply

- **WHEN** the user asks the sending agent for a reply
- **THEN** the message body explicitly asks for that reply

#### Scenario: Include the reply request when the stage instruction asked for it

- **WHEN** the stage instruction that directed the message asks for a reply
- **THEN** the message body explicitly asks for that reply

#### Scenario: Add no reply metadata or thread

- **WHEN** a reply is delivered
- **THEN** the delivery carries no reply flag, thread identifier, or reply record
- **AND** the transcript shows it as an ordinary cross-card message

### Requirement: Transcript presentation and non-effects

The plugin SHALL claim the message with an exclusive Chat Definition and present it at its position in the transcript as one collapsed context row using the host's native context-injection presentation, with an inline fallback that keeps the full text visible. The row SHALL be visible wherever the task conversation is rendered, including the task drawer and ordinary native DSH chat. The row summary SHALL name the sending task and SHALL stay within the host's notice-summary limit, and expanding the row SHALL show the full message. The plugin SHALL NOT add a messages section, a card indicator, an unread state, a broadcast, or persisted message history. The delivery SHALL NOT create, change, or remove a Hub, board, project, task, note, team file, or sharing document, beyond the first-conversation preparation defined by Target conversation preparation. A turn started by a cross-card message SHALL remain an ordinary turn for automatic advance: the automatic-advance rules SHALL apply unchanged and the message SHALL NOT pause auto mode.

#### Scenario: Present the native context row

- **WHEN** a delivered cross-card message is displayed in the target conversation
- **THEN** it appears as a collapsed context-injection row at its position in the transcript
- **AND** the row is visible in the task drawer and in ordinary native DSH chat

#### Scenario: Expand the row

- **WHEN** the user expands the row
- **THEN** the full message text is visible

#### Scenario: Add no extra surface or persisted history

- **WHEN** cross-card messages exist for a task
- **THEN** the plugin presents no messages section, card indicator, unread state, or stored message history for them

#### Scenario: Write no Hub, team-file, or sharing state

- **WHEN** a cross-card message is delivered without preparing a conversation
- **THEN** no Hub, board, project, task, note, team file, or sharing document changes

#### Scenario: Let automatic advance behave unchanged

- **WHEN** a turn started by a cross-card message ends
- **THEN** the automatic-advance rules apply exactly as for any other completed turn
- **AND** the message does not pause auto mode

### Requirement: Peer transition request

A cross-card message MAY explicitly request that the receiving task declare a transition to a stage the message names. The request SHALL be ordinary message text: the plugin SHALL NOT add a request marker, envelope, argument, or deterministic validation of the body, and recognizing the message as a request SHALL remain a judgment made by the receiving agent.

The receiving task SHALL decide the declaration under its own rules. The destination SHALL be a target its current stage configures, a nonempty reason SHALL still be required, and its own stage instruction, authored conditions, deterministic entry, pending user work, and unresolved stage entry SHALL continue to govern whether the task may leave. A peer request SHALL NOT relax, replace, or override any of those rules, and SHALL NOT authorize the receiving task to create, edit, or delete a task, board, note, or team file.

The sending agent SHALL be guided to read the receiving task's allowed transitions before composing the request, and to include the destination stage identifier and the reason in the body. A message SHALL NOT validate the request against the receiving task's workflow before delivery: a request the receiving task cannot satisfy SHALL surface in that task's turn. The request SHALL NOT move the card by itself; the receiving task's declaration acts only at the end of its own completed turn, under the existing automatic-advance rules.

#### Scenario: Declare a transition requested by a peer message

- **WHEN** a task receives a cross-card message that explicitly asks it to declare a transition to a named stage, its current stage configures that target, and no pending user work or unresolved stage entry holds it
- **THEN** the receiving agent may declare that transition with a reason
- **AND** the task moves to that stage at the end of its completed turn even when auto mode is disabled

#### Scenario: Keep the receiving stage's conditions

- **WHEN** a task whose auto mode is disabled receives a transition request, its stage instruction makes leaving conditional, and that condition is unmet
- **THEN** the receiving task does not declare the requested transition
- **AND** the card stays in its stage

#### Scenario: Reject a request the receiving stage does not configure

- **WHEN** a task whose auto mode is disabled receives a request for a destination its current stage does not configure
- **THEN** the declaration is rejected under the existing transition rules
- **AND** the card stays in its stage

#### Scenario: Do not move a card without a declaration

- **WHEN** a task whose auto mode is disabled receives a cross-card message that asks for a transition and its agent ends the turn without declaring one
- **THEN** no advance is admitted
- **AND** the card's stage and position are unchanged

#### Scenario: Do not validate the request at send time

- **WHEN** an agent sends a transition request to a task whose stage cannot declare it
- **THEN** the message is delivered under the ordinary rules
- **AND** the failure surfaces in the receiving task's turn instead of the sending call

#### Scenario: Do not widen authority

- **WHEN** a cross-card message asks the receiving task to create, edit, or delete a task, board, note, or team file
- **THEN** that action still requires the receiving conversation's user to request it

#### Scenario: Ask for a reply when the outcome matters

- **WHEN** the sending agent needs the outcome of a transition request
- **THEN** its body explicitly asks for a reply
- **AND** the reply follows the existing reply rules
