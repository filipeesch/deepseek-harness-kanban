# Product Tools Specification

## Purpose

Allow agents to discover Hubs, boards, and projects, inspect board-scoped tasks, perform explicitly requested task text changes and board administration, pause and resume a task's automatic advance, create, list, and tag-aware update shared task notes, and send explicitly requested messages between task conversations in the same Hub, without exposing task movement, task deletion, or Hub administration.

Reference note: Railyin's [card tool definitions](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/bun/engine/card-tool-definitions.ts#L16-L126>) provide reference terminology, not a fixed tool-name or JSON-schema contract for this plugin.

## Requirements

### Requirement: Restricted board tool surface

The plugin SHALL expose tools for discovering Hubs, boards, and projects; reading board and task information, including reading several tasks in one call through `get_cards`; creating tasks; editing task titles and descriptions; reading a task's recorded relations and writing or removing them through `create_relation` and `delete_relation`; creating, listing, and tag-aware updating of shared task notes; reading the transitions available from a task's current stage and declaring, with a reason, the transition that task will follow next through `list_allowed_transitions` and `set_next_transition`; pausing and resuming a task's automatic advance through `pause_task` and `resume_task`; administering the boards of a Hub through `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`, together with an extended `get_board_summary`; searching, reading, creating, editing, and deleting the Hub's team files through `search_team_files`, `read_team_file`, `create_team_file`, `edit_team_file`, and `delete_team_file`; sending a message from a task conversation to another task in the same Hub through `send_task_message`; and, for the workflow architect, reading a board's exact workflow document and one of its stages through `get_board_yaml` and `get_stage`, authoring stages through `set_stage_prompt`, `set_stage_routes`, `set_layout`, `add_stage`, and `remove_stage`, writing one stage's deterministic configuration through `set_stage_script`, reviewing a supplied document without saving it through `validate_workflow`, running one stage's authored program in an isolated test execution through `test_script`, reading one task's scripted execution state and the reason a saved result is held through `get_script_execution`, comparing a board's local document with the version this installation last applied from the team through `diff_published_board`, measuring a workflow through `get_route_stats`, `render_workflow_diagram`, and `layout_metrics`, and reading a board's revision history through `list_board_revisions`, `diff_board_revisions`, and `revert_board`. Its product tool surface SHALL NOT include moving tasks, deleting tasks, deleting notes, Hub creation, rename, or deletion, decision-ledger tools, or a plugin-owned TODO checklist. Neither declaring a transition, pausing a task, nor writing a relation SHALL move a task, change its stage or position, send a message, or start an execution during the call; a declared transition SHALL be followed by the task's next completed turn.

The document, stage, authoring, measurement, revision, scripted-execution, validation, and comparison tools SHALL be declared only for an agent whose preset is the workflow architect preset. For every other calling agent they SHALL be absent from the declared tool set and SHALL NOT be dispatchable, and the plugin SHALL NOT merely refuse them at call time while still declaring them.

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
- **THEN** `get_board_yaml`, `get_stage`, `set_stage_prompt`, `set_stage_routes`, `set_layout`, `add_stage`, `remove_stage`, `set_stage_script`, `validate_workflow`, `test_script`, `get_script_execution`, `diff_published_board`, `get_route_stats`, `render_workflow_diagram`, `layout_metrics`, `list_board_revisions`, `diff_board_revisions`, and `revert_board` are declared operations
- **AND** the board administration and task tools remain declared as before

#### Scenario: Withhold the workflow design tools from every other agent

- **WHEN** an agent whose preset is not the workflow architect preset, including a task conversation, receives the plugin's tool declarations
- **THEN** none of the document, stage, authoring, measurement, revision, scripted-execution, validation, or comparison tools is declared
- **AND** a request naming one of them is not dispatched
- **AND** the board administration and task tools remain declared as before

#### Scenario: Offer no script retry or execution control to an agent

- **WHEN** an agent receives the plugin's tools for a board that holds a scripted stage
- **THEN** the surface exposes reading that stage's execution state and running an isolated test execution
- **AND** it exposes no operation that retries the delivery of a saved result, starts a real execution, stops a real execution, approves an executable version, or edits an entry's parameter values

### Requirement: Note tools support tags
The plugin's note tools SHALL operate on the same shared task note collection as the Notes section and SHALL support tags with the same normalization rules. `create_note` and `update_note` SHALL accept an optional tag collection, and every returned note SHALL include its tags. `list_notes` SHALL accept an optional tag collection and SHALL return the notes that have any of those tags, comparing both stored and requested values after normalization. An empty tag collection SHALL apply no filter. `update_note` SHALL allow changing only tags, changing only content, or changing both, and SHALL require at least one of content or an explicit tag collection. An omitted tag collection SHALL preserve existing tags, and an explicitly empty collection SHALL clear them. The note tool surface SHALL NOT add a tool that deletes a note.

