# Harness Navigation Specification

## Purpose

Provide a Kanban-centered product entry point within DeepSeek Harness while preserving the host application's normal startup, native conversations, and existing navigation.

## Requirements

### Requirement: Plugin-provided Kanban main page
The product SHALL be delivered as an independent DSH plugin without requiring changes to the DSH core. It SHALL expose a main page named Kanban and a corresponding sidebar item alongside Automation tasks and Plugins.

#### Scenario: Open Kanban from the sidebar
- **WHEN** the plugin is available and the user selects Kanban in the DSH sidebar
- **THEN** DSH displays the Kanban main page
- **AND** Automation tasks and Plugins remain available as existing navigation destinations

### Requirement: Preserve normal host startup
The plugin SHALL preserve DSH's normal startup behavior and SHALL NOT force Kanban to become the startup page.

#### Scenario: Start DSH with the plugin available
- **WHEN** the user starts DSH with the Kanban plugin available
- **THEN** DSH follows its normal startup behavior rather than an override introduced by the plugin

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

### Requirement: Preserve native DSH interaction boundaries
The plugin SHALL retain native DSH conversations and execution rather than replace the host's agent experience. It SHALL preserve access to ordinary DSH chats and existing native features. This scope SHALL NOT add a new shortcut for navigating from a task card to the main chat area.

#### Scenario: Continue using ordinary DSH conversations
- **WHEN** the user opens an ordinary DSH chat outside a task drawer
- **THEN** the native chat experience remains available independently of the Kanban page

#### Scenario: Use native conversation behavior in task work
- **WHEN** a conversation is used within a Kanban task
- **THEN** conversation execution uses the native DSH experience rather than a separate Railyin agent runtime

### Requirement: Project registry list
The Projects section SHALL list each project of the active Hub with its name, its project path, and whether it is Git-backed. The list SHALL offer an add-project action and, per project, edit and delete actions. Delete SHALL require an inline confirmation and SHALL remain unavailable while any task of the Hub references the project or while the project has an unresolved relocation. A successful save or delete SHALL be reported in the Projects section.

When a project has a recorded relocation, its row SHALL present the relocation state — waiting for current work, migrating, or failed — and the problem of a failed step. The row SHALL offer retry for a failed relocation and cancel while the relocation has not changed the project. A completed relocation SHALL be reported in the Projects section.

#### Scenario: List Git-backed and folder projects
- **WHEN** the active Hub has one Git-backed project and one folder project
- **THEN** both appear in the list
- **AND** each row indicates whether the project is Git-backed

#### Scenario: Confirm project deletion
- **WHEN** the user deletes a project that no task references
- **THEN** an inline confirmation is requested before the deletion is sent
- **AND** the project is removed only after confirmation

#### Scenario: Block deleting a project in use
- **WHEN** a task of the Hub references the project
- **THEN** the project's delete action is unavailable and explains that its tasks must be moved or deleted first

#### Scenario: Present relocation progress
- **WHEN** a project has a relocation that is waiting for conversations or migrating
- **THEN** its row presents that state
- **AND** the rest of the list remains usable

#### Scenario: Retry or cancel a relocation
- **WHEN** a project's relocation failed
- **THEN** its row offers a retry action and presents the recorded problem
- **AND** a relocation that has not changed the project also offers a cancel action

#### Scenario: Block deleting a project during a relocation
- **WHEN** a project has an unresolved relocation
- **THEN** the project's delete action is unavailable

### Requirement: Project editor dialog
The Kanban page SHALL provide a project editor dialog for creating and editing a project of the active Hub. The dialog SHALL collect a required project name and a required absolute project folder. The folder SHALL be selectable through a directory picker and SHALL remain editable as text.

Selecting a folder SHALL run project location detection and SHALL populate the Git root and default branch from the detected result. The Git root and default branch SHALL remain editable text fields. Detection SHALL update a field only while that field has not been edited by the user or still equals the last detected value. Detection SHALL run when a folder is picked and when the folder field loses focus holding a valid absolute path. A detection failure SHALL be reported without discarding values already entered.

The dialog SHALL present the detected outcome before saving: a Git-backed outcome with its Git root and suggested default branch, or a folder outcome stating that no Git repository was found. An empty Git root SHALL declare a folder project, and clearing a stored Git root SHALL be the explicit way to remove a project's Git association. Saving SHALL submit the current values, SHALL report validation failures in the dialog, and SHALL keep the entered values so the user can correct them. Cancel SHALL discard the draft. The dialog SHALL prevent closing while a save is pending.

When the edited project still has tasks and the submitted project path or Git root differs from the stored one, the dialog SHALL present a confirmation before sending and SHALL list the migration impact: the affected tasks, the number of conversations that will move, the number of worktree bindings that will be revalidated, and the number of conversations that are currently active and will make the relocation wait. The impact SHALL be derived from the current board state. The dialog SHALL send a relocation request only after that confirmation. When the project has no tasks, or neither the project path nor the Git root changed, saving SHALL apply the project registration directly.

#### Scenario: Open the editor for a new project
- **WHEN** the user activates the add-project action
- **THEN** the dialog opens with empty name, folder, Git root, and default branch values
- **AND** saving is unavailable until a name and an absolute folder are present

#### Scenario: Pick a folder with the native picker
- **WHEN** the user selects a folder through the picker
- **THEN** the folder value is replaced with the selected path
- **AND** detection populates the Git root and default branch when a repository is found

#### Scenario: Detect a typed folder path
- **WHEN** the user types an absolute folder path and the field loses focus
- **THEN** detection runs for that path and populates the Git root and default branch when a repository is found

#### Scenario: Autocomplete preserves manual edits
- **WHEN** the user edits the Git root or default branch and then picks another folder
- **THEN** the edited field keeps its value
- **AND** fields still holding the last detected value are updated to the new detection

#### Scenario: Present a folder project outcome
- **WHEN** detection finds no Git repository for the selected folder
- **THEN** the dialog states that no Git repository was found
- **AND** saving the project as a folder project remains available

#### Scenario: Remove a Git association
- **WHEN** the user clears the Git root of an existing Git-backed project and saves
- **THEN** the project is saved as a folder project

#### Scenario: Report picker failure
- **WHEN** the directory picker fails or is unavailable
- **THEN** the dialog reports an actionable problem
- **AND** the current name and folder values are retained

#### Scenario: Report a save failure
- **WHEN** the host rejects the saved project
- **THEN** the dialog shows the problem and keeps the entered values
- **AND** the project registry is unchanged

#### Scenario: Cancel an edit
- **WHEN** the user cancels the dialog
- **THEN** no command is sent and the stored project is unchanged

#### Scenario: Edit an existing project
- **WHEN** the user activates edit for a project
- **THEN** the dialog opens with that project's stored values
- **AND** detection may run without replacing values the user did not change

#### Scenario: Confirm a relocation from the editor
- **WHEN** the user changes the project path or Git root of a project that still has tasks and submits the dialog
- **THEN** the dialog presents the migration impact before sending
- **AND** the relocation is sent only after the user confirms
- **AND** the dialog closes and the Projects section reports the accepted relocation
- **AND** a rejected relocation keeps the entered values in the form

#### Scenario: Present active conversations as waiting
- **WHEN** the migration impact includes conversations that are currently active
- **THEN** the confirmation states that the relocation will wait for them to finish

#### Scenario: Save a project location without tasks directly
- **WHEN** the edited project has no tasks and its project path changed
- **THEN** saving applies the new location without a relocation confirmation

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
