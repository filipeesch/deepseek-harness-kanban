# Spec Delta

## MODIFIED Requirements

### Requirement: Explicit permanent deletion confirmation

Delete SHALL be the only task lifecycle action. The plugin SHALL require explicit confirmation before permanently deleting a task. The confirmation SHALL identify the task and project and SHALL present, in a scannable form, that deletion removes its plugin-owned task data, shared notes, and associated worktree when present; the number of conversations being archived and that their histories remain; the worktree path, branch, and whether the checkout was created by Kanban or attached externally; any unclaimed checkouts that remain on disk; and any conversation that is currently running. It SHALL state that one explicit destructive action confirms normal deletion and that local changes require a separate discard confirmation. It SHALL NOT describe conversation archiving as permanent history deletion or offer task archiving as an alternative. On acceptance, the confirmation SHALL close and the deletion SHALL continue in the background; the confirmation SHALL NOT remain open or busy while the full lifecycle runs. When admission is rejected before the operation is recorded, the confirmation SHALL remain the active context and present the failure. When an accepted deletion later fails, the failure SHALL be presented in the task card status, the board destructive-operation notice, and the drawer operation status, and reopening the deletion confirmation SHALL present the recorded failure and its recovery actions. The plugin SHALL NOT close as if deletion succeeded.

#### Scenario: Review a task deletion with a worktree

- **WHEN** a user requests permanent deletion of a task that has conversations and a worktree
- **THEN** the plugin presents the destructive consequences, conversation count, worktree path and branch, and branch preservation before deletion can be confirmed
- **AND** the confirmation does not offer Archiving as an alternative

#### Scenario: Review a deletion with an attached checkout

- **WHEN** the task's worktree was attached from an existing external checkout rather than created by Kanban
- **THEN** the confirmation identifies the checkout as externally attached and states that the checkout itself will be removed while its branch is kept

#### Scenario: Review a deletion without a worktree

- **WHEN** the task has no associated worktree
- **THEN** the confirmation states that the project folder is not removed and omits worktree-removal consequences

#### Scenario: Decline permanent deletion

- **WHEN** a user declines the permanent deletion confirmation
- **THEN** the plugin does not perform that requested permanent deletion

#### Scenario: Confirmation closes on acceptance

- **WHEN** the host records the confirmed deletion and schedules its execution
- **THEN** the confirmation closes without waiting for the worktree removal, directory returns, or native archiving
- **AND** the card remains on the board with a queued or in-progress deletion status

#### Scenario: Pre-admission rejection remains in the confirmation

- **WHEN** the host rejects the confirmed deletion before recording the operation, for example because the worktree changed
- **THEN** the confirmation remains open with the failure and the applicable recovery action
- **AND** the task is presented as not deleted

#### Scenario: Failure remains in the confirmation context

- **WHEN** an accepted deletion later fails
- **THEN** the card status, the board notice, and the drawer operation status present the failure
- **AND** reopening the deletion confirmation presents the recorded failure and available retry, force, or return recovery
- **AND** the task is presented as not deleted

### Requirement: Best-effort bulk deletion

When the user deletes multiple tasks, the plugin SHALL apply the individual deletion confirmation and semantics to each eligible task. It SHALL skip a task whose conversations are running, whose operation or pending transition is unresolved, or whose worktree has local changes. It SHALL NOT stop conversations or discard local changes to force a bulk deletion. The bulk confirmation SHALL present the selected tasks and the same consequence summary used for individual deletion, including worktree presence and retained histories. A confirmed bulk deletion SHALL report eligible tasks as accepted for background deletion, not as already deleted. The result SHALL identify every skipped task with a user-facing reason, SHALL leave those tasks undeleted and selected, and SHALL distinguish queued tasks from skipped tasks.

#### Scenario: Delete a mixed selection

- **WHEN** the user confirms a bulk deletion containing eligible and blocked tasks
- **THEN** the confirmation presents the selected tasks and their deletion consequences
- **AND** every eligible task is accepted for background deletion with the individual deletion semantics
- **AND** every blocked task remains and its user-facing reason is reported

#### Scenario: Report queued and skipped tasks

- **WHEN** a confirmed bulk deletion admits some tasks and skips others
- **THEN** the result states how many tasks were accepted for deletion and identifies each skipped task and reason
- **AND** the board notice tracks the accepted deletions until they complete or fail

#### Scenario: Do not force a blocked task

- **WHEN** a selected task has a running conversation, an unresolved operation, or local worktree changes
- **THEN** the plugin does not stop the conversation, resolve the operation, or discard the changes to force deletion

