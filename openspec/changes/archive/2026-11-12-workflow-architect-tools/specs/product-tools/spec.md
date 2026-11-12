# Spec Delta

## MODIFIED Requirements

### Requirement: Restricted board tool surface

The plugin SHALL expose tools for discovering Hubs, boards, and projects; reading board and task information; creating tasks; editing task titles and descriptions; creating, listing, and tag-aware updating of shared task notes; reading the transitions available from a task's current stage and declaring, with a reason, the transition that task will follow next through `list_allowed_transitions` and `set_next_transition`; pausing and resuming a task's automatic advance through `pause_task` and `resume_task`; administering the boards of a Hub through `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`, together with an extended `get_board_summary`; searching, reading, creating, editing, and deleting the Hub's team files through `search_team_files`, `read_team_file`, `create_team_file`, `edit_team_file`, and `delete_team_file`; sending a message from a task conversation to another task in the same Hub through `send_task_message`; and, for the workflow architect, reading a board's exact workflow document and one of its stages through `get_board_yaml` and `get_stage`, authoring stages through `set_stage_prompt`, `set_stage_routes`, `set_layout`, `add_stage`, and `remove_stage`, measuring a workflow through `get_route_stats`, `render_workflow_diagram`, and `layout_metrics`, and reading a board's revision history through `list_board_revisions`, `diff_board_revisions`, and `revert_board`. Its product tool surface SHALL NOT include moving tasks, deleting tasks, deleting notes, Hub creation, rename, or deletion, decision-ledger tools, or a plugin-owned TODO checklist. Neither declaring a transition nor pausing a task SHALL move a task during the call; a declared transition SHALL be followed by the task's next completed turn.

The document, stage, authoring, measurement, and revision tools SHALL be declared only for an agent whose preset is the workflow architect preset. For every other calling agent they SHALL be absent from the declared tool set and SHALL NOT be dispatchable, and the plugin SHALL NOT merely refuse them at call time while still declaring them.

#### Scenario: Discover available product operations

- **WHEN** an agent receives the plugin's board and note tools
- **THEN** Hub, board, and project discovery, board and task reading, task creation, task text editing, shared note creation, listing, and tag-aware updating, transition discovery and declaration, task pause and resume, board creation, board rename, board workflow reading and writing, empty-board deletion, team file search, reading, creation, editing, and deletion, and cross-card message sending are available operations
- **AND** board movement, task deletion, note deletion, Hub administration, decision-ledger operations, and a plugin-owned TODO checklist are not exposed as part of that tool surface

#### Scenario: Inspect the board administration tool names

- **WHEN** an agent receives the plugin's board administration tools
- **THEN** the surface contains `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`
- **AND** no tool creates, renames, or deletes a Hub

#### Scenario: Inspect the task pause tool names

- **WHEN** an agent receives the plugin's task control tools
- **THEN** the surface contains `pause_task` and `resume_task`
- **AND** no tool turns a task's auto mode on or off

#### Scenario: Do not move a task by recording a transition

- **WHEN** an agent records the transition a task will follow next
- **THEN** the task remains in its current stage and position while the call runs
- **AND** the declared transition decides the destination of the advance the next completed turn performs

#### Scenario: Do not move a task by pausing it

- **WHEN** an agent pauses or resumes a task
- **THEN** the task remains in its current stage and position
- **AND** no message is sent and no agent execution starts

#### Scenario: Expose team file operations

- **WHEN** an agent receives the plugin's product tools for a Hub bound to a storage that supports team files
- **THEN** searching, reading, creating, editing, and deleting the Hub's team files are available operations
- **AND** moving a team file to another path, restoring a deleted team file, and browsing the storage outside the team files directory are not exposed

#### Scenario: Expose the cross-card message tool

- **WHEN** an agent receives the plugin's product tools inside a task conversation
- **THEN** `send_task_message` is available as an operation
- **AND** the tool surface still exposes no moving or deleting of tasks and no Hub administration

#### Scenario: Expose the workflow design tools to the workflow architect

- **WHEN** an agent whose preset is the workflow architect preset receives the plugin's tools
- **THEN** `get_board_yaml`, `get_stage`, `set_stage_prompt`, `set_stage_routes`, `set_layout`, `add_stage`, `remove_stage`, `get_route_stats`, `render_workflow_diagram`, `layout_metrics`, `list_board_revisions`, `diff_board_revisions`, and `revert_board` are declared operations
- **AND** the board administration and task tools remain declared as before

#### Scenario: Withhold the workflow design tools from every other agent

- **WHEN** an agent whose preset is not the workflow architect preset, including a task conversation, receives the plugin's tool declarations
- **THEN** none of the document, stage, authoring, measurement, or revision tools is declared
- **AND** a request naming one of them is not dispatched
- **AND** the board administration and task tools remain declared as before

### Requirement: Board workflow read payload

The plugin SHALL expose `get_board_summary` with an optional `include_workflow` flag. When the
flag is true, the result SHALL include the parsed workflow's initial stage, its columns with their
entry prompts and allowed transitions, its groups, the board's default model when the workflow
names one, the Hub revision, and the board's publishing state. When the flag is false or omitted,
the result SHALL retain the board summary with the board name, Hub, workflow columns, task counts,
and the Hub revision. The authored workflow document SHALL be read as exact text through
`get_board_yaml` and is not part of this payload in either mode.

#### Scenario: Read a complete board workflow

- **WHEN** an agent calls `get_board_summary` with a board identifier and `include_workflow` true
- **THEN** the result contains the initial stage, every column with its entry prompt and allowed transitions, and every group
- **AND** it contains the Hub revision and the board's publishing state

#### Scenario: Omit the authored document from the workflow payload

- **WHEN** an agent calls `get_board_summary` with `include_workflow` true
- **THEN** the result carries no authored workflow text
- **AND** the same board's exact text is available from `get_board_yaml` with the same Hub revision

#### Scenario: Read the board's default model

- **WHEN** an agent calls `get_board_summary` with `include_workflow` true for a board whose workflow names a default model
- **THEN** the result reports that provider, model, and reasoning effort

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
