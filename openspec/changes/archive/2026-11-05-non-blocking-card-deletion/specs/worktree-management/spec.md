# Spec Delta

## MODIFIED Requirements

### Requirement: Remove only the worktree while retaining the task

The Git section SHALL support removing an associated worktree independently of permanently deleting its task. A confirmed worktree-only removal SHALL be durably recorded before slow cleanup begins and SHALL execute in the background through the destructive-operation lane for its repository; the confirmation SHALL close on acceptance and SHALL NOT remain busy while the directory returns, checkout removal, or workspace cleanup run. Admission SHALL be decided from persisted state only, requiring that the task exists, its recorded worktree binding still matches the confirmed target, no other context operation holds it, and no pending transition is mid-delivery; the authoritative preflight covering conversation idleness, canonical target stability, checkout sharing, and local-change detection SHALL run inside the lane, where a busy conversation defers the removal to waiting until every conversation is idle. A failed queued preflight SHALL be recorded as a failed operation naming its failing phase rather than remaining a command rejection. A successful worktree-only removal SHALL retain the task, its conversations and histories, its shared notes, and its Git branch, and SHALL return every task conversation's effective directory to the base project path rather than the Git root. Destructive removal SHALL remain subject to the required explicit discard confirmation for local changes, which is reached through the recorded failure and its recovery. When admission is rejected from persisted state, the confirmation SHALL remain open with the failure; when an accepted removal later fails, the failure SHALL be presented in the task card status, the board destructive-operation notice, and the drawer operation status.

#### Scenario: Remove a clean, unshared worktree from an idle task

- **WHEN** all task conversations are idle, the associated worktree is not in use by another task or session, the worktree is clean, and the user confirms worktree-only removal
- **THEN** the removal is accepted and the confirmation closes
- **AND** successful removal deletes that worktree while retaining the task, conversations, notes, and branch and returns every task conversation to its base project path

#### Scenario: Queue the removal without inspecting the checkout

- **WHEN** the user confirms worktree-only removal for a task whose recorded binding still matches the confirmed target, with no other operation and no transition mid-delivery
- **THEN** the host records the operation and returns the response without inspecting Git or native conversations
- **AND** the card presents a queued or in-progress removal status

#### Scenario: Return a monorepo task to its base subproject

- **WHEN** a worktree-only removal succeeds for an idle task whose base project path is /repos/platform/services/api and whose Git root is /repos/platform
- **THEN** all task conversations use /repos/platform/services/api rather than /repos/platform

#### Scenario: Queued preflight failure remains recoverable

- **WHEN** the queued removal finds a changed target, a shared checkout, or local changes requiring consent
- **THEN** the operation is recorded as failed with its failing phase and the task, worktree, and conversations are left unchanged
- **AND** the card status, the board notice, and the drawer operation status present the failure and its recovery actions
- **AND** retrying re-runs the preflight, requiring the separate discard consent when local changes caused the failure

#### Scenario: A busy conversation defers the queued removal

- **WHEN** the queued removal finds a conversation that is still running
- **THEN** the operation is recorded as waiting rather than failed and the checkout is untouched
- **AND** the removal resumes after the conversations settle, without stopping them

#### Scenario: Pre-admission rejection remains in the confirmation

- **WHEN** the host rejects the confirmed removal from persisted state before recording the operation
- **THEN** the confirmation remains open with the failure and the applicable recovery action

#### Scenario: Failure remains visible after acceptance

- **WHEN** an accepted worktree-only removal later fails
- **THEN** the card status, the board notice, and the drawer operation status present the failure
- **AND** the task and its conversations remain available for recovery
