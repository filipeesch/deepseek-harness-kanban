# Kanban Board Specification

## Purpose

Provide Hub-scoped Kanban boards for managing tasks across projects, each board with its own configurable workflow stages, explicit execution choices, and independent task activity and attention information.

Reference note: Railyin's [board view](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/views/BoardView.vue#L4-L145>) and [task card](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/TaskCard.vue#L1-L79>) provide observed UX evidence. This specification intentionally changes the reference's WIP, editing, workflow-template, and attention behavior.

## Requirements

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
Each board SHALL support its own workflow configuration in YAML, including the initial stage, grouped columns, allowed transitions, and optional stage entry instructions. The active board's workflow SHALL be used for rendering, transitions, and task creation. The product SHALL honor configured transition restrictions by requiring explicit confirmation before a restricted transition can proceed, and it SHALL honor column grouping. This version SHALL NOT implement WIP limits and SHALL NOT introduce reusable workflow templates.

#### Scenario: Render a configured column group
- **WHEN** the active board's workflow groups multiple stages together
- **THEN** the board presents those stages as a group while retaining each stage as a distinct task destination

#### Scenario: Reject a prohibited transition
- **WHEN** a user requests a move that the active board's workflow does not permit from its current stage and does not confirm the override
- **THEN** the task remains in its current stage
- **AND** the prohibited move does not initiate an agent execution

#### Scenario: Restricted transition requires confirmation
- **WHEN** a user requests a move that the active board's workflow does not permit
- **THEN** the board asks for explicit confirmation before moving the task
- **AND** the task remains in its current stage until the user confirms
- **AND** the request does not initiate an agent execution

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
The board SHALL move tasks between workflow stages only through drag and drop. A task card SHALL NOT provide an independent stage selector. A drag SHALL present a distinct dragged representation and a drop indicator. Dropping on a permitted stage SHALL move the task immediately, whether or not that stage has an entry instruction. Hovering a restricted stage during a drag SHALL present a distinct warning affordance. Dropping on a restricted stage SHALL require explicit confirmation before moving the task; canceling SHALL leave the task's stage and position unchanged. An instructed stage SHALL expose the stage run action on its cards as defined by the Run a stage instruction from a card requirement. Dropping within the current stage SHALL reorder the task relative to its neighbors. The board SHALL NOT offer worktree creation as part of a drop.

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

#### Scenario: Warn while hovering a restricted stage
- **WHEN** the user drags a task over a stage that the workflow does not permit from its current stage
- **THEN** the board presents a distinct warning affordance before the drop
- **AND** the task remains in its current stage until a drop is confirmed

#### Scenario: Restricted drop asks for confirmation
- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage
- **THEN** the board asks for explicit confirmation before moving the task
- **AND** the task remains in its current stage until the user confirms

#### Scenario: Confirm a restricted drop
- **WHEN** the user confirms the restricted-drop confirmation
- **THEN** the task appears in the destination stage at the dropped position
- **AND** the move does not initiate an agent execution

#### Scenario: Prohibited drop
- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage and cancels the confirmation
- **THEN** the task remains in its current stage and its position is unchanged

#### Scenario: Drop without a worktree
- **WHEN** the user drops a task that has no worktree on a permitted stage
- **THEN** the move completes without asking whether to create a worktree

### Requirement: Bulk task deletion
The board SHALL provide an explicit selection mode that presents a selection control on each card and disables card dragging while active. The user SHALL be able to select multiple tasks across visible stages. A bulk deletion SHALL require one confirmation and SHALL apply the individual task deletion semantics to each eligible task. A task SHALL be skipped when any of its conversations is active through a running turn or unsettled background work, it has a pending operation or transition, or its worktree has local changes. The board SHALL report skipped tasks and their reasons, and SHALL leave those tasks selected. Leaving selection mode SHALL clear the selection.

#### Scenario: Enter selection mode and select tasks
- **WHEN** the user enters selection mode and activates cards in more than one stage
- **THEN** the board marks the selected tasks and disables dragging for them

#### Scenario: Delete eligible tasks
- **WHEN** the user confirms deletion of a selection whose tasks are eligible
- **THEN** each eligible task is deleted with the individual deletion semantics and the selection is cleared

#### Scenario: Skip a task with a running conversation
- **WHEN** the user confirms deletion of a selection that includes a task with a running turn or unsettled background work
- **THEN** that task is not deleted, its reason is reported, and it remains selected

