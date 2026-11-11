# Spec Delta

## MODIFIED Requirements

### Requirement: Background deletion admission and progress
A confirmed task deletion or worktree-only removal SHALL be durably recorded before any slow work begins. The host SHALL decide admission from persisted state only: the task exists, its recorded worktree binding still matches the confirmed target, no other context operation holds the task, and no pending transition is mid-delivery. Admission SHALL NOT inspect Git, native conversations, or the filesystem, and SHALL NOT keep the interactive command lane busy for such work. After admission the operation SHALL be marked queued and SHALL execute in the background through one host-owned queue with one lane per repository: at most one destructive operation SHALL run in a lane, and operations on tasks in different repositories MAY run concurrently. Every lane SHALL begin with the authoritative preflight, covering conversation idleness, canonical target stability, checkout sharing, and local-change detection. A busy conversation SHALL move the operation to waiting, which resumes once every conversation is idle. Any other preflight failure SHALL be recorded as a failed operation naming its failing phase instead of rejecting the command. The command response SHALL return before the worktree removal, conversation directory returns, native archiving, or final record removal complete. The board and its commands SHALL remain usable while an operation is admitted, queued, or executing. A queued or in-progress operation SHALL resume after a plugin restart, ordered by its recorded creation time within its lane, and shutting down the plugin SHALL NOT discard its journal. Once every conversation has returned to the base project and the operation still has a checkout to remove, the checkout removal and the native conversation archiving SHALL proceed concurrently, and the deletion SHALL complete only after both have finished. Each of those two steps SHALL record its own failing phase, and the progress of each SHALL remain visible while they overlap. When both steps fail, the recorded failing phase SHALL be the archiving step, because archived native conversations cannot be restored.

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

#### Scenario: Checkout removal and archiving overlap
- **WHEN** every task conversation has returned to the base project and the deletion still has a checkout to remove and conversations to archive
- **THEN** the checkout removal and the native archiving run concurrently
- **AND** the operation stays in progress until both finish
- **AND** the card and the drawer keep presenting the deletion as in progress while they overlap

#### Scenario: Archiving fails after the checkout was removed
- **WHEN** the checkout removal succeeded and the native archiving then failed
- **THEN** the recorded failure names the archiving phase
- **AND** the operation records the checkout as removed
- **AND** the task, its notes, and its remaining conversations stay available for recovery

#### Scenario: Both steps fail
- **WHEN** the checkout removal and the native archiving both fail during the same deletion
- **THEN** the recorded failing phase names the archiving step
- **AND** the presented recovery actions are the ones for that failure
- **AND** the operation does not claim deletion success

#### Scenario: Discard consent is not requested twice
- **WHEN** the confirmed deletion already carries explicit consent to discard local worktree changes
- **THEN** the preflight does not ask for that consent again
- **AND** the removal proceeds without reporting local changes as a new failure
