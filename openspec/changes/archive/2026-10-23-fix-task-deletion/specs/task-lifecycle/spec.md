# Spec Delta

## MODIFIED Requirements

### Requirement: Explicit permanent deletion confirmation

Delete SHALL be the only task lifecycle action. The plugin SHALL require explicit confirmation before permanently deleting a task. The confirmation SHALL identify the task and project and SHALL present, in a scannable form, that deletion removes its plugin-owned task data, shared notes, and associated worktree when present; the number of conversations being archived and that their histories remain; the worktree path, branch, and whether the checkout was created by Kanban or attached externally; any unclaimed checkouts that remain on disk; and any conversation that is currently running. It SHALL state that one explicit destructive action confirms normal deletion and that local changes require a separate discard confirmation. It SHALL NOT describe conversation archiving as permanent history deletion or offer task archiving as an alternative. If the deletion fails after confirmation, the confirmation surface SHALL remain the active context and present the failure and available recovery actions, or transition to the required discard confirmation when local changes require that separate consent; it SHALL NOT close as if deletion succeeded.

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

#### Scenario: Failure remains in the confirmation context

- **WHEN** a confirmed deletion does not complete
- **THEN** the confirmation surface remains the active context or transitions to the required discard confirmation
- **AND** it identifies what completed and what did not
- **AND** it presents the available retry or return recovery instead of presenting the task as deleted

### Requirement: Best-effort bulk deletion

When the user deletes multiple tasks, the plugin SHALL apply the individual deletion confirmation and semantics to each eligible task. It SHALL skip a task whose conversations are running, whose operation or pending transition is unresolved, or whose worktree has local changes. It SHALL NOT stop conversations or discard local changes to force a bulk deletion. The bulk confirmation SHALL present the selected tasks and the same consequence summary used for individual deletion, including worktree presence and retained histories. The result SHALL identify every skipped task with a user-facing reason and SHALL leave those tasks undeleted.

#### Scenario: Delete a mixed selection

- **WHEN** the user confirms a bulk deletion containing eligible and blocked tasks
- **THEN** the confirmation presents the selected tasks and their deletion consequences
- **AND** every eligible task is deleted with the individual deletion semantics
- **AND** every blocked task remains and its user-facing reason is reported

#### Scenario: Do not force a blocked task

- **WHEN** a selected task has a running conversation, an unresolved operation, or local worktree changes
- **THEN** the plugin does not stop the conversation, resolve the operation, or discard the changes to force deletion

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