#### Scenario: Create a note with tags
- **WHEN** an agent creates a note with the tags ` Design ` and `TODO`
- **THEN** the note is stored with the tags `design` and `todo` and the result includes them

#### Scenario: List notes filtered by one tag
- **WHEN** an agent lists the notes of a task with the tag `design` and notes exist with `design` and `architecture`
- **THEN** only the notes tagged `design` are returned

#### Scenario: List notes filtered by several tags
- **WHEN** an agent lists notes with the tags `design` and `architecture`
- **THEN** notes tagged with either value are returned

#### Scenario: List notes without a filter
- **WHEN** an agent lists notes without a tag collection
- **THEN** every note of the task is returned regardless of tags

#### Scenario: Empty tag collection applies no filter
- **WHEN** an agent lists notes with an explicitly empty tag collection
- **THEN** every note of the task is returned

#### Scenario: Tag filtering is normalized
- **WHEN** an agent lists notes with the tag `Design` and a note has the tag `design`
- **THEN** the note is returned

#### Scenario: Update only the tags
- **WHEN** an agent updates a note with a tag collection and no content
- **THEN** the note's tags are replaced and its Markdown content is unchanged

#### Scenario: Update only the content
- **WHEN** an agent updates a note with content and no tag collection
- **THEN** the content changes and the existing tags are preserved

#### Scenario: Empty tag collection clears tags
- **WHEN** an agent updates a note with an explicitly empty tag collection
- **THEN** the note has no tags and its content is unchanged

#### Scenario: Update without content or tags is rejected
- **WHEN** an agent updates a note without content and without a tag collection
- **THEN** the tool reports a validation error and the note is unchanged

#### Scenario: Note reads include tags
- **WHEN** an agent reads a note with tags
- **THEN** the returned note includes the tag collection

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

### Requirement: Tool writes follow the same task behavior as the board
Task creation through tools SHALL use the target board's configured initial workflow stage and SHALL require a project owned by that board's Hub. Task creation SHALL accept an auto-mode option and SHALL persist the selected value. When that initial stage has an entry instruction, creation SHALL prepare the task's first execution immediately — the default worktree for a Git-backed project, the first conversation, and the dispatch of the stage instruction — without the cancelable countdown, because the agent surface has no cancelable window. The tool result SHALL report the start outcome, and a failed preparation or dispatch SHALL leave the task in its initial stage with the unresolved entry. When the initial stage has no entry instruction, creation SHALL NOT start an agent. Tool editing SHALL allow title and description changes at any stage, including for tasks with worktrees, without automatically messaging task conversations. Tool changes SHALL affect the same task data shown in the active board UI.

#### Scenario: Create in an instructed initial stage
- **WHEN** an authorized board tool creates a task on a board whose initial stage has an entry instruction
- **THEN** the task appears in that stage with the requested project and task text
- **AND** the first execution is prepared and the stage instruction is dispatched in the same call
- **AND** the tool result reports the start outcome

#### Scenario: Create without triggering task execution
- **WHEN** an authorized board tool creates a task on a board whose initial stage has no entry instruction
- **THEN** the task appears in that stage with the requested project and task text
- **AND** creation does not initiate an agent execution

#### Scenario: Create with auto mode
- **WHEN** an authorized board tool creates a task with auto mode enabled
- **THEN** the task is persisted with auto mode enabled
- **AND** the start rule applies independently of the auto-mode value

#### Scenario: Report a failed start
- **WHEN** the first-execution preparation or the stage-instruction dispatch fails during tool creation
- **THEN** the task remains in its initial stage with the unresolved entry
- **AND** the tool result reports the failure
- **AND** no automatic retry occurs

#### Scenario: Reject a project from another Hub
- **WHEN** a board tool receives a project identifier that is not owned by the board's Hub
- **THEN** the task is not created
- **AND** the tool reports the scope mismatch

#### Scenario: Edit an existing task outside Backlog
- **WHEN** an authorized board tool edits the title or description of a task outside Backlog that has a worktree
- **THEN** the updated text is reflected in that task's board data
- **AND** the edit does not automatically send a message to its conversations or initiate an execution

### Requirement: Availability outside task-bound chats

