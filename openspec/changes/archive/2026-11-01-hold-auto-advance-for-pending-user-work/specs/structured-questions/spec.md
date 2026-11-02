# Spec Delta

## ADDED Requirements

### Requirement: An unanswered round is pending user work

A structured question round with no answer SHALL count as pending user work as defined by Pending user work in `kanban-board`, so a task with auto mode enabled does not advance while the round is open, including when the round belongs to a conversation whose tab is closed. Submitting the round, replying with an ordinary chat message, or dismissing the round SHALL consume that item. The pending state SHALL be presented by the auto-mode control and SHALL NOT add a question-panel, status-strip, or drawer-notice entry of its own.

#### Scenario: An open round holds auto mode
- **WHEN** a task with auto mode enabled has an unanswered round and a completed turn ends
- **THEN** the host admits no automatic advance
- **AND** the task remains in its current stage

#### Scenario: A closed tab still holds auto mode
- **WHEN** the conversation holding an unanswered round has its tab closed
- **THEN** the round still counts as pending user work for the task

#### Scenario: Submit consumes the pending state
- **WHEN** the user submits the round
- **THEN** the round no longer counts as pending user work
- **AND** the next completed turn re-evaluates the advance

#### Scenario: An ordinary reply consumes the pending state
- **WHEN** the user answers through the normal chat composer while the round is unresolved
- **THEN** the round no longer counts as pending user work
- **AND** the next completed turn re-evaluates the advance

#### Scenario: Dismissal consumes the pending state
- **WHEN** the user dismisses the unresolved round
- **THEN** the round no longer counts as pending user work
- **AND** no answer is submitted and no conversation message is sent

#### Scenario: The pending state does not add a question surface
- **WHEN** a round counts as pending user work for an auto-mode task
- **THEN** no additional question panel, status-region entry, or drawer notice is presented because of that
- **AND** the auto-mode control presents the held state
