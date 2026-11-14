# Spec Delta

## MODIFIED Requirements

### Requirement: Restricted board tool surface

The plugin SHALL expose tools for discovering Hubs, boards, and projects; reading board and task information, including reading several tasks in one call through `get_cards`; creating tasks; editing task titles and descriptions; reading a task's recorded relations and writing or removing them through `create_relation` and `delete_relation`; creating, listing, and tag-aware updating of shared task notes; reading the transitions available from a task's current stage and declaring, with a reason, the transition that task will follow next through `list_allowed_transitions` and `set_next_transition`; pausing and resuming a task's automatic advance through `pause_task` and `resume_task`; administering the boards of a Hub through `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`, together with an extended `get_board_summary`; searching, reading, creating, editing, and deleting the Hub's team files through `search_team_files`, `read_team_file`, `create_team_file`, `edit_team_file`, and `delete_team_file`; sending a message from a task conversation to another task in the same Hub through `send_task_message`; and, for the workflow architect, reading a board's exact workflow document and one of its stages through `get_board_yaml` and `get_stage`, authoring stages through `set_stage_prompt`, `set_stage_routes`, `set_layout`, `add_stage`, and `remove_stage`, measuring a workflow through `get_route_stats`, `render_workflow_diagram`, and `layout_metrics`, and reading a board's revision history through `list_board_revisions`, `diff_board_revisions`, and `revert_board`. Its product tool surface SHALL NOT include moving tasks, deleting tasks, deleting notes, Hub creation, rename, or deletion, decision-ledger tools, or a plugin-owned TODO checklist. Neither declaring a transition, pausing a task, nor writing a relation SHALL move a task, change its stage or position, send a message, or start an execution during the call; a declared transition SHALL be followed by the task's next completed turn.

The document, stage, authoring, measurement, and revision tools SHALL be declared only for an agent whose preset is the workflow architect preset. For every other calling agent they SHALL be absent from the declared tool set and SHALL NOT be dispatchable, and the plugin SHALL NOT merely refuse them at call time while still declaring them.

#### Scenario: Discover available product operations

- **WHEN** an agent receives the plugin's board and note tools
- **THEN** Hub, board, and project discovery, board and task reading, reading several tasks in one call, card relation reading and writing, task creation, task text editing, shared note creation, listing, and tag-aware updating, transition discovery and declaration, task pause and resume, board creation, board rename, board workflow reading and writing, empty-board deletion, team file search, reading, creation, editing, and deletion, and cross-card message sending are available operations
- **AND** board movement, task deletion, note deletion, Hub administration, decision-ledger operations, and a plugin-owned TODO checklist are not exposed as part of that tool surface

#### Scenario: Inspect the board administration tool names

- **WHEN** an agent receives the plugin's board administration tools
- **THEN** the surface contains `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`
- **AND** no tool creates, renames, or deletes a Hub

#### Scenario: Inspect the task pause tool names

- **WHEN** an agent receives the plugin's task control tools
- **THEN** the surface contains `pause_task` and `resume_task`
- **AND** no tool turns a task's auto mode on or off

#### Scenario: Inspect the relation tool names

- **WHEN** an agent receives the plugin's card tools
- **THEN** the surface contains `create_relation` and `delete_relation`
- **AND** no tool moves a task by writing a relation

#### Scenario: Do not move a task by recording a transition

- **WHEN** an agent records the transition a task will follow next
- **THEN** the task remains in its current stage and position while the call runs
- **AND** the declared transition decides the destination of the advance the next completed turn performs

#### Scenario: Do not move a task by pausing it

- **WHEN** an agent pauses or resumes a task
- **THEN** the task remains in its current stage and position
- **AND** no message is sent and no agent execution starts

#### Scenario: Do not change a card by writing a relation

- **WHEN** an agent creates or removes a relation
- **THEN** both tasks remain in their stage and position
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

### Requirement: Explicit user intent without a second product confirmation

