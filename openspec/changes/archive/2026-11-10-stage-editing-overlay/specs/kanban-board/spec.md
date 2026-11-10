# Spec Delta

## ADDED Requirements

### Requirement: Stage edit action in the column board stage header

Every stage header of the column board SHALL present the stage edit action defined by `stage-editing` at the header's top right, after the stage's card count and, on the initial stage, after the task creation action. The action SHALL carry an accessible name naming the stage it edits and SHALL activate from the keyboard as readily as from the pointer.

The action SHALL be available while card selection is active and while the search or project filter hides every card of the stage. Activating it SHALL open the same stage editor the workflow diagram opens, with the same fields, validation, and effects, and SHALL NOT move, reorder, or otherwise change the stage by itself.

#### Scenario: Present the action in the column board

- **WHEN** the column board presents a workflow with four stages
- **THEN** each stage header presents the stage edit action after its card count

#### Scenario: Open the editor from the column board

- **WHEN** the user activates the stage edit action of a stage in the column board
- **THEN** the stage editor opens for that stage
- **AND** it presents the same fields and validation the diagram's editor presents

#### Scenario: Keep the action available during card selection

- **WHEN** card selection is active and the user activates the stage edit action
- **THEN** the stage editor opens
- **AND** no card selection changes

#### Scenario: Save from the column board

- **WHEN** the user changes the stage name in the editor opened from the column board and saves
- **THEN** the column board presents the stored name
- **AND** the cards in that stage keep their order and stage
