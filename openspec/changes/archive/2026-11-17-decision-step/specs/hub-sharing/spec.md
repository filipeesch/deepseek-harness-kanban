# Spec Delta

## ADDED Requirements

### Requirement: Decision configuration in the published event vocabulary

The published event vocabulary SHALL represent a decision stage's complete authored configuration, including its question, its optional context, and its ordered options with each identifier, title, optional description, and destination. Creation, replacement, edits to the question, context, or an option, clearing the configuration, and switching between a decision stage and another stage mode SHALL each recover the same valid workflow that was published. Option destinations SHALL be represented through the stable stage identity like every other authored route, so a stage rename is one event and never a removal followed by a creation. Definition changes SHALL be represented without publishing local execution authority, answered choices, or runtime records.

An event that carries a decision configuration SHALL state an event format version that distinguishes it from events that do not, following the negotiation already defined for later-authored fields. A peer that understands an earlier event format SHALL report that board as requiring a plugin update, SHALL stop its cursor at that event, and SHALL neither apply the board nor publish over it; a peer that understands the version SHALL apply the decision configuration and must not treat an unconfigured stage as a decision stage.

#### Scenario: Publish a decision gate

- **WHEN** a board with a decision stage is published
- **THEN** its log carries events that recover the question, context, and every option with its destination
- **AND** the published content carries no answered choice or runtime record

#### Scenario: Replay a decision configuration

- **WHEN** a member reads a log that creates a decision stage, edits its question, and retargets an option
- **THEN** replay produces that stage's current decision configuration
- **AND** no intermediate configuration is left as a partial or conflicting stage

#### Scenario: Rename a decision destination

- **WHEN** a stage an option destinations is renamed
- **THEN** the log carries the stage identifier change as one event
- **AND** replay preserves the option's destination

#### Scenario: Refuse a decision event from an unknown format

- **WHEN** a peer that understands only an earlier event format meets an event carrying a decision configuration
- **THEN** it reports that board as requiring a plugin update
- **AND** it neither applies nor publishes over that board
- **AND** another board of the same Hub is unaffected
