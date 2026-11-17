# Spec Delta

## MODIFIED Requirements

### Requirement: Board workflow read payload

The plugin SHALL replace `get_board_summary` with `get_workflow_summary` and SHALL NOT declare or dispatch the former. The new tool SHALL resolve a board as specified by board-anchored discovery and return a concise live workflow projection with board and Hub identity, optional workflow description, initial stage, and each stage's identifier, name, optional description, and script, agent-instruction, decision, or no-instruction type. It SHALL describe the routing policy, including targets and documentary conditions or named script exits, and distinguish unrestricted, explicitly empty, configured, scripted, and decision routes. Conditions are documentary, not executable predicates. For a stage that authors a decision configuration it SHALL report the bounded question and each option's identifier, title, and destination, and SHALL NOT report the option descriptions; the gate is documentary here and the projection SHALL NOT answer it. The projection SHALL include board project scope and sharing status. Missing or blank descriptions SHALL be absent, and unknown or unavailable state SHALL be explicit rather than fabricated.

Only when the requested board is the calling task's own board SHALL the result include that task's current stage and automatic-mode enabled, paused, and held state. It SHALL NOT attribute a task from another board to the requested board. The response SHALL omit task counts, Hub revision, model and preset settings, MCP configuration, layout, full YAML, script code, and full entry prompts. The workflow architect retains `get_board_yaml`, `get_stage`, and Hub revision reads under the existing architect-only gate; the summary SHALL NOT broaden other roles' access. The workflow projection SHALL fit within 6 KiB per page in UTF-8, report omitted records and counts explicitly, and expose a continuation cursor. An individually oversized description, condition, or decision question SHALL be indicated and remain readable in pages through the same tool without silent truncation.

#### Scenario: Read a complete board workflow

- **WHEN** an agent calls `get_workflow_summary` with a board identifier
- **THEN** the result contains the initial stage and stages with their IDs, names, optional descriptions, types, and routing policy
- **AND** it contains the workflow description when authored, board project scope, and sharing status
- **AND** it distinguishes unrestricted, explicitly empty, configured, scripted, and decision routes without treating conditions as executable predicates

#### Scenario: Read a decision gate

- **WHEN** an agent calls `get_workflow_summary` for a board whose workflow authors a decision stage
- **THEN** the stage is reported with the decision type
- **AND** the result contains the bounded question and each option's identifier, title, and destination
- **AND** it contains no option description and no answer

#### Scenario: Omit the authored document from the workflow payload

- **WHEN** an agent calls `get_workflow_summary`
- **THEN** the result carries no authored workflow YAML, script code, or full entry prompts
- **AND** the workflow architect can read the exact document with `get_board_yaml` and a stage with `get_stage` under the existing gate

#### Scenario: Read the board's default model

- **WHEN** an agent calls `get_workflow_summary` for a board whose workflow names a default model
- **THEN** the result does not include the provider, model, or reasoning effort

#### Scenario: Report no default model

- **WHEN** an agent calls `get_workflow_summary` for a board whose workflow names no default model
- **THEN** the result does not include model settings

#### Scenario: Read a board summary without the workflow payload

- **WHEN** an agent calls `get_workflow_summary` for a board
- **THEN** the result always contains the compact workflow projection without an `include_workflow` flag
- **AND** it excludes counts, Hub revision, model, preset, MCP configuration, and workflow YAML

#### Scenario: Reject an unknown board

- **WHEN** an agent calls `get_workflow_summary` with a board identifier that does not exist
- **THEN** the tool reports that the board does not exist
- **AND** it returns no board data

#### Scenario: Include operational state for the calling task only

- **WHEN** a task conversation reads its own board's workflow summary
- **THEN** the result includes its current stage and its automatic-mode enabled, paused, and held state
- **AND** unavailable state is reported as unavailable rather than invented

#### Scenario: Do not attribute a task to another board

- **WHEN** a task conversation reads a different board, or an ordinary chat reads a board
- **THEN** the result does not present the calling task's stage or automatic-mode state as belonging to the requested board

#### Scenario: Preserve access when limiting the projection

- **WHEN** a workflow summary exceeds an applied response limit
- **THEN** the result identifies the truncation and offers continuation or another read mechanism for all routes
- **AND** authored descriptions and decision questions are not silently truncated

#### Scenario: Remove the previous summary tool

- **WHEN** product tools are declared or dispatched
- **THEN** `get_board_summary` is absent and cannot be dispatched
- **AND** roles that previously allowed it use `get_workflow_summary` subject to their existing role boundaries

## ADDED Requirements

### Requirement: Decision stages in the transition tools

For a task whose current stage authors a decision configuration, `list_allowed_transitions` SHALL report that the stage owns its routing and that the person answers it, and SHALL report the gate's options as informational destinations with their titles and destinations without presenting them as declarable targets or as a default destination. `set_next_transition` SHALL refuse both an ordinary declaration and an exceptional declaration from such a stage with an actionable result, and the refusal SHALL leave the task's stage, recorded transition, and position unchanged. Neither tool SHALL answer the gate or move the task.

#### Scenario: Report a decision-owned stage

- **WHEN** an agent calls `list_allowed_transitions` for a task in a decision stage
- **THEN** the result states that the stage owns its routing and waits for the person
- **AND** it reports the gate's options with their destinations
- **AND** it reports no default destination

#### Scenario: Refuse an ordinary declaration

- **WHEN** an agent calls `set_next_transition` with a target for a task in a decision stage
- **THEN** the tool refuses with an actionable result
- **AND** the task and its recorded transition are unchanged

#### Scenario: Refuse an exceptional declaration

- **WHEN** an agent calls `set_next_transition` with the exception flag for a task in a decision stage
- **THEN** the tool refuses with an actionable result
- **AND** no exceptional intent is recorded

### Requirement: Decision authoring stays behind the workflow architect gate

`set_stage_decision` SHALL be a workflow-design tool. It SHALL be declared only for an agent whose preset is the workflow architect preset, and for every other calling agent it SHALL be absent from the declared tool set and SHALL NOT be dispatchable. It SHALL be listed among the design tools that requirement names for that preset.

#### Scenario: Expose decision authoring to the workflow architect

- **WHEN** an agent whose preset is the workflow architect preset receives the plugin's tools
- **THEN** `set_stage_decision` is a declared operation

#### Scenario: Withhold decision authoring from other roles

- **WHEN** an agent whose preset is not the workflow architect preset receives the plugin's tool declarations
- **THEN** `set_stage_decision` is absent
- **AND** a call to it is reported as an unknown tool rather than as a permission refusal
