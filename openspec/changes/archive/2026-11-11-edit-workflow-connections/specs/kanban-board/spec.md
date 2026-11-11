# Spec Delta

## ADDED Requirements

### Requirement: Stage with no destination

A board's workflow MAY author an empty allowed transitions list for a stage, and such a stage SHALL permit no destination. An empty list SHALL be valid and SHALL NOT be rejected as an invalid workflow, and it SHALL NOT be interpreted as a stage that allows any other stage, which is the meaning of omitting the list. A stage with no destination SHALL have no outgoing connection drawn for it, SHALL NOT be advanced automatically, and SHALL require the explicit confirmation already defined for a restricted transition before any task leaves it. A task in a stage with no destination SHALL still be reorderable inside that stage. Making a stage author no destination, and restoring it to allow any other stage, SHALL each be an ordinary workflow write.

#### Scenario: Accept a stage with no destination

- **WHEN** a workflow configuration stores an empty allowed transitions list for a stage
- **THEN** the configuration is accepted
- **AND** the stage permits no destination

#### Scenario: Distinguish an empty list from an omitted list

- **WHEN** one stage omits its allowed transitions and another stage stores an empty list
- **THEN** the stage that omits them permits any other stage
- **AND** the stage that stores an empty list permits none

#### Scenario: Require confirmation to leave a stage with no destination

- **WHEN** a user requests a move out of a stage that permits no destination
- **THEN** the board asks for the restricted-transition confirmation before moving the task
- **AND** the task remains in its stage until the user confirms

#### Scenario: Do not advance out of a stage with no destination

- **WHEN** a task in a stage that permits no destination completes a turn with automatic advance in effect
- **THEN** the task is not moved to another stage
- **AND** no execution is initiated by an automatic advance

#### Scenario: Present no advance action in a stage with no destination

- **WHEN** a card is presented in a stage that permits no destination
- **THEN** the card presents no advance action
- **AND** its other card actions behave as they do in any other stage

#### Scenario: Reorder inside a stage with no destination

- **WHEN** the user reorders a task inside a stage that permits no destination
- **THEN** the task keeps its stage
- **AND** its position changes as requested

#### Scenario: Restore a stage that allows any other stage

- **WHEN** a stage that authored an empty list is stored with its allowed transitions omitted
- **THEN** any other stage may be a destination again
