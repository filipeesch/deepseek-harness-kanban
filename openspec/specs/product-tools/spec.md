# Product Tools Specification

## Purpose

Allow agents to discover Hubs, boards, and projects and to inspect board-scoped tasks and perform explicitly requested task creation and text edits from task conversations and ordinary DSH chats, without expanding the approved board mutation surface.

Reference note: Railyin's [card tool definitions](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/bun/engine/card-tool-definitions.ts#L16-L126>) provide reference terminology, not a fixed tool-name or JSON-schema contract for this plugin.

## Requirements

### Requirement: Restricted board tool surface
The plugin SHALL expose tools for discovering Hubs, boards, and projects, reading board and task information, creating tasks, editing task titles and descriptions, and creating, listing, and tag-aware updating of shared task notes. Its product tool surface SHALL NOT include moving tasks, deleting tasks, deleting notes, or sending messages to other cards. It SHALL NOT include Hub or board creation, rename, or deletion. It SHALL NOT introduce decision-ledger or task-TODO tools from Railyin.

#### Scenario: Discover available product operations
- **WHEN** an agent receives the plugin's board and note tools
- **THEN** Hub, board, and project discovery, board and task reading, task creation, task text editing, and shared note creation, listing, and tag-aware updating are available operations
- **AND** board movement, task deletion, note deletion, inter-card messaging, Hub or board administration, decision-ledger operations, and a plugin-owned TODO checklist are not exposed as part of that tool surface

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
Creating or editing a task through a board tool SHALL require an explicit user request for that change. The plugin SHALL NOT add another product-specific approval dialog for a write that the user explicitly requested. This requirement SHALL NOT bypass native DSH permission behavior.

#### Scenario: Create a task at the user's request
- **WHEN** the user explicitly asks an agent to create a task and the agent invokes the corresponding board operation
- **THEN** the requested task can be created without an additional product-specific confirmation dialog

#### Scenario: Edit a task at the user's request
- **WHEN** the user explicitly asks an agent to change a task's title or description and the agent invokes the corresponding board operation
- **THEN** the requested text change can be applied without an additional product-specific confirmation dialog

#### Scenario: Do not use cards for unsolicited agent tracking
- **WHEN** an agent has no explicit user request to create or edit a board task
- **THEN** the plugin's board tools do not authorize creating or editing a task merely to track the agent's own work

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
The approved board tools SHALL be available in task conversations and ordinary DSH chats. Reading, creating, or editing board tasks SHALL NOT require the calling chat to be associated with a task card. Board-scoped tools SHALL require an explicitly discovered board identifier in an ordinary DSH chat and SHALL resolve it from the task in a task conversation.

#### Scenario: Use board tools from an ordinary DSH chat
- **WHEN** a user asks for a supported board operation in an ordinary DSH chat
- **THEN** the agent can discover a Hub and board with the approved tools
- **AND** it can perform the operation with the discovered board identifier without first opening or creating a task-bound conversation

#### Scenario: Use board tools from a task conversation
- **WHEN** a user asks for a supported board operation within a task conversation
- **THEN** the same approved operation set is available there
- **AND** the board identifier can be inferred from the task

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

### Requirement: No Hub or board administration tools
The plugin's agent tool surface SHALL NOT create, rename, or delete Hubs or boards. Those operations SHALL remain available only through the Kanban UI.

#### Scenario: Inspect the tool surface
- **WHEN** an agent receives the plugin's tools
- **THEN** Hub and board creation, rename, and deletion are absent
- **AND** reading Hubs, boards, projects, cards, and notes remains available

#### Scenario: Do not create structure through tools
- **WHEN** an agent needs a new Hub or board
- **THEN** the plugin does not expose a tool that performs that change
- **AND** the user creates it through the Kanban UI
