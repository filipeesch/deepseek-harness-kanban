# Spec Delta

## ADDED Requirements

### Requirement: Decision choices are recorded on the stage entry

A stage entry produced by a decision choice SHALL distinguish that origin from an operator move, a declared transition, an automatic advance, a named script exit, and the reserved error route, and it SHALL name the option identifier the person chose. That entry SHALL carry the observation the person entered, bounded, together with the moment the choice settled. The entry SHALL be appended only when the choice actually changes the task's stage; a canceled window, an unanswered gate, and a refused choice SHALL add nothing. A choice that is applied twice SHALL NOT add a second entry.

The History section SHALL present that entry with its origin stage, its destination stage, the chosen option, and the observation in its Detail. The option's title SHALL be resolved from the board's current workflow, so renaming the option reads with the current title, and an entry whose option the workflow no longer defines SHALL remain present and identifiable by its option identifier. The entry SHALL remain a stage entry and SHALL present the time spent in the stage like any other one.

#### Scenario: Record a decision choice

- **WHEN** a decision choice moves a task from the decision stage to its destination
- **THEN** the record gains one stage entry naming the chosen option and the observation
- **AND** the entry carries the moment the choice settled

#### Scenario: Read a decision choice

- **WHEN** the user opens the History section of a task that recorded a decision choice
- **THEN** the row names both stages, the chosen option, and the observation
- **AND** it presents the time spent in the source stage

#### Scenario: Follow a renamed or removed option

- **WHEN** the chosen option's title is renamed, or the option is removed from the workflow
- **THEN** the entry remains present and identifiable
- **AND** a renamed option reads with its current title

#### Scenario: Record nothing without a move

- **WHEN** a decision window is canceled, a gate is answered but the choice is refused, or the task already left the entry
- **THEN** the record gains no stage entry

#### Scenario: Do not duplicate a retried choice

- **WHEN** the same choice is applied again after an interrupted response
- **THEN** the record gains no second stage entry
