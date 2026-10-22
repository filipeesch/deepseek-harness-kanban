# Spec Delta

## ADDED Requirements

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