Creating, editing, or deleting a task, creating, renaming, editing, or deleting a board, and creating, editing, or deleting a Hub's team file SHALL require an explicit user request for that change. Sending a cross-card message, declaring a transition, and creating or removing a card relation SHALL require the user's explicit request in that conversation, an explicit direction in the stage instruction delivered to it, or an explicit request in a cross-card message from another task. The plugin SHALL NOT add another product-specific approval dialog for a write that the user, that stage instruction, or that peer request explicitly requested. This requirement SHALL NOT bypass native DSH permission behavior, and a cross-card message received from another task SHALL NOT satisfy it for any change other than declaring a transition and writing the relation it asks for.

#### Scenario: Create a task at the user's request

- **WHEN** the user explicitly asks an agent to create a task and the agent invokes the corresponding board operation
- **THEN** the requested task can be created without an additional product-specific confirmation dialog

#### Scenario: Edit a task at the user's request

- **WHEN** the user explicitly asks an agent to change a task's title or description and the agent invokes the corresponding board operation
- **THEN** the requested text change can be applied without an additional product-specific confirmation dialog

#### Scenario: Create a board at the user's request

- **WHEN** the user explicitly asks an agent to create a board in a Hub and the agent invokes `create_board`
- **THEN** the requested board can be created without an additional product-specific confirmation dialog

#### Scenario: Delete a board at the user's request

- **WHEN** the user explicitly asks an agent to delete an empty board and the agent invokes `delete_board` with confirmation
- **THEN** the requested board can be deleted without an additional product-specific confirmation dialog

#### Scenario: Do not use cards for unsolicited agent tracking

- **WHEN** an agent has no explicit user request to create, edit, or delete a board task or a board
- **THEN** the plugin's board tools do not authorize that change merely to track the agent's own work

#### Scenario: Edit a team file at the user's request

- **WHEN** the user explicitly asks an agent to change a document in the Hub's team files and the agent invokes the corresponding team file tool
- **THEN** the requested change can be applied without an additional product-specific confirmation dialog

#### Scenario: Do not use team files for unsolicited agent bookkeeping

- **WHEN** an agent has no explicit user request to create, edit, or delete a team file
- **THEN** the plugin's team file tools do not authorize that change merely to record the agent's own progress

#### Scenario: Send a cross-card message at the user's request

- **WHEN** the user explicitly asks an agent to send a message to another task and the agent invokes `send_task_message`
- **THEN** the requested message can be delivered without an additional product-specific confirmation dialog

#### Scenario: Send a cross-card message directed by the stage instruction

- **WHEN** the stage instruction delivered to the calling conversation explicitly directs a message to another task and the agent invokes `send_task_message`
- **THEN** the message can be delivered without an additional product-specific confirmation dialog
- **AND** the user is not asked to authorize it separately

#### Scenario: Do not message another card unsolicited

- **WHEN** an agent has neither an explicit user request nor a stage-instruction direction to message another task
- **THEN** the plugin's cross-card message tool does not authorize that message merely to record the agent's own progress

#### Scenario: Write a relation directed by the stage instruction

- **WHEN** the stage instruction delivered to the calling conversation explicitly directs the agent to relate its task to another task and the agent invokes `create_relation`
- **THEN** the relations are stored without an additional product-specific confirmation dialog
- **AND** the user is not asked to authorize them separately

#### Scenario: Do not write relations unsolicited

- **WHEN** an agent has no explicit user request, stage-instruction direction, or peer request to relate tasks
- **THEN** the plugin's relation tools do not authorize the write merely to record the agent's own progress

#### Scenario: Do not write on a peer message

- **WHEN** a cross-card message asks the receiving agent to create, edit, or delete a task, board, note, or team file
- **THEN** the plugin's tools still require the receiving conversation's user to request that change
- **AND** the message alone authorizes no such write

### Requirement: Board-anchored discovery and scope

