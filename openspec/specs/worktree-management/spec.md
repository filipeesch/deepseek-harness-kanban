# Worktree Management Specification

## Purpose

Support optional task worktrees with explicit creation and attachment controls, coordinated changes to native conversation directories, and safe removal without confusing a worktree with the base project.

## Requirements

### Requirement: Optional worktrees and prominent creation notice
A worktree SHALL remain optional for a task. When a task has no associated worktree and its missing-worktree notice has not been dismissed, its conversation area SHALL show a prominent notice above the chat with Create and Dismiss actions. Dismissing the notice SHALL NOT create a branch or worktree or change any conversation's effective directory.

#### Scenario: Open a task without a worktree
- **WHEN** a user opens the conversation area of a task that has no worktree and whose missing-worktree notice has not been dismissed
- **THEN** a prominent notice above the chat offers Create and Dismiss

#### Scenario: Dismiss the missing-worktree notice
- **WHEN** the user dismisses the notice for a task using its base project directory
- **THEN** the notice is hidden without creating Git resources or changing that directory

### Requirement: Worktree choice during column transitions
When a user requests a column transition for a task without a worktree, the plugin SHALL ask whether to create a worktree and branch. Declining creation SHALL NOT make a worktree a prerequisite for moving the card or performing an otherwise confirmed agent action in the task's base project directory.

#### Scenario: Transition without creating a worktree
- **WHEN** a user requests a task transition, is offered worktree creation, and declines it
- **THEN** the task can continue through the selected transition flow without a worktree and its agent directory remains the base project path

### Requirement: Git tab supports new and existing branches
The task's Git section SHALL provide worktree creation using a new branch or an existing branch. The user SHALL be able to specify the destination worktree path and choose a source branch when creating a new branch. Choosing an existing branch SHALL create a worktree for that branch, distinct from attaching an already existing worktree.

#### Scenario: Create a worktree with a new branch
- **WHEN** a user selects new-branch creation, specifies a branch name, source branch, and destination path, and the requested Git operation succeeds
- **THEN** the task becomes associated with the new worktree and branch

#### Scenario: Create a worktree for an existing branch
- **WHEN** a user selects an existing branch and destination path and creation succeeds
- **THEN** the task becomes associated with the newly created worktree for that existing branch

### Requirement: Attach an existing external worktree
The Git section SHALL support attaching an already existing worktree that belongs to the task's intended Git repository. Attachment SHALL use the existing directory and branch rather than recreate that worktree. The effective project directory SHALL preserve the project's relative path inside its Git root.

#### Scenario: Attach an existing monorepo worktree
- **WHEN** an existing worktree for the task's Git repository is selected at /external/feature-tree and the project is located at services/api relative to the Git root
- **THEN** successful attachment associates that worktree with the task and resolves its effective directory to /external/feature-tree/services/api without recreating the worktree

#### Scenario: Reject a worktree from a different repository
- **WHEN** a selected existing worktree belongs to a different Git repository from the task's project
- **THEN** the plugin reports the context mismatch instead of switching the task's conversations into that repository

### Requirement: Wait for every conversation before directory changes
A requested switch to or from a worktree SHALL wait until every conversation tab belonging to the task is idle. The plugin SHALL NOT force that switch while any of those conversations is executing. After a successful switch, every existing task conversation SHALL use the resolved target project directory and SHALL retain its native session identity and history.

#### Scenario: One conversation is still executing
- **WHEN** a worktree directory switch is requested while at least one of the task's conversation tabs is executing
- **THEN** the switch waits and the existing effective conversation directories remain unchanged until every task conversation is idle

#### Scenario: Switch all idle conversations to the worktree project
- **WHEN** every task conversation is idle and a switch to a worktree project directory successfully completes
- **THEN** all of the task's existing sessions use that directory with their identities and histories preserved

### Requirement: Remove only the worktree while retaining the task
The Git section SHALL support removing an associated worktree independently of permanently deleting its task. A successful worktree-only removal SHALL retain the task, its conversations and histories, its shared notes, and its Git branch, and SHALL return every task conversation's effective directory to the base project path rather than the Git root. Destructive removal SHALL remain subject to the required explicit discard confirmation for local changes.

#### Scenario: Remove a clean, unshared worktree from an idle task
- **WHEN** all task conversations are idle, the associated worktree is not in use by another task or session, the worktree is clean, and the user confirms worktree-only removal
- **THEN** successful removal deletes that worktree while retaining the task, conversations, notes, and branch and returns every task conversation to its base project path

#### Scenario: Return a monorepo task to its base subproject
- **WHEN** a worktree-only removal succeeds for an idle task whose base project path is /repos/platform/services/api and whose Git root is /repos/platform
- **THEN** all task conversations use /repos/platform/services/api rather than /repos/platform

### Requirement: No worktree means no base-directory removal
Worktree removal SHALL target only the task's associated worktree. A task without an associated worktree SHALL NOT cause the plugin to remove its base project directory or Git root as a substitute.

#### Scenario: Request removal for a task without a worktree
- **WHEN** a worktree-removal action is evaluated for a task with no associated worktree
- **THEN** neither its base project path nor its Git root is treated as a worktree to delete

### Requirement: Preserve host policy and report compatibility failures
Worktree operations and conversation directory changes SHALL respect the active host filesystem policy. The plugin SHALL surface actual sandbox denials or unsupported host integration rather than bypass them or claim the denied operation succeeded. Changing a working directory or attaching a worktree SHALL NOT be treated as granting filesystem permissions.

#### Scenario: Host policy denies worktree creation
- **WHEN** the host denies a filesystem operation required to create a requested worktree
- **THEN** the plugin reports that denial and does not bypass the policy or report the denied creation as successful

#### Scenario: A new directory does not confer access rights
- **WHEN** a conversation targets an attached worktree outside its original workspace grouping and a subsequent required operation is denied by the host policy
- **THEN** the plugin surfaces the actual denial rather than presenting the working-directory change as authorization to access that location
