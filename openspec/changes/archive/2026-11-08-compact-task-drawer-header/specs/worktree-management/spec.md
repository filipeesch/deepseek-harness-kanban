# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Optional worktrees and prominent creation notice`
- TO: `### Requirement: Optional worktrees and compact creation notice`

## MODIFIED Requirements

### Requirement: Optional worktrees and compact creation notice

A worktree SHALL remain optional for a task whose project is Git-backed. When such a task has no associated worktree and its missing-worktree notice has not been dismissed, its conversation area SHALL show a compact notice line above the chat with a base-project choice. The notice SHALL present the derived branch and destination in a compact line with its actions, wrapping the actions below the summary only when the drawer is too narrow to keep them inline, and SHALL NOT occupy a card-like block above the conversation. When a destination is configured, the notice SHALL offer Create and Review in Git; without a configured destination it SHALL route the user to the Git section to set one. Dismissing the notice SHALL record and persist the task's choice to continue in the base project; it SHALL NOT create a branch or worktree or change any conversation's effective directory. For such a task that also has no conversation, the conversation area SHALL withhold the explicit first-conversation start action, including the plus action, until the notice is dismissed or a created or attached worktree is ready. A worktree that is preparing or in error SHALL NOT satisfy that choice. A stage instruction that would create the task's first conversation SHALL NOT create it while the choice is pending; the execution preparation defined by Worktree choice before a card's first execution SHALL ask for that choice first. A task whose project is a folder project SHALL NOT show the notice and SHALL NOT offer any worktree action.

#### Scenario: Open a task without a worktree

- **WHEN** a user opens the conversation area of a Git-backed task that has no worktree and whose missing-worktree notice has not been dismissed
- **THEN** a compact notice line above the chat offers a base-project choice
- **AND** the notice line shows the derived branch and destination
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

- **WHEN** a stage instruction would need a conversation while the worktree choice is pending
- **THEN** the execution preparation asks for the worktree choice first
- **AND** no first conversation is created before that choice is resolved
- **AND** the first conversation uses the resolved directory

#### Scenario: Existing conversation before the worktree

- **WHEN** a Git-backed task already has a conversation and the user creates a worktree later
- **THEN** the existing conversation is migrated as before
- **AND** the explicit first-conversation start gate does not apply

### Requirement: One-click worktree creation from the missing-worktree notice

The missing-worktree notice SHALL offer a Create action that starts a new-branch worktree creation from derived defaults without requiring the user to visit the Git section. Before creation, the notice SHALL show the derived branch and destination, and SHALL expose the source branch (the project default or HEAD) in the notice's tooltip when available. Activating Create SHALL NOT start an agent.

#### Scenario: Show the derived preview in one line

- **WHEN** a task has no worktree and a worktree destination can be derived
- **THEN** the notice line shows the derived branch and destination
- **AND** the notice's tooltip exposes the source branch

#### Scenario: Create from the notice with defaults
- **WHEN** a task has no worktree, a worktree base path is configured, and the user activates Create in the notice
- **THEN** a worktree is requested with the displayed collision-free branch and destination
- **AND** the task conversations follow the normal worktree creation flow
- **AND** no agent message is sent

#### Scenario: No base path configured
- **WHEN** no worktree base path is configured and the user activates Create in the notice
- **THEN** the Git section opens with a message that a destination is required
- **AND** no worktree or branch is created

#### Scenario: Creation fails
- **WHEN** the worktree request fails, for example because the branch or destination became occupied
- **THEN** the notice shows an actionable error
- **AND** the user can review the current values in the Git section before retrying

#### Scenario: Task operation is active
- **WHEN** the task has an unresolved context operation or confirmed transition
- **THEN** the notice's Create action is unavailable until that operation is resolved