#### Scenario: Skip a task with local worktree changes
- **WHEN** the user confirms deletion of a selection that includes a task whose worktree has local changes
- **THEN** that task is not deleted, its reason is reported, and it remains selected

#### Scenario: Leave selection mode
- **WHEN** the user leaves selection mode
- **THEN** the selection is cleared and normal card dragging is restored

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

### Requirement: Execution activity is independent of workflow and attention
The board SHALL represent task execution state independently of the task's workflow stage and of its unread, awaiting-reply, and failure attention indicators. Execution state SHALL consist of two distinct facts. Turn execution SHALL mean that at least one of the task's conversations is running an assistant turn. Background activity SHALL mean that the task owns unsettled work other than a turn, such as jobs, subagents, or schedules. Both facts SHALL aggregate across all of the task's conversations rather than only the currently selected conversation. Completing or failing an execution SHALL NOT, by itself, redefine the task's workflow stage. A task SHALL be presented as running a turn only while an assistant turn is active; background work that outlives the turn SHALL be presented as background activity instead.

#### Scenario: Activity in a nonselected task conversation
- **WHEN** a task conversation is executing while another task tab is selected
- **THEN** the board still represents that task's execution state

#### Scenario: Execution completion does not imply workflow completion
- **WHEN** an execution finishes in a task whose workflow stage is In Progress
- **THEN** the task remains in In Progress unless a separate stage change is requested

#### Scenario: Background work after the turn ends
- **WHEN** an assistant turn ends in a task while a job, subagent, or schedule owned by that task is still unsettled
- **THEN** the board no longer presents the task as running a turn
- **AND** the board presents that remaining work as background activity

#### Scenario: All execution activity settles
- **WHEN** the last turn and the last background activity for a task have settled
- **THEN** the board presents neither a turn execution state nor background activity for that task

### Requirement: Coexisting attention indicators across task conversations
The board SHALL aggregate attention information across all conversations belonging to a task. It SHALL distinguish blue unread-message indicators, orange awaiting-reply indicators, and red failure indicators. Simultaneously applicable indicators SHALL coexist rather than collapse to a single highest-priority indicator. Those attention indicators SHALL also coexist with the turn execution and background activity presentation rather than replacing one another. Background activity SHALL present a count of the task's unsettled activities; counts are not required for the blue, orange, or red attention indicators.

#### Scenario: Attention from a nonselected conversation
- **WHEN** an unread message, awaiting-reply state, or failure is present in a task conversation that is not selected
- **THEN** the corresponding task-level attention indicator is still represented on the board

#### Scenario: Multiple attention states coexist with activity
- **WHEN** a task has unread messages, a conversation awaiting a reply, a conversation with a failure, a conversation running an assistant turn, and unsettled background activity
- **THEN** blue, orange, and red attention indicators are all represented together
- **AND** the turn execution state and the background activity count are represented separately from those attention indicators

### Requirement: Truthful and self-healing turn execution state
The board SHALL stop presenting a task's turn execution state when the assistant turn ends, without requiring another session event, a reload, or any user action. The board SHALL NOT present a turn as running when no task conversation is running an assistant turn. When an activity update is missed or a transient read fails, the board SHALL recover the correct execution state within at most two seconds. Background activity SHALL NOT be presented as a running turn.

#### Scenario: Turn end clears the card
- **WHEN** the assistant turn of the only active task conversation ends
- **THEN** the card stops presenting the turn execution state without user action and without waiting for another session event

#### Scenario: A missed activity update self-heals
- **WHEN** the last activity update for a conversation is missed or a transient read fails
- **THEN** the board presents the correct execution state within two seconds

#### Scenario: Background work never reads as a turn
- **WHEN** the only active work for a task is a job, subagent, or schedule
- **THEN** the task is not presented as running a turn

### Requirement: Visible execution state on task cards
A task card SHALL present turn execution through a visible working indicator and a distinct card accent rather than a text label alone. The indicator SHALL remain legible in the host's light and dark appearances and SHALL follow the host theme. The working state SHALL be announced to assistive technology when it begins, and periodic animation updates SHALL NOT be announced. The card SHALL follow the host's reduced-motion preference by keeping the indicator and accent visible without animation. When the task owns background activity, the card SHALL present a separate background indicator that shows the number of unsettled activities and makes their labels available on hover and to assistive technology. The background indicator SHALL be visually quieter than the working indicator, and it SHALL be present on its own when no turn is running.

