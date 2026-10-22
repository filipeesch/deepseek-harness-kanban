## Purpose

Define the project contexts used by Kanban tasks so native DSH conversations run in the correct project directory, including projects located inside a larger Git repository.

## ADDED Requirements

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

### Requirement: Invalid project contexts do not silently select another root
The plugin SHALL surface an actionable error when it cannot resolve or use the configured project directory or its equivalent worktree subdirectory. It SHALL NOT silently run the agent from a different root as a fallback.

#### Scenario: The project path is unavailable
- **WHEN** a task's configured base project path is missing or inaccessible when an agent action needs that directory
- **THEN** the plugin reports the context problem instead of substituting the Git root or workspace root

#### Scenario: The worktree does not contain the project subdirectory
- **WHEN** a task's required relative project subdirectory is absent from a selected worktree
- **THEN** the plugin reports that the task directory cannot be resolved instead of running from the worktree root
