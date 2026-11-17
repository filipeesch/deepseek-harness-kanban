# Spec Delta

## ADDED Requirements

### Requirement: Preserve workflow descriptions and new-board defaults in team synchronization

Publishing, incremental changes, conflict detection, replay, restore, and team synchronization SHALL preserve the workflow description, each stage description, and a newly created board's effective default preset choice without silently discarding them. A description-only edit SHALL be treated as workflow content, not as an unchanged layout. Existing boards and historical revisions without descriptions or new-board default metadata SHALL remain readable and retain their existing semantics. A peer that cannot safely preserve the representation SHALL report an incompatibility rather than overwrite it or silently remove data. Publishing remains an explicit user action.

#### Scenario: Publish only a description change

- **WHEN** a person publishes a workflow whose only semantic edit is a workflow or stage description
- **THEN** the team update preserves and delivers that edit
- **AND** a receiver does not treat the version as unchanged

#### Scenario: Avoid overwriting a local description

- **WHEN** a board has a local description change and a team update changes the same workflow
- **THEN** synchronization accounts for that local change under the existing conflict rules
- **AND** does not silently replace it as though the local board were clean

#### Scenario: Receive a board with an operator default

- **WHEN** a shared board created with the workflow operator default is received by a compatible installation
- **THEN** its effective default choice is preserved
- **AND** its authored YAML remains exact

#### Scenario: Reject unsafe older peers

- **WHEN** an installation cannot safely read or preserve the new description or default representation
- **THEN** it reports incompatibility rather than silently discarding that data
