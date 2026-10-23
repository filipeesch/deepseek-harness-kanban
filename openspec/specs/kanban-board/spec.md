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
The board SHALL provide one New task action at the top of the workflow's configured initial column. It SHALL collect a title, description, and project. The project input SHALL start unselected and SHALL be required; the board SHALL NOT preselect a project, including when a project filter is active. Saving a new task SHALL place it in the configured initial stage without initiating an agent execution. The board header SHALL NOT provide a separate New task action.

#### Scenario: Open task creation from the board
- **WHEN** the user selects the New task action at the top of the configured initial column
- **THEN** the creation experience provides title, description, and project inputs without asking the user to choose a stage
- **AND** the project input is unselected

#### Scenario: Create into a customized initial stage
- **WHEN** the user saves a new task and the workflow has a configured initial stage
- **THEN** the task is created in that stage with the supplied title, description, and project
- **AND** task creation does not initiate an agent execution

#### Scenario: Require an explicit project choice
- **WHEN** the user opens New task with one or more registered projects and does not select a project
- **THEN** the task cannot be created
- **AND** no project is silently chosen from the project list or the active project filter

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
The board SHALL move tasks between workflow stages only through drag and drop. A task card SHALL NOT provide an independent stage selector. A drag SHALL present a distinct dragged representation and a drop indicator. Dropping on a permitted stage SHALL move the task immediately, whether or not that stage has an entry instruction. An instructed stage SHALL expose the stage run action on its cards as defined by the Run a stage instruction from a card requirement. Dropping within the current stage SHALL reorder the task relative to its neighbors. A prohibited drop SHALL leave the task unchanged. The board SHALL NOT offer worktree creation as part of a drop.

#### Scenario: Move to an uninstructed stage by drag and drop
- **WHEN** the user drops a task on a permitted stage that has no entry instruction
- **THEN** the task appears in that stage immediately
- **AND** the move does not initiate an agent execution

#### Scenario: Reorder within the current stage
- **WHEN** the user drops a task at a new position within its current stage
- **THEN** the task is placed at that position and the new order is retained

#### Scenario: Drop on an instructed stage
- **WHEN** the user drops a task on a permitted stage that has an entry instruction
- **THEN** the task moves to that stage immediately
- **AND** the drop does not initiate an agent execution
- **AND** the card exposes the stage run action

#### Scenario: Prohibited drop
- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage
- **THEN** the task remains in its current stage and its position is unchanged

#### Scenario: Drop without a worktree
- **WHEN** the user drops a task that has no worktree on a permitted stage
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

### Requirement: General board configuration with worktree base path
The board configuration experience SHALL include a General section that is presented first and opened by default. The General section SHALL provide an optional worktree base path used as the parent directory for future task worktree destinations. A non-empty worktree base path SHALL be an absolute path; saving SHALL require it to resolve to an existing directory and SHALL retain that canonical directory. Saving an empty worktree base path SHALL remove the configured value. Changing or clearing the worktree base path SHALL NOT move, remove, or rename any existing worktree or branch.

#### Scenario: Save a worktree base path
- **WHEN** the user saves an existing absolute directory as the worktree base path
- **THEN** the canonical directory is retained as the board's worktree base path
- **AND** future task worktree destinations use it as their default parent

#### Scenario: Reject a non-existent worktree base path
- **WHEN** the user saves a worktree base path that does not resolve to an existing directory
- **THEN** the setting is not saved and the user sees an actionable error

#### Scenario: Clear the worktree base path
- **WHEN** the user saves the General section with an empty worktree base path
- **THEN** the board has no configured worktree base path
- **AND** task worktree destinations are not derived from a board base path

#### Scenario: Existing worktrees survive a base path change
- **WHEN** the user changes or clears the worktree base path while tasks have existing worktrees
- **THEN** every existing worktree, branch, and recorded destination remains unchanged

