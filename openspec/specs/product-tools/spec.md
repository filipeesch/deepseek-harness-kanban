# Product Tools Specification

## Purpose

Allow agents to inspect the Kanban board and perform explicitly requested task creation and text edits from task conversations and ordinary DSH chats, without expanding the approved board mutation surface.

Reference note: Railyin's [card tool definitions](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/bun/engine/card-tool-definitions.ts#L16-L126>) provide reference terminology, not a fixed tool-name or JSON-schema contract for this plugin.

## Requirements

### Requirement: Restricted board tool surface
The plugin SHALL expose board tools for reading board and task information, creating tasks, and editing task titles and descriptions. Its board tool surface SHALL NOT include moving tasks, deleting tasks, or sending messages to other cards. It SHALL NOT introduce decision-ledger or task-TODO tools from Railyin.

#### Scenario: Discover available product operations
- **WHEN** an agent receives the plugin's board tools
- **THEN** reading, task creation, and task text editing are available operations
- **AND** board movement, task deletion, inter-card messaging, decision-ledger operations, and a plugin-owned TODO checklist are not exposed as part of that tool surface

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
Task creation through tools SHALL use the configured initial workflow stage without starting an agent. Tool editing SHALL allow title and description changes at any stage, including for tasks with worktrees, without automatically messaging task conversations. Tool changes SHALL affect the same task data shown in the board UI.

#### Scenario: Create without triggering task execution
- **WHEN** an authorized board tool creates a task
- **THEN** the task appears in the board's configured initial stage with the requested project and task text
- **AND** creation does not initiate an agent execution for that task

#### Scenario: Edit an existing task outside Backlog
- **WHEN** an authorized board tool edits the title or description of a task outside Backlog that has a worktree
- **THEN** the updated text is reflected in that task's board data
- **AND** the edit does not automatically send a message to its conversations or initiate an execution

### Requirement: Availability outside task-bound chats
The approved board tools SHALL be available in task conversations and ordinary DSH chats. Reading, creating, or editing board tasks SHALL NOT require the calling chat to be associated with a task card.

#### Scenario: Use board tools from an ordinary DSH chat
- **WHEN** a user asks for a supported board operation in an ordinary DSH chat
- **THEN** the agent can use the approved board tools without first opening or creating a task-bound conversation

#### Scenario: Use board tools from a task conversation
- **WHEN** a user asks for a supported board operation within a task conversation
- **THEN** the same approved operation set is available there

### Requirement: Preserve host-native tools
Excluding Railyin board mutations, decision-ledger tools, and a plugin-owned TODO checklist SHALL apply to this plugin's product scope only. The plugin SHALL NOT remove or disable native DSH tools merely because an equivalent Railyin capability is out of scope.

#### Scenario: Native tooling remains available
- **WHEN** the plugin is enabled in a DSH conversation that already has native tools
- **THEN** those host-native tools remain governed by DSH rather than being removed by the plugin's exclusions
