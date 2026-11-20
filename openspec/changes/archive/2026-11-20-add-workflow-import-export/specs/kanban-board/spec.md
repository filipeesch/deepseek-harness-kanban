# Spec Delta

## MODIFIED Requirements

### Requirement: Boards section with stacked board configuration

The Boards section SHALL list every board of the active Hub, and each row SHALL present the board's name together with an Edit action and a Delete action. The section SHALL present a New board action that creates a board through the same creation surface the board header offers, requiring a name and initializing the default workflow. Renaming a board SHALL be available in that board's own configuration and SHALL NOT be offered from the row. The row SHALL NOT present an action that makes the board the active board.

The section SHALL additionally present an Export action and an Import action as section-level actions beside New board. Export SHALL open the board selection defined by `workflow-transfer` for the active Hub. Import SHALL open the file read and conflict settlement defined by `workflow-transfer` for the active Hub. Neither action SHALL make a board the active board, and neither SHALL be offered from a board row.

Choosing Edit SHALL open that board's configuration as an overlay stacked above the Boards section, carrying the board sub-sections General, Projects, Defaults, Workflow, and Danger zone, and editing the board it was opened for — including a board that is not the active board. While the overlay is open, the Boards section SHALL remain presented beneath it and SHALL NOT accept input. Closing the overlay SHALL return to the Boards section with the list reflecting every change the overlay made. Deleting a board from the overlay's Danger zone SHALL close the overlay and return to the Boards section. Board deletion SHALL keep its existing rules: only a board with no tasks is deletable, and the removal of a published board SHALL ask whether it applies only to this installation or to the team.

#### Scenario: List the boards of the active Hub

- **WHEN** the user opens the Boards section for a Hub with more than one board
- **THEN** every board of that Hub is listed with its name, an Edit action, and a Delete action
- **AND** no board from another Hub is listed

#### Scenario: Edit a board that is not active

- **WHEN** the user chooses Edit on a board that is not the active board
- **THEN** that board's configuration opens over the list
- **AND** the changes apply to that board and to no other
- **AND** the active board of the Kanban page is unchanged

#### Scenario: Close the overlay back to the list

- **WHEN** the user closes the board configuration overlay
- **THEN** the Boards section is presented with the list reflecting the changes the overlay made
- **AND** the configuration dialog stays open

#### Scenario: Delete a board from the overlay

- **WHEN** the user deletes the board the overlay was opened for, from its Danger zone
- **THEN** the overlay closes
- **AND** the Boards section is presented without that board

#### Scenario: Create a board from the section

- **WHEN** the user chooses New board and submits a valid name
- **THEN** the board is created with the default workflow through the same creation surface the board header offers
- **AND** it appears in the Boards section

#### Scenario: Export from the section

- **WHEN** the user chooses Export in the Boards section
- **THEN** the board selection for the active Hub opens over the list
- **AND** the active board of the Kanban page is unchanged

#### Scenario: Import from the section

- **WHEN** the user chooses Import in the Boards section
- **THEN** the file read for the active Hub opens over the list
- **AND** the list reflects the boards an applied import created or replaced when the surface closes
