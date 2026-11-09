# Spec Delta

## MODIFIED Requirements

### Requirement: Board-anchored discovery and scope
The plugin SHALL expose `list_hubs` so an agent can discover Hubs, and `list_boards` so an agent can discover the boards of a Hub. Board-scoped tools SHALL accept a board identifier and SHALL resolve the board's Hub and project registry from it. The plugin SHALL provide `list_projects`, `get_board_summary`, `list_cards`, and `create_card` with the board identifier as their scope. `get_card`, `edit_card`, and the note tools SHALL accept a task identifier and resolve the owning board and Hub. A task conversation SHALL allow the board identifier to be omitted for board-scoped tools and SHALL resolve it from the task. An ordinary DSH chat SHALL require an explicitly discovered board identifier. `list_projects` SHALL return every project owned by the board's Hub and SHALL state, for each project, whether that project may create a card on the requested board. `get_board_summary` SHALL report the board's project scope, including the state where the board allows no project. `create_card` SHALL reject a project that the destination board does not allow with an actionable problem, before any task is created.

#### Scenario: Discover Hubs and boards before writing
- **WHEN** an agent in an ordinary DSH chat needs to create a task
- **THEN** it can call `list_hubs`, then `list_boards` with a discovered Hub identifier
- **AND** it passes a discovered board identifier and a project identifier from that board's Hub to `create_card`

#### Scenario: Read a board summary
- **WHEN** an agent calls `get_board_summary` with a board identifier
- **THEN** the result includes that board's name, Hub, workflow columns, and task counts
- **AND** the result reports the board's project scope

#### Scenario: List projects for a board
- **WHEN** an agent calls `list_projects` with a board identifier
- **THEN** the result contains only projects owned by the board's Hub
- **AND** each project states whether it may create a card on that board

#### Scenario: Report a board that allows no project
- **WHEN** an agent calls `get_board_summary` for a board restricted to no project
- **THEN** the result reports that the board accepts no new task
- **AND** `list_projects` reports that no project may create a card on that board

#### Scenario: Reject a project the board does not allow
- **WHEN** an agent calls `create_card` with a project that the destination board does not allow
- **THEN** no task is created
- **AND** the tool reports an actionable problem naming the board and the project

#### Scenario: Use a task conversation's board
- **WHEN** an agent calls a board-scoped read tool from a task conversation without a board identifier
- **THEN** the plugin resolves the board from that task
- **AND** the agent does not need the native workspace to choose a Hub

#### Scenario: Reject an ambiguous or missing board
- **WHEN** an ordinary DSH chat calls a board-scoped tool without a board identifier
- **THEN** the tool rejects the request with an actionable error
- **AND** no board is chosen from the active UI selection or a default

#### Scenario: Return identity in results
- **WHEN** a board or card tool returns a board or task
- **THEN** the result includes the board identifier and the Hub identifier needed for a subsequent scoped call
