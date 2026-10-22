# Spec Delta

## MODIFIED Requirements

### Requirement: Configuration within the Kanban page
The Kanban page SHALL provide access to General, Projects, and Workflow configuration within the board experience rather than requiring a separate Railyin-style application setup area. The configuration action SHALL open the General section by default. The empty-board Configure projects action SHALL open the Projects section.

#### Scenario: Configure projects from the board
- **WHEN** the user accesses Projects configuration from Kanban
- **THEN** the project configuration experience is available within the Kanban page

#### Scenario: Configure the workflow from the board
- **WHEN** the user accesses Workflow configuration from Kanban
- **THEN** the workflow configuration experience is available within the Kanban page

#### Scenario: Configure general board settings from the board
- **WHEN** the user opens configuration from the board's configuration action
- **THEN** the General configuration section is presented
- **AND** Projects and Workflow remain available

#### Scenario: Configure projects from an empty board
- **WHEN** the user selects Configure projects on a board without projects
- **THEN** the Projects configuration section is presented
