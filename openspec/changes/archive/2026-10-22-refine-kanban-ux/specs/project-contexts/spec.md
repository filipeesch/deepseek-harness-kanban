# Spec Delta

## ADDED Requirements

### Requirement: Native workspace binding for task conversations
A new task conversation SHALL join a native DSH workspace whose canonical path is the task's current effective directory, rather than being created with only a cwd. The plugin SHALL reuse an existing workspace for that path or create one. The base-project workspace SHALL be shared by tasks in that project; a worktree workspace SHALL belong to one task. The plugin SHALL NOT require the user to select a workspace for a task conversation. An existing conversation SHALL keep the workspace it joined at creation when the task's effective directory changes; a conversation added after the change SHALL join the workspace for the new effective directory. The base workspace title SHALL be the project name and the worktree workspace title SHALL be `project · branch`; an existing workspace SHALL preserve its title. If a required workspace cannot be created or resolved, the plugin SHALL fail the conversation creation with an actionable error and SHALL NOT fall back to a cwd-only session.

#### Scenario: Open a conversation for a task without a worktree
- **WHEN** a task uses its base project directory and its conversation is created
- **THEN** the conversation joins the workspace for that project path
- **AND** the user is not asked to select a workspace

#### Scenario: Open a conversation for a task with a worktree
- **WHEN** a task uses its worktree project directory and a new conversation is created
- **THEN** the conversation joins the workspace for that worktree path

#### Scenario: Add a conversation after a directory change
- **WHEN** an existing task conversation keeps its original workspace after the task moves to a worktree, and the user adds another conversation
- **THEN** the new conversation joins the workspace for the worktree path
- **AND** the existing conversation retains its original workspace grouping

#### Scenario: Reuse an existing workspace
- **WHEN** a workspace already exists at the canonical path required for a conversation
- **THEN** the plugin reuses it without renaming it

#### Scenario: Fail without a cwd-only fallback
- **WHEN** the required workspace cannot be created or resolved
- **THEN** the conversation is not created as a cwd-only session and the plugin reports the failure

### Requirement: Workspace ownership and cleanup
The plugin SHALL record which native workspaces it created and SHALL treat any pre-existing workspace as not owned. When a task is deleted, the plugin SHALL delete the registration of an owned worktree workspace when no other task or session uses it. It SHALL NOT delete the shared base-project workspace or any workspace it did not create. Deleting a workspace registration SHALL retain its directory and native conversation logs. DSH has no hidden-workspace state, so a registered workspace remains visible in the sidebar while it is in use; the plugin SHALL NOT claim to hide it. A failed cleanup SHALL be reported and SHALL NOT be represented as a successful removal.

#### Scenario: Remove an owned worktree workspace
- **WHEN** a task with a Kanban-created worktree workspace is deleted and no other task or session uses that workspace
- **THEN** the workspace registration is removed
- **AND** the directory and native conversation logs are retained

#### Scenario: Keep a shared base workspace
- **WHEN** a task using the shared project workspace is deleted while other tasks or a user-created workspace still use that path
- **THEN** the workspace registration is retained

#### Scenario: Report a cleanup failure
- **WHEN** deleting an owned worktree workspace registration fails
- **THEN** the failure is reported and the plugin does not claim that the registration was removed
