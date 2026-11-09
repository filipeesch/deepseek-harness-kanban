# Spec Delta

## MODIFIED Requirements

### Requirement: Top-level task creation
The active board SHALL provide the New task action in each of its presentations: at the top of its workflow's configured initial column in the column board, and in the header of that stage in the workflow diagram as defined by `workflow-view` Task creation in the initial stage. The two presentations SHALL open one shared creation experience, and neither SHALL build creation inputs, enablement, or receipt handling of its own. It SHALL collect a title, description, and project, an Auto mode option that is off by default, and, only when the initial stage has an entry instruction, a Start execution now option that is on by default. The project input SHALL offer only the projects of the active Hub that the active board allows, as defined by Board project scope configuration; a project that the board does not allow SHALL NOT be offered and SHALL NOT be accepted. The project input SHALL start unselected and SHALL be required; the board SHALL NOT preselect a project, including when a project filter is active. A board that allows no project SHALL present no selectable project and SHALL explain that the board accepts no new task, and saving SHALL be unavailable. Saving a new task SHALL place it in the active board's configured initial stage whichever presentation opened it, and SHALL record the selected auto-mode value. The board SHALL NOT offer any other stage as a creation target. When the initial stage has an entry instruction and the Start execution now option remains enabled, saving SHALL start the automatic first execution defined by Automatic first execution on task creation. Otherwise, saving SHALL NOT create a native DSH conversation, a workspace, or an agent execution. The board header SHALL NOT provide a separate New task action.

#### Scenario: Open task creation from the board
- **WHEN** the user selects the New task action at the top of the active board's configured initial column
- **THEN** the creation experience provides title, description, project, and Auto mode inputs without asking the user to choose a stage
- **AND** it presents Start execution now only when the initial stage has an entry instruction
- **AND** the project input is unselected
- **AND** the project list contains only projects of the active Hub that the board allows

#### Scenario: Open the same creation experience from either presentation
- **WHEN** the user opens New task from the column board's initial column and, separately, from the workflow diagram's initial stage
- **THEN** both present the same creation experience with the same inputs and the same defaults
- **AND** saving from either creates the task in the configured initial stage with the same effect

#### Scenario: Enable the action identically in both presentations
- **WHEN** a board is read in the column board and in the workflow diagram with the same Hub registry
- **THEN** both presentations offer the action as available, or both withhold it, on the same condition: the Hub holds at least one registered project
- **AND** the board's project scope never withholds the action from one presentation alone, since a board that allows no project must stay reachable through either of them to explain itself

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
- **WHEN** the active Hub has projects that the active board does not allow and the user opens New task from either presentation
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

#### Scenario: No creation target other than the initial stage
- **WHEN** the user opens New task from either presentation
- **THEN** the creation experience provides no stage input
- **AND** the saved task's stage is the configured initial stage regardless of the stage the user was looking at

#### Scenario: Start the first conversation after creation
- **WHEN** the user opens a newly created task's Conversations section and its creation did not start the first execution
- **THEN** the task has no native conversation
- **AND** the section presents the explicit start state defined by `task-conversations`