Board and task read tools SHALL be available in task conversations and ordinary DSH chats. Creating or editing a task SHALL NOT require the calling chat to be associated with a task card. Board administration writes SHALL be available only in an ordinary DSH chat that is not owned by a task; a session owned by a task, including a subagent descendant of a task conversation, SHALL be rejected without changing board state. Board-scoped tools SHALL require an explicitly discovered board identifier in an ordinary DSH chat and SHALL resolve it from the task in a task conversation. Team file tools SHALL be available in task conversations and ordinary DSH chats alike, SHALL resolve the Hub from the task in a task conversation, and SHALL NOT require a board identifier or a task identifier. `send_task_message` SHALL be available only inside a conversation associated with a task. An ordinary DSH chat, a session that no task owns, and a subagent descendant of a task conversation SHALL be rejected with an actionable error without delivering anything.

#### Scenario: Use board tools from an ordinary DSH chat

- **WHEN** a user asks for a supported board operation in an ordinary DSH chat
- **THEN** the agent can discover a Hub and board with the approved tools
- **AND** it can perform the operation with the discovered board identifier without first opening or creating a task-bound conversation

#### Scenario: Use board tools from a task conversation

- **WHEN** a user asks for a supported board read operation within a task conversation
- **THEN** the same approved read operation set is available there
- **AND** the board identifier can be inferred from the task

#### Scenario: Reject board administration from a task conversation

- **WHEN** an agent invokes `create_board`, `update_board`, `edit_board_yaml`, or `delete_board` from a task conversation or from a subagent descendant of one
- **THEN** the tool rejects the request with an actionable error
- **AND** no board is created, changed, or deleted

#### Scenario: Do not require a board for Hub discovery

- **WHEN** an agent calls `list_hubs`
- **THEN** the tool returns the Hubs available to the installation
- **AND** it does not require a board or a native workspace

#### Scenario: Use team file tools from either conversation kind

- **WHEN** a user asks an agent to read or change a Hub's team file from a task conversation or from an ordinary DSH chat
- **THEN** the tool resolves the Hub for that conversation and reports the storage's team file support
- **AND** no board identifier or task identifier is required

#### Scenario: Reject a cross-card message outside a task conversation

- **WHEN** an agent invokes `send_task_message` from an ordinary DSH chat or from a session that no task owns
- **THEN** the tool rejects the request with an actionable error
- **AND** nothing is delivered

#### Scenario: Reject a cross-card message from a subagent descendant

- **WHEN** an agent invokes `send_task_message` from a subagent descendant of a task conversation
- **THEN** the tool rejects the request with an actionable error
- **AND** nothing is delivered

### Requirement: Preserve host-native tools
Excluding Railyin board mutations, decision-ledger tools, and a plugin-owned TODO checklist SHALL apply to this plugin's product scope only. The plugin SHALL NOT remove or disable native DSH tools merely because an equivalent Railyin capability is out of scope.

#### Scenario: Native tooling remains available
- **WHEN** the plugin is enabled in a DSH conversation that already has native tools
- **THEN** those host-native tools remain governed by DSH rather than being removed by the plugin's exclusions

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

### Requirement: Partial board workflow edits

`edit_board_yaml` SHALL accept one or more literal old/new text pairs. Each edit MAY also name the stage it targets and the authored field of that stage the match must fall inside, so an edit is unambiguous between stages that carry the same text. Each old value SHALL match the stored workflow YAML exactly once at the moment the edit is applied, within the scope the edit names when it names one. Zero matches, multiple matches, and an empty edit collection SHALL be rejected without changing the board. A rejection SHALL name the zero-based index of the edit that failed; for a missing match it SHALL name the closest authored line and its line number; for a repeated match it SHALL name the line number of every occurrence and, when the occurrences fall in different stages, the stage of each.

The plugin SHALL apply the pairs in order to an in-memory copy, validate the complete result with the same workflow semantics as the board UI, and persist the result all or nothing. Text and comments outside the replaced spans SHALL remain unchanged. A call that names a stage the workflow does not define, or a field the named stage does not author, SHALL be rejected without changing the board.

#### Scenario: Set a stage entry prompt

- **WHEN** an agent calls `edit_board_yaml` with an old value that occurs once in the current YAML and a new value that adds `on_enter_prompt` to that stage
- **THEN** the stage's entry prompt is stored
- **AND** the other stages and every comment outside the replaced span are unchanged

#### Scenario: Apply several edits in one call

- **WHEN** an agent calls `edit_board_yaml` with several old/new pairs and every old value occurs once at its turn
- **THEN** every pair is applied in order
- **AND** the board is persisted once with the complete result

#### Scenario: Scope an edit to one stage

- **WHEN** the same text exists in two stages and an edit names one of them
- **THEN** only that stage's occurrence is replaced
- **AND** the other stage's identical text is unchanged

#### Scenario: Scope an edit to one stage field

