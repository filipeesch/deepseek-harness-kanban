# Kanban Board Specification

## Purpose

Provide a single global Kanban board for managing tasks across projects, with configurable workflow stages, explicit execution choices, and independent task activity and attention information.

Reference note: Railyin's [board view](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/views/BoardView.vue#L4-L145>) and [task card](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/TaskCard.vue#L1-L79>) provide observed UX evidence. This specification intentionally changes the reference's multiple-board, WIP, editing, and attention behavior.

## Requirements

### Requirement: One global multi-project board
The product SHALL provide one global board whose tasks can belong to different registered projects. This scope SHALL NOT provide creation or selection of multiple boards.

#### Scenario: View tasks from different projects together
- **WHEN** tasks for different registered projects exist
- **THEN** the same global board displays those tasks in their workflow stages with their project association

### Requirement: Initial workflow without automatic instructions
The initial workflow SHALL contain Backlog, Plan, In Progress, In Review, and Done in that order. Backlog SHALL be the initial stage of this default workflow. No stage SHALL have an entry instruction enabled by default.

#### Scenario: Use the initial workflow
- **WHEN** the board is initialized without a user-customized workflow
- **THEN** its stages are Backlog, Plan, In Progress, In Review, and Done in that order
- **AND** new tasks use Backlog as the initial stage

#### Scenario: Move through the default workflow
- **WHEN** a user moves a task to another stage of the unmodified default workflow
- **THEN** no agent execution is initiated by a default entry instruction

### Requirement: YAML workflow configuration
The board SHALL support workflow configuration in YAML, including the initial stage, grouped columns, allowed transitions, and optional stage entry instructions. It SHALL honor configured transition restrictions and column grouping. This version SHALL NOT implement WIP limits.

#### Scenario: Render a configured column group
- **WHEN** the workflow configuration groups multiple stages together
- **THEN** the board presents those stages as a group while retaining each stage as a distinct task destination

#### Scenario: Reject a prohibited transition
- **WHEN** a user requests a move that the workflow's allowed transitions prohibit
- **THEN** the task remains in its current stage
- **AND** the prohibited move does not initiate an agent execution

#### Scenario: Do not enforce a WIP capacity
- **WHEN** a user makes an otherwise permitted move into a stage that already contains tasks
- **THEN** the board does not reject the move because of a WIP capacity limit

### Requirement: Top-level task creation
The board SHALL provide one New task action at the top of the workflow's configured initial column. It SHALL collect a title, description, and project. Saving a new task SHALL place it in the configured initial stage without initiating an agent execution. The board header SHALL NOT provide a separate New task action.

#### Scenario: Open task creation from the board
- **WHEN** the user selects the New task action at the top of the configured initial column
- **THEN** the creation experience provides title, description, and project inputs without asking the user to choose a stage

#### Scenario: Create into a customized initial stage
- **WHEN** the user saves a new task and the workflow has a configured initial stage
- **THEN** the task is created in that stage with the supplied title, description, and project
- **AND** task creation does not initiate an agent execution

### Requirement: Edit task text at any stage
The user SHALL be able to edit a task's title and description in any workflow stage, including after a worktree has been created. Saving those edits SHALL NOT automatically send a message to any task conversation or initiate an agent execution.

#### Scenario: Edit an in-progress task with a worktree
- **WHEN** the user saves a new title or description for an In Progress task that has a worktree
- **THEN** the task's text is updated without requiring a return to Backlog

#### Scenario: Save edits without messaging agents
- **WHEN** the user saves task title or description changes
- **THEN** the changes do not automatically append a message to any task chat or initiate a new agent execution

### Requirement: Open a task drawer
Activating a task card SHALL open its task drawer, giving access to that task's conversations and supporting task information. The whole card surface SHALL be activatable except for nested controls, which SHALL perform their own action without opening the drawer. A focused card SHALL be activatable from the keyboard.

#### Scenario: Inspect a card
- **WHEN** the user activates any non-control area of a task card
- **THEN** the task drawer opens for the selected task

#### Scenario: Use a nested control
- **WHEN** the user activates a control inside a task card
- **THEN** that control performs its own action and the task drawer does not open

