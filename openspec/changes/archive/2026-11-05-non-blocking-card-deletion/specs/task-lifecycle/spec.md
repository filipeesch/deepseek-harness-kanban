# Spec Delta

## ADDED Requirements

### Requirement: Bulk deletion admission

When the user deletes multiple tasks, the plugin SHALL apply the individual deletion confirmation and semantics to each selected task and SHALL admit them without serializing the board behind per-task cleanup preflight. The bulk confirmation SHALL present the selected tasks and the same consequence summary used for individual deletion, including worktree presence and retained histories. A confirmed bulk deletion SHALL close the confirmation on accept, SHALL accept every selected task whose persisted state permits admission, SHALL remove accepted tasks from the selection, and SHALL leave selection mode without waiting for the deletions to complete. The plugin SHALL NOT present a bulk result summary, SHALL NOT claim any task deleted, and SHALL NOT stop conversations or discard local changes to force a bulk deletion. A selected task whose persisted state does not permit admission SHALL remain on the board and SHALL be reported as a board error naming that task. Tasks accepted for deletion whose queued preflight later fails SHALL be presented through the individual recovery surfaces.

#### Scenario: Delete an eligible selection

- **WHEN** the user confirms a bulk deletion of tasks whose persisted state permits admission
- **THEN** each selected task is accepted for background deletion with the individual deletion semantics
- **AND** the confirmation closes and the board leaves selection mode without presenting a result summary
- **AND** no task is reported as already deleted

#### Scenario: Report an admission rejection

- **WHEN** a selected task cannot be admitted, for example because it no longer exists or another operation holds it
- **THEN** that task remains on the board and the board reports an error naming it
- **AND** the other selected tasks proceed with their own admission

#### Scenario: Asynchronous failure of a selected task

- **WHEN** a selected task was accepted and its queued preflight fails
- **THEN** its card, the board destructive-operation notice, and the drawer present the recorded failure and its recovery actions
- **AND** the other accepted deletions are unaffected

#### Scenario: Do not force a blocked task

- **WHEN** a selected task has a running conversation, an unresolved operation, or local worktree changes
- **THEN** the plugin does not stop the conversation, resolve the operation, or discard the changes to force deletion
- **AND** that task is presented as queued, waiting, or requiring recovery rather than as deleted

## MODIFIED Requirements

### Requirement: Background deletion admission and progress

A confirmed task deletion or worktree-only removal SHALL be durably recorded before any slow work begins. The host SHALL decide admission from persisted state only: the task exists, its recorded worktree binding still matches the confirmed target, no other context operation holds the task, and no pending transition is mid-delivery. Admission SHALL NOT inspect Git, native conversations, or the filesystem, and SHALL NOT keep the interactive command lane busy for such work. After admission the operation SHALL be marked queued and SHALL execute in the background through one host-owned queue with one lane per repository: at most one destructive operation SHALL run in a lane, and operations on tasks in different repositories MAY run concurrently. Every lane SHALL begin with the authoritative preflight, covering conversation idleness, canonical target stability, checkout sharing, and local-change detection. A busy conversation SHALL move the operation to waiting, which resumes once every conversation is idle. Any other preflight failure SHALL be recorded as a failed operation naming its failing phase instead of rejecting the command. The command response SHALL return before the worktree removal, conversation directory returns, native archiving, or final record removal complete. The board and its commands SHALL remain usable while an operation is admitted, queued, or executing. A queued or in-progress operation SHALL resume after a plugin restart, ordered by its recorded creation time within its lane, and shutting down the plugin SHALL NOT discard its journal.

#### Scenario: Admission returns before cleanup

- **WHEN** a confirmed deletion is admitted from persisted state
- **THEN** the host records the operation, marks it queued, and returns the command response
- **AND** accepting it requires no Git command, native conversation read, or filesystem scan
- **AND** the queued preflight, worktree removal, conversation returns, and native archiving do not hold the command response

#### Scenario: Preflight rejection does not queue

- **WHEN** the persisted-state admission rejects the confirmed deletion because another operation holds the task or the confirmed target no longer matches the recorded binding
- **THEN** the deletion is rejected before an operation is queued
- **AND** the applicable existing error and recovery surface are presented

#### Scenario: A recorded target is never substituted

- **WHEN** a task already has a recorded destructive operation and a new confirmation names a different current binding
- **THEN** the command is rejected with a recoverable target-changed problem
- **AND** the recorded operation keeps its original target and failure state
- **AND** the user resolves or retries the existing operation instead of silently retargeting it

#### Scenario: Queued preflight rejects the cleanup instead of the command

- **WHEN** the queued operation finds a changed target, a shared checkout, or local changes requiring consent
- **THEN** the operation is recorded as failed with its failing phase and the applicable problem
- **AND** the task, its worktree, and its conversations are left unchanged

#### Scenario: A busy conversation defers the queued deletion

- **WHEN** the queued operation finds a conversation that is still running
- **THEN** the operation is recorded as waiting rather than failed and no cleanup starts
- **AND** the card presents the waiting state
- **AND** the operation resumes after the conversations settle, without stopping them

#### Scenario: Recovery from a queued preflight failure

- **WHEN** a deletion failed in its queued preflight
- **THEN** the card, the board notice, and the drawer present the recorded failure and its recovery actions
- **AND** retrying re-runs the preflight without stopping a conversation or discarding local changes
- **AND** when the failure is local changes, the separate discard consent is required before the retry proceeds

#### Scenario: Board remains usable during deletion

- **WHEN** a task deletion is admitted, queued, or executing
- **THEN** the user can still move other cards, open tasks, and issue other board commands
- **AND** the deleting card presents a queued or in-progress status

#### Scenario: Destructive operations run one at a time

- **WHEN** more than one destructive operation is admitted
- **THEN** the host executes them in admission order with at most one running per repository at a time
- **AND** operations for tasks in different repositories may run concurrently
- **AND** the remaining operations stay queued

#### Scenario: Background failure is published

- **WHEN** an admitted deletion fails after admission
- **THEN** the operation is recorded as failed with its phase and problem
- **AND** the failure is published to the connected board without a page reload

#### Scenario: Restart resumes a queued deletion

- **WHEN** the plugin starts and a task has a queued or in-progress deletion
- **THEN** the host resumes that deletion in its repository lane
- **AND** an already-started queue order is not executed twice for the same journal

## REMOVED Requirements

### Requirement: Best-effort bulk deletion

**Reason**: Bulk eligibility was decided synchronously with the cleanup preflight, which is the work this change moves into the destructive queue; the skip-at-admission contract no longer exists.

**Migration**: The new "Bulk deletion admission" requirement defines the replacement behavior. A task that the old contract would have skipped at admission is now admitted and either waits in its queue lane or records a recoverable failure.
