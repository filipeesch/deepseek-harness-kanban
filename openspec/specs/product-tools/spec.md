# Product Tools Specification

## Purpose

Allow agents to discover Hubs, boards, and projects, inspect board-scoped tasks, perform explicitly requested task text changes and board administration, and create, list, and tag-aware update shared task notes from task conversations and ordinary DSH chats, without exposing task movement, task deletion, inter-card messaging, or Hub administration.

Reference note: Railyin's [card tool definitions](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/bun/engine/card-tool-definitions.ts#L16-L126>) provide reference terminology, not a fixed tool-name or JSON-schema contract for this plugin.

## Requirements

### Requirement: Restricted board tool surface

The plugin SHALL expose tools for discovering Hubs, boards, and projects; reading board and task information; creating tasks; editing task titles and descriptions; creating, listing, and tag-aware updating of shared task notes; and administering the boards of a Hub through `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`, together with an extended `get_board_summary`. Its product tool surface SHALL NOT include moving tasks, deleting tasks, deleting notes, sending messages to other cards, Hub creation, rename, or deletion, decision-ledger tools, or a plugin-owned TODO checklist.

#### Scenario: Discover available product operations

- **WHEN** an agent receives the plugin's board and note tools
- **THEN** Hub, board, and project discovery, board and task reading, task creation, task text editing, shared note creation, listing, and tag-aware updating, board creation, board rename, board workflow reading and writing, and empty-board deletion are available operations
- **AND** board movement, task deletion, note deletion, inter-card messaging, Hub administration, decision-ledger operations, and a plugin-owned TODO checklist are not exposed as part of that tool surface

#### Scenario: Inspect the board administration tool names

- **WHEN** an agent receives the plugin's board administration tools
- **THEN** the surface contains `create_board`, `update_board`, `edit_board_yaml`, and `delete_board`
- **AND** no tool creates, renames, or deletes a Hub


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

Creating, editing, or deleting a task, or creating, renaming, editing, or deleting a board through a product tool SHALL require an explicit user request for that change. The plugin SHALL NOT add another product-specific approval dialog for a write that the user explicitly requested. This requirement SHALL NOT bypass native DSH permission behavior.

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


### Requirement: Tool writes follow the same task behavior as the board
Task creation through tools SHALL use the target board's configured initial workflow stage without starting an agent, and SHALL require a project owned by that board's Hub. Tool editing SHALL allow title and description changes at any stage, including for tasks with worktrees, without automatically messaging task conversations. Tool changes SHALL affect the same task data shown in the active board UI.

#### Scenario: Create without triggering task execution
- **WHEN** an authorized board tool creates a task on a board
- **THEN** the task appears in that board's configured initial stage with the requested project and task text
- **AND** the project belongs to the board's Hub
- **AND** creation does not initiate an agent execution for that task

#### Scenario: Reject a project from another Hub
- **WHEN** a board tool receives a project identifier that is not owned by the board's Hub
- **THEN** the task is not created
- **AND** the tool reports the scope mismatch

#### Scenario: Edit an existing task outside Backlog
- **WHEN** an authorized board tool edits the title or description of a task outside Backlog that has a worktree
- **THEN** the updated text is reflected in that task's board data
- **AND** the edit does not automatically send a message to its conversations or initiate an execution


### Requirement: Availability outside task-bound chats

Board and task read tools SHALL be available in task conversations and ordinary DSH chats. Creating or editing a task SHALL NOT require the calling chat to be associated with a task card. Board administration writes SHALL be available only in an ordinary DSH chat that is not owned by a task; a session owned by a task, including a subagent descendant of a task conversation, SHALL be rejected without changing board state. Board-scoped tools SHALL require an explicitly discovered board identifier in an ordinary DSH chat and SHALL resolve it from the task in a task conversation.

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


### Requirement: Preserve host-native tools
Excluding Railyin board mutations, decision-ledger tools, and a plugin-owned TODO checklist SHALL apply to this plugin's product scope only. The plugin SHALL NOT remove or disable native DSH tools merely because an equivalent Railyin capability is out of scope.

