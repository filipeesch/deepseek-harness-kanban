# Task Lifecycle Specification

## Purpose

Provide explicit deletion of plugin-owned task data and worktrees while archiving native conversations, preserving Git branches, and protecting base projects.

## Requirements

### Requirement: Explicit permanent deletion confirmation
Delete SHALL be the only task lifecycle action. The plugin SHALL require explicit confirmation before permanently deleting a task. The confirmation SHALL identify the task and communicate that deletion removes its plugin-owned task data, shared notes, and associated worktree when present, archives its native DSH conversations without erasing their histories, and preserves the Git branch. It SHALL NOT describe conversation archiving as permanent history deletion or offer task archiving as an alternative.

#### Scenario: Review a task deletion with a worktree
- **WHEN** a user requests permanent deletion of a task that has conversations and a worktree
- **THEN** the plugin presents the destructive consequences and branch preservation before deletion can be confirmed
- **AND** the confirmation does not offer Archiving as an alternative

#### Scenario: Decline permanent deletion
- **WHEN** a user declines the permanent deletion confirmation
- **THEN** the plugin does not perform that requested permanent deletion

### Requirement: Delete is the only task lifecycle action
The plugin SHALL NOT provide task archive, task restore, or an archived-task view. Delete SHALL be the only task lifecycle action offered, and it SHALL be available from the task drawer and from the board's bulk selection.

#### Scenario: Inspect task lifecycle actions
- **WHEN** the user opens a task drawer
- **THEN** Delete is offered and Archive and Restore are absent

#### Scenario: View the board
- **WHEN** the user views the board
- **THEN** no archived-task view, filter, or restore action is offered

### Requirement: Best-effort bulk deletion
When the user deletes multiple tasks, the plugin SHALL apply the individual deletion confirmation and semantics to each eligible task. It SHALL skip a task whose conversations are running, whose operation or pending transition is unresolved, or whose worktree has local changes. It SHALL NOT stop conversations or discard local changes to force a bulk deletion. It SHALL report every skipped task and reason and SHALL leave those tasks undeleted.

#### Scenario: Delete a mixed selection
- **WHEN** the user confirms a bulk deletion containing eligible and blocked tasks
- **THEN** every eligible task is deleted with the individual deletion semantics
- **AND** every blocked task remains and its reason is reported

#### Scenario: Do not force a blocked task
- **WHEN** a selected task has a running conversation, an unresolved operation, or local worktree changes
- **THEN** the plugin does not stop the conversation, resolve the operation, or discard the changes to force deletion

### Requirement: Successful task deletion archives conversations and keeps its branch
A successfully completed task deletion SHALL remove the task card and its shared notes and archive all native DSH conversations associated with the task without erasing their histories. Before removing an associated worktree, the plugin SHALL return every retained task conversation to the base project path through the all-idle directory coordinator. If that return fails, the plugin SHALL retain the worktree and recovery information rather than report deletion success. Successful deletion SHALL remove an eligible associated worktree, preserve the task's associated Git branch, and SHALL NOT delete native conversation log files directly.

#### Scenario: Permanently delete an idle task with a clean unshared worktree
- **WHEN** the task's conversations are idle, its worktree is not in use by another task or session, its worktree is clean, and the user confirms permanent deletion
- **THEN** successful deletion removes the card, notes, and worktree, archives the associated native conversations while retaining their histories, and leaves its Git branch intact

#### Scenario: Permanently delete an idle task without a worktree
- **WHEN** an idle task has no associated worktree and the user confirms its permanent deletion
- **THEN** successful deletion removes the card and notes and archives the associated conversations with their histories retained, without removing the base project directory

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
