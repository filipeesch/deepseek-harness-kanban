# Spec Delta

## MODIFIED Requirements

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
