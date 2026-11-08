# Spec Delta

## ADDED Requirements

### Requirement: Responsive board opening

The board SHALL be presented from the snapshot the client already holds when the Kanban page is selected, without waiting for a new host read and without discarding conversation attention that is already available. Selecting the page again after visiting another page SHALL behave the same way: the board is presented from the available snapshot and does not wait for a new host read before appearing. Opening the page SHALL NOT wait for any conversation's Session history to be read. A background reconciliation SHALL obtain a current snapshot so that a client whose live stream stopped still recovers, and the board SHALL apply its result without a page reload.

#### Scenario: Open from the published snapshot

- **WHEN** the user selects Kanban while the client holds a published board snapshot
- **THEN** the board is presented without waiting for a new host read
- **AND** no conversation history is read before the board is presented
- **AND** the Hub, board, workflow, and task content are presented

#### Scenario: Reopen without discarding attention

- **WHEN** the user leaves the Kanban page and selects it again
- **THEN** the board is presented without waiting for a new host read
- **AND** attention already resolved for its tasks is still presented

#### Scenario: Recover a stopped live stream

- **WHEN** the client has no current published snapshot or its live stream stopped
- **THEN** a background reconciliation obtains a current snapshot
- **AND** the board presents it without a page reload

### Requirement: Progressive attention presentation

The board SHALL remain interactive while conversation attention is still resolving. Facts for tasks with auto mode enabled and for conversations with observed activity SHALL be resolved before facts for idle historical conversations. A task's attention SHALL be presented when its conversations' facts resolve, without a page reload, and the final state after a burst of activity SHALL NOT be dropped. Before a conversation's facts resolve, its task MAY be presented without that conversation's attention indicators. An automatic advance decision SHALL NOT use a partially resolved attention projection.

#### Scenario: Board first, attention later

- **WHEN** the board is presented while conversation facts are still resolving
- **THEN** the board and its cards remain usable
- **AND** each task's attention appears when its facts resolve, without a reload

#### Scenario: Prioritize active tasks

- **WHEN** one task has auto mode enabled or has observed conversation activity and another task has only idle historical conversations
- **THEN** the active task's attention is resolved first

#### Scenario: Keep the final state after a burst

- **WHEN** several conversations of a task change attention in quick succession
- **THEN** the task presents the final aggregate attention without a reload
- **AND** the board's own attention indicators reflect the same final state

#### Scenario: Recover a failed read

- **WHEN** a conversation's fact read fails transiently
- **THEN** the board presents the correct execution state within two seconds without user action

#### Scenario: Never decide from partial attention

- **WHEN** an automatic advance is evaluated while attention is still resolving
- **THEN** the decision uses the conversations' durable facts rather than the partial presentation
- **AND** no advance is admitted while pending user work exists

### Requirement: Card commands isolated from unrelated work

A card command SHALL persist the change it describes and SHALL NOT perform work that its change does not require. Enabling or disabling a task's auto mode SHALL NOT dispatch pending transitions when no pending transition exists, SHALL NOT recompute team-sharing or authorization state, and SHALL NOT read a conversation's Session history. The auto-mode control SHALL present a pending state while its change is in flight, SHALL present the new setting only after the change is durably persisted, and SHALL NOT remain pending after the command completes or fails.

#### Scenario: Enable auto mode without unrelated work

- **WHEN** the user enables auto mode on a card and no task has a pending transition
- **THEN** the setting is persisted with the task
- **AND** no pending transition is dispatched
- **AND** conversation facts, team-sharing views, and authorization state are not recomputed by that command

#### Scenario: Persisted setting drives the control

- **WHEN** the auto-mode change is in flight
- **THEN** the control presents its pending state
- **AND** it presents the new setting after the change is durably persisted

#### Scenario: A failed change leaves the setting unchanged

- **WHEN** the auto-mode change fails
- **THEN** the control stops presenting the pending state
- **AND** it presents the task's stored setting
- **AND** the failure is reported on the board

#### Scenario: Disable without unrelated work

- **WHEN** the user disables auto mode on a card and no advance is in progress
- **THEN** the setting is removed from the task
- **AND** no pending transition is dispatched and no conversation history is read by that command

### Requirement: Startup reconciliation stays off the interaction path

Plugin startup SHALL restore persisted question projections before the board is presented, and SHALL reconcile Session history and workspace records in the background. The board SHALL remain usable while that background reconciliation runs. An unanswered question that was already persisted SHALL hold an automatic advance before the background reconciliation completes, as defined by Pending user work and Automatic advance after a completed turn. A failure during background reconciliation SHALL be reported and SHALL NOT block the board.

#### Scenario: Persisted questions are available at first paint

- **WHEN** the plugin starts and a conversation has a persisted unanswered question round
- **THEN** the round is available for pending-work evaluation before the board is presented

#### Scenario: Background reconciliation does not block

- **WHEN** the board is presented while Session-history replay or workspace reconciliation is still running
- **THEN** the board remains usable
- **AND** its content completes without a page reload

#### Scenario: The pending-work gate holds during reconciliation

- **WHEN** a completed turn ends before the background reconciliation finishes and a persisted unanswered question exists for that task
- **THEN** no automatic advance is admitted

#### Scenario: A reconciliation failure is reported

- **WHEN** background reconciliation fails for a conversation or workspace
- **THEN** the failure is reported
- **AND** the board is not blocked
