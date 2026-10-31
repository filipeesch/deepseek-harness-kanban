# Spec Delta

## MODIFIED Requirements

### Requirement: Top-level task creation
The active board SHALL provide one New task action at the top of its workflow's configured initial column. It SHALL collect a title, description, and project from the active Hub's project registry. The project input SHALL start unselected and SHALL be required; the board SHALL NOT preselect a project, including when a project filter is active. Saving a new task SHALL place it in the active board's configured initial stage without creating a native DSH conversation and without initiating an agent execution. The board header SHALL NOT provide a separate New task action.

#### Scenario: Open task creation from the board
- **WHEN** the user selects the New task action at the top of the active board's configured initial column
- **THEN** the creation experience provides title, description, and project inputs without asking the user to choose a stage
- **AND** the project input is unselected
- **AND** the project list contains only projects owned by the active Hub

#### Scenario: Create into a customized initial stage
- **WHEN** the user saves a new task and the active board's workflow has a configured initial stage
- **THEN** the task is created in that stage with the supplied title, description, and project
- **AND** the task belongs to the active board
- **AND** no native DSH conversation or workspace is created
- **AND** task creation does not initiate an agent execution

#### Scenario: Require an explicit project choice
- **WHEN** the user opens New task with one or more registered Hub projects and does not select a project
- **THEN** the task cannot be created
- **AND** no project is silently chosen from the project list or the active project filter

#### Scenario: No task creation without a board
- **WHEN** the active Hub has no boards
- **THEN** the board surface presents the create-board empty state
- **AND** no New task action is available

#### Scenario: Start the first conversation after creation
- **WHEN** the user opens a newly created task's Conversations section
- **THEN** the task has no native conversation
- **AND** the section presents the explicit start state defined by `task-conversations`
