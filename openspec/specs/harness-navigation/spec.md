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
The Kanban page SHALL provide access to General, Hub, Projects, and Board configuration within the board experience rather than requiring a separate Railyin-style application setup area. The configuration action SHALL open the General section by default. The General section SHALL contain the global worktree base path. The Hub section SHALL contain the active Hub's name, Hub deletion, and board management. The Projects section SHALL list the active Hub's project registry and SHALL NOT embed the project creation or editing form; creating or editing a project SHALL open the project editor dialog described by the Project editor dialog requirement. The Board section SHALL contain the active board's name, workflow, and deletion, and SHALL be unavailable when the active Hub has no board. The empty-board Configure projects action SHALL open the Projects section. The create-board empty state SHALL open the Hub section or an equivalent board-creation action.

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
- **WHEN** the user opens the Board section with an active board
- **THEN** that board's name, workflow, and deletion are available

#### Scenario: Configure general board settings from the board
- **WHEN** the user opens the General section
- **THEN** the global worktree base path setting is available

#### Scenario: Configure the active Hub
- **WHEN** the user opens the Hub section
- **THEN** the active Hub's name and board management are available
- **AND** projects from other Hubs are not shown

#### Scenario: No Board section without a board
- **WHEN** the active Hub has no boards
- **THEN** the Board section is unavailable
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
The Projects section SHALL list each project of the active Hub with its name, its project path, and whether it is Git-backed. The list SHALL offer an add-project action and, per project, edit and delete actions. Delete SHALL require an inline confirmation and SHALL remain unavailable while any task of the Hub references the project. A successful save or delete SHALL be reported in the Projects section.

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

### Requirement: Project editor dialog
The Kanban page SHALL provide a project editor dialog for creating and editing a project of the active Hub. The dialog SHALL collect a required project name and a required absolute project folder. The folder SHALL be selectable through a directory picker and SHALL remain editable as text.

Selecting a folder SHALL run project location detection and SHALL populate the Git root and default branch from the detected result. The Git root and default branch SHALL remain editable text fields. Detection SHALL update a field only while that field has not been edited by the user or still equals the last detected value. Detection SHALL run when a folder is picked and when the folder field loses focus holding a valid absolute path. A detection failure SHALL be reported without discarding values already entered.

The dialog SHALL present the detected outcome before saving: a Git-backed outcome with its Git root and suggested default branch, or a folder outcome stating that no Git repository was found. An empty Git root SHALL declare a folder project, and clearing a stored Git root SHALL be the explicit way to remove a project's Git association. Saving SHALL submit the current values, SHALL report validation failures in the dialog, and SHALL keep the entered values so the user can correct them. Cancel SHALL discard the draft. The dialog SHALL prevent closing while a save is pending.

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
