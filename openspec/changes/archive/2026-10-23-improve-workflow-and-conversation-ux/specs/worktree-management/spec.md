# Spec Delta

## ADDED Requirements

### Requirement: One-click worktree creation from the missing-worktree notice
The missing-worktree notice SHALL offer a Create action that starts a new-branch worktree creation from derived defaults without requiring the user to visit the Git section. Before creation, the notice SHALL show the derived branch, destination, and source branch (the project default or HEAD) when available. Activating Create SHALL NOT start an agent.

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

### Requirement: Shared worktree creation defaults
The notice and the Git section SHALL present the same derived branch, destination, and source defaults for the same task. A source branch MAY be omitted, in which case the host SHALL use the project's configured default branch or HEAD. A draft edited in the Git section SHALL remain authoritative when the notice creates from it, and SHALL NOT be silently renamed.

#### Scenario: Consistent defaults across surfaces
- **WHEN** the notice has loaded its derived defaults and the user opens the Git section without editing them
- **THEN** the Git section shows the same branch, destination, and source

#### Scenario: Empty source branch
- **WHEN** the project has no configured default branch and creation is requested without a source branch
- **THEN** the host uses HEAD as the source

#### Scenario: Manual draft remains authoritative
- **WHEN** the user edits the branch or destination in the Git section and then creates from the notice
- **THEN** the edited values are used rather than silently restored to the title-derived defaults

## MODIFIED Requirements

### Requirement: Git tab supports new and existing branches
The task's Git section SHALL provide worktree creation using a new branch or an existing branch. The user SHALL be able to specify the destination worktree path and MAY choose a source branch when creating a new branch; when the source is omitted, the project's configured default branch or HEAD SHALL be used. Choosing an existing branch SHALL create a worktree for that branch, distinct from attaching an already existing worktree. Branch selection SHALL support searching the available local branches.

#### Scenario: Create a worktree with a new branch
- **WHEN** a user selects new-branch creation, specifies a branch name, source branch, and destination path, and the requested Git operation succeeds
- **THEN** the task becomes associated with the new worktree and branch

#### Scenario: Create a new branch without a source
- **WHEN** a user selects new-branch creation, leaves the source branch empty, and requests creation
- **THEN** the host uses the project's configured default branch or HEAD
- **AND** the task becomes associated with the new worktree and branch

#### Scenario: Create a worktree for an existing branch
- **WHEN** a user selects an existing branch and destination path and creation succeeds
- **THEN** the task becomes associated with the newly created worktree for that existing branch

#### Scenario: Search for a branch
- **WHEN** the user enters text in the source-branch or existing-branch selector
- **THEN** the selector offers only local branches that match the text
