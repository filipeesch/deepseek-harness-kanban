# Spec Delta

## MODIFIED Requirements

### Requirement: Each role declares the product tools it receives

Each project-role preset SHALL declare, in its own composition, the allowlist of product tool names its role receives. Every product tool outside that allowlist SHALL be absent from that agent declared tool set, in the terms stated by Product tools are declared per role in `product-tools`. The planner allowlist SHALL cover board, card, and project reading, card creation, editing, and deletion, relations, shared notes, task messages, transitions, pause and resume, team files including deletion, and the structured-question tool. The manager allowlist SHALL cover board, card, and project reading, shared notes, task messages, transitions, pause and resume, and the structured-question tool. Neither role allowlist SHALL cover board administration or workflow authoring, and neither SHALL include the host native question tool, so a question to the person goes through the structured-question tool.

The planner SHALL hold card deletion, because the role that agrees a project card breakdown is the role that has to retire a card the person dropped. The manager SHALL NOT hold it, because the manager writes nothing on cards.

#### Scenario: A tool outside the allowlist is absent

- **WHEN** either role declared tool set is read
- **THEN** every product tool it declares appears in that role allowlist
- **AND** no product tool outside the allowlist is declared

#### Scenario: The manager cannot create a card

- **WHEN** the manager allowlist is read
- **THEN** it does not contain the card creation or card editing tool names

#### Scenario: The manager cannot delete a card

- **WHEN** the manager allowlist is read
- **THEN** it does not contain the card deletion tool name
- **AND** a manager conversation that needs a card removed asks the person or the planner instead

#### Scenario: The planner can delete a card

- **WHEN** the planner allowlist is read
- **THEN** it contains the card creation, card editing, and card deletion tool names
- **AND** it still contains no board administration or workflow authoring tool

#### Scenario: Questions go through the structured-question tool

- **WHEN** either role allowlist is read
- **THEN** it contains the structured-question tool
- **AND** it does not contain the host native question tool
