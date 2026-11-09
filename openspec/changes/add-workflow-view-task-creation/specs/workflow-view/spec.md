# Spec Delta

## ADDED Requirements

### Requirement: Task creation in the initial stage

The diagram SHALL present a task creation action in the header of the stage that is the workflow's configured initial stage, and SHALL NOT present that action in any other stage. The action SHALL carry an accessible name naming task creation and a tooltip naming the same action, so a sighted and an assisted reading agree, and SHALL be an icon control that does not disturb the arrangement of its stage's title and card count.

Activating the action SHALL open the board's New task experience defined by `kanban-board` Top-level task creation, presenting that experience exactly as the column board does and creating the task in the configured initial stage. The action SHALL NOT be a layout edit: activating it SHALL NOT start a stage move, a stage resize, or an arrow adjustment, and SHALL NOT store a workflow change or add a placement-history entry, whether it is activated by pointer or by keyboard.

The action SHALL remain available while the layout is locked and while card selection is active, because it creates a task rather than editing the diagram. The action SHALL be unavailable when the active Hub has no registered project. The action SHALL remain present when the board's search or project filter hides every card of that stage.

The action SHALL be focusable and SHALL activate from the keyboard without moving focus out of the diagram or opening the task drawer.

#### Scenario: Present the action only on the initial stage

- **WHEN** the diagram presents a workflow whose initial stage is one of three stages
- **THEN** the initial stage's header presents the task creation action
- **AND** neither of the other two stage headers presents it

#### Scenario: Create a task from the diagram

- **WHEN** the user activates the task creation action in the initial stage's header and saves the New task experience
- **THEN** the task is created in the configured initial stage
- **AND** the diagram presents the new card in that stage region

#### Scenario: Activate the action without moving the stage

- **WHEN** the user presses the task creation action in the initial stage's header
- **THEN** the New task experience opens
- **AND** the stage does not move, resize, or enter a gesture
- **AND** no workflow change is stored and no placement-history entry is added

#### Scenario: Keep the action available while the layout is locked

- **WHEN** the layout is locked and the user activates the task creation action
- **THEN** the New task experience opens
- **AND** the locked diagram still refuses stage moves, resizes, and arrow adjustments

#### Scenario: Keep the action available during selection mode

- **WHEN** card selection is active and the user activates the task creation action
- **THEN** the New task experience opens
- **AND** no card selection is changed

#### Scenario: Disable the action without a registered project

- **WHEN** the active Hub has no registered project
- **THEN** the task creation action in the initial stage's header is unavailable
- **AND** activating it opens nothing

#### Scenario: Keep the action while a filter hides every card

- **WHEN** the board's search or project filter hides every card of the initial stage
- **THEN** the initial stage's header still presents the task creation action
- **AND** the stage region presents its empty state

#### Scenario: Activate the action from the keyboard

- **WHEN** the user reaches the task creation action by tabbing through the diagram and activates it
- **THEN** the New task experience opens
- **AND** the stage has not moved and the task drawer has not opened
