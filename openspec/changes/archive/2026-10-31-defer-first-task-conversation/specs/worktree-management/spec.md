# Spec Delta

## MODIFIED Requirements

### Requirement: Optional worktrees and prominent creation notice
A worktree SHALL remain optional for a task whose project is Git-backed. When such a task has no associated worktree and its missing-worktree notice has not been dismissed, its conversation area SHALL show a prominent notice above the chat with a base-project choice. When a destination is configured, the notice SHALL offer Create and Review in Git; without a configured destination it SHALL route the user to the Git section to set one. Dismissing the notice SHALL record and persist the task's choice to continue in the base project; it SHALL NOT create a branch or worktree or change any conversation's effective directory. For such a task that also has no conversation, the conversation area SHALL withhold the explicit first-conversation start action, including the plus action, until the notice is dismissed or a created or attached worktree is ready. A worktree that is preparing or in error SHALL NOT satisfy that choice. A stage instruction that needs a conversation MAY create the first conversation in the task's current effective directory while the choice is pending. A task whose project is a folder project SHALL NOT show the notice and SHALL NOT offer any worktree action.

#### Scenario: Open a task without a worktree
- **WHEN** a user opens the conversation area of a Git-backed task that has no worktree and whose missing-worktree notice has not been dismissed
- **THEN** a prominent notice above the chat offers a base-project choice
- **AND** when a destination is configured, the notice also offers Create and Review in Git
- **AND** when no destination is configured, the notice offers a path to the Git section
- **AND** if the task has no conversation, the explicit first-conversation start action is withheld

#### Scenario: Dismiss the missing-worktree notice
- **WHEN** the user chooses to continue in the base project for a task that has no worktree
- **THEN** the notice is hidden and the choice is persisted
- **AND** no Git resources are created and no conversation's effective directory changes
- **AND** the explicit first-conversation start action becomes available when the task has no conversation

#### Scenario: No notice for a folder project
- **WHEN** a task belongs to a folder project
- **THEN** no missing-worktree notice is shown
- **AND** no worktree action is offered in its conversation area or drawer

#### Scenario: Create a worktree before the first conversation
- **WHEN** a Git-backed task has no conversation and the user creates or attaches a worktree
- **THEN** the explicit first-conversation start action becomes available when the worktree is ready
- **AND** the first conversation uses the worktree's effective directory

#### Scenario: Worktree still preparing or in error
- **WHEN** a worktree is preparing or is in error
- **THEN** the explicit first-conversation start action remains withheld
- **AND** the Git and operation surfaces expose the next step

#### Scenario: Stage instruction before the worktree choice
- **WHEN** a stage instruction needs a conversation while the worktree choice is pending
- **THEN** the first conversation is created in the task's current effective directory
- **AND** the instruction is sent
- **AND** the worktree choice remains pending for the notice

#### Scenario: Existing conversation before the worktree
- **WHEN** a Git-backed task already has a conversation and the user creates a worktree later
- **THEN** the existing conversation is migrated as before
- **AND** the explicit first-conversation start gate does not apply
