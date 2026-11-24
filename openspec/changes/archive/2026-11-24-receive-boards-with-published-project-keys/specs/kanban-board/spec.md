# Spec Delta

## MODIFIED Requirements

### Requirement: Board project scope configuration

A board SHALL carry its own project scope that states which projects may create tasks on it. The scope
SHALL be stored on the board and SHALL NOT be stored in the board's workflow YAML. The scope SHALL
have two states: unrestricted, meaning every project of the Hub may create tasks, and restricted to
an explicit set of published project identities. A board with no recorded scope SHALL be unrestricted,
and a restriction SHALL be recorded as an explicit set that SHALL be able to be empty. A board
restricted to an empty set SHALL accept no new task and SHALL be presented as closed for creation. The
board configuration's Projects sub-section SHALL present both states with the projects of the active
Hub, naming each project by its published identity, so a user can choose between them and change the
selected set. It SHALL mark a project the Hub holds as a placeholder as awaiting adoption and a
placeholder the installation ignored as ignored. Removing a project from the scope SHALL NOT change the
tasks already on the board, SHALL NOT move them, and SHALL NOT remove them. Saving the scope SHALL be a
board write that carries the Hub revision as its precondition and SHALL follow the same publishing
behavior as the other board writes. The scope SHALL be local to the Hub that owns the board and SHALL
be published only as described by the hub-sharing specification.

#### Scenario: Restrict a board to selected projects

- **WHEN** the user selects specific projects for a board and saves the board configuration
- **THEN** the board allows those projects and refuses every other project of the Hub
- **AND** the New task input offers the selected projects only

#### Scenario: Allow every project on a board

- **WHEN** the user chooses to allow every project for a board that was restricted
- **THEN** the board records no restriction
- **AND** every project of the Hub may create tasks on that board again

#### Scenario: Close a board to new tasks

- **WHEN** the user selects specific projects and leaves none selected
- **THEN** the board accepts no new task
- **AND** New task explains that the board is closed for creation instead of offering an empty project input

#### Scenario: Keep existing cards when a project leaves the scope

- **WHEN** the user removes from the board's scope a project that has cards on that board
- **THEN** the scope no longer allows that project
- **AND** the existing cards stay in their stages with their conversations and worktrees unchanged

#### Scenario: Present the scope beside the rest of the board configuration

- **WHEN** the user opens the board configuration's Projects sub-section
- **THEN** the project scope is presented with the board's other configuration
- **AND** it presents the board's current state and the projects of the active Hub

#### Scenario: Name a project by its published identity

- **WHEN** the Projects sub-section presents a project whose local key and published key differ
- **THEN** it presents the published identity the board scope records
- **AND** the project's local key remains available with the project

#### Scenario: Keep a linked project allowed when its local key changes

- **WHEN** the user changes the local key of a project a board allows by its published identity
- **THEN** the board's scope is unchanged
- **AND** the project remains allowed

#### Scenario: Do not store the scope in the workflow

- **WHEN** the user saves a board project scope
- **THEN** the board's workflow YAML is unchanged
- **AND** the scope does not appear in the workflow editor
