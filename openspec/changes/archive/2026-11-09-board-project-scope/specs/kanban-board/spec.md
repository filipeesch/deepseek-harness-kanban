# Spec Delta

## MODIFIED Requirements

### Requirement: Top-level task creation
The active board SHALL provide one New task action at the top of its workflow's configured initial column. It SHALL collect a title, description, and project, an Auto mode option that is off by default, and, only when the initial stage has an entry instruction, a Start execution now option that is on by default. The project input SHALL offer only the projects of the active Hub that the active board allows, as defined by Board project scope configuration; a project that the board does not allow SHALL NOT be offered and SHALL NOT be accepted. The project input SHALL start unselected and SHALL be required; the board SHALL NOT preselect a project, including when a project filter is active. A board that allows no project SHALL present no selectable project and SHALL explain that the board accepts no new task, and saving SHALL be unavailable. Saving a new task SHALL place it in the active board's configured initial stage and SHALL record the selected auto-mode value. When the initial stage has an entry instruction and the Start execution now option remains enabled, saving SHALL start the automatic first execution defined by Automatic first execution on task creation. Otherwise, saving SHALL NOT create a native DSH conversation, a workspace, or an agent execution. The board header SHALL NOT provide a separate New task action.

#### Scenario: Open task creation from the board
- **WHEN** the user selects the New task action at the top of the active board's configured initial column
- **THEN** the creation experience provides title, description, project, and Auto mode inputs without asking the user to choose a stage
- **AND** it presents Start execution now only when the initial stage has an entry instruction
- **AND** the project input is unselected
- **AND** the project list contains only projects of the active Hub that the board allows

#### Scenario: Create into a customized initial stage
- **WHEN** the user saves a new task, the active board's workflow has a configured initial stage, and the start option does not apply or is disabled
- **THEN** the task is created in that stage with the supplied title, description, project, and auto-mode value
- **AND** the task belongs to the active board
- **AND** no native DSH conversation or workspace is created
- **AND** task creation does not initiate an agent execution

#### Scenario: Create a task with auto mode
- **WHEN** the user enables Auto mode in the New task dialog and saves
- **THEN** the task is persisted with auto mode enabled
- **AND** its stage and position are unchanged
- **AND** no agent execution starts unless Start execution now also applies

#### Scenario: Create and start the first execution
- **WHEN** the user saves a new task in an initial stage with an entry instruction and keeps Start execution now enabled
- **THEN** the task is created in that stage
- **AND** the automatic first execution defined by Automatic first execution on task creation prepares the task and arms the countdown
- **AND** the card presents the task in that stage

#### Scenario: Capture a task without starting
- **WHEN** the initial stage has an entry instruction and the user disables Start execution now
- **THEN** no native DSH conversation, workspace, worktree, or agent execution is created
- **AND** the selected auto-mode value is persisted
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: No start option without an entry instruction
- **WHEN** the active board's initial stage has no entry instruction
- **THEN** the dialog does not present Start execution now
- **AND** task creation does not initiate an agent execution

#### Scenario: Require an explicit project choice
- **WHEN** the user opens New task with one or more allowed projects and does not select a project
- **THEN** the task cannot be created
- **AND** no project is silently chosen from the project list or the active project filter

#### Scenario: Offer only the allowed projects
- **WHEN** the active Hub has projects that the active board does not allow and the user opens New task
- **THEN** the project input lists the allowed projects of that Hub only
- **AND** no project the board does not allow is offered

#### Scenario: Create from another board of the same Hub
- **WHEN** a task of one board creates a task on another board of the same Hub with a project that the destination board allows
- **THEN** the task is created on the destination board
- **AND** the creating board's own scope does not restrict the destination

#### Scenario: No task creation without a board
- **WHEN** the active Hub has no boards
- **THEN** the board surface presents the create-board empty state
- **AND** no New task action is available

#### Scenario: Start the first conversation after creation
- **WHEN** the user opens a newly created task's Conversations section and its creation did not start the first execution
- **THEN** the task has no native conversation
- **AND** the section presents the explicit start state defined by `task-conversations`

### Requirement: Text search and project filtering
The active board SHALL support text search over its task titles and descriptions and filtering by project, separately and together. The project filter SHALL list the projects that already have at least one card on the active board; it SHALL NOT list a project with no card on that board. The filter SHALL derive its options from the tasks of the active board, so removing a project from the board's scope SHALL NOT remove a project that still has cards there. The two inputs SHALL be presented by the board filter control defined by the Board filter control requirement. This scope SHALL NOT add activity or worktree-status filters.

#### Scenario: Find a task by its title or description
- **WHEN** the user searches for text that matches a task's title or description
- **THEN** that task is included in the board's matching results

#### Scenario: Filter tasks by project
- **WHEN** the user selects a project filter
- **THEN** the board displays only tasks associated with that project

#### Scenario: Combine search and project filtering
- **WHEN** the user applies text search and a project filter together
- **THEN** the displayed tasks satisfy both the text search and the selected project filter

#### Scenario: List only projects with cards on the board
- **WHEN** the active Hub has a project with no card on the active board
- **THEN** the project filter does not offer that project
- **AND** it offers every project that has at least one card on the board

#### Scenario: Keep the filter inside the active board
- **WHEN** the user changes from one board to another
- **THEN** the project filter options are limited to the projects with cards on the newly active board
- **AND** tasks from the previous board are not shown

#### Scenario: Reach both filters from one control
- **WHEN** the user wants to combine a text search with a project filter
- **THEN** both inputs are available in the same filter popover without leaving it

## ADDED Requirements

### Requirement: Board project scope configuration
A board SHALL carry its own project scope that states which projects may create tasks on it. The scope SHALL be stored on the board and SHALL NOT be stored in the board's workflow YAML. The scope SHALL have two states: unrestricted, meaning every project of the Hub may create tasks, and restricted to an explicit set of project keys. A board with no recorded scope SHALL be unrestricted, and a restriction SHALL be recorded as an explicit set that SHALL be able to be empty. A board restricted to an empty set SHALL accept no new task and SHALL be presented as closed for creation. The board's configuration SHALL present both states with the projects of the active Hub so a user can choose between them and change the selected set. Removing a project from the scope SHALL NOT change the tasks already on the board, SHALL NOT move them, and SHALL NOT remove them. Saving the scope SHALL be a board write that carries the Hub revision as its precondition and SHALL follow the same publishing behavior as the other board writes. The scope SHALL be local to the Hub that owns the board and SHALL be published only as described by the hub-sharing specification.

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
- **WHEN** the user opens the board's configuration
- **THEN** the project scope is presented with the board's other configuration
- **AND** it presents the board's current state and the projects of the active Hub

#### Scenario: Do not store the scope in the workflow
- **WHEN** the user saves a board project scope
- **THEN** the board's workflow YAML is unchanged
- **AND** the scope does not appear in the workflow editor
