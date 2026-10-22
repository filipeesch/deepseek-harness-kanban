# Spec Delta

## MODIFIED Requirements

### Requirement: Top-level task creation
The board SHALL provide one New task action at the top of the workflow's configured initial column. It SHALL collect a title, description, and project. Saving a new task SHALL place it in the configured initial stage without initiating an agent execution. The board header SHALL NOT provide a separate New task action.

#### Scenario: Open task creation from the board
- **WHEN** the user selects the New task action at the top of the configured initial column
- **THEN** the creation experience provides title, description, and project inputs without asking the user to choose a stage

#### Scenario: Create into a customized initial stage
- **WHEN** the user saves a new task and the workflow has a configured initial stage
- **THEN** the task is created in that stage with the supplied title, description, and project
- **AND** task creation does not initiate an agent execution

### Requirement: Open a task drawer
Activating a task card SHALL open its task drawer, giving access to that task's conversations and supporting task information. The whole card surface SHALL be activatable except for nested controls, which SHALL perform their own action without opening the drawer. A focused card SHALL be activatable from the keyboard.

#### Scenario: Inspect a card
- **WHEN** the user activates any non-control area of a task card
- **THEN** the task drawer opens for the selected task

#### Scenario: Use a nested control
- **WHEN** the user activates a control inside a task card
- **THEN** that control performs its own action and the task drawer does not open

#### Scenario: Activate a card from the keyboard
- **WHEN** a task card has keyboard focus and the user presses Enter
- **THEN** the task drawer opens for the selected task

## ADDED Requirements

### Requirement: Direct stage manipulation on the board
The board SHALL move tasks between workflow stages only through drag and drop. A task card SHALL NOT provide an independent stage selector. A drag SHALL present a distinct dragged representation and a drop indicator. Dropping on a permitted stage without an entry instruction SHALL move the task immediately. Dropping on an instructed stage SHALL open the Move and run / Move only / Cancel confirmation. Dropping within the current stage SHALL reorder the task relative to its neighbors. A prohibited drop SHALL leave the task unchanged. The board SHALL NOT offer worktree creation as part of a drop.

#### Scenario: Move to an uninstructed stage by drag and drop
- **WHEN** the user drops a task on a permitted stage that has no entry instruction
- **THEN** the task appears in that stage immediately
- **AND** the move does not initiate an agent execution

#### Scenario: Reorder within the current stage
- **WHEN** the user drops a task at a new position within its current stage
- **THEN** the task is placed at that position and the new order is retained

#### Scenario: Drop on an instructed stage
- **WHEN** the user drops a task on a permitted stage that has an entry instruction
- **THEN** the board opens the Move and run / Move only / Cancel confirmation
- **AND** the task does not move until the user makes an explicit choice

#### Scenario: Prohibited drop
- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage
- **THEN** the task remains in its current stage and its position is unchanged

#### Scenario: Drop without a worktree
- **WHEN** the user drops a task that has no worktree on a permitted uninstructed stage
- **THEN** the move completes without asking whether to create a worktree

### Requirement: Bulk task deletion
The board SHALL provide an explicit selection mode that presents a selection control on each card and disables card dragging while active. The user SHALL be able to select multiple tasks across visible stages. A bulk deletion SHALL require one confirmation and SHALL apply the individual task deletion semantics to each eligible task. A task SHALL be skipped when any of its conversations is running, it has a pending operation or transition, or its worktree has local changes. The board SHALL report skipped tasks and their reasons, and SHALL leave those tasks selected. Leaving selection mode SHALL clear the selection.

#### Scenario: Enter selection mode and select tasks
- **WHEN** the user enters selection mode and activates cards in more than one stage
- **THEN** the board marks the selected tasks and disables dragging for them

#### Scenario: Delete eligible tasks
- **WHEN** the user confirms deletion of a selection whose tasks are eligible
- **THEN** each eligible task is deleted with the individual deletion semantics and the selection is cleared

#### Scenario: Skip a task with a running conversation
- **WHEN** the user confirms deletion of a selection that includes a task with a running conversation
- **THEN** that task is not deleted, its reason is reported, and it remains selected

#### Scenario: Skip a task with local worktree changes
- **WHEN** the user confirms deletion of a selection that includes a task whose worktree has local changes
- **THEN** that task is not deleted, its reason is reported, and it remains selected

#### Scenario: Leave selection mode
- **WHEN** the user leaves selection mode
- **THEN** the selection is cleared and normal card dragging is restored
