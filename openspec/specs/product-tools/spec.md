# Product Tools Specification

## Purpose

Allow agents to discover Hubs, boards, and projects, inspect board-scoped tasks, perform explicitly requested task text changes and board administration, and create, list, and tag-aware update shared task notes from task conversations and ordinary DSH chats, without exposing task movement, task deletion, inter-card messaging, or Hub administration.

Reference note: Railyin's [card tool definitions](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/bun/engine/card-tool-definitions.ts#L16-L126>) provide reference terminology, not a fixed tool-name or JSON-schema contract for this plugin.

## Requirements

### Requirement: Restricted board tool surface

The plugin SHALL expose tools for discovering Hubs, boards, and projects; reading board and task information; creating tasks; editing task titles and descriptions; creating, listing, and tag-aware updating of shared task notes; reading the transitions available from a task's current stage and recording the transition that task will follow next through `list_allowed_transitions` and `set_next_transition`; pausing and resuming a task's automatic advance through `pause_task` and `resume_task`; and administering the boards of a Hub through `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`, together with an extended `get_board_summary`; and searching, reading, creating, editing, and deleting the Hub's team files through `search_team_files`, `read_team_file`, `create_team_file`, `edit_team_file`, and `delete_team_file`. Its product tool surface SHALL NOT include moving tasks, deleting tasks, deleting notes, sending messages to other cards, Hub creation, rename, or deletion, decision-ledger tools, or a plugin-owned TODO checklist. Recording a transition or pausing a task SHALL NOT be treated as moving a task.

#### Scenario: Discover available product operations

- **WHEN** an agent receives the plugin's board and note tools
- **THEN** Hub, board, and project discovery, board and task reading, task creation, task text editing, shared note creation, listing, and tag-aware updating, transition discovery and recording, task pause and resume, board creation, board rename, board workflow reading and writing, empty-board deletion, and team file search, reading, creation, editing, and deletion are available operations
- **AND** board movement, task deletion, note deletion, inter-card messaging, Hub administration, decision-ledger operations, and a plugin-owned TODO checklist are not exposed as part of that tool surface

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
- **THEN** the task remains in its current stage and position
- **AND** the recorded transition only decides the destination of a later advance

#### Scenario: Do not move a task by pausing it

- **WHEN** an agent pauses or resumes a task
- **THEN** the task remains in its current stage and position
- **AND** no message is sent and no agent execution starts

#### Scenario: Expose team file operations

- **WHEN** an agent receives the plugin's product tools for a Hub bound to a storage that supports team files
- **THEN** searching, reading, creating, editing, and deleting the Hub's team files are available operations
- **AND** moving a team file to another path, restoring a deleted team file, and browsing the storage outside the team files directory are not exposed
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

Creating, editing, or deleting a task, creating, renaming, editing, or deleting a board, or creating, editing, or deleting a Hub's team file through a product tool SHALL require an explicit user request for that change. The plugin SHALL NOT add another product-specific approval dialog for a write that the user explicitly requested. This requirement SHALL NOT bypass native DSH permission behavior.

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

Board and task read tools SHALL be available in task conversations and ordinary DSH chats. Creating or editing a task SHALL NOT require the calling chat to be associated with a task card. Board administration writes SHALL be available only in an ordinary DSH chat that is not owned by a task; a session owned by a task, including a subagent descendant of a task conversation, SHALL be rejected without changing board state. Board-scoped tools SHALL require an explicitly discovered board identifier in an ordinary DSH chat and SHALL resolve it from the task in a task conversation. Team file tools SHALL be available in task conversations and ordinary DSH chats alike, SHALL resolve the Hub from the task in a task conversation, and SHALL NOT require a board identifier or a task identifier.

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

### Requirement: Preserve host-native tools
Excluding Railyin board mutations, decision-ledger tools, and a plugin-owned TODO checklist SHALL apply to this plugin's product scope only. The plugin SHALL NOT remove or disable native DSH tools merely because an equivalent Railyin capability is out of scope.

#### Scenario: Native tooling remains available
- **WHEN** the plugin is enabled in a DSH conversation that already has native tools
- **THEN** those host-native tools remain governed by DSH rather than being removed by the plugin's exclusions

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

### Requirement: Partial board workflow edits

