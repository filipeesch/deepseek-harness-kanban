# Spec Delta

## REMOVED Requirements

### Requirement: Worktree choice during column transitions
**Reason**: Board movement becomes drag-and-drop only. A transition no longer asks whether to create a worktree, and worktree creation is not part of a drop.
**Migration**: Create or attach a worktree from the missing-worktree notice or the Git section before or after moving the task.

## MODIFIED Requirements

### Requirement: Git tab supports new and existing branches
The task's Git section SHALL provide worktree creation using a new branch or an existing branch. The user SHALL be able to specify the destination worktree path and choose a source branch when creating a new branch. Choosing an existing branch SHALL create a worktree for that branch, distinct from attaching an already existing worktree. Branch selection SHALL support searching the available local branches.

#### Scenario: Create a worktree with a new branch
- **WHEN** a user selects new-branch creation, specifies a branch name, source branch, and destination path, and the requested Git operation succeeds
- **THEN** the task becomes associated with the new worktree and branch

#### Scenario: Create a worktree for an existing branch
- **WHEN** a user selects an existing branch and destination path and creation succeeds
- **THEN** the task becomes associated with the newly created worktree for that existing branch

#### Scenario: Search for a branch
- **WHEN** the user enters text in the source-branch or existing-branch selector
- **THEN** the selector offers only local branches that match the text

## ADDED Requirements

### Requirement: Compact Git worktree state
The Git section SHALL present the worktree as one of four states: no worktree, creating, ready, or error. In the ready state it SHALL show the branch, path, and a removal action with inline confirmation. In the creating state it SHALL show progress. In the no-worktree or error state it SHALL show the creation form or failure and a retry path. Operation recovery and discard consent SHALL remain available. The primary view SHALL NOT require base project path, Git root, effective directory, or ownership; those SHALL remain available through a secondary detail surface.

#### Scenario: Inspect a ready worktree
- **WHEN** the task has a ready worktree
- **THEN** the Git section shows its branch, path, state, and removal action
- **AND** the worktree creation form is not shown

#### Scenario: Inspect a creating or failed worktree
- **WHEN** the worktree is being created or has failed
- **THEN** the Git section shows that state and the applicable retry path
- **AND** recovery information for a partial operation remains available

#### Scenario: Use the secondary detail surface
- **WHEN** the user needs the base project path, Git root, or effective directory
- **THEN** those values are available from a secondary detail surface rather than the primary Git view

### Requirement: Unclaimed checkouts remain visible
When unclaimed checkouts exist for a task, the Git section SHALL show a compact warning that lists each path, branch, and recorded error. The plugin SHALL NOT attach or remove an unclaimed checkout automatically. Task deletion SHALL leave unclaimed checkouts on disk and SHALL report that they remain.

#### Scenario: Show unclaimed checkouts
- **WHEN** a task has unclaimed checkouts
- **THEN** the Git section lists their paths, branches, and errors in a compact warning

#### Scenario: Delete a task with unclaimed checkouts
- **WHEN** a task with unclaimed checkouts is deleted
- **THEN** those checkouts are not removed and remain on disk
- **AND** the deletion result reports that they remain
