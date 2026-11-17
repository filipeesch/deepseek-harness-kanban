# Spec Delta

## ADDED Requirements

### Requirement: Unobservable Session status on a task card

The board SHALL present a conversation that cannot be observed in the same status region that carries the task's other unresolved facts, as a failure-toned status naming the classified state. The status SHALL coexist with the task's operation, transition, automatic-advance, and scripted statuses without replacing any of them, and SHALL be cleared by a successful observation rather than by reading the conversation.

#### Scenario: Present the status beside other facts

- **WHEN** a task carries an unresolved operation and a conversation that cannot be observed
- **THEN** the status region presents both statuses
- **AND** neither status replaces the other

#### Scenario: Distinguish the state in the label

- **WHEN** a conversation is classified as unreadable and another is classified as missing
- **THEN** the status labels name the two states differently

#### Scenario: Clear only by observation

- **WHEN** the person opens the conversation's card or reads its details
- **THEN** the status remains presented until an observation of that conversation succeeds
