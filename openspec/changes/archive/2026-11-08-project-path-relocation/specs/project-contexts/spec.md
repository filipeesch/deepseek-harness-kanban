# Spec Delta

## MODIFIED Requirements

### Requirement: Project registration validation

Saving a project SHALL canonicalize its project path and, when a Git root is supplied, that Git root. A Git-backed project SHALL be rejected unless both paths exist as directories, the project path is contained by the Git root, and the Git root is the top-level directory of a Git repository that contains the project path. A folder project SHALL be rejected unless its project path exists as a directory. A detection result held by the client SHALL NOT be authoritative for the save.

A save MAY add or remove a project's Git association without changing its project path. Removing the Git association SHALL discard the stored default branch. A save SHALL be rejected while any task of the project has an unresolved context operation or a pending confirmed transition that requests a worktree. A save SHALL be rejected while the project has an unresolved relocation.

A save SHALL NOT change the project path or the Git root of a project that still has tasks; that change SHALL be requested as a project relocation. A save MAY change the project path or the Git root of a project with no tasks.

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

- **WHEN** a project that still has tasks is saved with a different project path or a different Git root
- **THEN** the save is rejected with an actionable problem that identifies the requested change as a relocation
- **AND** the stored project is unchanged

#### Scenario: Change the location of a project without tasks

- **WHEN** a project with no tasks is saved with a different project path or Git root
- **THEN** the save applies the new location to the stored project

#### Scenario: Reject a save while a relocation is pending

- **WHEN** the project has an unresolved relocation
- **THEN** the save is rejected with an actionable problem
- **AND** the stored project is unchanged
