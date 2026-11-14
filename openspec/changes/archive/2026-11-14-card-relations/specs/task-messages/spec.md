# Spec Delta

## MODIFIED Requirements

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
