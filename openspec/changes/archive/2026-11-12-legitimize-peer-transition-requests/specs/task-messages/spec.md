# Spec Delta

## MODIFIED Requirements

### Requirement: Cross-card message tool

The plugin SHALL expose `send_task_message` with a required target task identifier and a required message body. The tool SHALL be available only inside a conversation associated with a task; a call from an ordinary DSH chat, from a session that no task owns, or from a subagent descendant of a task conversation SHALL be rejected with an actionable error without delivering anything. The tool description SHALL require either the user's explicit request in the sending conversation or a stage instruction delivered to that conversation that explicitly directs the message; the plugin SHALL NOT add a deterministic consent check, approval dialog, or persisted consent record. The target SHALL be a task in the sending task's Hub and SHALL NOT be the sending task; any other target SHALL be rejected without delivering anything. A message body that is empty or whitespace-only SHALL be rejected without delivering anything. The plugin SHALL NOT impose a product message-length limit, a delivery-rate limit, or a deferral while the target awaits the user in this version. The result SHALL report the target task, the target conversation, the delivery result, and any worktree or conversation created for the delivery.

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

#### Scenario: Impose no product limits

- **WHEN** an agent sends a long message while the target awaits the user
- **THEN** the message is still delivered under the same rule
- **AND** the plugin applies no product message-length limit, delivery-rate limit, or deferral

#### Scenario: Do not send for the agent's own bookkeeping

- **WHEN** neither the user nor the sending conversation's stage instruction asked for the message
- **THEN** the tool does not authorize the call merely to record the agent's own progress

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

## ADDED Requirements

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
