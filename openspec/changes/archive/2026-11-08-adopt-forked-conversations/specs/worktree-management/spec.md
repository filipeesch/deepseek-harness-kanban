# Spec Delta

## MODIFIED Requirements

### Requirement: Protect worktrees shared outside the task conversation lineage

Before removing or deleting an associated worktree, the plugin SHALL refuse the operation when the checkout is associated with another task or is in use by a native DSH session outside the task's conversation lineage. The refusal SHALL collect every blocking task and every blocking native session in its details rather than reporting only the first blocker. The task's conversation lineage SHALL consist of its retained top-level conversation sessions plus their direct and nested native subagent descendants whose session header records `origin: subagent`. Retained top-level conversation sessions SHALL include conversations created for the task and forks the task adopted. A fork that no task adopted, and any unrelated session, SHALL remain foreign. A destructive operation MAY accept an explicit force option that bypasses this shared-checkout refusal; force SHALL NOT bypass host filesystem policy, discard consent, or the refusal to remove a checkout with an active operation from another task. When the associated worktree directory no longer exists, the plugin SHALL NOT fail the sharing preflight because of that absence; the Git removal path SHALL treat the already-absent checkout as completed.

#### Scenario: A task's own subagent child does not block removal

- **WHEN** a task's worktree is idle and its only other related native session is a direct or nested subagent descendant of one of the task's conversations
- **THEN** the plugin does not report the worktree as shared and proceeds with the confirmed removal

#### Scenario: An adopted fork does not block removal

- **WHEN** a task's worktree is idle and its only other related native session is a fork the task adopted
- **THEN** the plugin does not report the worktree as shared and proceeds with the confirmed removal

#### Scenario: A foreign native session blocks removal

- **WHEN** a native session outside the task's conversation lineage has its effective directory inside the worktree
- **THEN** the plugin refuses removal with an actionable shared-worktree error and leaves the checkout intact

#### Scenario: An unadopted fork blocks removal

- **WHEN** a fork that no task adopted has its effective directory inside the worktree
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
