# Project Contexts Specification

## Purpose

Define the project contexts used by Kanban tasks so native DSH conversations run in the correct project directory, including projects located inside a larger Git repository.

## Requirements

### Requirement: Retained project registry
The plugin SHALL retain a project registry that users can configure and select from when associating a project with a task. A Git-backed project SHALL have a project path and a separately configurable Git root; the registry SHALL NOT treat those paths as necessarily identical or introduce a Railyin workspace hierarchy.

#### Scenario: Register a monorepo project
- **WHEN** a user registers a project at /repos/platform/services/api whose Git root is /repos/platform
- **THEN** the registry retains both paths separately and makes that project selectable for a task

#### Scenario: Register a project at its repository root
- **WHEN** a user registers a project whose project path and Git root are both /repos/library
- **THEN** the registry accepts that context without requiring an artificial project subdirectory

### Requirement: Exact base project working directory
A task that has not switched to a worktree SHALL use its configured project path as the effective working directory of every associated agent conversation. The plugin SHALL NOT default those conversations to the Git root or native DSH workspace root when either differs from the project path.

#### Scenario: Start a conversation in a monorepo subproject
- **WHEN** a task for project /repos/platform/services/api has no worktree and its initial conversation is created
- **THEN** the agent working directory is /repos/platform/services/api, not /repos/platform

#### Scenario: Add another conversation before creating a worktree
- **WHEN** a task using its base project path gains another conversation tab
- **THEN** the new conversation uses that same project path

### Requirement: Equivalent worktree project directory
For a Git-backed project, the plugin SHALL preserve the project's relative path within its Git root when resolving a task's worktree directory. After a successful switch to a worktree, each task conversation SHALL use the worktree root joined with that relative project path, rather than defaulting to the worktree root.

#### Scenario: Resolve a monorepo project inside a worktree
- **WHEN** the base Git root is /repos/platform, the project path is /repos/platform/services/api, and the task switches to worktree root /worktrees/task-42
- **THEN** its effective agent directory is /worktrees/task-42/services/api

#### Scenario: Resolve a repository-root project inside a worktree
- **WHEN** a project's project path equals its Git root and the task switches to worktree root /worktrees/task-43
- **THEN** its effective agent directory is /worktrees/task-43

### Requirement: Native workspace semantics remain distinct from working directory
The term workspace SHALL refer to a native DSH workspace. Changing a task's effective agent directory SHALL preserve its existing conversations and histories and SHALL NOT require moving their native sidebar grouping or Files view to the new directory. A working-directory change SHALL NOT be represented as a filesystem permission grant.

#### Scenario: Change directories without moving native grouping
- **WHEN** a task's conversations successfully switch from a base project directory to its worktree project directory while their native DSH workspace grouping and Files view remain at the original location
- **THEN** the conversations retain their identities and histories and agent operations use the new effective directory

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

### Requirement: Invalid project contexts do not silently select another root
The plugin SHALL surface an actionable error when it cannot resolve or use the configured project directory or its equivalent worktree subdirectory. It SHALL NOT silently run the agent from a different root as a fallback.

#### Scenario: The project path is unavailable
- **WHEN** a task's configured base project path is missing or inaccessible when an agent action needs that directory
- **THEN** the plugin reports the context problem instead of substituting the Git root or workspace root

#### Scenario: The worktree does not contain the project subdirectory
- **WHEN** a task's required relative project subdirectory is absent from a selected worktree
- **THEN** the plugin reports that the task directory cannot be resolved instead of running from the worktree root