The plugin SHALL expose `list_hubs` so an agent can discover Hubs, and `list_boards` so an agent can discover the boards of a Hub. Board-scoped tools SHALL accept a board identifier and SHALL resolve the board's Hub and project registry from it. The plugin SHALL provide `list_projects`, `get_board_summary`, `list_cards`, and `create_card` with the board identifier as their scope. `list_cards` SHALL also accept a Hub identifier that selects every board of that Hub. `get_card`, `get_cards`, `edit_card`, and the note tools SHALL accept task identifiers and resolve each task's owning board and Hub. A task conversation SHALL allow the board identifier to be omitted for board-scoped tools and SHALL resolve it from the task. An ordinary DSH chat SHALL require an explicitly discovered board or Hub identifier for a card listing. `list_projects` SHALL return every project owned by the board's Hub and SHALL state, for each project, whether that project may create a card on the requested board. `get_board_summary` SHALL report the board's project scope, including the state where the board allows no project. `create_card` SHALL reject a project that the destination board does not allow with an actionable problem, before any task is created.

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

#### Scenario: List the cards of a whole Hub

- **WHEN** an agent calls `list_cards` with a Hub identifier
- **THEN** the result contains cards from every board of that Hub
- **AND** each card reports the board it belongs to

#### Scenario: Use a task conversation's board

- **WHEN** an agent calls a board-scoped read tool from a task conversation without a board identifier
- **THEN** the plugin resolves the board from that task
- **AND** the agent does not need the native workspace to choose a Hub

#### Scenario: Reject an ambiguous or missing board

- **WHEN** an ordinary DSH chat calls a board-scoped tool without a board identifier
- **THEN** the tool rejects the request with an actionable error
- **AND** no board is chosen from the active UI selection or a default

#### Scenario: Reject a listing with no scope

- **WHEN** an ordinary DSH chat calls `list_cards` with neither a board identifier nor a Hub identifier
- **THEN** the tool rejects the request with an actionable error

#### Scenario: Return identity in results

- **WHEN** a board or card tool returns a board or task
- **THEN** the result includes the board identifier and the Hub identifier needed for a subsequent scoped call

## ADDED Requirements

### Requirement: Compact and detailed card read payloads

The plugin SHALL distinguish two card read payloads. `list_cards` and `get_cards` SHALL return the compact payload, which carries the task's identity, board, project, stage, position, auto mode, pending transition, recorded transition, instruction marker, worktree summary, activity, and relation references, and SHALL NOT carry the task description. `get_card` SHALL return the detailed payload, which carries the compact fields plus the task description, the project record, the board and Hub identity, the incoming and outgoing relations with the other card's identifier, title and stage, and the epic roll-up when the card is an epic.

A relation reference in the compact payload SHALL carry the relation identifier, its type, its direction relative to that card, and the other task identifier. The direction SHALL be outgoing or incoming for a directed type and symmetric for a type that has no direction.

Removing the description from the compact payload SHALL NOT remove it from the task search filter: a title-and-description query SHALL still match a card whose description contains the query text.

#### Scenario: Omit the description from a listing

- **WHEN** an agent lists cards of a board or Hub
- **THEN** no returned card carries its description
- **AND** each returned card carries its relation references

#### Scenario: Read the description through the detail read

- **WHEN** an agent reads one card
- **THEN** the result carries that card's description

#### Scenario: Search a description that the listing omits

- **WHEN** an agent lists cards with a query that occurs only in a card's description
- **THEN** that card is returned

#### Scenario: Report a relation reference

- **WHEN** an agent lists a card that is the epic of another card and is related to a third card
- **THEN** the compact payload reports both relations with their identifier, type, direction, and the other task identifier

### Requirement: Batch card read

The plugin SHALL expose `get_cards`, which accepts a collection of task identifiers and returns the compact payload for each card that exists, preserving the requested order and omitting duplicates. Identifiers that name no task SHALL be reported in a separate missing-identifier list, and the cards that exist SHALL still be returned. An empty collection SHALL be rejected with an actionable problem, and a call SHALL be bounded by a limit that reports truncation explicitly.

#### Scenario: Read several cards in one call

- **WHEN** an agent calls `get_cards` with the identifiers of eight tasks
- **THEN** the result carries the compact payload of each task
- **AND** no call is made per task

#### Scenario: Report a missing identifier

- **WHEN** an agent calls `get_cards` with one identifier that names no task and one that does
- **THEN** the existing card is returned
- **AND** the unknown identifier is reported separately