- **WHEN** an edit names a stage and the stage's entry instruction field
- **THEN** the old text is matched only inside that field
- **AND** the same text in that stage's script or transition list is not matched

#### Scenario: Reject an edit whose old text is absent

- **WHEN** an old value does not occur in the current workflow YAML
- **THEN** the tool reports that the text was not found, the index of the failed edit, and the closest authored line with its line number
- **AND** the board is unchanged, including the other pairs of the same call

#### Scenario: Reject an edit whose old text is ambiguous

- **WHEN** an old value occurs more than once in the current workflow YAML
- **THEN** the tool reports how many occurrences were found, their line numbers, and the stage of each
- **AND** the board is unchanged

#### Scenario: Reject an edit collection that produces an invalid workflow

- **WHEN** the applied result is rejected by the workflow parser or would orphan a task stage
- **THEN** the tool reports the validation problem
- **AND** the board's stored workflow is unchanged

#### Scenario: Preserve comments and formatting

- **WHEN** an agent edits one stage's allowed transitions and the YAML contains comments elsewhere
- **THEN** every comment and every untouched line remain exactly as authored
- **AND** only the replaced span differs

### Requirement: Board creation and rename

`create_board` SHALL require a nonempty name and SHALL initialize the board with the default workflow unless a workflow is supplied. A board name SHALL be unique within its Hub after trimming and case-insensitive comparison. `update_board` SHALL rename a board without changing its tasks, workflow, conversations, or worktrees. Creating or renaming a board SHALL NOT create a native conversation or start an agent execution.

#### Scenario: Create a board

- **WHEN** an agent calls `create_board` with a name in a discovered Hub
- **THEN** the board exists in that Hub with the requested name
- **AND** the result includes the new board identifier and the Hub identifier

#### Scenario: Reject a duplicate board name

- **WHEN** an agent calls `create_board` or renames a board to a name that another board of the same Hub already uses after trimming and case-insensitive comparison
- **THEN** the tool reports the name conflict
- **AND** no board is created or renamed

#### Scenario: Rename without side effects

- **WHEN** an agent calls `update_board` with only a new name
- **THEN** the board's name changes
- **AND** its tasks, workflow, conversations, and worktrees are unchanged
- **AND** no native conversation is created and no agent execution starts

### Requirement: Board deletion

`delete_board` SHALL require an explicit confirmation and SHALL refuse a board that contains tasks. The tool SHALL NOT delete the board's projects, project directories, worktrees, branches, native conversations, or native workspaces. A board that is part of the team's shared configuration SHALL be refused with an actionable problem: removing it is a publishing decision, so the operator removes it in the interface, where the local or team removal scope selects what is published. A board that is not shared SHALL be removed locally, and the result SHALL state that no publishing was attempted. Deleting the last board SHALL leave the Hub with no boards.

#### Scenario: Delete an empty board

- **WHEN** an agent calls `delete_board` with a board identifier, confirmation, and a board that contains no tasks
- **THEN** the board is removed from its Hub

#### Scenario: Refuse a board that contains tasks

- **WHEN** an agent calls `delete_board` for a board that still contains tasks
- **THEN** the tool reports that the board is in use
- **AND** the board and its tasks are unchanged

#### Scenario: Require a removal scope for a bound board

- **WHEN** an agent calls `delete_board` for a board that is part of the team's shared configuration
- **THEN** the tool refuses and explains that the operator removes it in the interface, where the removal scope is chosen
- **AND** the board is unchanged

#### Scenario: Remove a bound board only from this installation

- **WHEN** the operator removes a shared board with the local scope in the interface
- **THEN** the board disappears locally
- **AND** no publishing or synchronization is started for that removal

#### Scenario: Remove a bound board for the team

- **WHEN** the operator removes a shared board with the team scope in the interface
- **THEN** the board disappears locally
- **AND** the removal is included in the team's document through the Hub's publishing behavior

#### Scenario: Delete the last board

- **WHEN** an agent deletes the only board of a Hub that has no tasks
- **THEN** the Hub remains with no boards

### Requirement: Board write concurrency

`update_board`, `edit_board_yaml`, and `delete_board` SHALL accept an optional Hub revision. The Hub revision is shared by every board of the Hub and advances on any Hub change, including a task move, a conversation change, and a note edit on another board, so it SHALL NOT be treated as the identity of the target board's document.