`edit_board_yaml` SHALL accept one or more literal old/new text pairs. Each old value SHALL match the current stored workflow YAML exactly once at the moment the edit is applied. Zero matches, multiple matches, and an empty edit collection SHALL be rejected without changing the board. The plugin SHALL apply the pairs in order to an in-memory copy, validate the complete result with the same workflow semantics as the board UI, and persist the result all or nothing. Text and comments outside the replaced spans SHALL remain unchanged.

#### Scenario: Set a stage entry prompt

- **WHEN** an agent calls `edit_board_yaml` with an old value that occurs once in the current YAML and a new value that adds `on_enter_prompt` to that stage
- **THEN** the stage's entry prompt is stored
- **AND** the other stages and every comment outside the replaced span are unchanged

#### Scenario: Apply several edits in one call

- **WHEN** an agent calls `edit_board_yaml` with several old/new pairs and every old value occurs once at its turn
- **THEN** every pair is applied in order
- **AND** the board is persisted once with the complete result

#### Scenario: Reject an edit whose old text is absent

- **WHEN** an old value does not occur in the current workflow YAML
- **THEN** the tool reports that the text was not found
- **AND** the board is unchanged, including the other pairs of the same call

#### Scenario: Reject an edit whose old text is ambiguous

- **WHEN** an old value occurs more than once in the current workflow YAML
- **THEN** the tool reports how many occurrences were found
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

`delete_board` SHALL require an explicit confirmation and SHALL refuse a board that contains tasks. The tool SHALL NOT delete the board's projects, project directories, worktrees, branches, native conversations, or native workspaces. When the board is bound to the team's shared configuration, the tool SHALL require an explicit local or team removal scope. A local removal SHALL remove the board only from this installation and SHALL NOT publish that removal. A team removal SHALL remove the board locally and SHALL make the removal part of the team's document through the Hub's publishing behavior. Deleting the last board SHALL leave the Hub with no boards.

#### Scenario: Delete an empty board

- **WHEN** an agent calls `delete_board` with a board identifier, confirmation, and a board that contains no tasks
- **THEN** the board is removed from its Hub

#### Scenario: Refuse a board that contains tasks

- **WHEN** an agent calls `delete_board` for a board that still contains tasks
- **THEN** the tool reports that the board is in use
- **AND** the board and its tasks are unchanged

#### Scenario: Require a removal scope for a bound board

- **WHEN** an agent calls `delete_board` for a team-bound board without a local or team scope
- **THEN** the tool reports that the removal scope is required
- **AND** the board is unchanged

#### Scenario: Remove a bound board only from this installation

- **WHEN** an agent calls `delete_board` with the local scope
- **THEN** the board disappears locally
- **AND** no publishing or synchronization is started for that removal

#### Scenario: Remove a bound board for the team

- **WHEN** an agent calls `delete_board` with the team scope
- **THEN** the board disappears locally
- **AND** the removal is included in the team's document through the Hub's publishing behavior

#### Scenario: Delete the last board

- **WHEN** an agent deletes the only board of a Hub that has no tasks
- **THEN** the Hub remains with no boards

### Requirement: Board write concurrency

`update_board`, `edit_board_yaml`, and `delete_board` SHALL accept an optional Hub revision. When the supplied revision no longer matches the current Hub revision, the tool SHALL reject the request without changing the board. When the revision is omitted, the tool SHALL apply the change to the current stored state. The board workflow read payload SHALL include the current Hub revision.

#### Scenario: Apply a write with the current revision

- **WHEN** an agent supplies the Hub revision returned by the read and the Hub has not changed since
- **THEN** the requested board change is applied

#### Scenario: Reject a write with a stale revision

- **WHEN** an agent supplies a Hub revision that no longer matches the current Hub revision
- **THEN** the tool reports the revision conflict
- **AND** the board is unchanged

#### Scenario: Apply a write without a revision

- **WHEN** an agent omits the Hub revision
- **THEN** the requested board change is applied to the current stored board

### Requirement: Board administration publishing

After a successful board creation, rename, workflow replacement, or workflow edit, the plugin SHALL publish the change when the board's Hub is bound to a storage and the publishing comparison permits it. A storage that requires explicit publishing SHALL publish immediately; a storage that supports continuous synchronization SHALL leave the change to its automatic synchronization. A team-scoped board removal SHALL follow the same publishing behavior, and a local-only removal SHALL NOT publish. A publishing failure, a blocker, unapplied team updates, or an unresolved review SHALL NOT roll back or discard the local board change; the tool result SHALL report the local change and the publishing outcome, including the problem when publishing did not happen. When the Hub is not bound, or is awaiting connection review, the tool SHALL keep the change local and report that no publishing occurred.