#### Scenario: Activate a card from the keyboard
- **WHEN** a task card has keyboard focus and the user presses Enter
- **THEN** the task drawer opens for the selected task

### Requirement: Direct stage manipulation on the board
The board SHALL move tasks between workflow stages only through drag and drop. A task card SHALL NOT provide an independent stage selector. A drag SHALL present a distinct dragged representation and a drop indicator. Dropping on a permitted stage without an entry instruction SHALL move the task immediately. Dropping on an instructed stage SHALL open the Move and run / Move only / Cancel confirmation. Dropping within the current stage SHALL reorder the task relative to its neighbors. A prohibited drop SHALL leave the task unchanged. The board SHALL NOT offer worktree creation as part of a drop.

#### Scenario: Move to an uninstructed stage by drag and drop
- **WHEN** the user drops a task on a permitted stage that has no entry instruction
- **THEN** the task appears in that stage immediately
- **AND** the move does not initiate an agent execution

#### Scenario: Reorder within the current stage
- **WHEN** the user drops a task at a new position within its current stage
- **THEN** the task is placed at that position and the new order is retained

#### Scenario: Drop on an instructed stage
- **WHEN** the user drops a task on a permitted stage that has an entry instruction
- **THEN** the board opens the Move and run / Move only / Cancel confirmation
- **AND** the task does not move until the user makes an explicit choice

#### Scenario: Prohibited drop
- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage
- **THEN** the task remains in its current stage and its position is unchanged

#### Scenario: Drop without a worktree
- **WHEN** the user drops a task that has no worktree on a permitted uninstructed stage
- **THEN** the move completes without asking whether to create a worktree

### Requirement: Bulk task deletion
The board SHALL provide an explicit selection mode that presents a selection control on each card and disables card dragging while active. The user SHALL be able to select multiple tasks across visible stages. A bulk deletion SHALL require one confirmation and SHALL apply the individual task deletion semantics to each eligible task. A task SHALL be skipped when any of its conversations is running, it has a pending operation or transition, or its worktree has local changes. The board SHALL report skipped tasks and their reasons, and SHALL leave those tasks selected. Leaving selection mode SHALL clear the selection.

#### Scenario: Enter selection mode and select tasks
- **WHEN** the user enters selection mode and activates cards in more than one stage
- **THEN** the board marks the selected tasks and disables dragging for them

#### Scenario: Delete eligible tasks
- **WHEN** the user confirms deletion of a selection whose tasks are eligible
- **THEN** each eligible task is deleted with the individual deletion semantics and the selection is cleared

#### Scenario: Skip a task with a running conversation
- **WHEN** the user confirms deletion of a selection that includes a task with a running conversation
- **THEN** that task is not deleted, its reason is reported, and it remains selected

#### Scenario: Skip a task with local worktree changes
- **WHEN** the user confirms deletion of a selection that includes a task whose worktree has local changes
- **THEN** that task is not deleted, its reason is reported, and it remains selected

#### Scenario: Leave selection mode
- **WHEN** the user leaves selection mode
- **THEN** the selection is cleared and normal card dragging is restored

### Requirement: Explicit choices for instructed moves
When a user requests entry into a stage with an entry instruction, the board SHALL offer Move and run, Move only, and Cancel. Agent execution SHALL require the Move and run choice; moving alone SHALL NOT imply permission to execute.

#### Scenario: Move and run
- **WHEN** the user chooses Move and run for an instructed destination and confirms a target conversation
- **THEN** the task moves to the destination stage
- **AND** the entry instruction is submitted for execution in the chosen conversation, subject to the task's context and permission constraints

#### Scenario: Move without running
- **WHEN** the user chooses Move only for an instructed destination
- **THEN** the task moves to the destination stage without submitting its entry instruction for execution

#### Scenario: Cancel an instructed move
- **WHEN** the user chooses Cancel for an instructed move
- **THEN** the task remains in its previous stage
- **AND** no execution is initiated by that move request

### Requirement: Choose the conversation for an entry instruction
The Move and run confirmation SHALL let the user select an existing task conversation or create a new task conversation as the execution target. The entry instruction SHALL be directed to that selected target rather than implicitly to every task conversation.

