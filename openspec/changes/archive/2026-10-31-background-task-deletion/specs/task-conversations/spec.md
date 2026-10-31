# Spec Delta

## MODIFIED Requirements

### Requirement: Visible operation status and recovery

The task drawer SHALL show the task's current context operation above its section tabs for every operation kind, including create, attach, return, remove, and delete. The status SHALL distinguish queued, waiting, in progress, and failed states; SHALL state which steps completed and which remain; and SHALL offer Retry when the recorded operation can resume. It SHALL offer Return only when returning the task's conversations to the base project is permitted; it SHALL NOT offer Return once native conversation archiving has begun. It SHALL offer a force action when a deletion or worktree removal failed the sharing preflight with `SHARED_WORKTREE`. The status SHALL remain visible from the Conversations, Info, Git, and Notes sections and SHALL use user-facing language rather than a raw error code as its primary explanation. A destructive confirmation SHALL close when the host accepts the operation; if that operation later fails, reopening the confirmation SHALL present the recorded failure and its recovery instead of presenting the task as deleted.

#### Scenario: A failed deletion is visible from every section

- **WHEN** a deletion fails before moving any conversation, removing the worktree, or archiving a conversation
- **THEN** opening the task drawer shows the failed operation above the tabs from any section
- **AND** the status states that no chats were moved and no worktree or archive change completed
- **AND** Retry and Return are available when their preconditions permit

#### Scenario: Waiting for idle is visible

- **WHEN** a context operation is waiting for every task conversation to become idle
- **THEN** the status explains that it is waiting and remains visible outside Conversations and Git
- **AND** it does not present the operation as failed

#### Scenario: Queued deletion is visible

- **WHEN** an accepted deletion is waiting for its turn in the destructive-operation queue
- **THEN** the status identifies the operation as queued rather than waiting for idle or in progress
- **AND** the status remains visible outside Conversations and Git

#### Scenario: Return is unavailable after archiving starts

- **WHEN** a failed deletion has already archived at least one native conversation
- **THEN** the status does not offer Return as a recovery action
- **AND** it directs the user to retry the recorded deletion instead

#### Scenario: Force recovery is offered for a shared checkout

- **WHEN** a deletion or worktree removal failed with `SHARED_WORKTREE`
- **THEN** the operation status offers the force action
- **AND** the force confirmation lists the affected tasks and conversations before the action can proceed

#### Scenario: Confirmation reopens with the recorded failure

- **WHEN** an accepted destructive operation later failed and the user reopens its confirmation
- **THEN** the confirmation presents the recorded failure and recovery actions
- **AND** it does not present the operation as completed

#### Scenario: Operation copy follows the operation kind

- **WHEN** the current operation is a worktree creation, attachment, return, removal, or task deletion
- **THEN** the status uses copy and recovery actions appropriate to that kind and phase
- **AND** it does not describe a deletion as a "worktree operation" or report a "conversations switched" count as the primary explanation
