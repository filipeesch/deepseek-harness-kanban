# Spec Delta

## MODIFIED Requirements

### Requirement: Optional worktrees and compact creation notice

A worktree SHALL remain optional for a task whose project is Git-backed. When such a task has no associated worktree and its missing-worktree notice has not been dismissed, its conversation area SHALL show a compact notice line above the chat with a base-project choice. The notice SHALL present the derived branch and destination in a compact line with its actions, wrapping the actions below the summary only when the drawer is too narrow to keep them inline, and SHALL NOT occupy a card-like block above the conversation. The notice SHALL offer Create and Review in Git; a Git-backed project SHALL always have a derivable destination, with or without a configured worktree base path. Dismissing the notice SHALL record and persist the task's choice to continue in the base project; it SHALL NOT create a branch or worktree or change any conversation's effective directory. For such a task that also has no conversation, the conversation area SHALL withhold the explicit first-conversation start action, including the plus action, until the notice is dismissed or a created or attached worktree is ready. A worktree that is preparing or in error SHALL NOT satisfy that choice. A stage instruction that would create the task's first conversation SHALL NOT create it while the choice is pending; the execution preparation defined by Worktree choice before a card's first execution SHALL ask for that choice first. A task whose project is a folder project SHALL NOT show the notice and SHALL NOT offer any worktree action.

#### Scenario: Open a task without a worktree

- **WHEN** a user opens the conversation area of a Git-backed task that has no worktree and whose missing-worktree notice has not been dismissed
- **THEN** a compact notice line above the chat offers a base-project choice
- **AND** the notice line shows the derived branch and destination
- **AND** the notice also offers Create and Review in Git
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

### Requirement: Worktree choice before a card's first execution

When a Git-backed task has no conversation, no worktree, and no recorded base-project choice, the execution preparation that precedes the task's first execution SHALL ask whether to create a worktree before that execution starts. The choice SHALL offer creating a worktree from the task's title-derived defaults or continuing in the base project, and it SHALL use the same derived branch, destination, and source defaults as the missing-worktree notice and the Git section. A Git-backed project SHALL always have a valid default destination, with or without a configured worktree base path, as defined by Title-derived worktree defaults. Declining SHALL record and persist the base-project choice and SHALL NOT create a branch or worktree. A created worktree SHALL be ready before the first conversation is created for the execution, so that conversation uses the worktree directory. A failed creation SHALL be reported in the preparation, SHALL keep the task's stage and position unchanged, and SHALL NOT start the execution. The automatic first execution on task creation SHALL NOT present this choice; for a Git-backed project it SHALL create the default worktree, and for a folder project it SHALL use the project directory. A worktree binding in the preparing or error state SHALL block the task's first execution: the preparation SHALL explain that the binding must be resolved in the Git section, SHALL NOT offer creating a worktree or continuing in the base project, and the move or run action SHALL NOT proceed. That block SHALL apply only to the task's first execution; a task that already has a conversation SHALL keep executing while its binding is in that state.

#### Scenario: Ask before the first drop

- **WHEN** the user drops a task with no conversation and no worktree on a permitted instructed stage
- **THEN** the execution preparation asks whether to create a worktree
- **AND** the task does not move until the choice is answered and the preparation completes

#### Scenario: Create from derived defaults

- **WHEN** the user chooses to create a worktree and a valid destination can be derived
- **THEN** a worktree is created with the derived branch, destination, and source
- **AND** the first conversation is created after the worktree is ready
- **AND** the first conversation uses the worktree directory

#### Scenario: Continue in the base project

- **WHEN** the user chooses to continue in the base project
- **THEN** no branch or worktree is created
- **AND** the base-project choice is recorded and persisted
- **AND** the first conversation is created in the base project directory

#### Scenario: No derivable destination

- **WHEN** no worktree base path is configured and the user chooses to create a worktree
- **THEN** the worktree is created at the repository-sibling destination defined by Title-derived worktree defaults
- **AND** the first conversation is created after the worktree is ready
- **AND** the first conversation uses the worktree directory

#### Scenario: Creation fails

- **WHEN** worktree creation fails during the preparation
- **THEN** the preparation reports the failure
- **AND** no first conversation is created
- **AND** the task's stage and position are unchanged

#### Scenario: Blocked by an errored binding

- **WHEN** a task with no conversation has a worktree binding in the preparing or error state
- **THEN** the execution preparation explains that the binding must be resolved in the Git section
- **AND** it does not offer creating a worktree or continuing in the base project
- **AND** the card does not move and no instruction is sent

#### Scenario: Blocked binding does not affect later executions

- **WHEN** a task that already has a conversation has a worktree binding in the preparing or error state
- **THEN** its moves and stage instructions proceed as before
- **AND** no worktree block is presented

#### Scenario: No worktree question for a folder project

- **WHEN** the task belongs to a folder project
- **THEN** the execution preparation asks no worktree question
- **AND** only the model step applies

#### Scenario: No worktree question after a recorded base choice

- **WHEN** the task has a recorded base-project choice
- **THEN** the execution preparation asks no worktree question
- **AND** the first conversation is created in the base project directory

#### Scenario: No question for the automatic creation start

- **WHEN** the automatic first execution on task creation runs for a Git-backed task
- **THEN** the execution preparation does not ask the worktree choice
- **AND** the default worktree is created
- **AND** the first conversation uses its directory

