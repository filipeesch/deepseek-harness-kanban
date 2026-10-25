# Spec Delta

## REMOVED Requirements

### Requirement: One global multi-project board
**Reason**: The product now supports multiple boards, each owned by a Hub and using all projects of that Hub.
**Migration**: Existing tasks, projects, and the previous workflow move into the default board of the migrated `My Hub`. No user action is required.

## ADDED Requirements

### Requirement: Multiple boards within a Hub
The product SHALL provide multiple boards inside each Hub. A board SHALL have a required nonempty name and its own workflow. Board names SHALL be unique after trimming, compared case-insensitively within the Hub. The board tabs SHALL list only the boards of the active Hub.

#### Scenario: Show the boards of the active Hub
- **WHEN** the user selects a Hub with more than one board
- **THEN** the board tabs list those boards
- **AND** no board from another Hub appears

#### Scenario: Reject a duplicate board name
- **WHEN** the user submits a board name that matches another board in the same Hub case-insensitively
- **THEN** no board is created and the form reports the name conflict

#### Scenario: Keep workflows independent
- **WHEN** the user changes the workflow of one board
- **THEN** the workflows and tasks of every other board are unchanged

### Requirement: Board creation and lifecycle
Creating a board SHALL require a name and SHALL initialize it with the default workflow. Renaming a board SHALL NOT change its tasks, workflow, conversations, or worktrees. A board SHALL be deletable only when it contains no tasks. Deleting the last board SHALL leave the Hub with no boards and SHALL present the Hub's create-board empty state. Deleting a board SHALL NOT delete its projects, project directories, worktrees, branches, native conversations, or native workspaces.

#### Scenario: Create a board with the default workflow
- **WHEN** the user creates a board with a valid name
- **THEN** the board appears in the Hub's board tabs
- **AND** it uses the default workflow stages

#### Scenario: Rename a board
- **WHEN** the user saves a valid new name for a board
- **THEN** the board tab and board header show the new name
- **AND** the board's tasks and workflow are unchanged

#### Scenario: Block deletion when the board has tasks
- **WHEN** the user attempts to delete a board that contains a task
- **THEN** the board is not deleted and the plugin reports how many tasks block it

#### Scenario: Delete the last board
- **WHEN** the user confirms deletion of the only board in a Hub and that board has no tasks
- **THEN** the board is removed and the Hub presents its create-board empty state

### Requirement: Board selection and persistence
The Kanban page SHALL present the boards of the active Hub as tabs below the Hub tabs. The active board SHALL be retained per Hub across reloads in browser local storage. When the remembered board no longer exists, the plugin SHALL select the first available board. Switching boards SHALL reset board-scoped search, project filter, selection mode, and the open task drawer. Switching boards SHALL NOT stop, move, or otherwise affect task execution.

#### Scenario: Restore the active board after reload
- **WHEN** the user reloads the page after selecting a board
- **THEN** the same board is active if it still exists in the same Hub

#### Scenario: Fall back from a deleted board
- **WHEN** the remembered board no longer exists in the active Hub
- **THEN** the first available board becomes active
- **AND** the page does not render an empty or stale board tab

#### Scenario: Reset board-scoped UI on switch
- **WHEN** the user switches from one board to another
- **THEN** the new board starts without the previous board's search, project filter, selection, or open task drawer
- **AND** running tasks continue unaffected

### Requirement: Board attention aggregation
The board tab SHALL present aggregated attention for all tasks on that board. The aggregation SHALL include unread activity and active execution. The aggregation SHALL clear when no task on the board has those facts. Attention on a board that is not active SHALL remain visible on its tab.

#### Scenario: Aggregate unread activity on the board tab
- **WHEN** a task on a board has unread activity
- **THEN** that board's tab presents an unread indicator

#### Scenario: Aggregate execution on the board tab
- **WHEN** a task on a board is running a turn or owns background activity
- **THEN** that board's tab presents an execution indicator

#### Scenario: Clear the board indicator
- **WHEN** no task on the board has unread activity or active execution
- **THEN** the board tab presents neither indicator

