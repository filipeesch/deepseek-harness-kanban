# Spec Delta

## ADDED Requirements

### Requirement: Agent declarations in a transferred document

The export document SHALL carry a board's authored workflow exactly, including any agents section and every stage agent reference, with no field dropped, normalized, or rewritten. Reading an import file SHALL validate each board's authored workflow with the same semantics the destination installation applies, so a document that declares agents is accepted only where the asking installation can read agents. An installation that cannot read the section SHALL report the affected board as blocked with its validation problem, SHALL NOT apply that board partially, SHALL NOT drop the section, and SHALL leave the outcome of every other board unchanged.

#### Scenario: Export carries the agents section

- **WHEN** a board whose workflow declares agents and stage references is exported
- **THEN** the exported document carries that authored workflow character for character
- **AND** the read of the document reports the board like any other board

#### Scenario: Import preserves the agents section

- **WHEN** a document that declares agents is applied on an installation that can read agents
- **THEN** the stored workflow declares the same agents and the same stage references

#### Scenario: Block a board on an installation that cannot read agents

- **WHEN** a document carries a board that declares agents and the asking installation cannot read that section
- **THEN** that board is reported as blocked with the validation problem
- **AND** nothing of that board is applied and no field is dropped

#### Scenario: Apply the readable boards around a blocked one

- **WHEN** a document carries a blocked board beside boards without an agents section
- **THEN** the other boards are applied as their entries state
- **AND** the result names the blocked board as blocked