#### Scenario: Reject an empty collection

- **WHEN** an agent calls `get_cards` with no identifier
- **THEN** the tool rejects the request with an actionable problem

#### Scenario: Report a truncated batch

- **WHEN** an agent requests more cards than the call accepts
- **THEN** the result reports the cards it returns and that the batch is truncated

### Requirement: Per-task activity in card read payloads

Every card read payload SHALL report the task's activity, aggregated over the task's open conversations from the native conversation facts the host owns. The activity SHALL report whether any owned agent is running, the union of pending user work kinds, the number of queued prompts, the number of background activities, and, for each open conversation that has settled at least one turn, that conversation's identifier and its last settled turn outcome.

Activity SHALL NOT be persisted in the Hub, SHALL NOT be written by a read, and SHALL NOT change a task. When the native facts cannot be read, the payload SHALL report the activity as unavailable and SHALL NOT fail the read and SHALL NOT report the task as idle.

A card listing SHALL NOT wait for a native read that has not resolved yet: a listed task whose facts are not yet resolved SHALL report its activity as unavailable. A single-card read and the cross-card delivery result SHALL perform the durable read, so their activity reflects a read made for that call.

#### Scenario: Report a running task

- **WHEN** an agent reads a card whose conversation has an agent turn in progress
- **THEN** the payload reports the task as running

#### Scenario: Distinguish a settled turn from a running one

- **WHEN** an agent reads a card whose conversation settled its last turn and has no work in progress
- **THEN** the payload reports the task as not running
- **AND** it reports that conversation's last settled turn outcome

#### Scenario: Report pending user work

- **WHEN** a task's conversation awaits a decision question or an approval
- **THEN** the payload reports the pending user work kinds

#### Scenario: Report unavailable activity without failing the read

- **WHEN** the native conversation facts cannot be read for a task
- **THEN** the read succeeds and reports the activity as unavailable

#### Scenario: Do not wait on a cold native read in a listing

- **WHEN** an agent lists cards before the host has resolved a conversation's facts
- **THEN** the listing returns without waiting for that read
- **AND** the affected task reports its activity as unavailable

#### Scenario: Report the activity of a closed conversation as absent

- **WHEN** a task's only conversation is closed and its facts still report a running turn
- **THEN** the card reports the task as not running
- **AND** the closed conversation contributes nothing to the task's activity

### Requirement: Relation write tools

The plugin SHALL expose `create_relation` and `delete_relation`. `create_relation` SHALL accept a nonempty collection of relations, each naming a type and two task identifiers, and SHALL store all of them or none: a rejected relation in the collection SHALL leave the stored relation collection unchanged and SHALL be reported with an actionable problem. `delete_relation` SHALL accept a nonempty collection of relation identifiers and SHALL remove all of them or none, reporting an unknown identifier as a rejection that changes nothing.

Both tools SHALL report the stored or removed relations with their identifiers and endpoints. A relation collection over the accepted limit SHALL be rejected with an actionable problem rather than truncated. Neither tool SHALL require a user identifier, resolve a task from the calling conversation, or act on an implicit target.

#### Scenario: Create several relations in one call

- **WHEN** an agent calls `create_relation` with eight relations between a new epic and its children
- **THEN** all eight relations are stored
- **AND** the result reports each stored relation with its identifier

#### Scenario: Reject a relation collection atomically

- **WHEN** one relation of a collection would target another Hub or form an epic cycle
- **THEN** none of the relations is stored
- **AND** the tool reports that relation's problem

#### Scenario: Remove several relations in one call

- **WHEN** an agent calls `delete_relation` with identifiers of stored relations
- **THEN** all of them are removed
- **AND** the result reports what was removed

#### Scenario: Reject an unknown relation identifier

- **WHEN** an agent calls `delete_relation` with one identifier that names no stored relation
- **THEN** no relation is removed
- **AND** the tool reports the unknown identifier

#### Scenario: Reject an empty relation collection

- **WHEN** an agent calls either relation tool with an empty collection
- **THEN** the tool rejects the request with an actionable problem