A tool that composes its document from the stored one SHALL, when the supplied revision no longer matches the current Hub revision, re-read the board and apply its composition to the current document. It SHALL proceed and save the composed result when the composition still succeeds and every anchor the call names still matches what it names. When the composition no longer succeeds, the tool SHALL reject the request without changing the board and SHALL report the current Hub revision together with the stale revision the caller supplied. When the installation still retains the document the most recent accepted write replaced, the report SHALL also name the stages and fields that changed on the target board. A tool that replaces the whole document SHALL reject a stale revision without changing the board, because a replacement cannot be rebased. When the revision is omitted, the tool SHALL apply the change to the current stored state. The board workflow read payload SHALL include the current Hub revision.

#### Scenario: Apply a write with the current revision

- **WHEN** an agent supplies the Hub revision returned by the read and the Hub has not changed since
- **THEN** the requested board change is applied

#### Scenario: Rebase a composed write after an unrelated Hub change

- **WHEN** the Hub revision moved because another board's task moved, and every anchor of the composed write still matches the target board
- **THEN** the composition is reapplied to the board's current document
- **AND** the write succeeds and reports the revision it saved

#### Scenario: Reject a write whose anchors no longer match

- **WHEN** the Hub revision moved and an anchor of the composed write no longer matches the target board
- **THEN** the write is refused and the board is unchanged
- **AND** the refusal reports the current Hub revision and the stale revision the caller supplied
- **AND** it names the stages and fields that changed when the installation still retains the replaced document

#### Scenario: Reject a write with a stale revision

- **WHEN** an agent supplies a Hub revision that no longer matches the current Hub revision and the write cannot be reapplied to the current document
- **THEN** the tool reports the revision conflict
- **AND** the board is unchanged

#### Scenario: Reject a whole-document write with a stale revision

- **WHEN** an agent supplies a Hub revision that no longer matches the current Hub revision and replaces the whole document
- **THEN** the tool reports the revision conflict
- **AND** the board is unchanged

#### Scenario: Apply a write without a revision

- **WHEN** an agent omits the Hub revision
- **THEN** the requested board change is applied to the current stored board

### Requirement: Board administration publishing

A board administration tool SHALL NOT publish. After a successful board creation, rename, workflow replacement, workflow edit, project scope change, or board removal, the tool SHALL change this installation's local state only and SHALL leave a team-bound board presented as the draft the publishing capability describes. Publishing SHALL remain a manual operator action in the interface and SHALL NOT be triggered by any product tool.

The tool result SHALL report the local change together with a publishing outcome that states that no publishing was attempted, and it SHALL NOT report a published state, a publishing blocker, or a publishing failure, because no publishing is attempted. A team-scoped board removal SHALL remove the board locally and SHALL leave the team's published board untouched until the operator publishes.

#### Scenario: Keep a tool write local on a bound Hub

- **WHEN** an agent creates, renames, or edits a board and the Hub is bound to a team storage
- **THEN** the local change is saved
- **AND** nothing is published
- **AND** the board is presented as a draft
- **AND** the result states that no publishing was attempted

#### Scenario: Keep a tool workflow edit local

- **WHEN** an agent replaces or edits a board workflow while the board is published to a team
- **THEN** the local workflow is saved
- **AND** the board's log gains the revision the write records
- **AND** the team's published board still carries the previous document until the operator publishes

#### Scenario: Keep a tool removal local

- **WHEN** an agent removes a team-bound board with either scope
- **THEN** the board disappears locally
- **AND** the team's published layout is unchanged
- **AND** no publishing is attempted for that removal

#### Scenario: Keep an unbound Hub local

- **WHEN** an agent changes a board and the Hub is not bound to a storage
- **THEN** the change is saved locally
- **AND** the result reports that no publishing was attempted

#### Scenario: Publish a tool change on an explicit binding

- **WHEN** an agent creates, renames, or edits a board and the Hub is bound to a storage that requires explicit publishing
- **THEN** the local change is saved
- **AND** nothing is published by the tool
- **AND** the result states that the change is local and the board is a draft until the operator publishes it

#### Scenario: Let continuous storage synchronize a tool change

- **WHEN** an agent creates, renames, or edits a board and the Hub is bound to a storage that synchronizes continuously
- **THEN** the local change is saved
- **AND** the result does not report the change as left to automatic synchronization
- **AND** the board remains a draft until the operator publishes it

#### Scenario: Keep the local change when publishing is blocked

- **WHEN** the board carries a publishing blocker and an agent changes it
- **THEN** the local change is saved
- **AND** the result reports that no publishing was attempted
- **AND** the blocker is not reported as a publishing failure of the tool

#### Scenario: Do not publish a local-only removal

- **WHEN** an agent deletes a team-bound board with the local scope
- **THEN** the board disappears locally
- **AND** no publishing is attempted for that removal

#### Scenario: Keep a Hub awaiting review local

- **WHEN** an agent changes a board and the Hub is awaiting connection review
- **THEN** the change is saved locally
- **AND** the result reports that no publishing was attempted

