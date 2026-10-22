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

### Requirement: Title-derived worktree defaults
When the Git section offers new-branch creation for a task without a worktree, it SHALL derive the default branch name from the task title. The derivation SHALL use lowercase ASCII, transliterate diacritics, replace runs of other characters with a single hyphen, trim leading and trailing hyphens, and limit the result to 48 characters. An empty result SHALL fall back to `task`. The default branch name SHALL NOT include a task UUID or a `task/` prefix. When a worktree base path is configured, the default destination SHALL be the base path joined with the default branch name. When no base path is configured, the default destination SHALL be empty and remain user-supplied.

#### Scenario: Derive a branch name from an accented title
- **WHEN** a task titled "Criação de tarefas" opens worktree creation with a new branch
- **THEN** the suggested branch name is `criacao-de-tarefas`
- **AND** with the base path `/worktrees` the suggested destination is `/worktrees/criacao-de-tarefas`

#### Scenario: Fall back for a title without ASCII letters or digits
- **WHEN** the task title produces an empty slug
- **THEN** the suggested branch name is `task`

#### Scenario: No configured base path
- **WHEN** no worktree base path is configured
- **THEN** the suggested destination is empty
- **AND** the user can supply an absolute destination

### Requirement: Collision-free title-derived names
The default new-branch name and destination SHALL avoid collisions. A candidate SHALL be rejected when a local branch with that name exists in the task's repository, when the candidate destination is already used by another task's worktree or pending creation, or when the destination already exists on the filesystem. The Git section SHALL append `-2`, `-3`, and so on to the derived name until both the branch and the destination are free. The branch and destination SHALL advance together so the destination remains the base path joined with the branch. Existing-branch creation SHALL retain the existing branch name and SHALL NOT apply a counter.

#### Scenario: Duplicate task titles
- **WHEN** a task whose derived name is `fix-login` is created after `fix-login` already exists as a local branch or destination
- **THEN** the suggested branch and destination use `fix-login-2`

#### Scenario: Existing branch
- **WHEN** the user chooses an existing branch whose name or destination collides
- **THEN** the existing branch name is kept
- **AND** no counter is applied to the branch

### Requirement: Editable title-derived defaults
The Git section SHALL prefill the new-branch name and destination with the derived defaults. The user SHALL be able to edit both fields. While the user has not edited the destination, changing the branch name SHALL update the destination to the base path joined with the edited branch name. Editing the destination SHALL stop that synchronization, and a reset action SHALL restore the derived default. A manually entered branch or destination SHALL be authoritative and SHALL be validated when creation is requested; the plugin SHALL NOT silently rename a manually entered branch. Editing a task title after a worktree exists SHALL NOT rename its branch or move its worktree.

#### Scenario: Branch edit updates an untouched destination
- **WHEN** the user changes the suggested branch name and has not edited the destination
- **THEN** the destination updates to the base path joined with the new branch name

#### Scenario: Manual destination override
- **WHEN** the user edits the destination and then changes the branch name
- **THEN** the destination retains the user's edited value

#### Scenario: Reset the destination
- **WHEN** the user activates the reset action after editing the destination
- **THEN** the destination returns to the base path joined with the current branch name

#### Scenario: Manual name collision
- **WHEN** the user requests creation with a manually entered branch or destination that collides
- **THEN** the plugin reports the Git failure instead of silently renaming the branch

#### Scenario: Title edit after worktree creation
- **WHEN** the user edits the task title after its worktree exists
- **THEN** the branch name and worktree destination remain unchanged