## ADDED Requirements

### Requirement: Background deletion admission and progress

A confirmed task deletion SHALL be durably recorded before slow cleanup begins. The host SHALL run the authoritative preflight synchronously before admission, including task idleness, target stability, checkout sharing, and local-change detection, and SHALL reject admission with the applicable existing error when that preflight fails. After admission, the deletion SHALL execute in the background through one host-owned queue that runs at most one destructive operation at a time, and the command response SHALL return before the worktree removal, conversation directory returns, native archiving, or final record removal complete. The board and its commands SHALL remain usable while an admitted deletion runs. The operation SHALL publish a queued state before execution and the existing progress phases during execution. A queued or in-progress operation SHALL resume after a plugin restart, and shutting down the plugin SHALL NOT discard its journal.

#### Scenario: Admission returns before cleanup

- **WHEN** a confirmed deletion passes preflight
- **THEN** the host records the operation, marks it queued, and returns the command response
- **AND** the worktree removal, conversation returns, and native archiving do not hold the command response

#### Scenario: Preflight rejection does not queue

- **WHEN** the task is busy, the target changed, the checkout is shared, or local changes require consent
- **THEN** the deletion is rejected before an operation is queued
- **AND** the applicable existing error and recovery surface are presented

#### Scenario: Board remains usable during deletion

- **WHEN** a task deletion is queued or executing
- **THEN** the user can still move other cards, open tasks, and issue other board commands
- **AND** the deleting card presents a queued or in-progress status

#### Scenario: Destructive operations run one at a time

- **WHEN** more than one destructive operation is admitted
- **THEN** the host executes them in admission order with at most one running at a time
- **AND** the remaining operations stay queued

#### Scenario: Background failure is published

- **WHEN** an admitted deletion fails after admission
- **THEN** the operation is recorded as failed with its phase and problem
- **AND** the failure is published to the connected board without a page reload

#### Scenario: Restart resumes a queued deletion

- **WHEN** the plugin starts and a task has a queued or in-progress deletion
- **THEN** the host resumes that deletion
- **AND** an already-started queue order is not executed twice for the same journal

### Requirement: Force deletion of a shared checkout

When a task deletion fails the sharing preflight with `SHARED_WORKTREE`, the plugin SHALL offer a force deletion action. The force confirmation SHALL list every blocking task and every blocking native conversation, SHALL state that the shared checkout directory will be removed, and SHALL require explicit opt-in before the destructive action is enabled. Force SHALL bypass only the sharing guard and SHALL NOT bypass host filesystem policy, the separate local-change discard consent, or task idleness requirements. The host SHALL refuse the force deletion while another task has an active context operation on the same checkout, and SHALL present that refusal as a recoverable problem. A successful forced deletion SHALL return the task's own conversations to the base project, remove the shared checkout, archive the task's conversations, remove the card and notes, and preserve the Git branch. For every other task bound to the removed checkout, the plugin SHALL persist an error on that binding that identifies the forced deletion and SHALL NOT silently rewrite that task's effective directory.

#### Scenario: Force consent lists every affected party

- **WHEN** the sharing preflight found another task and a foreign native conversation using the checkout
- **THEN** the force confirmation lists both the task and the conversation
- **AND** the destructive action is unavailable until the user explicitly opts in

#### Scenario: Forced deletion completes the removal

- **WHEN** the user explicitly opts in to force deletion and the preflight otherwise permits it
- **THEN** the checkout is removed despite the sharing blockers
- **AND** the task's own conversations are archived and its card and notes are removed
- **AND** the Git branch is preserved

#### Scenario: Active operation on the same checkout refuses force

- **WHEN** another task has an active context operation on the shared checkout
- **THEN** force deletion is refused with a recoverable problem
- **AND** the force action becomes available again after that operation settles

#### Scenario: Host policy still applies

- **WHEN** the host filesystem policy denies removing the shared checkout
- **THEN** the force deletion reports the denial and does not bypass the policy or claim success

#### Scenario: Local changes still require discard consent

- **WHEN** the shared checkout has modified tracked files or untracked files
- **THEN** the separate discard consent is required before the forced removal proceeds
- **AND** declining it leaves the checkout and the task intact

#### Scenario: Affected bindings record the removal

- **WHEN** a forced deletion removes a checkout bound to another task
- **THEN** that other task's worktree binding records an error identifying the forced deletion
- **AND** that other task's effective directory is not silently changed
- **AND** its Git surface explains that the checkout was removed externally