#### Scenario: Keep a tool removal local

- **WHEN** an agent attempts to remove a board that is part of the team's shared configuration
- **THEN** the tool refuses and explains that the operator removes it in the interface
- **AND** the board and the team's document are unchanged
- **AND** no publishing is attempted

#### Scenario: Do not publish a local-only removal

- **WHEN** an agent removes a board that is not shared with the team
- **THEN** the board disappears locally
- **AND** the result states that no publishing was attempted

#### Scenario: Report no publishing outcome that cannot happen

- **WHEN** an agent writes a board through any board administration tool
- **THEN** the result never reports a publishing blocker or a publishing failure
- **AND** the result never reports that the change is left to automatic synchronization

### Requirement: Transition discovery and recording tools

The plugin SHALL expose `list_allowed_transitions` and `set_next_transition`.

`list_allowed_transitions` SHALL resolve the task from the calling task conversation or from an explicit task identifier and SHALL return the task's current stage, every target that stage configures with its condition, the target that applies when nothing is recorded, the currently recorded transition together with the reason it carries, and, for every target stage that declares parameters, that target's declared parameter names with their optional descriptions.

`set_next_transition` SHALL act only on the task that owns the calling conversation: it SHALL offer no task identifier, and a call made outside a task conversation SHALL be rejected. It SHALL accept an optional target stage, an optional reason, and an optional parameter value set. A provided target SHALL be one of the current stage's configured targets and SHALL require a nonempty reason; a blank reason SHALL be rejected, and a reason longer than the accepted length SHALL be rejected rather than truncated. An omitted target SHALL clear the recording and SHALL NOT require a reason. A declaration MAY follow the user's explicit request in that conversation, a stage instruction delivered to it, or an explicit request in a cross-card message from another task; a peer request SHALL NOT relax any rule of this requirement, and the declaration SHALL remain attributed to the task that owns the calling conversation.

A parameter value set SHALL be accepted only for a target that declares parameters. For that target the call SHALL supply exactly the declared names, each with a nonempty string value within the accepted per-value and total size limits; an unknown name, a missing declared name, an empty value, or an oversized value SHALL be rejected with an actionable error that names the accepted parameter names, so the agent can correct the declaration in the same turn. A parameter value set supplied for a target that declares no parameters SHALL be rejected. A parameter value set SHALL NOT be accepted together with a cleared or omitted target.

Both tools SHALL report the current stage, the configured targets, and the recorded transition after the call, including the recorded parameter values when the recorded target declares parameters. A stage that does not configure transitions SHALL be reported as having no configurable transitions instead of inventing a target set. Neither tool SHALL move the task during the call, change its position, send a message, or change auto mode, and both SHALL be available while auto mode is disabled. A recorded transition SHALL arm the advance the task performs at the end of its next completed turn, whether or not auto mode is enabled. A rejected target, a rejected reason, a rejected parameter value set, or a missing required reason SHALL leave the task, its recorded transition, and its recorded parameters unchanged. The host SHALL revalidate the recorded parameter names against the destination's current declaration before the task enters it, and SHALL fail that transition with an actionable error rather than creating an entry whose declaration no longer matches.

#### Scenario: List the configured transitions

- **WHEN** an agent calls `list_allowed_transitions` for a task whose stage configures two targets with conditions
- **THEN** the result contains the current stage and both targets with their conditions
- **AND** it contains the target that applies when nothing is recorded

#### Scenario: Return the recorded transition

- **WHEN** the task already recorded a transition and the agent calls either tool
- **THEN** the result reports that recorded transition and the reason it carries

#### Scenario: Report a stage without configured transitions

- **WHEN** the agent calls `list_allowed_transitions` for a task whose stage does not configure transitions
- **THEN** the result states that the stage configures no transitions
- **AND** no target is returned

#### Scenario: Record a transition

- **WHEN** an agent calls `set_next_transition` with a target that the current stage configures and a nonempty reason
- **THEN** the task records that transition together with that reason
- **AND** the result reports the recorded transition and the remaining targets
- **AND** the task's stage and position are unchanged

#### Scenario: Declare on a peer request

- **WHEN** a cross-card message explicitly asks the task to declare a transition to a target its current stage configures and the agent calls `set_next_transition` with that target and a reason
- **THEN** the task records that transition
- **AND** the task's stage and position are unchanged during the call
- **AND** the declaration is recorded as the task's own, not as a user action or the requesting task's action

#### Scenario: Keep the transition rules under a peer request

- **WHEN** a cross-card message asks for a target the current stage does not configure, or the agent supplies no reason
- **THEN** the tool rejects the declaration under the existing rules
- **AND** the task and any previously recorded transition are unchanged

