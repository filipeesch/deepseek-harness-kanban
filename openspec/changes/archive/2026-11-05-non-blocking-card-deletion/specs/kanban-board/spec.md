# Spec Delta

## ADDED Requirements

### Requirement: Bulk deletion fan-out

The board SHALL provide an explicit selection mode that presents a selection control on each card and disables card dragging while active. The user SHALL be able to select multiple tasks across visible stages. A bulk deletion SHALL require one confirmation and SHALL apply the individual task deletion semantics to each selected task. On accept, the board SHALL close the confirmation, SHALL leave selection mode, and SHALL NOT present a result summary. A selected task whose persisted state permits admission SHALL be accepted for background deletion rather than reported as already deleted. A selected task that cannot be admitted SHALL remain on the board and SHALL be reported as a board error naming that task. The board SHALL NOT stop a conversation, resolve an operation, or discard local changes to force a bulk deletion, and SHALL present a later failure of an accepted task through the card status and the destructive-operation notice instead of as a bulk result. Leaving selection mode SHALL clear the selection.

#### Scenario: Enter selection mode and select tasks

- **WHEN** the user enters selection mode and activates cards in more than one stage
- **THEN** the board marks the selected tasks and disables dragging for them

#### Scenario: Delete an eligible selection

- **WHEN** the user confirms deletion of a selection whose tasks permit admission
- **THEN** each selected task is accepted for background deletion with the individual deletion semantics
- **AND** the confirmation closes and the board leaves selection mode immediately
- **AND** no result summary is presented and no task is reported as already deleted

#### Scenario: Report an admission rejection

- **WHEN** a selected task cannot be admitted, for example because it no longer exists or another operation holds it
- **THEN** that task remains on the board and the board reports an error naming it
- **AND** the other selected tasks proceed with their own admission

#### Scenario: Present a later failure

- **WHEN** an accepted task from the selection fails in its queued preflight
- **THEN** the card status and the destructive-operation notice present the failure and its recovery actions
- **AND** the other accepted deletions are unaffected

#### Scenario: Do not force a blocked task

- **WHEN** a selected task has a running conversation, an unresolved operation, or local worktree changes
- **THEN** the board does not stop the conversation, resolve the operation, or discard the changes to force deletion

#### Scenario: Leave selection mode

- **WHEN** the user leaves selection mode
- **THEN** the selection is cleared and normal card dragging is restored

## MODIFIED Requirements

### Requirement: Task card status strip

The board SHALL present a card's unresolved context operation, confirmed transition, and automatic-advance state in one status region below the activity region. Each status SHALL carry a tone that distinguishes a failure from a pending state and SHALL present a short label that names the state. A destructive operation's label SHALL use task-deletion or worktree-removal language and SHALL distinguish checking, queued, in progress, and failed states rather than exposing a raw phase token. A status SHALL remain visible while its operation or transition is unresolved. The automatic-advance status SHALL name the destination stage while an advance is admitted, name a failure when an admitted advance failed, and name the pause reason when auto mode is paused. The status region SHALL NOT report the held state defined by Auto mode on a task card, which the auto-mode control presents instead. A run-action admission failure SHALL be reported in the same status region. When a card has more than one such fact, the status region SHALL present them together without replacing one with another.

#### Scenario: Report a failed operation

- **WHEN** a card's task has a context operation in a failed phase
- **THEN** the status region presents a failure-toned status naming the failure

#### Scenario: Report a pending deletion

- **WHEN** a card's task has a queued or in-progress deletion or worktree removal
- **THEN** the status region presents a pending-toned status that names the destructive action and its queued or in-progress state
- **AND** it does not present the raw operation phase as the label

#### Scenario: Report a destructive preflight

- **WHEN** a card's task has an admitted deletion or worktree removal whose preflight is running
- **THEN** the status region presents a pending-toned status naming the destructive action as being checked
- **AND** it does not present the raw preflight phase as the label

#### Scenario: Report a failed deletion

- **WHEN** a card's task has a failed deletion or worktree removal
- **THEN** the status region presents a failure-toned status that names the destructive action as needing attention

#### Scenario: Report a pending transition

- **WHEN** a card's task has a confirmed transition that is not settled
- **THEN** the status region presents a pending-toned status naming the pending confirmation

#### Scenario: Report an advancing task

- **WHEN** a card's task has an admitted automatic advance that is not settled
- **THEN** the status region presents a pending-toned status naming the destination stage
- **AND** it does not present the advance as a user confirmation

#### Scenario: Report a failed automatic advance

- **WHEN** an admitted automatic advance fails
- **THEN** the status region presents a failure-toned status that names the automatic advance as needing attention
- **AND** the card still exposes the stage run action for an unresolved destination entry

#### Scenario: Report a paused automatic advance

- **WHEN** auto mode is paused
- **THEN** the status region presents a short label naming the pause reason
- **AND** the label distinguishes a turn that did not complete from an advance that could not be admitted

#### Scenario: Do not report the held state

- **WHEN** an armed task has pending user work
- **THEN** the status region presents no entry for the held state
- **AND** the auto-mode control presents it

#### Scenario: Present multiple statuses together

- **WHEN** a task has both an unresolved operation and a confirmed transition
- **THEN** the status region presents both statuses
- **AND** neither status replaces the other

#### Scenario: Report a run-action admission failure

- **WHEN** the run action is activated and the instruction cannot be admitted
- **THEN** the status region reports the failure
- **AND** the run action remains available for the same entry

#### Scenario: Clear a resolved status

- **WHEN** the operation, confirmed transition, or automatic-advance state resolves
- **THEN** the corresponding status is no longer presented in the status region
- **AND** reading a conversation does not clear an automatic-advance pause by itself

## REMOVED Requirements

### Requirement: Bulk task deletion

**Reason**: The board requirement bundled selection with a synchronous skip contract that no longer exists; bulk deletion is now a fan-out of individual admissions and never reports accepted or skipped tasks as a result.

**Migration**: The new "Bulk deletion fan-out" requirement defines the replacement behavior, including selection mode and leaving selection mode.
