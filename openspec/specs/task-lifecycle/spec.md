# Task Lifecycle Specification

## Purpose

Provide explicit deletion of plugin-owned task data and worktrees while archiving native conversations, preserving Git branches, and protecting base projects.

## Requirements

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

### Requirement: Delete is the only task lifecycle action
The plugin SHALL NOT provide task archive, task restore, or an archived-task view. Delete SHALL be the only task lifecycle action offered, and it SHALL be available from the task drawer and from the board's bulk selection.

#### Scenario: Inspect task lifecycle actions
- **WHEN** the user opens a task drawer
- **THEN** Delete is offered and Archive and Restore are absent

#### Scenario: View the board
- **WHEN** the user views the board
- **THEN** no archived-task view, filter, or restore action is offered

### Requirement: Successful task deletion archives conversations and keeps its branch

A successfully completed task deletion SHALL remove the task card and its shared notes and archive every retained top-level native DSH conversation associated with the task without erasing their histories. Native subagent descendants of those conversations SHALL belong to the task's conversation lineage for ownership decisions but SHALL NOT be moved or archived individually; archiving a parent conversation SHALL gate descendant execution according to native behavior. Before removing an associated worktree, the plugin SHALL return every retained task conversation to the base project path through the all-idle directory coordinator. If that return fails, the plugin SHALL retain the worktree and recovery information rather than report deletion success. Successful deletion SHALL remove an eligible associated worktree, including an externally attached checkout, preserve the task's associated Git branch, and SHALL NOT delete native conversation log files directly.

#### Scenario: Permanently delete an idle task with a clean unshared worktree

- **WHEN** the task's conversations are idle, its worktree is not in use by another task or a foreign native session, its worktree is clean, and the user confirms permanent deletion
- **THEN** successful deletion removes the card, notes, and worktree, archives the associated native conversations while retaining their histories, and leaves its Git branch intact

#### Scenario: Permanently delete an idle task without a worktree

- **WHEN** an idle task has no associated worktree and the user confirms its permanent deletion
- **THEN** successful deletion removes the card and notes and archives the associated conversations with their histories retained, without removing the base project directory

#### Scenario: Delete a task whose subagent child uses the worktree

- **WHEN** an idle task's conversation has a direct or nested native subagent descendant whose effective directory is inside the task's worktree
- **THEN** the subagent descendant does not block deletion
- **AND** the parent conversation is archived while the descendant is not moved or archived individually
- **AND** native behavior remains responsible for gating or recovering the descendant after the worktree is removed

#### Scenario: Delete a task with an externally attached worktree

- **WHEN** an idle task has a clean, unshared externally attached worktree and the user confirms permanent deletion
- **THEN** deletion removes that checkout, keeps the associated branch, and retains the native conversation histories

#### Scenario: Delete a task whose worktree directory is already absent

- **WHEN** the recorded worktree directory no longer exists and the user confirms permanent deletion
- **THEN** the sharing preflight does not fail because the directory is absent
- **AND** deletion completes the remaining task cleanup without substituting the base project or Git root

#### Scenario: Resume an archived conversation after task deletion

- **WHEN** task deletion has removed its worktree and a user later unarchives one of its retained native conversations whose base project path is /repos/platform/services/api
- **THEN** the conversation retains its history and uses /repos/platform/services/api rather than the deleted worktree or /repos/platform

#### Scenario: Retain the worktree when returning a conversation fails

- **WHEN** a retained task conversation cannot be returned to its base project path during task deletion
- **THEN** the worktree is not removed, recovery information remains available, and the plugin does not report successful deletion

### Requirement: Additional explicit consent to discard local worktree changes
If a worktree removal or task deletion would discard modified tracked files or untracked files, the plugin SHALL require additional explicit discard confirmation beyond the ordinary removal or deletion confirmation. The presence of those changes SHALL result in a discard choice rather than an unconditional prohibition on removal. Declining the discard confirmation SHALL NOT discard the local files or remove the worktree.

#### Scenario: Confirm discarding modified tracked files
- **WHEN** an idle task has an otherwise removable unshared worktree containing modified tracked files and the user confirms its deletion
- **THEN** the plugin requires additional explicit confirmation to discard those modifications before removing that worktree

#### Scenario: Confirm discarding untracked files
- **WHEN** an idle task has an otherwise removable unshared worktree containing untracked files and the user requests worktree-only removal
- **THEN** the plugin requires additional explicit confirmation to discard those files before removing that worktree

#### Scenario: Decline discarding local changes
- **WHEN** the user declines the additional discard confirmation for a worktree containing local changes
- **THEN** those local files and the worktree are not removed by the requested destructive operation

#### Scenario: Allow an explicitly confirmed discard
- **WHEN** an idle task has an otherwise removable unshared worktree with local changes, the user supplies both the ordinary destructive-action confirmation and the additional discard confirmation, and the host permits removal
- **THEN** those changes do not by themselves prevent the confirmed worktree removal from proceeding

### Requirement: Base project directories are never cleanup substitutes
A task without an associated worktree SHALL NEVER cause deletion of its base project directory or Git root. Cleanup SHALL NOT substitute a conversation's base working directory for a missing worktree target, including when that project is a monorepo subdirectory.

#### Scenario: Delete a monorepo task that never had a worktree
- **WHEN** permanent deletion succeeds for an idle task whose base project path is /repos/platform/services/api, whose Git root is /repos/platform, and which has no worktree
- **THEN** neither /repos/platform/services/api nor /repos/platform is removed as task cleanup

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
