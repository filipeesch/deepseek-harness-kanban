# Project Contexts Specification

## Purpose

Define the Hub-owned project contexts used by Kanban tasks so native DSH conversations run in the correct project directory, including projects located inside a larger Git repository.

## Requirements

### Requirement: Retained project registry
Each Hub SHALL retain its own project registry that users can configure and select from when associating a project with a task. A project SHALL belong to exactly one Hub. A project SHALL be either Git-backed or a folder project. A Git-backed project SHALL have a project path and a separately configurable Git root; the registry SHALL NOT treat those paths as necessarily identical, and the Git root SHALL be the top-level directory of the Git repository that contains the project path. A folder project SHALL have a project path and no Git root and SHALL remain selectable for tasks in its Hub. The registry SHALL NOT require a Hub root folder and SHALL NOT introduce a native DSH workspace hierarchy: a Hub is a logical grouping, not a workspace.

#### Scenario: Register a monorepo project
- **WHEN** a user registers a project at /repos/platform/services/api whose Git root is /repos/platform
- **THEN** the active Hub's registry retains both paths separately and makes that project selectable for a task in that Hub

#### Scenario: Register a project at its repository root
- **WHEN** a user registers a project whose project path and Git root are both /repos/library
- **THEN** the registry accepts that context without requiring an artificial project subdirectory

#### Scenario: Register a folder project
- **WHEN** a user registers a project whose directory is not inside any Git repository
- **THEN** the active Hub's registry retains it as a folder project with no Git root
- **AND** the project is selectable for a task in that Hub

#### Scenario: Scope the registry to the active Hub
- **WHEN** the user opens Projects for one Hub
- **THEN** the list contains only projects owned by that Hub
- **AND** projects from other Hubs are not selectable for its tasks

#### Scenario: Do not require a Hub root
- **WHEN** the user registers a project in a Hub without configuring a root folder
- **THEN** the registry accepts the project
- **AND** no containment check or native workspace is derived from the Hub

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

### Requirement: No Hub or project inference from native DSH workspace
The plugin SHALL NOT infer a Hub or a project from the native DSH workspace, workspace directory, or session grouping. In a task conversation, the task's board and project SHALL be authoritative. In an ordinary DSH chat, the agent SHALL discover a board through board tools before performing board-scoped work.

#### Scenario: Do not infer from a matching directory
- **WHEN** an ordinary DSH chat runs in a native workspace whose directory matches a registered project
- **THEN** the plugin does not select that project's Hub or board automatically
- **AND** board tools require an explicitly discovered board identifier

#### Scenario: Use the task's board context
- **WHEN** a board tool is called from a task conversation without a board identifier
- **THEN** the plugin resolves the board from the task that owns the conversation
- **AND** it does not use the native workspace to choose a Hub or project

#### Scenario: Keep project selection explicit
- **WHEN** a task is created through a board tool
- **THEN** the project is the explicitly requested project from the board's Hub
- **AND** no project is inferred from the native workspace

### Requirement: Project location detection
The plugin SHALL provide a non-persistent project location detection for an absolute folder path. Detection SHALL report exactly one of: a Git-backed location with the canonical project path, its repository top-level directory, and an optional suggested default branch; a folder location with the canonical project path; or a typed failure. Detection SHALL NOT report the project path as its own Git root when no repository contains it, and SHALL NOT create, modify, register, or open anything.

A suggested default branch SHALL be the first available of the repository's `origin/HEAD` target, a local `main` branch, a local `master` branch, and the currently checked-out branch. When none is available, detection SHALL report no suggested branch.

Detection SHALL distinguish an unavailable or non-directory path from a failed inspection, and SHALL surface each as an actionable problem rather than as a folder location. Detection SHALL NOT be subject to the execution sandbox policy of an agent session.

#### Scenario: Detect a monorepo subdirectory
- **WHEN** detection inspects /repos/platform/services/api inside the repository at /repos/platform
- **THEN** it reports a Git-backed location with project path /repos/platform/services/api and Git root /repos/platform
- **AND** it suggests that repository's default branch

#### Scenario: Detect a repository root
- **WHEN** detection inspects a directory that is the top level of its repository
- **THEN** it reports the same canonical path as both project path and Git root