#### Scenario: Card shows a running turn
- **WHEN** a task is running an assistant turn
- **THEN** its card shows the working indicator and the card accent
- **AND** the working state is announced once to assistive technology

#### Scenario: Card shows background work only
- **WHEN** a task's turn has ended and it still owns unsettled background work
- **THEN** its card shows the background indicator with the activity count and no working indicator

#### Scenario: Background labels are available
- **WHEN** the user points at or focuses the background indicator
- **THEN** the labels of the task's unsettled activities are available
- **AND** the labels are exposed to assistive technology

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion
- **THEN** the working indicator and card accent remain visible without animation

#### Scenario: Theme appearance
- **WHEN** the host application uses its light or dark appearance
- **THEN** the working and background indicators remain legible and use host theme colors

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

### Requirement: Run a stage instruction from a card
When a task's current stage has an entry instruction, its card SHALL expose a run action only while the current entry into that stage is unresolved. The entry SHALL be unresolved when a persisted entry marker exists for the current stage and no successful user prompt has been sent in any open conversation of the task since that entry. The marker SHALL be created on every move into an instructed stage, including a task created directly in an instructed initial stage. A same-stage reorder SHALL NOT reset the marker; leaving and re-entering the stage SHALL create a new marker. A successful user prompt in any open conversation SHALL clear the marker. An admission failure SHALL NOT clear it. A task already in an instructed stage without a marker SHALL NOT show the action until its next entry. When visible, the action SHALL send the stage's entry instruction verbatim to the task's first open conversation in conversation order; when no conversation is open, it SHALL create a new conversation and use that conversation as the target. The action SHALL NOT move the task or change its position, SHALL NOT offer a conversation picker, and SHALL NOT be available in selection mode. It SHALL be unavailable while the task has an unresolved context operation or confirmed transition. The submitted message SHALL contain only the stage instruction; the conversation's first-turn task context supplies the task context. Admission failures SHALL be reported without changing the stage or position and without creating another conversation beyond the resolved target.

#### Scenario: Show the action after a transition
- **WHEN** a card enters a stage with an entry instruction and no prompt has been sent since that entry
- **THEN** the card exposes the run action
- **AND** the task's stage and position are that of the transition

#### Scenario: Hide the action after any prompt
- **WHEN** a successful user prompt is sent in any open conversation of the task while the card remains in the instructed stage
- **THEN** the run action is no longer shown
- **AND** the task's stage and position are unchanged

#### Scenario: Report an admission failure
- **WHEN** the run action is activated and the instruction cannot be admitted
- **THEN** the failure is reported on the board
- **AND** the task's stage and position are unchanged
- **AND** the failed request does not implicitly start another run
- **AND** the run action remains available for the same entry

#### Scenario: Do not reset on same-stage reorder
- **WHEN** the card is reordered within the instructed stage
- **THEN** the entry marker is unchanged
- **AND** the action remains hidden if a prompt was already sent for that entry

#### Scenario: Reset on leaving and re-entering
- **WHEN** the card leaves the instructed stage and later enters it again
- **THEN** a new unresolved entry is created
- **AND** the action is shown again until a prompt is sent for that entry

#### Scenario: New task in an instructed initial stage
- **WHEN** a task is created directly in an instructed initial stage
- **THEN** the card exposes the run action until a prompt is sent
- **AND** the task is not moved by the action

#### Scenario: Existing task without an entry marker
- **WHEN** a task is already in an instructed stage without an entry marker
- **THEN** the card does not expose the run action
- **AND** the action becomes available only after its next entry

#### Scenario: Run an instruction from a card
- **WHEN** the user activates the run action on a card whose stage has an entry instruction and whose first conversation is open
- **THEN** the stage instruction is sent to that first open conversation
- **AND** the task's stage and position are unchanged
- **AND** no conversation picker is presented

#### Scenario: Run the instruction again
- **WHEN** a stage instruction has already been admitted and the card later re-enters that instructed stage
- **THEN** a new unresolved entry is created
- **AND** the action is available and sends the current stage instruction again to the resolved target

#### Scenario: Run when every conversation is closed
- **WHEN** the user activates the run action and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** the stage instruction is sent to that new conversation
- **AND** the task's stage and position are unchanged

