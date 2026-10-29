# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
