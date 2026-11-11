# Spec Delta

## MODIFIED Requirements

### Requirement: Board workflow read payload

The plugin SHALL expose `get_board_summary` with an optional `include_workflow` flag. When the
flag is true, the result SHALL include the exact stored workflow YAML, the parsed workflow's
initial stage, its columns with their entry prompts and allowed transitions, its groups, the
board's default model when the workflow names one, the Hub revision, and the board's publishing
state. When the flag is false or omitted, the result SHALL retain the board summary with the board
name, Hub, workflow columns, task counts, and the Hub revision.

#### Scenario: Read a complete board workflow

- **WHEN** an agent calls `get_board_summary` with a board identifier and `include_workflow` true
- **THEN** the result contains the exact authored workflow YAML
- **AND** it contains the initial stage, every column with its entry prompt and allowed transitions, and every group
- **AND** it contains the Hub revision and the board's publishing state

#### Scenario: Read the board's default model

- **WHEN** an agent calls `get_board_summary` with `include_workflow` true for a board whose workflow names a default model
- **THEN** the result reports that provider, model, and reasoning effort
- **AND** the exact authored YAML carries the same mapping

#### Scenario: Report no default model

- **WHEN** an agent calls `get_board_summary` with `include_workflow` true for a board whose workflow names no default model
- **THEN** the result reports no default model for that board

#### Scenario: Read a board summary without the workflow payload

- **WHEN** an agent calls `get_board_summary` without `include_workflow`
- **THEN** the result contains the board name, Hub, workflow columns, task counts, and the Hub revision
- **AND** it does not contain the workflow YAML

#### Scenario: Reject an unknown board

- **WHEN** an agent calls `get_board_summary` with a board identifier that does not exist
- **THEN** the tool reports that the board does not exist
- **AND** it returns no board data

### Requirement: Whole-document board workflow replacement

`update_board` SHALL accept a complete workflow YAML and replace the board's workflow with it.
`create_board` SHALL accept an optional complete workflow YAML and SHALL use the default workflow
when it is omitted. A workflow SHALL be validated with the same accepted workflow semantics as the
board UI, including unsupported fields, unknown stage references, existing task columns that the
workflow would no longer define, and a malformed or unsupported board default model. An invalid
workflow SHALL NOT change the stored workflow. A workflow that carries a root model mapping SHALL
become the board's default model, and a workflow that omits it SHALL leave the board with no
default model of its own.

#### Scenario: Replace a board workflow

- **WHEN** an agent calls `update_board` with a complete valid workflow YAML
- **THEN** the board's stored workflow becomes that document
- **AND** the returned result includes the saved workflow YAML and the parsed workflow

#### Scenario: Set a board default model through the tool

- **WHEN** an agent calls `update_board` with a complete valid workflow YAML that carries a root model mapping
- **THEN** the board's default model becomes that mapping
- **AND** a conversation created for a task of that board afterwards starts on it

#### Scenario: Clear a board default model through the tool

- **WHEN** an agent calls `update_board` with a complete valid workflow YAML that omits the root model mapping
- **THEN** the board has no default model
- **AND** a conversation created for a task of that board afterwards starts on the deployment default

#### Scenario: Create a board with a custom workflow

- **WHEN** an agent calls `create_board` with a name and a complete valid workflow YAML
- **THEN** the new board starts with that workflow

#### Scenario: Create a board with the default workflow

- **WHEN** an agent calls `create_board` with a name and no workflow YAML
- **THEN** the new board starts with the default workflow
- **AND** the new board has no default model

#### Scenario: Reject an invalid workflow

- **WHEN** an agent calls `update_board` or `create_board` with YAML that the workflow parser rejects
- **THEN** the tool reports the validation problem
- **AND** the board's stored workflow is unchanged

#### Scenario: Reject an invalid board default model

- **WHEN** an agent calls `update_board` with YAML whose root model mapping is malformed or names an unsupported field
- **THEN** the tool reports the validation problem
- **AND** the board's stored workflow and default model are unchanged

#### Scenario: Reject a workflow that orphans task stages

- **WHEN** an agent replaces a workflow and an existing task of that board is in a stage the new workflow no longer defines
- **THEN** the tool reports the orphaned stages
- **AND** the board's stored workflow is unchanged
