# Spec Delta

## ADDED Requirements

### Requirement: Board notice dismissal

The active board SHALL present one dismiss control on each notice it allows the user to dismiss: a retained-checkout entry, the board command-failure notice, and the team-changes banner. The control SHALL be a compact icon-only button at the notice's trailing edge, SHALL carry an accessible name that identifies the notice it dismisses, SHALL have a visible tooltip, SHALL be reachable and operable with the keyboard, and SHALL NOT displace the notice's message, facts, or actions.

The board SHALL NOT offer a dismiss control on a notice that reports work still to resolve: the board load failure, a failed destructive operation, and a project relocation that is waiting or failed. Those notices clear only from host state or from their own recovery action.

Dismissing one notice SHALL remove only that notice. When the dismissed notice was the last dismissible notice on the board, focus SHALL move to the board body; otherwise focus SHALL move to the dismiss control of the next dismissible notice. A dismissal SHALL NOT change task, project, workflow, or publishing state.

A dismissed board command-failure notice SHALL remain dismissed for the current page session, SHALL be replaced by the next failure, and SHALL NOT be stored on the host. Dismissing a retained-checkout entry SHALL be recorded by the host, as defined by the board destructive-operation notice requirement in this capability. Dismissing the team-changes banner SHALL follow the dismissible team-changes banner requirement in `hub-sharing`.

#### Scenario: Dismiss a board command failure

- **WHEN** the board presents a notice that the last command failed and the user activates its dismiss control
- **THEN** the notice is removed from the board
- **AND** the card, drawer, and operation surfaces keep whatever status they already present

#### Scenario: The dismiss control is keyboard operable

- **WHEN** keyboard focus reaches a dismissible notice's dismiss control
- **THEN** the control exposes an accessible name for the notice it dismisses
- **AND** activating it with the keyboard dismisses that notice

#### Scenario: Focus moves after a dismissal

- **WHEN** the user dismisses a notice and another dismissible notice remains
- **THEN** focus moves to that notice's dismiss control
- **WHEN** no dismissible notice remains
- **THEN** focus moves to the board body

#### Scenario: A notice that still needs resolution has no dismiss control

- **WHEN** the board reports a load failure, a failed destructive operation, or an unresolved project relocation
- **THEN** the notice presents no dismiss control
- **AND** its recovery action or its owning surface stays available

#### Scenario: A reload does not restore a dismissed command failure

- **WHEN** the user dismisses a board command-failure notice and reloads the page
- **THEN** the board presents no failure notice until another command fails

## MODIFIED Requirements

### Requirement: Board destructive-operation notice

The active board SHALL present one persistent notice above the board body while a destructive operation is queued or running, while a destructive operation needs attention, or while a deletion retained a checkout path on disk. The notice SHALL present running, queued, and failed operations in an operation group and retained checkouts in a retained group; the operation group SHALL NOT be dismissible, and the retained group SHALL be dismissible.

The operation group SHALL summarize in-progress and queued deletions and worktree removals with the affected task titles. For a failed operation, the operation group SHALL identify the task and offer recovery actions appropriate to the recorded operation, including retry, return when permitted, and force when the failure is `SHARED_WORKTREE`.

The retained group SHALL have its own heading, separate from the operation group, and SHALL report each retained path with the reason its checkout was kept: the checkout is not Git-managed, or the project path or Git root could not be resolved. Each retained entry SHALL be dismissible on its own, and the retained group SHALL offer one action that dismisses every entry it reports, present whenever it reports more than one. Dismissing a retained entry SHALL record the dismissal on the host, SHALL leave the directory on disk untouched, SHALL NOT affect any task, and SHALL NOT be undone by a reload, a panel switch, or another client. A retained record whose directory no longer exists SHALL be removed without a user action.

The notice SHALL update from host state without a reload, SHALL not claim success for an unresolved or failed operation, and SHALL NOT replace the drawer operation status or the card status.

#### Scenario: Show queued and in-progress deletions

- **WHEN** one or more accepted deletions are queued or executing
- **THEN** the board notice identifies the affected tasks and their aggregate state
- **AND** the rest of the board remains usable
- **AND** the operation group presents no dismiss control

#### Scenario: Show a failed destructive operation with recovery

- **WHEN** an accepted deletion or worktree removal fails
- **THEN** the board notice presents the failure and the recovery actions
- **AND** it offers force only when the failure is `SHARED_WORKTREE`
- **AND** it offers return only when returning the task's conversations is permitted
- **AND** the operation group presents no dismiss control

#### Scenario: Report a retained plain checkout

- **WHEN** a deletion completes and leaves a plain checkout on disk because its project is not Git-managed
- **THEN** the retained group reports the retained path
- **AND** the retained group reports that the checkout is not Git-managed
- **AND** the retained group offers a dismiss control for that entry

#### Scenario: Report a retained unverifiable checkout

- **WHEN** a deletion completes after leaving a checkout on disk because the project path or Git root could not be resolved
- **THEN** the retained group reports the retained checkout path
- **AND** the retained group reports that the project path or Git root could not be resolved
- **AND** it does not report that checkout as removed
- **AND** the retained group offers a dismiss control for that entry

#### Scenario: Dismiss one retained checkout

- **WHEN** the user dismisses one entry of the retained group
- **THEN** that entry is removed from the board
- **AND** every other entry of the retained group stays presented
- **AND** the retained checkout directory remains on disk

#### Scenario: Dismiss every retained checkout

- **WHEN** the retained group reports more than one entry and the user activates its dismiss-all action
- **THEN** every reported entry is removed from the board
- **AND** the retained group is no longer presented when no retained checkout remains

#### Scenario: A dismissed retained checkout stays dismissed

- **WHEN** the user dismisses a retained entry and then switches the Kanban panel, or reloads, or connects another client
- **THEN** that entry is not presented again

#### Scenario: Prune a retained checkout whose directory is gone

- **WHEN** the directory of a retained checkout no longer exists
- **THEN** the entry is removed from the board without a user action
- **AND** no other retained entry is removed for that reason

#### Scenario: Notice clears when the operation resolves

- **WHEN** every tracked queued or failed destructive operation resolves or is cleared
- **THEN** the notice no longer presents that operation
- **AND** the card and drawer status remain the authoritative per-task surfaces
