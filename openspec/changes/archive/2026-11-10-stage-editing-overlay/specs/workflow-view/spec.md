# Spec Delta

## MODIFIED Requirements

### Requirement: Layout editing lock

The diagram SHALL provide a layout lock that is on by default every time the diagram is presented. While the lock is on, stage move, stage resize, connection re-anchoring, route segment adjustment, Organize, Undo, and Redo SHALL NOT be available and SHALL NOT change the workflow. While the lock is off, those actions SHALL be available subject to their own availability rules. The lock SHALL NOT gate card activation, card drag, selection, the run action, the advance action, the stage edit action, pan, zoom, or the shared search and project filter. Unlocking and locking SHALL NOT change board data, and the lock SHALL NOT persist across a reload.

#### Scenario: Start locked

- **WHEN** the user opens the workflow diagram
- **THEN** the layout lock is on
- **AND** the layout actions are unavailable

#### Scenario: Block layout editing while locked

- **WHEN** the layout is locked and the user drags a stage header, a stage resize handle, a connection end, or a route segment, or activates Organize, Undo, or Redo
- **THEN** no stage moves, resizes, or is reorganized
- **AND** no connection changes
- **AND** no command is sent

#### Scenario: Rearrange after unlocking

- **WHEN** the user turns the lock off and drags a stage
- **THEN** the stage moves to the dropped position
- **AND** the placement is stored

#### Scenario: Keep card work available while locked

- **WHEN** the layout is locked and the user opens a card, drags a card between stages, or activates a card action
- **THEN** that action proceeds as usual

#### Scenario: Reset to locked on reload

- **WHEN** the user unlocks the layout and reloads the board
- **THEN** the layout lock is on again

## ADDED Requirements

### Requirement: Stage edit action in the diagram stage header

The diagram's stage header SHALL present the stage edit action defined by `stage-editing` alongside the stage title, the card count, and, on the initial stage, the task creation action. The action SHALL sit at the header's top right after the card count and SHALL live in the same group of stage actions, so presenting it never moves the stage title.

The action SHALL NOT be a layout edit. It SHALL stay available while the layout is locked, while card selection is active, and while the search or project filter hides every card of the stage; activating it SHALL NOT start a stage move, a stage resize, or a connection adjustment, SHALL NOT add a placement-history entry, and SHALL NOT store a workflow change by itself. The header is the stage's drag handle, so pressing the action SHALL NOT pick the stage up.

#### Scenario: Present the action in the diagram

- **WHEN** the diagram presents a board whose workflow has four stages
- **THEN** each stage header presents the stage edit action after its card count

#### Scenario: Pressing the action does not start a move

- **WHEN** the user presses the stage edit action in a stage header
- **THEN** the stage editor opens
- **AND** the stage does not enter a drag or resize gesture
- **AND** no placement-history entry is added

#### Scenario: Keep the action available while the layout is locked

- **WHEN** the layout is locked
- **THEN** the stage edit action remains available
- **AND** stage moves, resizes, and arrow adjustments remain refused
