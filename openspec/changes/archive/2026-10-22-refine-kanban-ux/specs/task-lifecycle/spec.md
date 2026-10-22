# Spec Delta

## REMOVED Requirements

### Requirement: Archive without losing task history
**Reason**: The product becomes delete-only. Task archiving and restoration are removed, and no archived task history exists to preserve.
**Migration**: Use task deletion. No legacy archived-task view, restore action, or data migration is provided.

### Requirement: Restore an archived task
**Reason**: Archive and Restore are removed with the delete-only lifecycle.
**Migration**: None. An archived task is no longer a product state.

## MODIFIED Requirements

### Requirement: Explicit permanent deletion confirmation
Delete SHALL be the only task lifecycle action. The plugin SHALL require explicit confirmation before permanently deleting a task. The confirmation SHALL identify the task and communicate that deletion removes its plugin-owned task data, shared notes, and associated worktree when present, archives its native DSH conversations without erasing their histories, and preserves the Git branch. It SHALL NOT describe conversation archiving as permanent history deletion or offer task archiving as an alternative.

#### Scenario: Review a task deletion with a worktree
- **WHEN** a user requests permanent deletion of a task that has conversations and a worktree
- **THEN** the plugin presents the destructive consequences and branch preservation before deletion can be confirmed
- **AND** the confirmation does not offer Archiving as an alternative

#### Scenario: Decline permanent deletion
- **WHEN** a user declines the permanent deletion confirmation
- **THEN** the plugin does not perform that requested permanent deletion

## ADDED Requirements

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