#### Scenario: Native tooling remains available
- **WHEN** the plugin is enabled in a DSH conversation that already has native tools
- **THEN** those host-native tools remain governed by DSH rather than being removed by the plugin's exclusions


### Requirement: Board-anchored discovery and scope
The plugin SHALL expose `list_hubs` so an agent can discover Hubs, and `list_boards` so an agent can discover the boards of a Hub. Board-scoped tools SHALL accept a board identifier and SHALL resolve the board's Hub and project registry from it. The plugin SHALL provide `list_projects`, `get_board_summary`, `list_cards`, and `create_card` with the board identifier as their scope. `get_card`, `edit_card`, and the note tools SHALL accept a task identifier and resolve the owning board and Hub. A task conversation SHALL allow the board identifier to be omitted for board-scoped tools and SHALL resolve it from the task. An ordinary DSH chat SHALL require an explicitly discovered board identifier.

#### Scenario: Discover Hubs and boards before writing
- **WHEN** an agent in an ordinary DSH chat needs to create a task
- **THEN** it can call `list_hubs`, then `list_boards` with a discovered Hub identifier
- **AND** it passes a discovered board identifier and a project identifier from that board's Hub to `create_card`

#### Scenario: Read a board summary
- **WHEN** an agent calls `get_board_summary` with a board identifier
- **THEN** the result includes that board's name, Hub, workflow columns, and task counts

#### Scenario: List projects for a board
- **WHEN** an agent calls `list_projects` with a board identifier
- **THEN** the result contains only projects owned by the board's Hub

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

The plugin SHALL expose `get_board_summary` with an optional `include_workflow` flag. When the flag is true, the result SHALL include the exact stored workflow YAML, the parsed workflow's initial stage, its columns with their entry prompts and allowed transitions, its groups, the Hub revision, and the board's publishing state. When the flag is false or omitted, the result SHALL retain the board summary with the board name, Hub, workflow columns, task counts, and the Hub revision.

#### Scenario: Read a complete board workflow

- **WHEN** an agent calls `get_board_summary` with a board identifier and `include_workflow` true
- **THEN** the result contains the exact authored workflow YAML
- **AND** it contains the initial stage, every column with its entry prompt and allowed transitions, and every group
- **AND** it contains the Hub revision and the board's publishing state

#### Scenario: Read a board summary without the workflow payload

- **WHEN** an agent calls `get_board_summary` without `include_workflow`
- **THEN** the result contains the board name, Hub, workflow columns, task counts, and the Hub revision
- **AND** it does not contain the workflow YAML

#### Scenario: Reject an unknown board

- **WHEN** an agent calls `get_board_summary` with a board identifier that does not exist
- **THEN** the tool reports that the board does not exist
- **AND** it returns no board data


### Requirement: Whole-document board workflow replacement

`update_board` SHALL accept a complete workflow YAML and replace the board's workflow with it. `create_board` SHALL accept an optional complete workflow YAML and SHALL use the default workflow when it is omitted. A workflow SHALL be validated with the same accepted workflow semantics as the board UI, including unsupported fields, unknown stage references, and existing task columns that the workflow would no longer define. An invalid workflow SHALL NOT change the stored workflow.

#### Scenario: Replace a board workflow

- **WHEN** an agent calls `update_board` with a complete valid workflow YAML
- **THEN** the board's stored workflow becomes that document
- **AND** the returned result includes the saved workflow YAML and the parsed workflow

#### Scenario: Create a board with a custom workflow

- **WHEN** an agent calls `create_board` with a name and a complete valid workflow YAML
- **THEN** the new board starts with that workflow

#### Scenario: Create a board with the default workflow

- **WHEN** an agent calls `create_board` with a name and no workflow YAML
- **THEN** the new board starts with the default workflow

#### Scenario: Reject an invalid workflow

- **WHEN** an agent calls `update_board` or `create_board` with YAML that the workflow parser rejects
- **THEN** the tool reports the validation problem
- **AND** the board's stored workflow is unchanged

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
