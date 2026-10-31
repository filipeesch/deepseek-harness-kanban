# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