### Requirement: Title-derived worktree defaults
When the Git section offers new-branch creation for a task without a worktree, it SHALL derive the default branch name from the task title. The derivation SHALL use lowercase ASCII, transliterate diacritics, replace runs of other characters with a single hyphen, trim leading and trailing hyphens, and limit the result to 48 characters. An empty result SHALL fall back to `task`. The default branch name SHALL NOT include a task UUID or a `task/` prefix. When a worktree base path is configured, the default destination SHALL be the base path joined with the default branch name. When no base path is configured, the default destination SHALL be the parent directory of the project's Git root joined with the repository directory name and the default branch name, in the form `<parent>/<repository>-<branch>`.

#### Scenario: Derive a branch name from an accented title
- **WHEN** a task titled "Criação de tarefas" opens worktree creation with a new branch
- **THEN** the suggested branch name is `criacao-de-tarefas`
- **AND** with the base path `/worktrees` the suggested destination is `/worktrees/criacao-de-tarefas`

#### Scenario: Fall back for a title without ASCII letters or digits
- **WHEN** the task title produces an empty slug
- **THEN** the suggested branch name is `task`

#### Scenario: No configured base path
- **WHEN** no worktree base path is configured and the project's Git root is `<parent>/<repository>`
- **THEN** the suggested destination is `<parent>/<repository>-<default branch name>`
- **AND** the destination is derived without user input

### Requirement: Collision-free title-derived names
The default new-branch name and destination SHALL avoid collisions. A candidate SHALL be rejected when a local branch with that name exists in the task's repository, when the candidate destination is already used by another task's worktree or pending creation, or when the destination already exists on the filesystem. The Git section SHALL append `-2`, `-3`, and so on to the derived name until both the branch and the destination are free. The branch and destination SHALL advance together so the destination follows the same derivation rule for the renamed branch: the configured base path joined with the branch, or the repository-sibling `<repository>-<branch>` when no base path is configured. Existing-branch creation SHALL retain the existing branch name and SHALL NOT apply a counter.

#### Scenario: Duplicate task titles
- **WHEN** a task whose derived name is `fix-login` is created after `fix-login` already exists as a local branch or destination
- **THEN** the suggested branch and destination use `fix-login-2`

#### Scenario: Existing branch
- **WHEN** the user chooses an existing branch whose name or destination collides
- **THEN** the existing branch name is kept
- **AND** no counter is applied to the branch

### Requirement: Editable title-derived defaults
The Git section SHALL prefill the new-branch name and destination with the derived defaults. The user SHALL be able to edit both fields. While the user has not edited the destination, changing the branch name SHALL update the destination using the same derivation rule: the configured base path joined with the edited branch name, or the repository-sibling `<repository>-<edited branch name>` when no base path is configured. Editing the destination SHALL stop that synchronization, and a reset action SHALL restore the derived default. A manually entered branch or destination SHALL be authoritative and SHALL be validated when creation is requested; the plugin SHALL NOT silently rename a manually entered branch. Editing a task title after a worktree exists SHALL NOT rename its branch or move its worktree.

#### Scenario: Branch edit updates an untouched destination
- **WHEN** the user changes the suggested branch name and has not edited the destination
- **THEN** the destination updates under the same derivation rule used for the suggested default

#### Scenario: Manual destination override
- **WHEN** the user edits the destination and then changes the branch name
- **THEN** the destination retains the user's edited value

#### Scenario: Reset the destination
- **WHEN** the user activates the reset action after editing the destination
- **THEN** the destination returns to the derived default for the current branch name

#### Scenario: Manual name collision
- **WHEN** the user requests creation with a manually entered branch or destination that collides
- **THEN** the plugin reports the Git failure instead of silently renaming the branch

#### Scenario: Title edit after worktree creation
- **WHEN** the user edits the task title after its worktree exists
- **THEN** the branch name and worktree destination remain unchanged

### Requirement: One-click worktree creation from the missing-worktree notice

The missing-worktree notice SHALL offer a Create action that starts a new-branch worktree creation from derived defaults without requiring the user to visit the Git section. Before creation, the notice SHALL show the derived branch and destination, and SHALL expose the source branch (the project default or HEAD) in the notice's tooltip when available. Activating Create SHALL NOT start an agent.

#### Scenario: Show the derived preview in one line

- **WHEN** a task has no worktree
- **THEN** the notice line shows the derived branch and destination
- **AND** the notice's tooltip exposes the source branch

#### Scenario: Create from the notice with defaults

- **WHEN** a task has no worktree and the user activates Create in the notice
- **THEN** a worktree is requested with the displayed collision-free branch and destination
- **AND** the task conversations follow the normal worktree creation flow
- **AND** no agent message is sent

#### Scenario: No base path configured

- **WHEN** no worktree base path is configured and the user activates Create in the notice
- **THEN** a worktree is requested at the repository-sibling destination defined by Title-derived worktree defaults
- **AND** no Git section redirect is presented
- **AND** no agent message is sent

#### Scenario: Creation fails
- **WHEN** the worktree request fails, for example because the branch or destination became occupied
- **THEN** the notice shows an actionable error
- **AND** the user can review the current values in the Git section before retrying

#### Scenario: Task operation is active
- **WHEN** the task has an unresolved context operation or confirmed transition
- **THEN** the notice's Create action is unavailable until that operation is resolved