#### Scenario: Reject a declaration without a reason

- **WHEN** an agent calls `set_next_transition` with a target and no reason, or with a reason that is blank after trimming
- **THEN** the tool reports the rejection with an actionable error
- **AND** the task and any previously recorded transition are unchanged

#### Scenario: Reject a reason over the accepted length

- **WHEN** an agent calls `set_next_transition` with a reason longer than the accepted length
- **THEN** the tool reports the rejection
- **AND** the recorded reason is never a silent truncation of what the agent wrote

#### Scenario: Clear the recording

- **WHEN** an agent calls `set_next_transition` without a target
- **THEN** the task's recorded transition is cleared without requiring a reason
- **AND** the result reports that no transition is recorded

#### Scenario: Reject a target the stage does not configure

- **WHEN** an agent calls `set_next_transition` with a target that is not one of the current stage's configured targets
- **THEN** the tool reports the rejection
- **AND** the task and any previously recorded transition are unchanged

#### Scenario: Reject a recording without configured transitions

- **WHEN** an agent calls `set_next_transition` for a task whose stage does not configure transitions
- **THEN** the tool reports that the stage has no configurable transitions
- **AND** the task is unchanged

#### Scenario: Recording does not move the task

- **WHEN** an agent declares or clears a transition
- **THEN** the task's stage and position are unchanged while the call runs
- **AND** no message is sent and no agent execution starts
- **AND** auto mode keeps its setting

#### Scenario: Arm the advance with auto mode disabled

- **WHEN** an agent declares a transition for a task whose auto mode is disabled
- **THEN** the recording is stored and auto mode remains disabled
- **AND** the task's next completed turn advances to the declared stage

#### Scenario: Disarm the advance by clearing with auto mode disabled

- **WHEN** an agent clears the recorded transition of a task whose auto mode is disabled
- **THEN** the task does not advance at the end of its next completed turn

#### Scenario: Resolve the task from the conversation

- **WHEN** an agent calls `set_next_transition` inside a task conversation
- **THEN** the recording applies to the task that owns that conversation
- **AND** the tool offers no way to name another task

#### Scenario: Require a task scope outside a task conversation

- **WHEN** an agent calls `set_next_transition` in an ordinary DSH chat
- **THEN** the tool rejects the request with an actionable error
- **AND** no task records a transition

#### Scenario: Read another task from an ordinary chat

- **WHEN** an agent calls `list_allowed_transitions` with an explicit task identifier
- **THEN** the result describes that task's stage and targets

#### Scenario: Report a target's declared parameters

- **WHEN** a configured target's stage declares a pipeline and an app parameter with descriptions
- **THEN** `list_allowed_transitions` reports both names and descriptions for that target
- **AND** it reports no parameters for a target whose stage declares none

#### Scenario: Record a transition with every declared parameter

- **WHEN** an agent calls `set_next_transition` with a target that declares two parameters and supplies both values and a reason
- **THEN** the task records the transition together with those values
- **AND** the result reports the recorded values
- **AND** the task's stage and position are unchanged

#### Scenario: Reject a missing or unknown parameter

- **WHEN** an agent supplies a value set that omits a declared name, adds an unknown name, or carries an empty or oversized value
- **THEN** the tool reports the rejection and names the accepted parameter names
- **AND** the task, its recorded transition, and its recorded parameters are unchanged

#### Scenario: Reject parameters for a target that declares none

- **WHEN** an agent supplies a parameter value set for a target whose stage declares no parameters
- **THEN** the tool reports the rejection
- **AND** the task records no transition

#### Scenario: Fail a placement whose declaration changed

- **WHEN** a recorded target's declaration changes between the recording and the placement so the recorded values no longer match
- **THEN** the transition fails with an actionable error instead of creating an entry
- **AND** the task remains in its current stage

### Requirement: Task pause tools

The plugin SHALL expose `pause_task` and `resume_task`. Both SHALL resolve the task from the calling task conversation or from an explicit task identifier, so a conversation may pause or resume a task other than its own. Both SHALL report the task, its current stage, whether auto mode is enabled, and the pause in effect with its reason after the call.

`pause_task` SHALL require a reason. A blank reason SHALL be rejected, and a reason longer than the accepted length SHALL be rejected rather than truncated. The pause SHALL suspend the task's automatic advance and SHALL NOT move the task, change its position, clear or replace the recorded transition, send a message, start an execution, or disable auto mode. A task whose auto mode is disabled SHALL NOT be paused: the call SHALL succeed with a result stating that auto mode is disabled and that the task does not advance, and SHALL record nothing.