#### Scenario: Show attention for an inactive board
- **WHEN** a task on a board in the active Hub gains unread activity or starts running while another board is active
- **THEN** the inactive board's tab presents the corresponding indicator

## MODIFIED Requirements

### Requirement: Initial workflow without automatic instructions
Each board SHALL start with a default workflow containing Backlog, Plan, In Progress, In Review, and Done in that order. Backlog SHALL be the initial stage of this default workflow. No stage SHALL have an entry instruction enabled by default. Editing one board's workflow SHALL NOT change another board's workflow.

#### Scenario: Use the initial workflow
- **WHEN** a board is created without a user-customized workflow
- **THEN** its stages are Backlog, Plan, In Progress, In Review, and Done in that order
- **AND** new tasks use Backlog as the initial stage

#### Scenario: Move through the default workflow
- **WHEN** a user moves a task to another stage of the unmodified default workflow
- **THEN** no agent execution is initiated by a default entry instruction

#### Scenario: Do not share workflow edits across boards
- **WHEN** the user saves a customized workflow for one board
- **THEN** every other board keeps its own saved workflow

### Requirement: YAML workflow configuration
Each board SHALL support its own workflow configuration in YAML, including the initial stage, grouped columns, allowed transitions, and optional stage entry instructions. The active board's workflow SHALL be used for rendering, transitions, and task creation. The product SHALL honor configured transition restrictions and column grouping. This version SHALL NOT implement WIP limits and SHALL NOT introduce reusable workflow templates.

#### Scenario: Render a configured column group
- **WHEN** the active board's workflow groups multiple stages together
- **THEN** the board presents those stages as a group while retaining each stage as a distinct task destination

#### Scenario: Reject a prohibited transition
- **WHEN** a user requests a move that the active board's workflow does not permit from its current stage
- **THEN** the task remains in its current stage
- **AND** the prohibited move does not initiate an agent execution

#### Scenario: Do not enforce a WIP capacity
- **WHEN** a user makes an otherwise permitted move into a stage that already contains tasks
- **THEN** the board does not reject the move because of a WIP capacity limit

#### Scenario: Validate against the active board's workflow
- **WHEN** the user edits the workflow of the active board
- **THEN** the editor validates that board's YAML
- **AND** no other board's workflow is read or replaced

### Requirement: Top-level task creation
The active board SHALL provide one New task action at the top of its workflow's configured initial column. It SHALL collect a title, description, and project from the active Hub's project registry. The project input SHALL start unselected and SHALL be required; the board SHALL NOT preselect a project, including when a project filter is active. Saving a new task SHALL place it in the active board's configured initial stage without initiating an agent execution. The board header SHALL NOT provide a separate New task action.

#### Scenario: Open task creation from the board
- **WHEN** the user selects the New task action at the top of the active board's configured initial column
- **THEN** the creation experience provides title, description, and project inputs without asking the user to choose a stage
- **AND** the project input is unselected
- **AND** the project list contains only projects owned by the active Hub

#### Scenario: Create into a customized initial stage
- **WHEN** the user saves a new task and the active board's workflow has a configured initial stage
- **THEN** the task is created in that stage with the supplied title, description, and project
- **AND** the task belongs to the active board
- **AND** task creation does not initiate an agent execution

#### Scenario: Require an explicit project choice
- **WHEN** the user opens New task with one or more registered Hub projects and does not select a project
- **THEN** the task cannot be created
- **AND** no project is silently chosen from the project list or the active project filter

#### Scenario: No task creation without a board
- **WHEN** the active Hub has no boards
- **THEN** the board surface presents the create-board empty state
- **AND** no New task action is available

### Requirement: Text search and project filtering
The active board SHALL support text search over its task titles and descriptions and filtering by project, separately and together. The project filter SHALL list the projects owned by the active Hub. This scope SHALL NOT add activity or worktree-status filters.

#### Scenario: Find a task by its title or description
- **WHEN** the user searches for text that matches a task's title or description
- **THEN** that task is included in the board's matching results

#### Scenario: Filter tasks by project
- **WHEN** the user selects a project filter
- **THEN** the board displays only tasks associated with that project

#### Scenario: Combine search and project filtering
- **WHEN** the user applies text search and a project filter together
- **THEN** the displayed tasks satisfy both the text search and the selected project filter

