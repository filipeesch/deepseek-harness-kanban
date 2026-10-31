# Worktree Management Specification

## Purpose

Support optional task worktrees with explicit creation and attachment controls, coordinated changes to native conversation directories, and safe removal without confusing a worktree with the base project.

## Requirements

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

### Requirement: Compact Git worktree state

The Git section SHALL present the worktree as one of four states: no worktree, creating, ready, or error. In the ready state it SHALL show the branch, path, and a removal action with inline confirmation. In the creating state it SHALL show progress. In the no-worktree or error state it SHALL show the creation form or failure and a retry path. When a worktree binding records a persisted error, the error state SHALL present that recorded reason. Operation recovery and discard consent SHALL remain available. The primary view SHALL NOT require base project path, Git root, effective directory, or ownership; those SHALL remain available through a secondary detail surface.

#### Scenario: Inspect a ready worktree

- **WHEN** the task has a ready worktree
- **THEN** the Git section shows its branch, path, state, and removal action
- **AND** the worktree creation form is not shown

#### Scenario: Inspect a creating or failed worktree

- **WHEN** the worktree is being created or has failed
- **THEN** the Git section shows that state and the applicable retry path
- **AND** recovery information for a partial operation remains available

#### Scenario: Inspect a binding removed externally

- **WHEN** another task's forced deletion removed this task's checkout and persisted a binding error
- **THEN** the Git section presents the recorded error and explains that the checkout was removed externally
- **AND** creation, attachment, and removal remain available for the task to recover

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

The Git section SHALL support removing an associated worktree independently of permanently deleting its task. A confirmed worktree-only removal SHALL be durably recorded and SHALL execute in the background through the host destructive-operation queue; the confirmation SHALL close on acceptance and SHALL NOT remain busy while the directory returns, checkout removal, or workspace cleanup run. A successful worktree-only removal SHALL retain the task, its conversations and histories, its shared notes, and its Git branch, and SHALL return every task conversation's effective directory to the base project path rather than the Git root. Destructive removal SHALL remain subject to the required explicit discard confirmation for local changes. When admission is rejected before the operation is recorded, the confirmation SHALL remain open with the failure; when an accepted removal later fails, the failure SHALL be presented in the task card status, the board destructive-operation notice, and the drawer operation status.

#### Scenario: Remove a clean, unshared worktree from an idle task

- **WHEN** all task conversations are idle, the associated worktree is not in use by another task or session, the worktree is clean, and the user confirms worktree-only removal
- **THEN** the removal is accepted and the confirmation closes
- **AND** successful removal deletes that worktree while retaining the task, conversations, notes, and branch and returns every task conversation to its base project path

#### Scenario: Return a monorepo task to its base subproject

- **WHEN** a worktree-only removal succeeds for an idle task whose base project path is /repos/platform/services/api and whose Git root is /repos/platform
- **THEN** all task conversations use /repos/platform/services/api rather than /repos/platform

#### Scenario: Pre-admission rejection remains in the confirmation

- **WHEN** the host rejects the confirmed removal before recording the operation
- **THEN** the confirmation remains open with the failure and the applicable recovery action

#### Scenario: Failure remains visible after acceptance

- **WHEN** an accepted worktree-only removal later fails
- **THEN** the card status, the board notice, and the drawer operation status present the failure
- **AND** the task and its conversations remain available for recovery

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

### Requirement: Protect worktrees shared outside the task conversation lineage

Before removing or deleting an associated worktree, the plugin SHALL refuse the operation when the checkout is associated with another task or is in use by a native DSH session outside the task's conversation lineage. The refusal SHALL collect every blocking task and every blocking native session in its details rather than reporting only the first blocker. The task's conversation lineage SHALL consist of its retained top-level conversation sessions and their direct and nested native subagent descendants whose session header records `origin: subagent`. Forks and unrelated sessions SHALL remain foreign. A destructive operation MAY accept an explicit force option that bypasses this shared-checkout refusal; force SHALL NOT bypass host filesystem policy, discard consent, or the refusal to remove a checkout with an active operation from another task. When the associated worktree directory no longer exists, the plugin SHALL NOT fail the sharing preflight because of that absence; the Git removal path SHALL treat the already-absent checkout as completed.

#### Scenario: A task's own subagent child does not block removal

- **WHEN** a task's worktree is idle and its only other related native session is a direct or nested subagent descendant of one of the task's conversations
- **THEN** the plugin does not report the worktree as shared and proceeds with the confirmed removal

#### Scenario: A foreign native session blocks removal

- **WHEN** a native session outside the task's conversation lineage has its effective directory inside the worktree
- **THEN** the plugin refuses removal with an actionable shared-worktree error and leaves the checkout intact

#### Scenario: A checkout associated with another task blocks removal

- **WHEN** another task is associated with the same checkout or a nested path inside it
- **THEN** the plugin refuses removal and identifies the other task in the error details

#### Scenario: Every blocker is reported together

- **WHEN** the checkout is associated with another task and used by one or more foreign native sessions
- **THEN** the refusal details identify every blocking task and every blocking native session

#### Scenario: Active operation on the same checkout blocks force

- **WHEN** another task has an active context operation on the same checkout
- **THEN** a forced removal is refused without removing the checkout
- **AND** the force action becomes available again after that operation settles

#### Scenario: Missing worktree directory does not block removal

- **WHEN** a confirmed removal targets an associated worktree directory that no longer exists
- **THEN** the sharing preflight does not fail because the directory is absent
- **AND** the Git removal path treats the already-absent checkout as completed

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

### Requirement: Consented force removal of a shared checkout

When a worktree-only removal fails the sharing preflight with `SHARED_WORKTREE`, the plugin SHALL offer a force removal action. The force confirmation SHALL list every blocking task and every blocking native conversation, SHALL state that the shared checkout directory will be removed, and SHALL require explicit opt-in before the destructive action is enabled. Force SHALL bypass only the sharing guard. A successful forced worktree-only removal SHALL return the task's conversations to the base project, remove the shared checkout, retain the task, conversations, notes, and Git branch, and persist an error on every other task bound to the removed checkout without rewriting that task's effective directory.

#### Scenario: Force removal consent

- **WHEN** a worktree-only removal fails because the checkout is shared
- **THEN** the failure surface offers a force removal action
- **AND** the force confirmation lists the affected tasks and conversations and requires explicit opt-in

#### Scenario: Forced worktree-only removal completes

- **WHEN** the user explicitly opts in and the preflight otherwise permits removal
- **THEN** the shared checkout is removed
- **AND** the task, its conversations, notes, and branch are retained
- **AND** every task conversation returns to the base project path

#### Scenario: Forced removal records affected bindings

- **WHEN** the forced removal removes a checkout bound to another task
- **THEN** that other task's binding records an error identifying the forced removal
- **AND** that other task's effective directory is not silently changed

#### Scenario: Forced removal respects host policy and local changes

- **WHEN** host policy denies the removal or the checkout has local changes without discard consent
- **THEN** the checkout is not removed
- **AND** the applicable denial or discard consent is presented without claiming success
