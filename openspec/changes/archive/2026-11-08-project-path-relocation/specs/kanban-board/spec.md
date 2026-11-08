# Spec Delta

## MODIFIED Requirements

### Requirement: Board destructive-operation notice

The active board SHALL present one persistent notice above the board body while a destructive operation is queued or running, while a destructive operation needs attention, or while a deletion retained a checkout path on disk. The notice SHALL summarize in-progress and queued deletions and worktree removals with the affected task titles. For a failed operation, the notice SHALL identify the task and offer recovery actions appropriate to the recorded operation, including retry, return when permitted, and force when the failure is `SHARED_WORKTREE`. The notice SHALL update from host state without a reload, SHALL not claim success for an unresolved or failed operation, and SHALL NOT replace the drawer operation status or the card status. A completed deletion that retained a checkout path — because the checkout is not Git-managed or because the project path or Git root could not be resolved — SHALL be reported with that path and SHALL be dismissible.

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

#### Scenario: Report a retained unverifiable checkout

- **WHEN** a deletion completes after leaving a checkout on disk because the project path or Git root could not be resolved
- **THEN** the board notice reports the retained checkout path
- **AND** it does not report that checkout as removed
- **AND** the user can dismiss the report

#### Scenario: Notice clears when the operation resolves

- **WHEN** every tracked queued or failed destructive operation resolves or is cleared
- **THEN** the notice no longer presents that operation
- **AND** the card and drawer status remain the authoritative per-task surfaces

## ADDED Requirements

### Requirement: Board project relocation notice

The active board SHALL present one compact notice above the board body while a project relocation is waiting for conversations or has failed. The notice SHALL identify the project and its state, SHALL offer retry for a failed relocation, SHALL update from host state without a reload, and SHALL NOT claim a relocation completed while it is unresolved. It SHALL NOT replace the Projects section as the authoritative relocation surface.

#### Scenario: Show a waiting relocation

- **WHEN** a project relocation is waiting for conversations to become idle
- **THEN** the board notice identifies the project and states that it is waiting
- **AND** the board remains usable

#### Scenario: Show a failed relocation with retry

- **WHEN** a project relocation failed
- **THEN** the board notice identifies the project, presents the recorded problem, and offers retry

#### Scenario: Clear the notice when the relocation resolves

- **WHEN** the relocation completes, is cancelled, or is no longer recorded
- **THEN** the notice no longer presents that project
