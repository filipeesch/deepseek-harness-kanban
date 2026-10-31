# Spec Delta

## MODIFIED Requirements

### Requirement: Bulk task deletion

The board SHALL provide an explicit selection mode that presents a selection control on each card and disables card dragging while active. The user SHALL be able to select multiple tasks across visible stages. A bulk deletion SHALL require one confirmation and SHALL apply the individual task deletion semantics to each eligible task. A task SHALL be skipped when any of its conversations is active through a running turn or unsettled background work, it has a pending operation or transition, or its worktree has local changes. An eligible task SHALL be reported as accepted for background deletion rather than as already deleted. The board SHALL report accepted and skipped tasks and the reason for each skip, SHALL leave skipped tasks selected, and SHALL NOT claim a queued deletion completed. Leaving selection mode SHALL clear the selection.

#### Scenario: Enter selection mode and select tasks
- **WHEN** the user enters selection mode and activates cards in more than one stage
- **THEN** the board marks the selected tasks and disables dragging for them

#### Scenario: Delete eligible tasks
- **WHEN** the user confirms deletion of a selection whose tasks are eligible
- **THEN** each eligible task is accepted for background deletion with the individual deletion semantics
- **AND** the selection is cleared

#### Scenario: Report accepted and skipped tasks
- **WHEN** a confirmed bulk deletion admits some tasks and skips others
- **THEN** the result states how many tasks were accepted for deletion
- **AND** it identifies every skipped task and reason
- **AND** it does not report the accepted tasks as already deleted

#### Scenario: Skip a task with a running conversation
- **WHEN** the user confirms deletion of a selection that includes a task with a running turn or unsettled background work
- **THEN** that task is not deleted, its reason is reported, and it remains selected

#### Scenario: Skip a task with local worktree changes
- **WHEN** the user confirms deletion of a selection that includes a task whose worktree has local changes
- **THEN** that task is not deleted, its reason is reported, and it remains selected

#### Scenario: Leave selection mode
- **WHEN** the user leaves selection mode
- **THEN** the selection is cleared and normal card dragging is restored

### Requirement: Task card status strip

The board SHALL present a card's unresolved context operation and confirmed transition in one status region below the activity region. Each status SHALL carry a tone that distinguishes a failure from a pending state and SHALL present a short label that names the state. A destructive operation's label SHALL use task-deletion or worktree-removal language and SHALL distinguish queued, in progress, and failed states rather than exposing a raw phase token. A status SHALL remain visible while its operation or transition is unresolved. A run-action admission failure SHALL be reported in the same status region. When a card has more than one such fact, the status region SHALL present them together without replacing one with another.

#### Scenario: Report a failed operation
- **WHEN** a card's task has a context operation in a failed phase
- **THEN** the status region presents a failure-toned status naming the failure

#### Scenario: Report a pending deletion
- **WHEN** a card's task has a queued or in-progress deletion or worktree removal
- **THEN** the status region presents a pending-toned status that names the destructive action and its queued or in-progress state
- **AND** it does not present the raw operation phase as the label

#### Scenario: Report a failed deletion
- **WHEN** a card's task has a failed deletion or worktree removal
- **THEN** the status region presents a failure-toned status that names the destructive action as needing attention

#### Scenario: Report a pending transition
- **WHEN** a card's task has a confirmed transition that is not settled
- **THEN** the status region presents a pending-toned status naming the pending confirmation

#### Scenario: Present multiple statuses together
- **WHEN** a task has both an unresolved operation and a confirmed transition
- **THEN** the status region presents both statuses
- **AND** neither status replaces the other

#### Scenario: Report a run-action admission failure
- **WHEN** the run action is activated and the instruction cannot be admitted
- **THEN** the status region reports the failure
- **AND** the run action remains available for the same entry

#### Scenario: Clear a resolved status
- **WHEN** the operation or confirmed transition resolves
- **THEN** the corresponding status is no longer presented in the status region

## ADDED Requirements

### Requirement: Board destructive-operation notice

The active board SHALL present one persistent notice above the board body while a destructive operation is queued or running, while a destructive operation needs attention, or while a deletion retained a checkout path on disk. The notice SHALL summarize in-progress and queued deletions and worktree removals with the affected task titles. For a failed operation, the notice SHALL identify the task and offer recovery actions appropriate to the recorded operation, including retry, return when permitted, and force when the failure is `SHARED_WORKTREE`. The notice SHALL update from host state without a reload, SHALL not claim success for an unresolved or failed operation, and SHALL NOT replace the drawer operation status or the card status. A completed deletion that retained a plain checkout path SHALL be reported with that path and SHALL be dismissible.

#### Scenario: Show queued and in-progress deletions

- **WHEN** one or more accepted deletions are queued or executing
- **THEN** the board notice identifies the affected tasks and their aggregate state
- **AND** the rest of the board remains usable

#### Scenario: Show a failed destructive operation with recovery

- **WHEN** an accepted deletion or worktree removal fails
- **THEN** the board notice presents the failure and the recovery actions
- **AND** it offers force only when the failure is `SHARED_WORKTREE`
- **AND** it offers return only when returning the task's conversations is permitted

#### Scenario: Report a retained plain checkout

- **WHEN** a deletion completes and leaves a plain checkout on disk
- **THEN** the board notice reports the retained path
- **AND** the user can dismiss the report

#### Scenario: Notice clears when the operation resolves

- **WHEN** every tracked queued or failed destructive operation resolves or is cleared
- **THEN** the notice no longer presents that operation
- **AND** the card and drawer status remain the authoritative per-task surfaces
