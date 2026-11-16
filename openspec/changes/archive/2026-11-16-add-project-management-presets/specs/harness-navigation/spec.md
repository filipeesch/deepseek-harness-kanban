# Spec Delta

## MODIFIED Requirements

### Requirement: Configuration within the Kanban page

The Kanban page SHALL provide access to General, Hub, Projects, and Board configuration within the
board experience rather than requiring a separate Railyin-style application setup area. The
configuration action SHALL open the General section by default. The General section SHALL contain the
global worktree base path. The Hub section SHALL contain the active Hub's name, Hub deletion, and
board management. The Projects section SHALL list the active Hub's project registry and SHALL NOT
embed the project creation or editing form; creating or editing a project SHALL open the project
editor dialog described by the Project editor dialog requirement. The Board section SHALL contain the
active board's configuration in five sub-sections: General, containing the board name; Projects,
containing the board's project scope; Defaults, containing the board's default model, default agent
preset, and MCP tool allowlist; Workflow, containing the board's workflow; and Danger zone, containing board deletion.
The Board section and its sub-sections SHALL be unavailable when the active Hub has no board. The
empty-board Configure projects action SHALL open the Projects section. The create-board empty state
SHALL open the Hub section or an equivalent board-creation action.

#### Scenario: Open configuration from the board

- **WHEN** the user opens configuration from the board's configuration action
- **THEN** the General section is presented
- **AND** Hub, Projects, and Board remain available

#### Scenario: Configure projects from the board

- **WHEN** the user accesses Projects configuration from Kanban
- **THEN** the active Hub's project registry is listed
- **AND** the project creation and editing form is not embedded in the section

#### Scenario: Create a project from the Projects section

- **WHEN** the user activates the add-project action in the Projects section
- **THEN** the project editor dialog opens for a new project of the active Hub

#### Scenario: Configure the workflow from the board

- **WHEN** the user opens the Board section with an active board and selects its Workflow sub-section
- **THEN** that board's workflow is available

#### Scenario: Configure the board name and project scope

- **WHEN** the user opens the Board section's General or Projects sub-section
- **THEN** the board's name or its project scope is available respectively

#### Scenario: Configure the board defaults

- **WHEN** the user opens the Board section's Defaults sub-section
- **THEN** the board's default model, default agent preset, and MCP tool allowlist are available

#### Scenario: Configure the board MCP allowlist

- **WHEN** the user opens the Board section's Defaults sub-section of a board whose conversations use MCP servers
- **THEN** the board's MCP tool allowlist is available beside its default model and default agent preset


#### Scenario: Delete a board from the Danger zone

- **WHEN** the user opens the Board section's Danger zone sub-section with an active board that has no tasks
- **THEN** deleting that board is available under the existing confirmation rules

#### Scenario: Configure general board settings from the board

- **WHEN** the user opens the General section
- **THEN** the global worktree base path setting is available

#### Scenario: Configure the active Hub

- **WHEN** the user opens the Hub section
- **THEN** the active Hub's name and board management are available
- **AND** projects from other Hubs are not shown

#### Scenario: No Board section without a board

- **WHEN** the active Hub has no boards
- **THEN** the Board section and its sub-sections are unavailable
- **AND** the page presents the create-board empty state

#### Scenario: Configure projects from an empty board

- **WHEN** the user selects Configure projects on a board without projects
- **THEN** the Projects configuration section is presented for the active Hub
