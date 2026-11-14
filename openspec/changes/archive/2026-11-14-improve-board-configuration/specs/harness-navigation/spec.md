# Spec Delta

## ADDED Requirements

### Requirement: Configuration surface sizing

The configuration dialog SHALL size its surface per section instead of applying one fixed width to
every section. A section that presents forms SHALL use a wider surface than the legacy fixed width,
and a section that edits the active board's workflow SHALL use the widest configured surface. Every
surface SHALL remain inside the viewport, SHALL keep the dialog's content vertically scrollable, and
SHALL NOT require horizontal scrolling for the section's content at the supported viewport widths.
The configuration section tabs SHALL remain available at the top of the dialog.

#### Scenario: Open a form section

- **WHEN** the user opens the General, Hub, Projects, Schedules, or Team Settings section
- **THEN** the dialog uses the wider form surface
- **AND** the section content fits the surface without horizontal scrolling

#### Scenario: Open the board workflow

- **WHEN** the user opens the board's Workflow sub-section
- **THEN** the dialog uses the widest configured surface
- **AND** the dialog remains inside the viewport

#### Scenario: Fit a narrow viewport

- **WHEN** the viewport is narrower than the widest configured surface
- **THEN** the dialog shrinks to the viewport
- **AND** the section content remains reachable through vertical scrolling

### Requirement: Unsaved changes across configuration navigation

The configuration SHALL require explicit confirmation before any navigation that would discard
unsaved edits in the current surface. This SHALL cover switching away from a board sub-section whose
draft would be lost, leaving the Board section for another configuration section, and closing the
dialog while such a draft exists. The confirmation SHALL name what will be discarded, SHALL be
cancelable, and SHALL keep the current surface and its edits when canceled; the edits SHALL be
discarded only after the user confirms. Navigating with no unsaved edits SHALL NOT ask. The board's
workflow draft is not covered by this rule: it survives navigation as defined by `kanban-board`.

#### Scenario: Leave a board sub-section with unsaved edits

- **WHEN** the user changes the board name, project scope, or defaults and switches to another board sub-section
- **THEN** a confirmation asks whether to discard those edits
- **AND** canceling keeps the current sub-section and its edits

#### Scenario: Confirm discarding a board sub-section

- **WHEN** the confirmation for a board sub-section with unsaved edits is accepted
- **THEN** the requested sub-section opens
- **AND** the previous sub-section's unsaved edits are gone

#### Scenario: Leave the Board section with unsaved edits

- **WHEN** the user leaves the Board section for another configuration section while a board sub-section holds unsaved edits
- **THEN** a confirmation asks whether to discard those edits
- **AND** canceling keeps the Board section and its edits

#### Scenario: Do not ask without unsaved edits

- **WHEN** the user navigates between configuration surfaces with no unsaved edits
- **THEN** no confirmation is presented

#### Scenario: Close with unsaved board edits

- **WHEN** the user closes the configuration dialog while a board sub-section holds unsaved edits
- **THEN** a confirmation asks whether to discard them
- **AND** canceling keeps the dialog open with the edits intact

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
containing the board's project scope; Defaults, containing the board's default model and default
agent preset; Workflow, containing the board's workflow; and Danger zone, containing board deletion.
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
- **THEN** the board's default model and default agent preset are available

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