#### Scenario: Detect a folder without Git
- **WHEN** detection inspects a directory that is not inside any Git repository
- **THEN** it reports a folder location with the canonical project path
- **AND** it does not report the project path as a Git root and does not fail

#### Scenario: Suggest the remote default branch first
- **WHEN** the repository resolves `origin/HEAD` to a branch
- **THEN** detection suggests that branch even when other candidate branches exist

#### Scenario: Fall back through local branches
- **WHEN** the repository has no `origin/HEAD` and has a local `main` branch
- **THEN** detection suggests `main`
- **AND** when `main` is absent and `master` exists, it suggests `master`
- **AND** when neither exists, it suggests the currently checked-out branch

#### Scenario: No suggested branch
- **WHEN** none of the ordered candidates resolves to a branch
- **THEN** detection reports no suggested branch and still reports the Git-backed location

#### Scenario: Report an unavailable path
- **WHEN** detection inspects a path that does not exist or is not a directory
- **THEN** it fails with an actionable problem identifying the path
- **AND** it does not report a folder location

#### Scenario: Detection does not register a project
- **WHEN** detection inspects any path
- **THEN** the project registry is unchanged
- **AND** the result is not persisted by detection itself

### Requirement: Project registration validation
Saving a project SHALL canonicalize its project path and, when a Git root is supplied, that Git root. A Git-backed project SHALL be rejected unless both paths exist as directories, the project path is contained by the Git root, and the Git root is the top-level directory of a Git repository that contains the project path. A folder project SHALL be rejected unless its project path exists as a directory. A detection result held by the client SHALL NOT be authoritative for the save.

A save MAY add or remove a project's Git association without changing its project path. Removing the Git association SHALL discard the stored default branch. A save SHALL be rejected while any task of the project has an unresolved context operation or a pending confirmed transition that requests a worktree. Changing the project path of a project that still has tasks SHALL remain rejected.

#### Scenario: Save a valid Git-backed project
- **WHEN** the user saves a project whose project path is inside a directory that is the top level of a Git repository
- **THEN** the project is stored as Git-backed with that Git root

#### Scenario: Reject a Git root that is not the repository top
- **WHEN** the user saves a Git-backed project whose Git root is a subdirectory of the repository or is not a repository
- **THEN** the save is rejected with an actionable problem identifying the Git root
- **AND** the stored project is unchanged

#### Scenario: Save a folder project
- **WHEN** the user saves a project with an existing project path and no Git root
- **THEN** the project is stored as a folder project

#### Scenario: Remove the Git association
- **WHEN** the user saves a Git-backed project with its Git root cleared and no task operation is in flight
- **THEN** the project becomes a folder project
- **AND** its stored default branch is discarded

#### Scenario: Add a Git association
- **WHEN** the user saves a folder project with a valid Git root
- **THEN** the project becomes Git-backed
- **AND** tasks that remain in the project path keep their effective directory

#### Scenario: Block conversion during worktree work
- **WHEN** a task of the project has an unresolved context operation or a pending transition that requests a worktree
- **THEN** a save that adds or removes the Git association is rejected
- **AND** the project remains unchanged

#### Scenario: Reject a project path change with tasks
- **WHEN** a project that still has tasks is saved with a different project path
- **THEN** the save is rejected and the stored project is unchanged

### Requirement: Folder projects exclude Git-backed operations
A Git-backed operation SHALL require a project with a Git root. Branch listing, worktree inspection, creation, attachment, removal, repository policy checks, and worktree-derived directory resolution SHALL be rejected for a folder project with an actionable problem, and SHALL NOT alter the task, its conversations, or its effective directory. A task of a folder project SHALL use its project path as the effective working directory of its conversations.

#### Scenario: Reject worktree creation for a folder project
- **WHEN** worktree creation is requested for a task whose project is a folder project
- **THEN** the request is rejected with an actionable problem
- **AND** no branch, worktree, or directory change is produced

#### Scenario: Reject branch discovery for a folder project
- **WHEN** branch discovery is requested for a task whose project is a folder project
- **THEN** the request is rejected instead of returning an empty list presented as valid

#### Scenario: Keep the project path as the working directory
- **WHEN** a task of a folder project starts or resumes a conversation
- **THEN** the conversation uses the project path as its effective working directory
