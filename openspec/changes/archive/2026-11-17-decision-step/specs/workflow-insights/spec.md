# Spec Delta

## ADDED Requirements

### Requirement: Decision option usage

`get_route_stats` SHALL report a route use produced by a decision choice as its own origin, distinct from an operator move, a declared transition, an automatic advance, a named script exit, and the reserved error route, and it SHALL name the option identifier that produced the use. Over the same window it SHALL report each configured decision option with its number of uses, including an option that was never used, and SHALL report a decision stage with no use in the window. The payload SHALL continue to carry identifiers, counts, durations, and labels only, and SHALL NOT carry a card title, description, note, task message, conversation content, or the authored question.

#### Scenario: Count a decision use

- **WHEN** an agent asks for a board's route usage over a window in which a decision option was chosen
- **THEN** the report names the decision origin, the option, and the destination with the number of uses

#### Scenario: List an unused option

- **WHEN** a decision stage configures two options and only one was chosen in the window
- **THEN** the report gives the chosen option its count
- **AND** it lists the unused option as configured and unused

#### Scenario: Carry no authored question

- **WHEN** an agent asks for a board's statistics
- **THEN** the payload carries no decision question or option description
- **AND** the board is unchanged