#### Scenario: Reject a changed instruction
- **WHEN** the stage's entry instruction changes after the card action was displayed and the user activates the action
- **THEN** the run is rejected
- **AND** the task, its stage, and its conversations are unchanged
- **AND** the user can review and run the current instruction

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

### Requirement: Narrower board columns
The board SHALL render workflow columns with a 240px default width, 20% narrower than the previous 300px default, and a 208px minimum. Content-driven column heights and horizontal board scrolling SHALL remain available.

#### Scenario: Render the narrower default columns
- **WHEN** the board renders a workflow column slot at its default width
- **THEN** the slot is 240px wide
- **AND** the column keeps its content-driven height and the board scrolls horizontally when needed

### Requirement: Board header clears collapsed-sidebar window chrome
When the host sidebar is fully collapsed on macOS, the Kanban board header SHALL offset its leading content by the host-published frame leading clearance so the title, subtitle, and toolbar do not overlap the window traffic lights or the shell's sidebar and new-session controls. The header SHALL use its normal leading inset when the clearance is absent, SHALL use the fullscreen clearance when the host reports fullscreen, and SHALL wrap its content without clipping at supported widths.

#### Scenario: Collapse the sidebar on macOS
- **WHEN** the DSH sidebar is fully collapsed on macOS and the host publishes a frame leading clearance
- **THEN** the board header's leading content starts after that clearance
- **AND** the Kanban title, subtitle, and toolbar do not sit under the traffic lights or shell controls

#### Scenario: Keep the normal inset when expanded
- **WHEN** the sidebar is expanded or the host publishes no frame leading clearance
- **THEN** the board header uses its normal leading inset

#### Scenario: Keep the fullscreen clearance
- **WHEN** the collapsed macOS window is fullscreen and the host publishes the smaller clearance
- **THEN** the header clears the remaining shell controls without reserving the traffic-light band

#### Scenario: Wrap at a narrow width
- **WHEN** the board header is narrower than its title, subtitle, and toolbar together
- **THEN** the header content wraps or reflows without clipping or overlapping the window chrome

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

### Requirement: Explicit confirmation for a restricted transition
When a user requests a transition that the active board's workflow does not permit, the system SHALL require explicit confirmation before moving the task. The confirmation SHALL identify the task, the source stage, and the destination stage, and SHALL state that the override affects only that card and does not change that board's workflow configuration. Cancel SHALL receive the initial action focus. Canceling SHALL leave the task's stage and position unchanged and SHALL NOT send an agent instruction. Confirming SHALL move the task and SHALL NOT modify the workflow configuration or initiate an agent execution. If the confirmed move fails, the confirmation SHALL remain the active context, present the failure, and offer a retry that revalidates the task and the active board's workflow; it SHALL NOT present the task as moved. When the task or destination no longer matches the confirmed context, the system SHALL report the failure without offering a retry that cannot succeed.

#### Scenario: Confirm a restricted transition
- **WHEN** the user confirms a restricted transition
- **THEN** the task moves to the destination stage
- **AND** the board's workflow configuration is unchanged
- **AND** the move does not initiate an agent execution

#### Scenario: Cancel a restricted transition
- **WHEN** the user cancels a restricted transition
- **THEN** the task remains in its current stage and position
- **AND** no agent instruction is sent

#### Scenario: Identify the override consequence
- **WHEN** the confirmation is presented
- **THEN** it identifies the task, the source stage, and the destination stage
- **AND** it states that only the card is affected and the workflow is not changed
- **AND** Cancel receives the initial action focus

#### Scenario: Failure remains in the confirmation context
- **WHEN** a confirmed restricted move is rejected
- **THEN** the confirmation remains the active context and presents the failure
- **AND** it offers a retry that revalidates the current task and workflow
- **AND** it does not present the task as moved

#### Scenario: Retry revalidates the confirmed context
- **WHEN** the user retries a rejected restricted move after the blocking condition is resolved
- **THEN** the retry re-reads the current task and workflow before sending the move
- **AND** the move proceeds only when the confirmed source and destination still apply

#### Scenario: Stale context does not offer a pointless retry
- **WHEN** the task has left the confirmed source stage or the destination stage no longer exists
- **THEN** the confirmation reports the changed context
- **AND** it does not offer a retry that cannot succeed