`resume_task` SHALL clear the pause and SHALL leave auto mode enabled. It SHALL NOT move the task, change its position, send a message, or start an execution, and it SHALL NOT advance the task for a turn that already ended. Resuming a task that carries no pause SHALL succeed with a result stating that the task is not paused and SHALL change nothing.

Neither tool SHALL change the task's recorded transition, and clearing a recorded transition SHALL NOT pause the task. Both tools SHALL be available in a task conversation and in an ordinary DSH chat when the task identifier is provided.

#### Scenario: Pause a task

- **WHEN** an agent calls `pause_task` for a task whose auto mode is enabled with a nonempty reason
- **THEN** the task records the pause and its reason
- **AND** auto mode remains enabled
- **AND** the result reports the pause in effect

#### Scenario: Resolve the pause target from the conversation

- **WHEN** an agent calls either tool inside a task conversation without a task identifier
- **THEN** the plugin resolves the task that owns the conversation

#### Scenario: Resolve another task by identifier

- **WHEN** an agent calls `resume_task` with the identifier of a different task in the same Hub
- **THEN** the plugin resumes that task
- **AND** the calling task is unchanged

#### Scenario: Require a task scope outside a task conversation

- **WHEN** an agent calls either tool in an ordinary DSH chat without a task identifier
- **THEN** the tool rejects the request with an actionable error

#### Scenario: Reject a blank reason

- **WHEN** an agent calls `pause_task` with a blank reason
- **THEN** the tool reports the rejection
- **AND** the task is unchanged

#### Scenario: Reject an oversized reason

- **WHEN** an agent calls `pause_task` with a reason longer than the accepted length
- **THEN** the tool reports the rejection
- **AND** the task is unchanged

#### Scenario: Report a task that does not advance

- **WHEN** an agent calls `pause_task` for a task whose auto mode is disabled
- **THEN** the call succeeds and reports that the task does not advance because auto mode is disabled
- **AND** no pause is recorded

#### Scenario: Resume a paused task

- **WHEN** an agent calls `resume_task` for a task that carries a pause
- **THEN** the pause is cleared and auto mode remains enabled
- **AND** the task's stage and position are unchanged
- **AND** the result reports that no pause is in effect

#### Scenario: Resume a task that is not paused

- **WHEN** an agent calls `resume_task` for a task that carries no pause
- **THEN** the call succeeds and reports that the task is not paused
- **AND** the task is unchanged

#### Scenario: Pausing does not clear the routing

- **WHEN** an agent pauses a task that has a recorded transition
- **THEN** the recorded transition is unchanged
- **AND** clearing the recorded transition later does not pause the task

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

### Requirement: Workflow write controls

Every tool that writes a board's workflow document SHALL accept three optional controls beside the document or the edits: a digest expectation, a dry review, and a response mode.

A supplied digest expectation SHALL be compared with the digest of the exact document the write would store, after composition and validation and before any persistence. A mismatch SHALL refuse the write, persist nothing, and report both digests. A matching expectation SHALL change nothing about the write.

A dry review SHALL compose and validate the document exactly as a real write does, return the same report, and persist nothing: no board document, no revision, no publishing, and no change to any task.

A response mode SHALL select the report shape: a summary, which is the default, and a full report. The summary SHALL carry the digest of the composed document, the stages whose content changed with the name of each changed field but not its text, the validation problems, the grouped warnings, the authorization impact, the affected cards, and the instruction and source sizes. The full report SHALL carry the per-field before and after values the report already defines. The digest SHALL be reported in both modes.

Every accepted write SHALL report the digest of the exact document it stored, so a caller can verify what was saved without reading the document back.

#### Scenario: Refuse a write whose document does not match the expected digest

- **WHEN** a caller supplies a digest expectation that differs from the composed document
- **THEN** nothing is persisted and no revision is recorded
- **AND** the result reports the expected and the composed digests

#### Scenario: Accept a write whose document matches the expected digest

- **WHEN** a caller supplies the digest of the document the write composes
- **THEN** the document is stored and its digest is reported

#### Scenario: Review a write without saving it

- **WHEN** a caller writes with the dry review control
- **THEN** the same report a real write would produce is returned
- **AND** the board, its revisions, its tasks, and the team document are unchanged

#### Scenario: Report a summary by default

- **WHEN** a caller writes without naming a response mode
- **THEN** the result names the stages that changed and the fields that changed in each
- **AND** it does not carry the before and after text of those fields
- **AND** it carries the digest of the stored document

#### Scenario: Report the full difference on request

- **WHEN** a caller writes with the full response mode
- **THEN** the result carries the per-field before and after values the report defines
- **AND** it carries the digest of the stored document
