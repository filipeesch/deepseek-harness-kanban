# Spec Delta

## ADDED Requirements

### Requirement: Durable question form drafts

The plugin SHALL persist the in-progress form state of every unresolved question round against the conversation that owns the round, and SHALL restore that state when the round is presented again. The persisted state SHALL comprise each received page's selected choices, Other text, and per-answer notes, the round's Additional Notes, and the question page the user was viewing. The persisted state SHALL NOT comprise the collapsed state of the panel: a restored round SHALL be presented expanded, like a newly arrived round. Draft state SHALL belong to the conversation and SHALL NOT be owned by a task or board record, and the same durability SHALL apply to ordinary DSH chats that have no task card. A persisted draft SHALL NOT be submitted, delivered as a conversation message, or otherwise settled automatically, and it SHALL NOT change the round's completion or answered state.

#### Scenario: Reopen after closing the drawer

- **WHEN** the user answers part of an unresolved round and closes the task drawer
- **THEN** reopening the task restores the selected choices, Other text, per-answer notes, Additional Notes, and the page the user was viewing

#### Scenario: Return to another conversation

- **WHEN** the user answers part of a round in one conversation, switches to another conversation tab, and returns
- **THEN** the round returns with the answers and the page the user had reached

#### Scenario: Reload the application

- **WHEN** the application is reloaded while an unresolved round has a draft
- **THEN** the round returns above the composer with the persisted draft and the same active page

#### Scenario: Closed conversation keeps its draft

- **WHEN** the user closes the conversation tab while it holds an unresolved round with a draft
- **THEN** reopening that conversation restores the draft

#### Scenario: Ordinary chat without a task

- **WHEN** an unresolved round with a draft belongs to an ordinary DSH chat that has no task card
- **THEN** the same restore behavior applies without a task record

#### Scenario: Pages arrive after a restore

- **WHEN** the agent produces additional question pages after a persisted draft was restored
- **THEN** the restored choices, Other text, notes, and Additional Notes remain available
- **AND** the panel announces the newly received page without discarding the draft

#### Scenario: Restored round is never auto-submitted

- **WHEN** a persisted draft is restored with every received answer valid and the agent's turn has ended
- **THEN** Submit remains an explicit user action and no conversation message is produced until the user submits

#### Scenario: Restored round is expanded

- **WHEN** a round with a persisted draft is presented again
- **THEN** its panel is expanded with the restored active page shown

### Requirement: Draft discarded when its round ends

The plugin SHALL discard a conversation's draft for a question round once that round is no longer answerable: when the round is submitted and admitted, when an ordinary chat reply retires the round, or when the round is dismissed. Discarding SHALL NOT send a conversation message, modify the native transcript, or affect another unresolved round's draft. An unresolved round presented after an earlier round was discarded SHALL start with empty answers.

#### Scenario: Submit discards the draft

- **WHEN** the user submits a valid round and the reply is admitted
- **THEN** the stored draft for that round is removed
- **AND** the removed round does not return later with its answers

#### Scenario: Ordinary reply discards the draft

- **WHEN** the user answers the round with an ordinary chat message
- **THEN** the stored draft for that round is removed
- **AND** the round no longer appears above the composer

#### Scenario: Dismissal discards the draft

- **WHEN** the user dismisses the unresolved rounds of a conversation
- **THEN** the stored drafts for those rounds are removed
- **AND** no conversation message is sent

#### Scenario: A newer round starts empty

- **WHEN** the agent presents a new unresolved round after an earlier round was submitted, answered, or dismissed
- **THEN** the newer round starts with empty answers and no inherited draft

### Requirement: Bounded draft retention

The plugin SHALL retain at most the 100 most recently updated conversation draft records. When that bound is exceeded, the records of the least recently updated conversations SHALL be discarded. Draft retention SHALL NOT depend on draft age, and dropping a draft record SHALL NOT remove or alter that conversation's question rounds, their completion, their dismissal state, or their answered state.

#### Scenario: Exceeding the bound

- **WHEN** more than 100 conversation draft records exist
- **THEN** only the 100 most recently updated records are retained

#### Scenario: Recently updated record is retained

- **WHEN** a conversation's draft is updated while the bound is at capacity
- **THEN** that conversation's draft is retained ahead of older records

#### Scenario: Retention does not remove rounds

- **WHEN** a conversation's draft record is dropped by the retention bound
- **THEN** an unresolved round in that conversation is still presented, without a restored draft

### Requirement: Task deletion removes conversation question state

Deleting a task SHALL remove the durable question projection and the question drafts belonging to that task's conversations. Deleting a task SHALL NOT remove question state belonging to another task's conversations or to an ordinary chat, and SHALL NOT modify the native transcripts of the archived conversations.

#### Scenario: Deletion removes the task's question state

- **WHEN** a task with conversations holding question state is deleted
- **THEN** the question projection and drafts for its conversations are removed from durable storage

#### Scenario: Another task is unaffected

- **WHEN** one task is deleted
- **THEN** the question state of every other task's conversations remains available

#### Scenario: Ordinary chat is unaffected

- **WHEN** a task is deleted
- **THEN** question state belonging to an ordinary DSH chat remains available

#### Scenario: Transcript untouched

- **WHEN** a task is deleted
- **THEN** no archived conversation transcript is modified