#### Scenario: Run in an existing conversation
- **WHEN** the user selects an existing task conversation while confirming Move and run
- **THEN** that conversation is the target of the entry instruction
- **AND** other task conversations do not receive the instruction merely because they belong to the task

#### Scenario: Run in a new conversation
- **WHEN** the user chooses a new conversation while confirming Move and run
- **THEN** a new conversation is added to the task and used as the entry instruction's target

### Requirement: Movement without an entry instruction does not run an agent
Moving a task into a stage without an entry instruction SHALL update its workflow stage without initiating an agent execution. Optional worktree creation and directory switching SHALL follow the separate worktree-management requirements.

#### Scenario: Move to an uninstructed stage
- **WHEN** the user completes an allowed move to a stage without an entry instruction
- **THEN** the task appears in that stage without an agent execution being initiated by the stage change

### Requirement: Text search and project filtering
The board SHALL support text search over task titles and descriptions and filtering by project, separately and together. This scope SHALL NOT add activity or worktree-status filters.

#### Scenario: Find a task by its title or description
- **WHEN** the user searches for text that matches a task's title or description
- **THEN** that task is included in the board's matching results

#### Scenario: Filter tasks by project
- **WHEN** the user selects a project filter
- **THEN** the board displays only tasks associated with that project

#### Scenario: Combine search and project filtering
- **WHEN** the user applies text search and a project filter together
- **THEN** the displayed tasks satisfy both the text search and the selected project filter

### Requirement: Execution activity is independent of workflow and attention
The board SHALL display task execution activity separately from the task's workflow stage and attention indicators. Activity SHALL reflect execution across the task's conversation tabs rather than only the currently selected tab. Completing or failing an execution SHALL NOT, by itself, redefine the task's workflow stage.

#### Scenario: Activity in a nonselected task conversation
- **WHEN** a task conversation is executing while another task tab is selected
- **THEN** the board still represents that task's execution activity

#### Scenario: Execution completion does not imply workflow completion
- **WHEN** an execution finishes in a task whose workflow stage is In Progress
- **THEN** the task remains in In Progress unless a separate stage change is requested

### Requirement: Coexisting attention indicators across task conversations
The board SHALL aggregate attention information across all conversations belonging to a task. It SHALL distinguish blue unread-message indicators, orange awaiting-reply indicators, and red failure indicators. Simultaneously applicable indicators SHALL coexist rather than collapse to a single highest-priority indicator. Indicator counts are not required by this capability.

#### Scenario: Attention from a nonselected conversation
- **WHEN** an unread message, awaiting-reply state, or failure is present in a task conversation that is not selected
- **THEN** the corresponding task-level attention indicator is still represented on the board

#### Scenario: Multiple attention states coexist with activity
- **WHEN** a task has unread messages, a conversation awaiting a reply, a conversation with a failure, and another conversation executing
- **THEN** blue, orange, and red attention indicators are all represented together
- **AND** execution activity is represented separately from those attention indicators

### Requirement: Host-themed board controls
The board SHALL follow the host application's light and dark appearance for its primary actions, focus indicators, and selection accents. Enabled primary actions SHALL use host theme colors for their fill, foreground, and hover state in both appearances. Primary-action text SHALL maintain at least 4.5:1 contrast against its fill at rest and on hover. The board SHALL NOT use the browser's selection highlight color as a product fill or accent.

#### Scenario: Primary action in the dark appearance
- **WHEN** the host application uses its dark appearance
- **THEN** enabled primary actions use the host dark theme fill and foreground
- **AND** the fill and foreground remain at least 4.5:1 contrast at rest and on hover

#### Scenario: Primary action in the light appearance
- **WHEN** the host application uses its light appearance
- **THEN** enabled primary actions use the host light theme fill and foreground
- **AND** the fill and foreground remain at least 4.5:1 contrast at rest and on hover

#### Scenario: Focus and selection accents
- **WHEN** a board control has keyboard focus, a tab is selected, a card is selected, or a drag shows its drop indicator
- **THEN** the indicator uses the host accent or focus color
- **AND** it remains distinguishable in both appearances

#### Scenario: No browser selection palette
- **WHEN** the board renders in either appearance
- **THEN** primary-action fills and board accents do not use the browser selection highlight color or its matching foreground color
