# Spec Delta

## MODIFIED Requirements

### Requirement: Optional worktrees and prominent creation notice
A worktree SHALL remain optional for a task whose project is Git-backed. When such a task has no associated worktree and its missing-worktree notice has not been dismissed, its conversation area SHALL show a prominent notice above the chat with Create and Dismiss actions. Dismissing the notice SHALL NOT create a branch or worktree or change any conversation's effective directory. A task whose project is a folder project SHALL NOT show the notice and SHALL NOT offer any worktree action.

#### Scenario: Open a task without a worktree
- **WHEN** a user opens the conversation area of a Git-backed task that has no worktree and whose missing-worktree notice has not been dismissed
- **THEN** a prominent notice above the chat offers Create and Dismiss

#### Scenario: Dismiss the missing-worktree notice
- **WHEN** the user dismisses the notice for a task using its base project directory
- **THEN** the notice is hidden without creating Git resources or changing that directory

#### Scenario: No notice for a folder project
- **WHEN** a task belongs to a folder project
- **THEN** no missing-worktree notice is shown
- **AND** no worktree action is offered in its conversation area or drawer

## ADDED Requirements

### Requirement: Plain checkout after Git association removal
When a project loses its Git association, existing checkout bindings SHALL be retained as plain checkouts. Each affected task SHALL keep its current effective directory, its conversations SHALL keep running in that checkout, and no Git operation SHALL be offered for it. Returning the task to its base project, removing the checkout, or attaching another checkout SHALL be unavailable while the project has no Git root.

The task drawer SHALL omit the Git section and the missing-worktree notice for such a task and SHALL present a compact indication that its checkout is no longer Git-managed. Deleting such a task SHALL archive its conversations and remove its card and notes, SHALL NOT delete the checkout directory, and SHALL report the retained checkout path in the confirmation and in the result. Unclaimed checkouts SHALL remain untouched.

#### Scenario: Keep working in a plain checkout
- **WHEN** a task has an associated checkout and its project's Git association is removed
- **THEN** the task keeps its effective directory
- **AND** its conversations continue running in that checkout
- **AND** no Git operation is offered for the checkout

#### Scenario: Omit Git affordances for a plain checkout
- **WHEN** the user opens a task whose project is a folder project and whose checkout binding remains
- **THEN** the drawer does not present the Git section or the missing-worktree notice
- **AND** the drawer states that the checkout is no longer Git-managed

#### Scenario: Withhold return and removal for a plain checkout
- **WHEN** a task has a plain checkout
- **THEN** returning to the base project, removing the checkout, and attaching another checkout are unavailable

#### Scenario: Delete a task with a plain checkout
- **WHEN** the user confirms deleting a task that has a plain checkout
- **THEN** its conversations are archived and its card and notes are removed
- **AND** the checkout directory remains on disk
- **AND** the confirmation and the result state that the checkout path was retained

#### Scenario: Leave unclaimed checkouts untouched
- **WHEN** a task with a plain checkout also records unclaimed checkouts
- **THEN** those paths are not modified or removed when the task is deleted
