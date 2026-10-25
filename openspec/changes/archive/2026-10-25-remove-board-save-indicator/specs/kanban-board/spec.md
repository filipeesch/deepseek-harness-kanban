# Spec Delta

## ADDED Requirements

### Requirement: Stable board frame during commands

The active board SHALL keep its frame stable while a command is in flight. Command progress SHALL NOT insert, remove, or resize any element between the board header and the task columns, and the board SHALL NOT present a global saving indicator, either visually or through a live region. A task move or same-stage reorder SHALL be reflected in its destination position immediately, and that immediate placement SHALL be the board-level feedback for the move. Progress that a specific action needs SHALL be reported inside the surface that started it, and a command failure SHALL remain a board-level notice.

#### Scenario: Move a card without moving the board

- **WHEN** the user drops a task on a permitted stage of the active board
- **THEN** the task appears in the destination stage immediately
- **AND** the board header, the workflow columns, and the surrounding page keep their position and height while the command is in flight
- **AND** no global saving indicator or live save announcement appears

#### Scenario: Same-stage reorder keeps the frame stable

- **WHEN** the user drops a task within its current stage
- **THEN** the task is placed at the dropped position immediately
- **AND** the board frame does not change height while the command is in flight

#### Scenario: A command started from another surface

- **WHEN** a command started from the task drawer, a dialog, or Configuration is in flight
- **THEN** that surface reports its own progress
- **AND** the board frame does not change height or position

#### Scenario: A failed command stays visible

- **WHEN** a board command fails
- **THEN** a board-level notice states the failure
- **AND** no global saving indicator or live save announcement is added for that command