### Requirement: Run a stage instruction from a card
When a task's current stage has an entry instruction, its card SHALL expose a run action. The action SHALL send the stage's entry instruction verbatim to the task's first open conversation in conversation order; when no conversation is open, it SHALL create a new conversation and use that conversation as the target. The action SHALL NOT move the task or change its position, SHALL NOT offer a conversation picker, and SHALL NOT be available in selection mode. It SHALL be unavailable while the task has an unresolved context operation or confirmed transition. It SHALL remain available after a successful admission and MAY be used again. The submitted message SHALL contain only the stage instruction; the conversation's first-turn task context supplies the task context. Admission failures SHALL be reported without changing the stage or position and without creating another conversation beyond the resolved target.

#### Scenario: Run an instruction from a card
- **WHEN** the user activates the run action on a card whose stage has an entry instruction and whose first conversation is open
- **THEN** the stage instruction is sent to that first open conversation
- **AND** the task's stage and position are unchanged
- **AND** no conversation picker is presented

#### Scenario: Run when every conversation is closed
- **WHEN** the user activates the run action and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** the stage instruction is sent to that new conversation
- **AND** the task's stage and position are unchanged

#### Scenario: Run the instruction again
- **WHEN** a stage instruction has already been admitted and the user activates the run action again
- **THEN** the action remains available
- **AND** the current stage instruction is sent again to the resolved target

#### Scenario: Reject a changed instruction
- **WHEN** the stage's entry instruction changes after the card action was displayed and the user activates the action
- **THEN** the run is rejected
- **AND** the task, its stage, and its conversations are unchanged
- **AND** the user can review and run the current instruction

#### Scenario: Report an admission failure
- **WHEN** the stage instruction cannot be admitted
- **THEN** the failure is reported on the board
- **AND** the task's stage and position are unchanged
- **AND** the failed request does not implicitly start another run

#### Scenario: Action unavailable while the task is busy
- **WHEN** the task has an unresolved context operation, a confirmed transition, or selection mode is active
- **THEN** the run action is unavailable
- **AND** no instruction is sent

#### Scenario: No action without an entry instruction
- **WHEN** a card's current stage has no entry instruction
- **THEN** the card does not expose the run action

### Requirement: Movement never runs an agent
Moving a task, including into a stage with an entry instruction, SHALL update its workflow stage and position without initiating an agent execution. Execution SHALL require a separate explicit card run action or a user-sent message from the conversation composer. Optional worktree creation and directory switching SHALL follow the separate worktree-management requirements.

#### Scenario: Move to a stage without an entry instruction
- **WHEN** the user completes an allowed move to a stage without an entry instruction
- **THEN** the task appears in that stage without an agent execution being initiated by the move

#### Scenario: Move to an instructed stage
- **WHEN** the user completes an allowed move to a stage with an entry instruction
- **THEN** the task appears in that stage without an agent execution being initiated by the move
- **AND** the stage run action is available on the card

### Requirement: Rich workflow YAML editing
The Workflow configuration SHALL present YAML in a code-editor surface rather than a plain textarea. The surface SHALL provide YAML syntax highlighting, line numbers, folding, search, and a vertically resizable editing area, and it SHALL preserve the text and comments entered by the user without reformatting.

#### Scenario: Edit workflow YAML with code-editor assistance
- **WHEN** the user opens Configuration → Workflow
- **THEN** the YAML is shown with syntax highlighting and line numbers in a resizable editor
- **AND** the user can fold sections and search within the document

#### Scenario: Preserve authored text
- **WHEN** the user saves a workflow whose text was not changed
- **THEN** the stored YAML matches the editor text without normalization or reformatting

### Requirement: Expanded workflow editing area
The Workflow section SHALL use a larger Configuration surface than the other sections, and the editor SHALL support vertical resizing and a maximize action that expands the editing area without closing Configuration.

#### Scenario: Maximize the workflow editor
- **WHEN** the user activates the editor's maximize action
- **THEN** the editor expands within the Configuration dialog
- **AND** the Save and Reload actions remain available

