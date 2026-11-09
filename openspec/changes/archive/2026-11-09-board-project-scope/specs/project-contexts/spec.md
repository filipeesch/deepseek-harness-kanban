# Spec Delta

## MODIFIED Requirements

### Requirement: Retained project registry
Each Hub SHALL retain its own project registry that users can configure and select from when associating a project with a task. A project SHALL belong to exactly one Hub. A project SHALL be Git-backed, a folder project, or a published placeholder. A Git-backed project SHALL have a project path and a separately configurable Git root; the registry SHALL NOT treat those paths as necessarily identical, and the Git root SHALL be the top-level directory of the Git repository that contains the project path. A folder project SHALL have a project path and no Git root and SHALL remain selectable for tasks in its Hub. A published placeholder SHALL have no project path and SHALL NOT be selectable for a task until it is adopted. Every project SHALL carry a stable project key that is unique within its Hub. The registry SHALL NOT require a Hub root folder and SHALL NOT introduce a native DSH workspace hierarchy: a Hub is a logical grouping, not a workspace.

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

#### Scenario: Hold a published placeholder
- **WHEN** a received board names a project key that the Hub does not have
- **THEN** the registry holds a placeholder for that key
- **AND** the placeholder presents no project path and is not selectable for a task

### Requirement: Project registration validation
Saving a project SHALL canonicalize its project path and, when a Git root is supplied, that Git root. A Git-backed project SHALL be rejected unless both paths exist as directories, the project path is contained by the Git root, and the Git root is the top-level directory of a Git repository that contains the project path. A folder project SHALL be rejected unless its project path exists as a directory. A detection result held by the client SHALL NOT be authoritative for the save.

A save SHALL carry a project key that is unique within the Hub and SHALL be rejected with an actionable problem when another project of the same Hub already uses that key. A save SHALL require a project path: a published placeholder exists only through reception, and adopting it is an ordinary save that supplies a path and keeps the key.

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

#### Scenario: Reject a duplicate project key
- **WHEN** the user saves a project with a key that another project of the same Hub already uses
- **THEN** the save is rejected with an actionable problem identifying the key
- **AND** no stored project changes

#### Scenario: Adopt a published placeholder
- **WHEN** the user edits a published placeholder and supplies an existing project path
- **THEN** the project becomes a folder or Git-backed project with that path
- **AND** it keeps the key it was published with
- **AND** the save does not require a project relocation

## ADDED Requirements

### Requirement: Stable project key
Every project SHALL have a project key that identifies it across a Hub's boards and across installations. The key SHALL be generated from the project name when the project is registered, SHALL be editable, and SHALL be unique within its Hub. Generating a key SHALL be deterministic for a given name and existing key set, so projects registered on two installations from the same names receive the same key. A rename or a relocation of the project SHALL NOT change its key. Editing a key SHALL rewrite the key in every board scope of the same Hub in the same write, so no board is left referring to the previous key. A project that predates the key SHALL receive a deterministic key when its Hub opens, before any board is published.

#### Scenario: Generate a key on registration
- **WHEN** the user registers a project named "Platform API"
- **THEN** the project is stored with a key derived from that name
- **AND** the key is unique within the Hub

#### Scenario: Keep the key across a rename
- **WHEN** the user renames a project that has a key
- **THEN** the project key is unchanged

#### Scenario: Keep the key across a relocation
- **WHEN** the user relocates a project that has a key
- **THEN** the project key is unchanged

#### Scenario: Edit a key used by board scopes
- **WHEN** the user changes the key of a project that boards of the same Hub reference
- **THEN** those board scopes refer to the new key in the same write
- **AND** no board refers to the previous key

#### Scenario: Reject an ambiguous key
- **WHEN** the user sets a key that another project of the same Hub already uses
- **THEN** the key is rejected with an actionable problem
- **AND** the stored keys are unchanged

#### Scenario: Key an existing project on open
- **WHEN** a Hub opens with a project stored before project keys existed
- **THEN** the project receives a deterministic key that no other project of the Hub uses
- **AND** the key is recorded before the Hub is published

### Requirement: Published project placeholder
A project created because a received board names its key SHALL be a published placeholder. Its key SHALL be the published key, it SHALL have no project path, and it SHALL be presented in the project registry as awaiting adoption. A placeholder SHALL NOT create a task or a worktree, SHALL NOT be offered in a task creation input, and SHALL NOT be selectable for a task. Deleting a placeholder SHALL remove its key from every board scope of the Hub. A placeholder SHALL be deleted without the project-in-use precondition that a project with tasks carries, because it cannot own tasks.

#### Scenario: Receive a scope with an unknown key
- **WHEN** a board is received whose scope names a key the Hub does not hold
- **THEN** the Hub holds a placeholder with that key
- **AND** the placeholder presents no project path

#### Scenario: Refuse a task for a placeholder
- **WHEN** a task creation requests a project that is a placeholder
- **THEN** the task is not created
- **AND** the failure states that the project must be adopted first

#### Scenario: Omit placeholders from creation
- **WHEN** the user opens New task on a board that allows a placeholder
- **THEN** the placeholder is not offered as a selectable project

#### Scenario: Delete a placeholder
- **WHEN** the user deletes a placeholder that a board of the Hub allows
- **THEN** the placeholder is removed from the registry
- **AND** its key is removed from every board scope of the Hub