#### Scenario: Keep the filter inside the active board
- **WHEN** the user changes from one board to another
- **THEN** the project filter options are limited to the active Hub's projects
- **AND** tasks from the previous board are not shown

### Requirement: General board configuration with worktree base path
The Kanban configuration experience SHALL include a General section that is presented first and opened by default. The General section SHALL provide an optional worktree base path used as the parent directory for future task worktree destinations across all Hubs and boards. A non-empty worktree base path SHALL be an absolute path; saving SHALL require it to resolve to an existing directory and SHALL retain that canonical directory. Saving an empty worktree base path SHALL remove the configured value. Changing or clearing the worktree base path SHALL NOT move, remove, or rename any existing worktree or branch.

#### Scenario: Save a worktree base path
- **WHEN** the user saves an existing absolute directory as the worktree base path
- **THEN** the canonical directory is retained as the global worktree base path
- **AND** future task worktree destinations across every Hub and board use it as their default parent

#### Scenario: Reject a non-existent worktree base path
- **WHEN** the user saves a worktree base path that does not resolve to an existing directory
- **THEN** the setting is not saved and the user sees an actionable error

#### Scenario: Clear the worktree base path
- **WHEN** the user saves the General section with an empty worktree base path
- **THEN** the installation has no configured worktree base path
- **AND** task worktree destinations are not derived from a configured base path

#### Scenario: Existing worktrees survive a base path change
- **WHEN** the user changes or clears the worktree base path while tasks have existing worktrees
- **THEN** every existing worktree, branch, and recorded destination remains unchanged

### Requirement: Rich workflow YAML editing
The Board configuration SHALL present the active board's workflow YAML in a code-editor surface rather than a plain textarea. The surface SHALL provide YAML syntax highlighting, line numbers, folding, search, and a vertically resizable editing area, and it SHALL preserve the text and comments entered by the user without reformatting.

#### Scenario: Edit workflow YAML with code-editor assistance
- **WHEN** the user opens Configuration → Board
- **THEN** the active board's YAML is shown with syntax highlighting and line numbers in a resizable editor
- **AND** the user can fold sections and search within the document

#### Scenario: Preserve authored text
- **WHEN** the user saves a workflow whose text was not changed
- **THEN** the stored YAML matches the editor text without normalization or reformatting

### Requirement: Expanded workflow editing area
The Board section SHALL use a larger Configuration surface than the other sections, and the editor SHALL support vertical resizing and a maximize action that expands the editing area without closing Configuration.

#### Scenario: Maximize the workflow editor
- **WHEN** the user activates the editor's maximize action
- **THEN** the editor expands within the Configuration dialog
- **AND** the Save and Reload actions remain available

#### Scenario: Resize the workflow editor
- **WHEN** the user drags the editor's vertical resize handle
- **THEN** the editing area grows or shrinks without changing the YAML or closing the dialog

### Requirement: Live workflow diagnostics and guarded save
The Board section SHALL validate the active board's YAML locally while the user edits, using the same accepted workflow semantics as the host save path. Syntax problems SHALL be shown at their document positions, schema problems SHALL be shown inline or in an issue summary, and Save SHALL remain disabled while the current text is invalid or validation is pending.

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
- **AND** the active board's last valid workflow is not replaced

### Requirement: Workflow draft preservation
The active board's Workflow draft SHALL survive switching between Configuration tabs. Closing Configuration with unsaved changes, or replacing the draft with Reload, SHALL require explicit confirmation; canceling SHALL keep the draft and the dialog open.

#### Scenario: Switch tabs without losing the draft
- **WHEN** the user edits the workflow, switches to another Configuration tab, and returns to Board
- **THEN** the edited YAML is still present for the same board

#### Scenario: Confirm before closing
- **WHEN** the user attempts to close Configuration while the workflow draft differs from the saved workflow
- **THEN** a discard confirmation is shown
- **AND** canceling keeps the dialog open with the draft intact

#### Scenario: Confirm before reload
- **WHEN** the user activates Reload saved workflow while the draft is dirty
- **THEN** the user is asked to confirm replacing the draft