#### Scenario: Resize the workflow editor
- **WHEN** the user drags the editor's vertical resize handle
- **THEN** the editing area grows or shrinks without changing the YAML or closing the dialog

### Requirement: Live workflow diagnostics and guarded save
The Workflow section SHALL validate the YAML locally while the user edits, using the same accepted workflow semantics as the host save path. Syntax problems SHALL be shown at their document positions, schema problems SHALL be shown inline or in an issue summary, and Save SHALL remain disabled while the current text is invalid or validation is pending.

#### Scenario: Syntax error blocks saving
- **WHEN** the editor contains invalid YAML syntax
- **THEN** the problem is shown in the editor and the Save action is disabled
- **AND** no save request is sent

#### Scenario: Correcting the YAML enables saving
- **WHEN** the user fixes the invalid YAML and the document becomes valid
- **THEN** the diagnostics clear and the Save action becomes available

#### Scenario: Host-only rejection remains visible
- **WHEN** a locally valid workflow is rejected by the host for an orphaned column or revision conflict
- **THEN** the host error remains visible after the save attempt
- **AND** the last valid workflow is not replaced

### Requirement: Workflow draft preservation
The Workflow draft SHALL survive switching between Configuration tabs. Closing Configuration with unsaved changes, or replacing the draft with Reload, SHALL require explicit confirmation; canceling SHALL keep the draft and the dialog open.

#### Scenario: Switch tabs without losing the draft
- **WHEN** the user edits the workflow, switches to another Configuration tab, and returns to Workflow
- **THEN** the edited YAML is still present

#### Scenario: Confirm before closing
- **WHEN** the user attempts to close Configuration while the workflow draft differs from the saved workflow
- **THEN** a discard confirmation is shown
- **AND** canceling keeps the dialog open with the draft intact

#### Scenario: Confirm before reload
- **WHEN** the user activates Reload saved workflow while the draft is dirty
- **THEN** the user is asked to confirm replacing the draft

### Requirement: Content-height workflow columns
Each workflow column SHALL size itself to its own cards and controls. A column in a grouped workflow SHALL grow to fit its cards instead of receiving an equal share of a fixed group height. When the columns exceed the viewport, the board page SHALL scroll vertically; cards SHALL NOT be clipped or overflow their column background.

#### Scenario: Grow a grouped column with many cards
- **WHEN** a column inside a multi-column group contains more cards than fit in its previous equal-height share
- **THEN** the column grows so every card is inside the column surface
- **AND** the board page scrolls vertically when needed

#### Scenario: Short column stays content-sized
- **WHEN** another column in the same group has fewer cards
- **THEN** that column ends at its own content instead of stretching to match the taller peer

### Requirement: Animated task drawer transitions
Opening a task drawer from a card SHALL use a short slide-and-fade transition. Closing the drawer from the header action, Escape, or a board-background click SHALL use a symmetric exit transition before the drawer is removed. The entrance SHALL replay only when opening from a closed drawer, not when switching cards while the drawer is open. Reopening during the exit SHALL cancel the exit, and reduced-motion preferences SHALL disable these animations.

#### Scenario: Animate opening from a card
- **WHEN** the user opens a task drawer from a closed state
- **THEN** the drawer enters with the configured slide-and-fade transition
- **AND** focus moves into the drawer

#### Scenario: Do not replay when switching cards
- **WHEN** the user selects another card while the drawer is already open
- **THEN** the drawer content changes without replaying the entrance transition

#### Scenario: Animate closing
- **WHEN** the user closes the drawer with the header action, Escape, or a board-background click
- **THEN** the drawer plays the exit transition before it is removed
- **AND** its controls do not accept interaction during the exit

#### Scenario: Reopen during exit
- **WHEN** the user selects a card while the drawer is exiting
- **THEN** the exit is canceled and the drawer remains available

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion
- **THEN** the drawer opens and closes without the entrance or exit transition