#### Scenario: Publish a tool change on an explicit binding

- **WHEN** an agent creates, renames, or edits a board and the Hub is bound to a storage that requires explicit publishing
- **THEN** the local change is saved before publishing starts
- **AND** the Hub's document is published with the change
- **AND** the result reports that the change was published

#### Scenario: Let continuous storage synchronize a tool change

- **WHEN** an agent creates, renames, or edits a board and the Hub is bound to a storage that synchronizes continuously
- **THEN** the local change is saved
- **AND** the result reports that the change is left to automatic synchronization

#### Scenario: Keep the local change when publishing is blocked

- **WHEN** the local board change succeeds and publishing is refused or fails
- **THEN** the local change remains saved
- **AND** the result reports the publishing outcome and the problem
- **AND** no board data is rolled back

#### Scenario: Do not publish a local-only removal

- **WHEN** an agent deletes a team-bound board with the local scope
- **THEN** the board disappears locally
- **AND** no publishing is attempted for that removal

#### Scenario: Keep an unbound Hub local

- **WHEN** an agent changes a board and the Hub is not bound to a storage
- **THEN** the change is saved locally
- **AND** the result reports that no publishing occurred

#### Scenario: Keep a Hub awaiting review local

- **WHEN** an agent changes a board and the Hub is awaiting connection review
- **THEN** the change is saved locally
- **AND** the result reports that no publishing occurred

### Requirement: Transition discovery and recording tools

The plugin SHALL expose `list_allowed_transitions` and `set_next_transition`. `list_allowed_transitions` SHALL resolve the task from the calling task conversation or from an explicit task identifier and SHALL return the task's current stage, every target that stage configures with its condition, the target that applies when nothing is recorded, and the currently recorded transition. `set_next_transition` SHALL accept the same task scope and an optional target stage: a provided target SHALL be one of the current stage's configured targets, and an omitted target SHALL clear the recording. Both tools SHALL report the current stage, the configured targets, and the recorded transition after the call. A stage that does not configure transitions SHALL be reported as having no configurable transitions instead of inventing a target set. Neither tool SHALL move the task, change its position, send a message, or change auto mode, and both SHALL be available while auto mode is disabled. A rejected target SHALL leave the task and its recorded transition unchanged.

#### Scenario: List the configured transitions

- **WHEN** an agent calls `list_allowed_transitions` for a task whose stage configures two targets with conditions
- **THEN** the result contains the current stage and both targets with their conditions
- **AND** it contains the target that applies when nothing is recorded

#### Scenario: Return the recorded transition

- **WHEN** the task already recorded a transition and the agent calls either tool
- **THEN** the result reports that recorded transition

#### Scenario: Report a stage without configured transitions

- **WHEN** the agent calls `list_allowed_transitions` for a task whose stage does not configure transitions
- **THEN** the result states that the stage configures no transitions
- **AND** no target is returned

#### Scenario: Record a transition

- **WHEN** an agent calls `set_next_transition` with a target that the current stage configures
- **THEN** the task records that transition
- **AND** the result reports the recorded transition and the remaining targets
- **AND** the task's stage and position are unchanged

#### Scenario: Clear the recording

- **WHEN** an agent calls `set_next_transition` without a target
- **THEN** the task's recorded transition is cleared
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

- **WHEN** an agent records or clears a transition
- **THEN** the task's stage and position are unchanged
- **AND** no message is sent and no agent execution starts
- **AND** auto mode keeps its setting

#### Scenario: Resolve the task from the conversation

- **WHEN** an agent calls either tool inside a task conversation without a task identifier
- **THEN** the plugin resolves the task that owns the conversation

#### Scenario: Require a task scope outside a task conversation

- **WHEN** an agent calls either tool in an ordinary DSH chat without a task identifier
- **THEN** the tool rejects the request with an actionable error
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

#### Scenario: Pausing does not move the task

- **WHEN** an agent pauses or resumes a task
- **THEN** the task's stage and position are unchanged
- **AND** no message is sent and no agent execution starts
- **AND** no pending automatic advance is retracted
