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

Each board SHALL support its own workflow configuration in YAML, including the initial stage, grouped columns, allowed transitions, optional stage entry instructions, each stage's stored placement, each stage's stored size, and the board's default presentation. The active board's workflow SHALL be used for rendering, transitions, and task creation. The product SHALL honor configured transition restrictions by requiring explicit confirmation before a restricted transition can proceed, and it SHALL honor column grouping. This version SHALL NOT implement WIP limits and SHALL NOT introduce reusable workflow templates.

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

#### Scenario: Read a stage's stored size

- **WHEN** the active board's workflow stores a size for a stage
- **THEN** the board presents that stage at that size, bounded by the minimum size

#### Scenario: Reject an invalid stage size

- **WHEN** a workflow configuration stores a stage size that is not a finite number, is below the minimum, or lies outside the accepted range
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Do not enforce a WIP capacity

- **WHEN** a user makes an otherwise permitted move into a stage that already contains tasks
- **THEN** the board does not reject the move because of a WIP capacity limit

#### Scenario: Validate against the active board's workflow

- **WHEN** the user edits the workflow of the active board
- **THEN** the editor validates that board's YAML
- **AND** no other board's workflow is read or replaced

#### Scenario: Reject an unsupported default presentation

- **WHEN** a workflow configuration sets a default presentation other than the column board or the workflow diagram
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

### Requirement: Top-level task creation
The active board SHALL provide one New task action at the top of its workflow's configured initial column. It SHALL collect a title, description, and project from the active Hub's project registry. The project input SHALL start unselected and SHALL be required; the board SHALL NOT preselect a project, including when a project filter is active. Saving a new task SHALL place it in the active board's configured initial stage without creating a native DSH conversation and without initiating an agent execution. The board header SHALL NOT provide a separate New task action.

#### Scenario: Open task creation from the board
- **WHEN** the user selects the New task action at the top of the active board's configured initial column
- **THEN** the creation experience provides title, description, and project inputs without asking the user to choose a stage
- **AND** the project input is unselected
- **AND** the project list contains only projects owned by the active Hub

#### Scenario: Create into a customized initial stage
- **WHEN** the user saves a new task and the active board's workflow has a configured initial stage
- **THEN** the task is created in that stage with the supplied title, description, and project
- **AND** the task belongs to the active board
- **AND** no native DSH conversation or workspace is created
- **AND** task creation does not initiate an agent execution

#### Scenario: Require an explicit project choice
- **WHEN** the user opens New task with one or more registered Hub projects and does not select a project
- **THEN** the task cannot be created
- **AND** no project is silently chosen from the project list or the active project filter

#### Scenario: No task creation without a board
- **WHEN** the active Hub has no boards
- **THEN** the board surface presents the create-board empty state
- **AND** no New task action is available

#### Scenario: Start the first conversation after creation
- **WHEN** the user opens a newly created task's Conversations section
- **THEN** the task has no native conversation
- **AND** the section presents the explicit start state defined by `task-conversations`

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

### Requirement: Execution preparation before a task's first execution
When a user move into an instructed stage or a card run action would start a task's first execution — the task has no native conversation — the system SHALL present one execution preparation before applying the move or admitting the instruction. The preparation SHALL contain the worktree choice defined by the Worktree choice before a card's first execution requirement in `worktree-management` when that choice applies, and the model selection defined by Model selection for the first conversation in `task-conversations` when DSH's native model selector is available. When the task already has a conversation, or when neither part applies, the system SHALL NOT present the preparation and SHALL follow the current move and run behavior. A restricted-transition confirmation SHALL be presented before the preparation; canceling that confirmation SHALL present nothing else. The preparation SHALL NOT start an agent execution and SHALL NOT change the task's stage or position. Completing the preparation SHALL leave the move or run action to proceed as defined by its own requirement. Canceling the preparation after it created a worktree or the first conversation SHALL keep those resources and SHALL leave the task's stage and position unchanged. The preparation SHALL NOT be presented for a same-stage reorder or by an automatic advance.

#### Scenario: Prepare the first instructed drop
- **WHEN** the user drops a task that has no conversation on a permitted stage with an entry instruction
- **THEN** the board presents the execution preparation before moving the task
- **AND** the task remains in its source stage and position until the preparation completes
- **AND** no agent instruction is sent by the preparation

#### Scenario: Prepare the first run from a card
- **WHEN** the user activates the run action on a card whose task has no conversation
- **THEN** the board presents the execution preparation before creating a conversation or admitting the instruction
- **AND** the task's stage and position are unchanged throughout the preparation

#### Scenario: Present the preparation after a restricted confirmation
- **WHEN** the confirmed destination would start the task's first execution
- **THEN** the restricted-transition confirmation is presented first
- **AND** the preparation is presented only after that confirmation
- **AND** canceling the preparation leaves the task in its current stage and position

#### Scenario: Skip the preparation when the task has a conversation
- **WHEN** a task already has a conversation and the user drops it on an instructed stage or activates its run action
- **THEN** no execution preparation is presented
- **AND** the move or run behavior follows its own requirement

#### Scenario: Skip the preparation when nothing applies
- **WHEN** the task has no conversation but neither a worktree choice nor a model selection applies
- **THEN** no execution preparation is presented
- **AND** the move or run behavior follows its own requirement

#### Scenario: Cancel before any resource exists
- **WHEN** the user cancels the preparation before a worktree or the first conversation has been created
- **THEN** no worktree, branch, or conversation is created
- **AND** the task's stage, position, and conversations are unchanged

#### Scenario: Cancel after provisioning
- **WHEN** the user cancels the preparation after it created a worktree or the first conversation
- **THEN** the created worktree and conversation are kept
- **AND** the task's stage and position are unchanged
- **AND** no agent instruction is sent

### Requirement: Direct stage manipulation on the board
The task card SHALL NOT provide an independent stage selector. A user SHALL change a task's stage through board drag and drop or through the stage control in the open task drawer. A stage change that requests no position, including a drawer stage change and a confirmed restricted drawer change, SHALL place the task at the top of the destination stage. A drag SHALL present a distinct dragged representation and a drop indicator, and a drop SHALL place the task at the dropped position, including before a chosen card and after the last card of the destination stage. Dropping on a permitted stage SHALL move the task immediately, whether or not that stage has an entry instruction, except when the drop would start the task's first execution: that drop SHALL present the execution preparation defined by Execution preparation before a task's first execution, and the move SHALL follow the preparation. Hovering a restricted stage during a drag SHALL present a distinct warning affordance. Dropping on a restricted stage SHALL require explicit confirmation before moving the task; canceling SHALL leave the task's stage and position unchanged. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement; neither the drop, the drawer stage change, nor a restricted-move confirmation SHALL initiate an execution. Dropping within the current stage SHALL reorder the task relative to its neighbors without arming a new timed instruction. A prohibited or canceled change SHALL leave the task unchanged. The board SHALL offer worktree creation during a drop only through that execution preparation. The host's automatic advance, defined by Automatic advance after a completed turn, SHALL NOT be presented as board stage manipulation, SHALL NOT add a card stage selector, and SHALL NOT require a confirmation.

#### Scenario: Move to an uninstructed stage by drag and drop
- **WHEN** the user drops a task on a permitted stage that has no entry instruction
- **THEN** the task appears in that stage immediately
- **AND** the task appears at the dropped position
- **AND** the move does not initiate an agent execution
- **AND** no timed instruction is armed

#### Scenario: Change the stage from the drawer
- **WHEN** the user selects a permitted destination in the open task drawer's stage control
- **THEN** the task appears at the top of the destination stage immediately
- **AND** the task is placed before every card that stage already contained
- **AND** the board presents the new position without a board drag
- **AND** the change does not initiate an agent execution

#### Scenario: Confirm a restricted drawer change
- **WHEN** the user confirms the restricted-transition confirmation for a destination selected in the open task drawer
- **THEN** the task appears at the top of the destination stage
- **AND** the change does not initiate an agent execution

#### Scenario: Reorder within the current stage
- **WHEN** the user drops a task at a new position within its current stage
- **THEN** the task is placed at that position and the new order is retained
- **AND** no new timed instruction is armed
- **AND** a countdown already active for the current entry remains active

#### Scenario: Drop on an instructed stage
- **WHEN** the user drops a task that already has a conversation on a permitted stage that has an entry instruction
- **THEN** the task moves to that stage immediately
- **AND** the task appears at the dropped position
- **AND** the drop does not initiate an agent execution
- **AND** a five-second countdown for that entry is armed
- **AND** the card exposes the countdown control

#### Scenario: Prepare the first instructed drop
- **WHEN** the user drops a task that has no conversation on a permitted stage that has an entry instruction
- **THEN** the board presents the execution preparation before moving the task
- **AND** the task remains in its source stage and position until the preparation completes
- **AND** after the preparation the task moves to the dropped position and the countdown for that entry is armed

#### Scenario: Prepare the first instructed drawer change
- **WHEN** the user selects a permitted instructed destination in the drawer's stage control for a task that has no conversation
- **THEN** the board presents the execution preparation before moving the task
- **AND** the task remains in its source stage and position until the preparation completes
- **AND** after the preparation the task moves to the top of the destination stage and the countdown for that entry is armed

#### Scenario: Warn while hovering a restricted stage
- **WHEN** the user drags a task over a stage that the workflow does not permit from its current stage
- **THEN** the board presents a distinct warning affordance before the drop
- **AND** the task remains in its current stage until a drop is confirmed

#### Scenario: Restricted drop asks for confirmation
- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage
- **THEN** the board asks for explicit confirmation before moving the task
- **AND** the task remains in its current stage until the user confirms

#### Scenario: Confirm a restricted drop
- **WHEN** the user confirms the restricted-drop confirmation for a task that already has a conversation
- **THEN** the task appears in the destination stage at the dropped position
- **AND** the move does not initiate an agent execution
- **AND** if the destination has an entry instruction, its timed instruction is armed

#### Scenario: Prohibited drop
- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage and cancels the confirmation
- **THEN** the task remains in its current stage and its position is unchanged

#### Scenario: Drop without a worktree
- **WHEN** the user drops a task that has no worktree and no conversation on a permitted instructed stage
- **THEN** the execution preparation asks whether to create a worktree
- **AND** the task remains in its current stage and position until the preparation completes

#### Scenario: Advance without board manipulation
- **WHEN** an automatic advance moves a task
- **THEN** the card does not present a stage selector
- **AND** no confirmation or drop indicator is shown

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
The board SHALL represent task execution state independently of the task's workflow stage and of its unread, awaiting-reply, and failure attention indicators. Execution state SHALL consist of two distinct facts. Agent execution SHALL mean that at least one agent owned by the task's conversations is running: a conversation's own assistant turn or an owned native subagent descendant. Background activity SHALL mean that the task owns unsettled work other than agent execution, such as jobs or schedules. Both facts SHALL aggregate across all of the task's conversations rather than only the currently selected conversation. Completing or failing an execution SHALL NOT, by itself, redefine the task's workflow stage. A task SHALL be presented as working while at least one owned agent is running, including when the main turn has ended and only an owned subagent descendant is still running. Work that is not agent execution and outlives the turn SHALL be presented as background activity instead.

#### Scenario: Activity in a nonselected task conversation
- **WHEN** a task conversation is executing while another task tab is selected
- **THEN** the board still represents that task's execution state

#### Scenario: Execution completion does not imply workflow completion
- **WHEN** an execution finishes in a task whose workflow stage is In Progress
- **THEN** the task remains in In Progress unless a separate stage change is requested

#### Scenario: Subagent work after the main turn ends
- **WHEN** an assistant turn ends in a task while an owned subagent descendant is still running
- **THEN** the board keeps presenting the task as working
- **AND** the running subagent is not presented as background activity

#### Scenario: Background work after the turn ends
- **WHEN** an assistant turn ends in a task while a job or schedule is still unsettled and no owned agent is running
- **THEN** the board no longer presents the task as working
- **AND** the board presents that remaining work as background activity

#### Scenario: All execution activity settles
- **WHEN** the last owned agent and the last background activity for a task have settled
- **THEN** the board presents neither an agent execution state nor background activity for that task

### Requirement: Coexisting attention indicators across task conversations

The board SHALL derive attention per task conversation and aggregate it across all conversations belonging to a task. It SHALL distinguish blue unread-message indicators, orange awaiting-reply indicators, and red failure indicators. Blue and red SHALL be derived by the conversation's last settled assistant turn and its stored per-conversation read acknowledgment: unread SHALL mean that the conversation has a settled turn newer than its acknowledgment, and failure SHALL mean that the settled turn ended with an error outcome and is still unread. Blue and red SHALL NOT be presented while any agent owned by that conversation is running. The orange indicator SHALL reflect a live awaiting-reply state and SHALL NOT require acknowledgment. Attention SHALL be derived from durable conversation facts and the stored acknowledgment, SHALL survive a reload or plugin restart, and SHALL NOT depend on a per-client native unread transition. A conversation with no stored acknowledgment SHALL present its last settled turn as unread. Simultaneously applicable indicators SHALL coexist rather than collapse to a single highest-priority indicator. Those attention indicators SHALL also coexist with the card's agent execution accent rather than replacing one another.

Background activity SHALL remain derived per task as the unsettled work other than agent execution, and SHALL NOT be presented on the task card. It SHALL remain available through the task drawer's section navigation, whose Conversations entry SHALL expose the number of unsettled activities and their labels on hover and to assistive technology.

#### Scenario: Attention from a nonselected conversation

- **WHEN** an unread message, awaiting-reply state, or failure is present in a task conversation that is not selected
- **THEN** the corresponding task-level attention indicator is still represented on the board

#### Scenario: Multiple attention states coexist with activity

- **WHEN** a task has unread messages, a conversation awaiting a reply, a conversation with a failure, and a conversation running an owned agent
- **THEN** blue, orange, and red attention indicators are all represented together
- **AND** the agent execution accent is represented separately from those attention indicators

#### Scenario: Background activity leaves the card

- **WHEN** a task owns unsettled jobs or schedules
- **THEN** its card does not present a background activity indicator
- **AND** the task drawer's Conversations section entry presents the background activity count and labels on hover and to assistive technology

#### Scenario: Unread waits for every owned agent to finish

- **WHEN** a conversation's assistant turn ends while an owned subagent descendant is still running
- **THEN** the board does not present that conversation's settled turn as unread or failed
- **AND** the board presents the settled turn as unread once the last owned agent finishes

#### Scenario: Reading a conversation clears its indicators

- **WHEN** a conversation with an unread or failed settled turn is read in the task drawer
- **THEN** the board stops presenting that conversation's blue and red indicators
- **AND** a reload does not bring the cleared indicators back

#### Scenario: Unread survives a reload

- **WHEN** a turn settles while no conversation content is being read
- **THEN** the board presents the conversation as unread after a reload

#### Scenario: A conversation never read stays unread

- **WHEN** a conversation has a settled turn and no stored acknowledgment
- **THEN** the board presents the unread indicator for that turn

#### Scenario: A later error marks the conversation again

- **WHEN** a read conversation later settles a new turn with an error outcome
- **THEN** the board presents the failure indicator for that new settled turn

### Requirement: Truthful and self-healing turn execution state
The board SHALL stop presenting a task's agent execution when the last agent owned by its conversations finishes, without requiring another session event, a reload, or any user action. The board SHALL NOT present agent execution when no owned agent is running. When an activity update is missed or a transient read fails, the board SHALL recover the correct execution state within at most two seconds. Background activity SHALL NOT be presented as agent execution.

#### Scenario: Turn end clears the card
- **WHEN** the assistant turn of the only active task conversation ends and no owned subagent descendant is running
- **THEN** the card stops presenting the agent execution state without user action and without waiting for another session event

#### Scenario: A running subagent keeps the card working
- **WHEN** a conversation's assistant turn ends while an owned subagent descendant is still running
- **THEN** the card keeps presenting the agent execution state until that descendant finishes

#### Scenario: A missed activity update self-heals
- **WHEN** the last activity update for a conversation is missed or a transient read fails
- **THEN** the board presents the correct execution state within two seconds

#### Scenario: Background work never reads as a turn
- **WHEN** the only active work for a task is a job or schedule
- **THEN** the task is not presented as running an agent

### Requirement: Task card layout

The board SHALL render each task as a card composed of distinct regions in a fixed order: a title region, a context region, an activity region, and a status region. The context region SHALL present the task's project name and its unread, awaiting-reply, and failure attention indicators. The activity region SHALL present the auto-mode control defined by Auto mode on a task card, the stage run action defined by Run a stage instruction from a card, and the advance action defined by Advance a task from its card, kept on one line at the trailing edge of the card. The status region SHALL present unresolved context-operation, confirmed-transition, and automatic-advance state as defined by Task card status strip. The card's agent execution state SHALL be presented by the execution accent defined by Execution accent on task cards and SHALL NOT occupy a region of its own.

The project name SHALL remain visible on every card, SHALL be visually quieter than the title, and SHALL expose the complete name when the available width truncates it. The title SHALL NOT be clamped to a fixed number of lines. In selection mode the card SHALL present its selection control at the leading edge of the context region. The whole card surface SHALL remain activatable as defined by Open a task drawer, except for nested controls, which SHALL perform their own action without opening the drawer.

#### Scenario: Present the card regions in order

- **WHEN** a task card renders
- **THEN** the title, the context region, the activity region, and the status region appear in that order
- **AND** the project name and the attention indicators are in the context region
- **AND** the auto-mode control, the run action, and the advance action are in the activity region

#### Scenario: Keep a long title readable

- **WHEN** a task title is wider than the card
- **THEN** the title wraps onto additional lines without a fixed line clamp
- **AND** the complete title remains available to assistive technology

#### Scenario: Keep a long project name available

- **WHEN** a project name is wider than the context region
- **THEN** the context region truncates the visible name
- **AND** the complete project name is available on hover and to assistive technology

#### Scenario: Place the selection control

- **WHEN** the board is in selection mode
- **THEN** each card presents its selection control at the leading edge of the context region
- **AND** the card does not overlay the control on the title region
- **AND** the auto-mode control, the run action, and the advance action are not presented in selection mode

#### Scenario: Place the auto-mode control

- **WHEN** a task card renders outside selection mode
- **THEN** the auto-mode control appears in the activity region
- **AND** it keeps its label and its state indicator
- **AND** activating it does not open the task drawer and does not begin a drag

#### Scenario: Share the activity row

- **WHEN** a card presents the auto-mode control together with the run action or the advance action
- **THEN** the controls share one row in the activity region
- **AND** they present the same control height and the same pill styling

#### Scenario: Omit an empty status region

- **WHEN** a card has no unresolved context operation, confirmed transition, automatic-advance state, or run-action failure
- **THEN** the card presents no status-region content

### Requirement: Single-line activity strip on task cards

The card's activity region SHALL keep its content on one line. It SHALL present the auto-mode control, the stage run action or its countdown control, and the advance action at the trailing edge, and it SHALL NOT present a background activity indicator. The card SHALL reserve the activity region's height in every task state, so that starting or ending a turn, or showing or hiding the run and advance actions, SHALL NOT change the card's height. The controls SHALL share one row and SHALL NOT add a separate action row.

#### Scenario: Label a single background kind

- **WHEN** a task owns unsettled activities of exactly one kind
- **THEN** the card presents no background activity indicator
- **AND** the task drawer's Conversations section entry presents that kind's count and label

#### Scenario: Aggregate multiple background kinds

- **WHEN** a task owns unsettled activities of more than one kind
- **THEN** the card presents no background activity indicator
- **AND** the task drawer's Conversations section entry presents the total number of unsettled activities and their labels

#### Scenario: Keep the card height stable

- **WHEN** a turn starts or ends, the background count changes, or the run or advance action appears or disappears while no status is shown
- **THEN** the card keeps the same height
- **AND** the activity region keeps one line

#### Scenario: Present execution and background together

- **WHEN** a task is running a turn and also owns unsettled background work
- **THEN** the card presents the execution accent
- **AND** the task drawer's Conversations section entry presents the background activity
- **AND** the activity region stays on one line

#### Scenario: Place the run action in the activity region

- **WHEN** a card exposes the run action or its countdown control
- **THEN** the control appears at the trailing edge of the activity region
- **AND** the card does not add a separate action row

#### Scenario: Share the row with the auto-mode control

- **WHEN** a card presents the auto-mode control, the run action, and the advance action together
- **THEN** they appear on one line in the activity region
- **AND** the activity region does not wrap

#### Scenario: Place the advance action

- **WHEN** a card exposes the advance action
- **THEN** it appears at the trailing edge of the activity region, next to the run action
- **AND** it is presented in the same control style and height as the auto-mode control

### Requirement: Task card status strip
The board SHALL present a card's unresolved context operation, confirmed transition, and automatic-advance state in one status region below the activity region. Each status SHALL carry a tone that distinguishes a failure from a pending state and SHALL present a short label that names the state. A destructive operation's label SHALL use task-deletion or worktree-removal language and SHALL distinguish checking, queued, in progress, and failed states rather than exposing a raw phase token. A status SHALL remain visible while its operation or transition is unresolved. The automatic-advance status SHALL name the destination stage while an advance is admitted, name a failure when an admitted advance failed, and name the pause reason when auto mode is paused. The status region SHALL NOT report the held state defined by Auto mode on a task card, which the auto-mode control presents instead. A run-action admission failure SHALL be reported in the same status region. When a card has more than one such fact, the status region SHALL present them together without replacing one with another.

#### Scenario: Report a failed operation
- **WHEN** a card's task has a context operation in a failed phase
- **THEN** the status region presents a failure-toned status naming the failure

#### Scenario: Report a pending deletion
- **WHEN** a card's task has a queued or in-progress deletion or worktree removal
- **THEN** the status region presents a pending-toned status that names the destructive action and its queued or in-progress state
- **AND** it does not present the raw operation phase as the label

#### Scenario: Report a destructive preflight
- **WHEN** a card's task has an admitted deletion or worktree removal whose preflight is running
- **THEN** the status region presents a pending-toned status naming the destructive action as being checked
- **AND** it does not present the raw preflight phase as the label

#### Scenario: Report a failed deletion
- **WHEN** a card's task has a failed deletion or worktree removal
- **THEN** the status region presents a failure-toned status that names the destructive action as needing attention

#### Scenario: Report a pending transition
- **WHEN** a card's task has a confirmed transition that is not settled
- **THEN** the status region presents a pending-toned status naming the pending confirmation

#### Scenario: Report an advancing task
- **WHEN** a card's task has an admitted automatic advance that is not settled
- **THEN** the status region presents a pending-toned status naming the destination stage
- **AND** it does not present the advance as a user confirmation

#### Scenario: Report a failed automatic advance
- **WHEN** an admitted automatic advance fails
- **THEN** the status region presents a failure-toned status that names the automatic advance as needing attention
- **AND** the card still exposes the stage run action for an unresolved destination entry

#### Scenario: Report a paused automatic advance
- **WHEN** auto mode is paused
- **THEN** the status region presents a short label naming the pause reason
- **AND** the label distinguishes a turn that did not complete from an advance that could not be admitted

#### Scenario: Do not report the held state
- **WHEN** an armed task has pending user work
- **THEN** the status region presents no entry for the held state
- **AND** the auto-mode control presents it

#### Scenario: Present multiple statuses together
- **WHEN** a task has both an unresolved operation and a confirmed transition
- **THEN** the status region presents both statuses
- **AND** neither status replaces the other

#### Scenario: Report a run-action admission failure
- **WHEN** the run action is activated and the instruction cannot be admitted
- **THEN** the status region reports the failure
- **AND** the run action remains available for the same entry

#### Scenario: Clear a resolved status
- **WHEN** the operation, confirmed transition, or automatic-advance state resolves
- **THEN** the corresponding status is no longer presented in the status region
- **AND** reading a conversation does not clear an automatic-advance pause by itself

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
When a task's current stage has an entry instruction, its card SHALL expose a run action only while the current entry into that stage is unresolved. The entry SHALL be unresolved when a persisted entry marker exists for the current stage and no successful user prompt has been sent in any open conversation of the task since that entry. The marker SHALL be created on every move into an instructed stage, including a task created directly in an instructed initial stage. A same-stage reorder SHALL NOT reset the marker; leaving and re-entering the stage SHALL create a new marker. A successful user prompt in any open conversation SHALL clear the marker. An admission failure SHALL NOT clear it. A task already in an instructed stage without a marker SHALL NOT show the action until its next entry. While the timed instruction for the entry is counting down or being sent, the card SHALL expose the countdown control defined by the Timed stage instruction after a move requirement instead of the run action; canceling that countdown or a failed timed send SHALL expose the run action for the same unresolved entry. When visible, the action SHALL send the stage's entry instruction verbatim to the task's first open conversation in conversation order. When the task has no conversation, activating the action SHALL first present the execution preparation defined by Execution preparation before a task's first execution; when no conversation is open after the preparation, the action SHALL create a new conversation and use that conversation as the target. The action SHALL carry the entry identity it was displayed for — the entry's stage and entry timestamp — and the host SHALL reject a request for an entry that has been resolved or replaced. The action SHALL NOT move the task or change its position, SHALL NOT offer a conversation picker, and SHALL NOT be available in selection mode. It SHALL be unavailable while the task has an unresolved context operation or confirmed transition. The submitted message SHALL contain only the stage instruction; the conversation's first-turn task context supplies the task context. Admission failures SHALL be reported without changing the stage or position and without creating another conversation beyond the resolved target.

#### Scenario: Show the action after a transition
- **WHEN** a card enters a stage with an entry instruction and no prompt has been sent since that entry
- **THEN** the card exposes the countdown control for that entry
- **AND** no instruction is sent before the countdown ends
- **AND** the card exposes the run action if the countdown is canceled or its send fails
- **AND** the task's stage and position are that of the transition

#### Scenario: Restore the action after the countdown ends without sending
- **WHEN** the countdown for an unresolved entry is canceled or its send fails
- **THEN** the card exposes the run action for the same entry
- **AND** the task's stage and position are unchanged

#### Scenario: Countdown replaces the run action
- **WHEN** a move into an instructed stage arms the countdown
- **THEN** the card exposes the countdown control instead of the run action
- **AND** the run action is exposed again only after the countdown is canceled or the send fails

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
- **AND** the action is shown again by the new countdown and returns after cancel or failure

#### Scenario: New task in an instructed initial stage
- **WHEN** a task is created directly in an instructed initial stage
- **THEN** the card exposes the run action until a prompt is sent
- **AND** no countdown is armed by the creation
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

#### Scenario: Prepare the first run from a card
- **WHEN** the user activates the run action on a card whose task has no conversation
- **THEN** the execution preparation is presented before a conversation is created or the instruction is admitted
- **AND** after the preparation the instruction is sent to the conversation created by it
- **AND** the task's stage and position are unchanged

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

#### Scenario: Reject a resolved or replaced entry
- **WHEN** a run request carries an entry identity that has since been resolved or replaced
- **THEN** the request is rejected
- **AND** no instruction is sent
- **AND** the task's stage, position, and conversations are unchanged

#### Scenario: Action unavailable while the task is busy
- **WHEN** the task has an unresolved context operation, a confirmed transition, or selection mode is active
- **THEN** the run action is unavailable
- **AND** no instruction is sent

#### Scenario: No action without an entry instruction
- **WHEN** a card's current stage has no entry instruction
- **THEN** the card does not expose the run action

### Requirement: Movement never runs an agent
A user movement of a task, including into a stage with an entry instruction, SHALL update its workflow stage and position without initiating an agent execution at the time of the move. An instructed user move SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement; that scheduled execution is separate from the move. Execution SHALL otherwise require a separate explicit card run action or a user-sent message from the conversation composer. The automatic advance defined by Automatic advance after a completed turn SHALL be the only movement that dispatches the destination instruction itself, SHALL NOT arm the timed stage instruction, and SHALL NOT be available for a task whose auto mode is disabled. Optional worktree creation and directory switching SHALL follow the separate worktree-management requirements.

#### Scenario: Move to a stage without an entry instruction
- **WHEN** the user completes an allowed move to a stage without an entry instruction
- **THEN** the task appears in that stage without an agent execution being initiated by the move
- **AND** no countdown is armed

#### Scenario: Move to an instructed stage
- **WHEN** the user completes an allowed move to a stage with an entry instruction
- **THEN** the task appears in that stage without an agent execution being initiated by the move
- **AND** a five-second countdown is armed for that entry
- **AND** canceling the countdown leaves the task in that stage without an agent execution

#### Scenario: Automatic advance is not a user move
- **WHEN** the host completes an automatic advance into a stage with an entry instruction
- **THEN** the destination instruction is dispatched by the advance
- **AND** no five-second countdown is armed
- **AND** no worktree choice is requested by the advance

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
Creating a board SHALL require a name and SHALL initialize it with the default workflow. Renaming a board SHALL NOT change its tasks, workflow, conversations, or worktrees. A board SHALL be deletable only when it contains no tasks. Deleting a board that is bound to the team's shared configuration SHALL require choosing whether the removal applies only to this installation or to the team. A local-only removal SHALL remove the board locally and SHALL keep it out of later team updates. A team-wide removal SHALL remove the board locally and SHALL be included in the team's shared configuration on the next synchronization: the next explicit publish for Git, or the next automatic synchronization for Google Drive or a local folder. Deleting the last board SHALL leave the Hub with no boards and SHALL present the Hub's create-board empty state. Deleting a board SHALL NOT delete its projects, project directories, worktrees, branches, native conversations, or native workspaces.

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

#### Scenario: Choose the scope of a board removal
- **WHEN** the user deletes a board that is bound to the team's shared configuration and the board has no tasks
- **THEN** the confirmation offers removing it only from this installation or for the team
- **AND** no deletion happens before one of those choices

#### Scenario: Remove a board only from this installation
- **WHEN** the user confirms removing a published board only from this installation
- **THEN** the board disappears from this installation
- **AND** the shared document is unchanged
- **AND** later team updates do not recreate the board here

#### Scenario: Remove a board for the team
- **WHEN** the user confirms removing a published board for the team on a Git binding
- **THEN** the board disappears from this installation
- **AND** the removal is included in the next publish of that Hub

#### Scenario: Remove a board for the team on Google Drive
- **WHEN** the user confirms removing a published board for the team on a Google Drive binding
- **THEN** the board disappears from this installation
- **AND** the removal is included in the team's shared configuration on the next automatic synchronization

#### Scenario: Remove a board for the team on a local folder
- **WHEN** the user confirms removing a published board for the team on a local folder binding
- **THEN** the board disappears from this installation
- **AND** the removal is written into `kanban-hub.yaml` on the next automatic synchronization

#### Scenario: Delete the last board
- **WHEN** the user confirms deletion of the only board in a Hub and that board has no tasks
- **THEN** the board is removed and the Hub presents its create-board empty state

### Requirement: Board selection and persistence
The Kanban page SHALL present the boards of the active Hub as tabs below the Hub tabs. The active board SHALL be retained per Hub across reloads in browser local storage. When the remembered board no longer exists, the plugin SHALL select the first available board. Switching boards SHALL reset board-scoped search, project filter, selection mode, and the open task drawer. Switching boards SHALL NOT stop, move, or otherwise affect task execution or a pending timed stage instruction armed for a task on either board.

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

#### Scenario: Keep a pending timed instruction on switch
- **WHEN** the user switches to another board or Hub while a timed stage instruction countdown is active
- **THEN** the countdown keeps running
- **AND** the instruction is sent when the remaining time elapses unless it is canceled
- **AND** the switch does not send, cancel, or duplicate the instruction

### Requirement: Board attention aggregation
The board tab SHALL present aggregated attention for all tasks on that board. Attention SHALL consist of the unread indicator, the awaiting-reply indicator, the failure indicator, and a running-task indicator. The unread, awaiting-reply, and failure indicators SHALL be presented first, in that order, and the running-task indicator SHALL follow them. The running-task indicator SHALL be presented as a pulsing ring in the host accent with an adjacent numeral, and SHALL be present whenever at least one task on the board is running, including when exactly one task is running. The numeral SHALL be the number of running tasks, counting each task once regardless of how many agents, subagents, jobs, or schedules it owns. A task SHALL count as running while it has a running agent turn, an owned subagent still running after the turn ends, or unsettled background work such as jobs or schedules. The numeral SHALL be legible in the host's light and dark appearances, SHALL use tabular figures so the board label does not shift as the count changes, and SHALL remain visible without animation when the host prefers reduced motion. Hovering the indicator SHALL expose the titles of the running tasks. The board tab's accessible name SHALL include the running-task count. The unread, awaiting-reply, and failure indicators SHALL coexist with the running-task indicator. The running-task indicator SHALL communicate both the presence and the number of running tasks rather than a static status color alone. The running count SHALL clear when no task on the board is running. Attention on a board that is not active SHALL remain visible on its tab.

#### Scenario: Aggregate unread activity on the board tab
- **WHEN** a task on a board has unread activity
- **THEN** that board's tab presents an unread indicator

#### Scenario: Aggregate awaiting reply on the board tab
- **WHEN** a task on a board is awaiting the user's reply
- **THEN** that board's tab presents an awaiting-reply indicator

#### Scenario: Aggregate execution on the board tab
- **WHEN** two tasks on the same board are running
- **THEN** that board's tab presents a running-task indicator
- **AND** its numeral is 2

#### Scenario: Count a task once
- **WHEN** a task has a running agent turn and also owns unsettled jobs
- **THEN** that task contributes 1 to the board's running-task count

#### Scenario: Keep counting an owned subagent
- **WHEN** a task's assistant turn ends while an owned subagent descendant is still running
- **THEN** that task still contributes 1 to the board's running-task count

#### Scenario: Count background work without an agent
- **WHEN** a task on the board owns only unsettled background work and no agent is running
- **THEN** that task contributes 1 to the board's running-task count

#### Scenario: Order the running count after the attention indicators
- **WHEN** a board tab presents unread, awaiting-reply, and failure indicators together with running tasks
- **THEN** the unread, awaiting-reply, and failure indicators appear first, in that order
- **AND** the running-task indicator appears after them

#### Scenario: Expose the running task titles on hover
- **WHEN** the user hovers the running-task indicator on a board tab
- **THEN** the exposed detail lists the titles of the running tasks on that board

#### Scenario: Announce the running count to assistive technology
- **WHEN** a board tab carries a running-task indicator numbered 2
- **THEN** the tab's accessible name includes that there are 2 running tasks

#### Scenario: Keep the ring visible without animation
- **WHEN** the host prefers reduced motion and a board has running tasks
- **THEN** the running-task indicator remains visible without animation

#### Scenario: Clear the board indicator
- **WHEN** no task on the board has unread activity, is awaiting a reply, has failed, has a running agent, has an owned subagent, or owns unsettled background work
- **THEN** the board tab presents no attention or running-task indicator

#### Scenario: Keep every attention indicator alongside the count
- **WHEN** a task on the board has unread activity, an awaiting reply, or a failure in addition to running tasks
- **THEN** the board tab presents the corresponding attention indicators together with the running-task indicator

#### Scenario: Show attention for an inactive board
- **WHEN** a task on a board in the active Hub gains unread activity, awaits a reply, or starts running while another board is active
- **THEN** the inactive board's tab presents the corresponding indicator

### Requirement: Explicit confirmation for a restricted transition
When a user requests a transition that the active board's workflow does not permit, the system SHALL require explicit confirmation before moving the task. The confirmation SHALL identify the task, the source stage, and the destination stage, and SHALL state that the override affects only that card and does not change that board's workflow configuration. Cancel SHALL receive the initial action focus. Canceling SHALL leave the task's stage and position unchanged and SHALL NOT send an agent instruction. Confirming SHALL move the task and SHALL NOT modify the workflow configuration or initiate an agent execution. When the confirmed destination would start the task's first execution, the execution preparation defined by Execution preparation before a task's first execution SHALL be presented after the confirmation and before the move; canceling that preparation SHALL leave the task in its current stage and position. If the confirmed move fails, the confirmation SHALL remain the active context, present the failure, and offer a retry that revalidates the task and the active board's workflow; it SHALL NOT present the task as moved. When the task or destination no longer matches the confirmed context, the system SHALL report the failure without offering a retry that cannot succeed.

#### Scenario: Confirm a restricted transition
- **WHEN** the user confirms a restricted transition for a task that already has a conversation
- **THEN** the task moves to the destination stage
- **AND** the board's workflow configuration is unchanged
- **AND** the move does not initiate an agent execution

#### Scenario: Prepare after a restricted confirmation
- **WHEN** the confirmed destination would start the task's first execution
- **THEN** the confirmation is accepted first
- **AND** the execution preparation is presented before the move
- **AND** canceling the preparation leaves the task in its current stage and position

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

### Requirement: Timed stage instruction after a move
When a permitted move changes a task's stage to a stage with an entry instruction, the system SHALL arm one five-second countdown for that entry. The countdown SHALL be armed for board drops and drawer stage changes. It SHALL NOT be armed for a same-stage reorder, for a task created directly in an instructed initial stage, or for a move into a stage without an entry instruction. When the task has no conversation, the countdown SHALL be armed only after the execution preparation defined by Execution preparation before a task's first execution completes, and the conversation that preparation created SHALL be the target. The target SHALL be the task's first open conversation in conversation order; when no conversation is open, the system SHALL create a new conversation and use it. When the five seconds elapse without cancellation, the system SHALL send only that stage's entry instruction to the target. Cancel SHALL stop only the automatic send: the task's stage, position, and unresolved entry SHALL remain, and the card's run action SHALL be available. A new instructed entry for the task SHALL replace the pending countdown for the previous entry. The countdown SHALL be canceled without sending when a successful user prompt resolves the entry, when the task is deleted, or when the entry marker is removed for any other reason. The card SHALL present the countdown as a control that cancels when activated. The drawer for the task SHALL present a matching countdown notice above its section panel with the same cancel action. Both notices SHALL identify the stage whose instruction will run. A countdown SHALL continue when its card is not rendered, when the Kanban panel is not visible, or when the user switches to another board or Hub. The automatic send SHALL NOT depend on the board that armed it being mounted or visible. Unsent composer text or attachments in the target conversation SHALL NOT prevent the send and SHALL remain unchanged. The countdown SHALL NOT be persisted: a reload or plugin restart SHALL send nothing and SHALL leave the entry unresolved with its run action available. A failed timed send SHALL stop the countdown, report the failure on the card and in the drawer notice, restore the run action for the unresolved entry, and SHALL NOT retry automatically. When admission reports that the entry was already resolved, the countdown SHALL end without reporting a failure. The delay SHALL be fixed at five seconds and SHALL NOT be configurable.

#### Scenario: Arm on a board drop
- **WHEN** the user drops a card on a permitted stage with an entry instruction
- **THEN** the card exposes a countdown for that entry
- **AND** no instruction is sent while the countdown is active

#### Scenario: Arm on a drawer stage change
- **WHEN** the user selects a permitted instructed destination from the drawer's stage control
- **THEN** the drawer presents the countdown notice for that entry
- **AND** the card exposes the countdown control for the same entry

#### Scenario: Arm after the first-execution preparation
- **WHEN** a task without a conversation is dropped on a permitted stage with an entry instruction and the execution preparation completes
- **THEN** the countdown for that entry is armed only after the preparation
- **AND** the target is the conversation created by the preparation

#### Scenario: Send only the instruction on expiry
- **WHEN** the five-second countdown ends without cancellation
- **THEN** only the stage's entry instruction is sent to the task's first open conversation
- **AND** the unresolved entry is resolved
- **AND** no conversation picker or confirmation is presented

#### Scenario: Create a conversation when none is open
- **WHEN** the countdown ends and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** only the stage's entry instruction is sent to that new conversation
- **AND** the task's stage and position are unchanged

#### Scenario: Cancel from the card
- **WHEN** the user activates the card's countdown control before it ends
- **THEN** no instruction is sent
- **AND** the task remains in the destination stage at the same position
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: Cancel from the drawer
- **WHEN** the user activates the cancel action in the drawer's countdown notice
- **THEN** no instruction is sent
- **AND** the countdown disappears on the card and in the drawer
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: Manual prompt cancels the countdown
- **WHEN** a successful user prompt resolves the entry before the countdown ends
- **THEN** the countdown stops without sending the instruction
- **AND** no second instruction is sent

#### Scenario: New instructed entry replaces the countdown
- **WHEN** the task moves again into another instructed stage before the countdown ends
- **THEN** the previous countdown no longer sends
- **AND** a new countdown for the new entry is armed

#### Scenario: No countdown on a same-stage reorder
- **WHEN** the user reorders the card within its current stage
- **THEN** no new countdown is armed
- **AND** an active countdown for the current entry keeps running

#### Scenario: No countdown for task creation
- **WHEN** a task is created directly in an instructed initial stage
- **THEN** no countdown is armed
- **AND** the card exposes the run action for the new entry

#### Scenario: Continue when the card is not visible
- **WHEN** the card is hidden by search, a project filter, selection mode, or another panel before the countdown ends
- **THEN** the countdown keeps running
- **AND** the instruction is sent when the remaining time elapses unless it is canceled

#### Scenario: Continue across board and Hub switches
- **WHEN** the user switches to another board or Hub before the countdown ends
- **THEN** the countdown keeps running
- **AND** the instruction is sent when the remaining time elapses unless it is canceled
- **AND** the unresolved entry is resolved for the task on its own board

#### Scenario: Send while the Kanban panel is hidden
- **WHEN** the countdown ends while the Kanban panel is not visible and its board is not mounted
- **THEN** only the stage's entry instruction is sent to the resolved target
- **AND** the unresolved entry is resolved without requiring the board to be reopened

#### Scenario: Unsent draft does not block the send
- **WHEN** the target conversation has unsent composer text or attachments when the countdown ends
- **THEN** the stage instruction is sent anyway
- **AND** the unsent text and attachments remain unchanged

#### Scenario: Failed timed send restores the run action
- **WHEN** the timed instruction cannot be admitted or sent
- **THEN** the countdown stops
- **AND** the failure is reported on the card and in the drawer notice
- **AND** the run action remains available for the unresolved entry
- **AND** no automatic retry occurs

#### Scenario: Changed instruction fails visibly
- **WHEN** the stage's entry instruction changes before the countdown ends
- **THEN** the timed send is rejected
- **AND** the failure is reported on the card and in the drawer notice
- **AND** the run action remains available for the unresolved entry
- **AND** no replacement instruction is sent automatically

#### Scenario: Already resolved at admission ends silently
- **WHEN** admission reports that the entry was resolved before the timed send
- **THEN** the countdown stops without an error notice
- **AND** no instruction is sent

#### Scenario: Reload does not send
- **WHEN** the board reloads or the plugin restarts while a countdown is active
- **THEN** no instruction is sent automatically
- **AND** the entry remains unresolved
- **AND** the card exposes the run action after reload

### Requirement: Stable board frame during commands
The active board SHALL keep its frame stable while a command is in flight. Command progress SHALL NOT insert, remove, or resize any element between the board header and the task columns, and the board SHALL NOT present a global saving indicator, either visually or through a live region. A task move or same-stage reorder SHALL be reflected in its destination position immediately, and that immediate placement SHALL be the board-level feedback for the move. Progress that a specific action needs SHALL be reported inside the surface that started it, and a command failure SHALL remain a board-level notice.

#### Scenario: Move a card without moving the board
- **WHEN** the user drops a task on a permitted stage of the active board
- **THEN** the task appears in the destination stage immediately
- **AND** the board header, the workflow columns, and the surrounding page keep their position and height while the command is in flight
- **AND** no global saving indicator or live save announcement appears

#### Scenario: Same-stage reorder keeps the frame stable
- **WHEN** the user drops a task within its current stage
- **THEN** the task is placed at the dropped position immediately
- **AND** the board frame does not change height while the command is in flight

#### Scenario: A command started from another surface
- **WHEN** a command started from the task drawer, a dialog, or Configuration is in flight
- **THEN** that surface reports its own progress
- **AND** the board frame does not change height or position

#### Scenario: A failed command stays visible
- **WHEN** a board command fails
- **THEN** a board-level notice states the failure
- **AND** no global saving indicator or live save announcement is added for that command

### Requirement: Board destructive-operation notice
The active board SHALL present one persistent notice above the board body while a destructive operation is queued or running, while a destructive operation needs attention, or while a deletion retained a checkout path on disk. The notice SHALL summarize in-progress and queued deletions and worktree removals with the affected task titles. For a failed operation, the notice SHALL identify the task and offer recovery actions appropriate to the recorded operation, including retry, return when permitted, and force when the failure is `SHARED_WORKTREE`. The notice SHALL update from host state without a reload, SHALL not claim success for an unresolved or failed operation, and SHALL NOT replace the drawer operation status or the card status. A completed deletion that retained a checkout path — because the checkout is not Git-managed or because the project path or Git root could not be resolved — SHALL be reported with that path and SHALL be dismissible.

#### Scenario: Show queued and in-progress deletions
- **WHEN** one or more accepted deletions are queued or executing
- **THEN** the board notice identifies the affected tasks and their aggregate state
- **AND** the rest of the board remains usable

#### Scenario: Show a failed destructive operation with recovery
- **WHEN** an accepted deletion or worktree removal fails
- **THEN** the board notice presents the failure and the recovery actions
- **AND** it offers force only when the failure is `SHARED_WORKTREE`
- **AND** it offers return only when returning the task's conversations is permitted

#### Scenario: Report a retained plain checkout
- **WHEN** a deletion completes and leaves a plain checkout on disk
- **THEN** the board notice reports the retained path
- **AND** the user can dismiss the report

#### Scenario: Report a retained unverifiable checkout
- **WHEN** a deletion completes after leaving a checkout on disk because the project path or Git root could not be resolved
- **THEN** the board notice reports the retained checkout path
- **AND** it does not report that checkout as removed
- **AND** the user can dismiss the report

#### Scenario: Notice clears when the operation resolves
- **WHEN** every tracked queued or failed destructive operation resolves or is cleared
- **THEN** the notice no longer presents that operation
- **AND** the card and drawer status remain the authoritative per-task surfaces

### Requirement: Pending user work
Pending user work SHALL mean any input a task's conversation still owes the user's counterpart: an unanswered structured question round, an unanswered native question, a pending approval or permission request, and a user message queued for the next turn. Pending user work SHALL be evaluated for every conversation of the task, including a conversation whose tab is closed and a conversation the client has never displayed. A message the host itself queued as a stage instruction SHALL NOT count as pending user work.

Pending user work SHALL be derived from the conversations' durable state and SHALL NOT be persisted with the task, so it cannot outlive the input it describes. Submitting a structured question round, answering with an ordinary chat reply, answering a native question, deciding an approval, or losing a queued message SHALL consume the corresponding item. An unreadable conversation state SHALL NOT be treated as idle: the host SHALL NOT admit an advance from that evaluation and SHALL report the failure. The auto-mode control MAY keep its previous state, because an unreadable state cannot be presented as a specific kind of pending work.

#### Scenario: An unanswered question round is pending
- **WHEN** a conversation of the task has a structured question round with no answer
- **THEN** the task has pending user work

#### Scenario: An unanswered native question is pending
- **WHEN** a conversation of the task has a native question awaiting the user
- **THEN** the task has pending user work

#### Scenario: A pending approval is pending
- **WHEN** a conversation of the task has an approval or permission request awaiting the user
- **THEN** the task has pending user work

#### Scenario: A queued user message is pending
- **WHEN** a conversation of the task holds a user message queued for the next turn
- **THEN** the task has pending user work

#### Scenario: A closed conversation still counts
- **WHEN** a conversation with pending user work has its tab closed
- **THEN** the task still has pending user work

#### Scenario: A host-queued stage instruction is not user work
- **WHEN** the only queued message in a conversation is a stage instruction the host queued itself
- **THEN** the task does not have pending user work because of that message

#### Scenario: Consuming the last item ends the pending state
- **WHEN** the last outstanding item of pending user work in the task is consumed
- **THEN** the task no longer has pending user work
- **AND** no stored record had to be cleared

#### Scenario: Unreadable state is not idle
- **WHEN** a conversation's state cannot be read while pending user work is being evaluated
- **THEN** no automatic advance is admitted for that evaluation
- **AND** the failure is reported
- **AND** the control is not required to present a pending-work kind for it

### Requirement: Auto mode on a task card
A task SHALL have an optional auto-mode setting that is disabled unless the user enables it, is persisted with the task, and is independent of its stage, position, and conversations. The card SHALL present the setting as an always-visible toggle that also indicates its state, SHALL expose its pressed state and purpose to assistive technology, and SHALL NOT open the task drawer or begin a drag when activated. The control SHALL NOT be presented in selection mode.

Enabling auto mode SHALL arm the task and SHALL NOT move it, change its position, or send an instruction; the next completed turn remains the only trigger. Disabling it SHALL stop future automatic advances and SHALL NOT retract an advance that is already admitted. A user movement of the task SHALL preserve the setting. The indicator SHALL distinguish disabled, armed, advancing, held, and paused. A paused state SHALL be explained in the status region defined by Task card status strip. A held state SHALL be presented by the control itself, including its accessible name, and SHALL NOT add a status-region entry, because it is derived from pending user work rather than a recorded cause. Held SHALL mean the task has pending user work as defined by Pending user work, and the state SHALL clear when that work is consumed, SHALL NOT be persisted, and SHALL NOT require a user action. Reading a conversation SHALL NOT change the setting and SHALL NOT clear a pause.

#### Scenario: Auto mode is disabled by default
- **WHEN** a task is created
- **THEN** its auto mode is disabled
- **AND** the card presents the auto-mode control in its disabled state

#### Scenario: Enable auto mode
- **WHEN** the user enables auto mode on a card
- **THEN** the task is armed
- **AND** its stage and position are unchanged
- **AND** no instruction is sent and no agent execution starts

#### Scenario: Disable auto mode
- **WHEN** the user disables auto mode while no advance is in progress
- **THEN** future automatic advances stop
- **AND** the task's stage and position are unchanged

#### Scenario: Disable during an admitted advance
- **WHEN** the user disables auto mode while an automatic advance is already admitted
- **THEN** the admitted advance is not retracted
- **AND** no later advance is admitted

#### Scenario: Preserve auto mode across a manual move
- **WHEN** the user moves a task whose auto mode is enabled
- **THEN** auto mode remains enabled
- **AND** the next completed turn advances from the new stage

#### Scenario: Present the held state
- **WHEN** an armed task has pending user work
- **THEN** the auto-mode control presents the held state
- **AND** the card's status region presents no entry for that state

#### Scenario: Clear the held state when pending work is consumed
- **WHEN** the task's last pending user work is consumed
- **THEN** the auto-mode control stops presenting the held state without a reload
- **AND** the task's stage and position are unchanged by the change

#### Scenario: Reading does not change auto mode
- **WHEN** the user opens and reads a task conversation
- **THEN** auto mode keeps its setting and paused state

### Requirement: Automatic advance after a completed turn
When a conversation of a task with auto mode enabled ends a turn whose reason is `completed`, and no open conversation of the task is running a turn, and the task has no pending user work as defined by Pending user work, the host SHALL admit exactly one automatic advance. The host SHALL perform the advance without requiring the board to be mounted, without a confirmation, without a conversation picker, and without arming the timed stage instruction. An admitted advance SHALL be durable: reloading the board SHALL NOT cancel it, and a host restart SHALL dispatch it when it had not been dispatched.

The host SHALL evaluate pending user work when the completed turn ends and SHALL re-evaluate it when the advance is admitted, and SHALL NOT admit the advance when pending user work exists at either evaluation. Consuming pending user work SHALL NOT itself move the task; only an observed completed turn triggers an advance. A blocked advance SHALL NOT record a pause and SHALL NOT be dropped silently: the task SHALL present the held state defined by Auto mode on a task card, and the next completed turn SHALL re-evaluate the task.

A turn ending for any other reason SHALL NOT advance the task. The host SHALL NOT admit an advance while the task has an unresolved context operation, an unresolved confirmed transition, or an unresolved entry for its current stage; those conditions SHALL NOT be recorded as a pause and the next completed turn SHALL re-evaluate them.

The host SHALL NOT replay a turn that ended while it was not observing the task's conversations. Only a turn end observed while the host is running SHALL trigger an advance.

#### Scenario: Advance after a completed turn
- **WHEN** the only open conversation of an armed task ends a completed turn and the task has no pending user work
- **THEN** one automatic advance is admitted

#### Scenario: Do not advance after a non-completed turn
- **WHEN** a turn ends as `error`, `blocked`, `aborted`, or `max-tokens`
- **THEN** no advance is admitted
- **AND** the task remains in its current stage
- **AND** a pause reason naming the ending is recorded

#### Scenario: Wait for every conversation to become idle
- **WHEN** a completed turn ends while another open conversation of the same task is running a turn or awaiting a reply
- **THEN** no advance is admitted at that moment
- **AND** the next completed turn re-evaluates the task

#### Scenario: Wait while an unanswered question round exists
- **WHEN** a completed turn ends while any conversation of the task has an unanswered structured question round
- **THEN** no advance is admitted
- **AND** no pause reason is recorded
- **AND** the auto-mode control presents the held state

#### Scenario: Wait while a user message is queued
- **WHEN** a completed turn ends while any conversation of the task has a user message queued for the next turn
- **THEN** no advance is admitted
- **AND** no pause reason is recorded

#### Scenario: Wait while a pending approval exists
- **WHEN** a completed turn ends while any conversation of the task has an approval or native question awaiting the user
- **THEN** no advance is admitted
- **AND** no pause reason is recorded

#### Scenario: Wait while a closed conversation has pending user work
- **WHEN** a completed turn ends while a closed conversation of the task has pending user work
- **THEN** no advance is admitted
- **AND** no pause reason is recorded

#### Scenario: Advance after the pending work is consumed
- **WHEN** pending user work is consumed and a later turn ends as `completed` with no pending user work in the task
- **THEN** one automatic advance is admitted

#### Scenario: Consuming pending work does not advance by itself
- **WHEN** the task's last pending user work is consumed without a completed turn ending
- **THEN** no advance is admitted
- **AND** the task remains in its current stage

#### Scenario: Re-validate pending user work at admission
- **WHEN** pending user work appears after the completed turn was evaluated and before the advance is admitted
- **THEN** no advance is admitted
- **AND** the task's stage and position are unchanged
- **AND** the next completed turn re-evaluates the task

#### Scenario: Do not advance a busy task
- **WHEN** a completed turn ends while the task has an unresolved context operation, an unresolved confirmed transition, or an unresolved entry for its current stage
- **THEN** no advance is admitted
- **AND** no pause reason is recorded for that condition

#### Scenario: Advance with the board closed
- **WHEN** a completed turn ends while the Kanban board is not displayed and the task has no pending user work
- **THEN** the advance is admitted and dispatched
- **AND** the card shows its result when the board is displayed again

#### Scenario: Keep an admitted advance across a reload
- **WHEN** the user reloads the interface while an admitted advance has not been dispatched
- **THEN** the advance is still dispatched
- **AND** it is not duplicated

#### Scenario: No catch-up after a restart
- **WHEN** the host starts and a task's last turn ended while the host was not observing it
- **THEN** no advance is admitted for that turn
- **AND** the task remains in its stage until its next completed turn

### Requirement: Automatic advance destination and dispatch
The automatic advance destination SHALL be the first entry of the current stage's configured `allowed_transitions` when that list is configured, otherwise the stage that follows the current stage in workflow order. There SHALL be no destination when the configured list is empty or the resolved stage is the current stage.

While the resolved destination has no entry instruction, resolution SHALL continue from that destination. Resolution SHALL stop at the first stage that has an entry instruction, or at the last reachable stage when no reachable stage has one. A stage already visited during the same resolution SHALL NOT be revisited. The resolved destination and its entry instruction SHALL be captured when the advance is admitted, so a workflow edit after admission SHALL NOT change that advance.

The task SHALL be placed at the top of the destination stage, before every card that stage already contains. When the destination has an entry instruction, that instruction SHALL be sent verbatim to the task's first open conversation; when no conversation is open, a new conversation SHALL be created and used as the target. The submitted message SHALL contain only the stage instruction. The advance SHALL NOT create more than one conversation beyond that target. The destination entry SHALL remain unresolved until a prompt is sent.

#### Scenario: Use the first configured transition
- **WHEN** the current stage configures multiple permitted transitions and a completed turn advances the task
- **THEN** the task moves to the first configured transition's stage

#### Scenario: Fall back to workflow order
- **WHEN** the current stage does not configure transitions and a completed turn advances the task
- **THEN** the task moves to the next stage in workflow order

#### Scenario: Cross a stage without an instruction
- **WHEN** the next stage has no entry instruction and a later reachable stage has one
- **THEN** the task moves to that later stage in one advance
- **AND** that stage's instruction is sent

#### Scenario: Stop at the last reachable stage
- **WHEN** no reachable stage ahead has an entry instruction
- **THEN** the task moves to the last reachable stage
- **AND** no instruction is sent

#### Scenario: Place at the top of the destination
- **WHEN** an advance is dispatched to a destination stage that already contains tasks
- **THEN** the task is placed before every existing card of that stage
- **AND** the existing cards retain their relative order

#### Scenario: Never revisit a stage
- **WHEN** the resolution would return to a stage it already visited
- **THEN** resolution stops before the repeat
- **AND** no advance loops

#### Scenario: Capture the instruction at admission
- **WHEN** the destination instruction changes after an advance is admitted
- **THEN** the admitted advance sends the captured instruction
- **AND** the task moves to the captured destination

#### Scenario: Target the first open conversation
- **WHEN** an advance with an instructed destination is dispatched and the task has open conversations
- **THEN** the first open conversation receives the instruction
- **AND** no conversation picker is presented

#### Scenario: Create the target conversation
- **WHEN** an advance with an instructed destination is dispatched and the task has no open conversation
- **THEN** one new conversation is created and receives the instruction
- **AND** no additional conversation is created

#### Scenario: Keep a failed destination entry unresolved
- **WHEN** the instruction cannot be sent after the task moved
- **THEN** the task stays in the destination
- **AND** the destination entry remains unresolved
- **AND** the card exposes the stage run action for that entry

### Requirement: Automatic advance pause and failure
A pause SHALL be recorded with the task when a turn ends for a reason other than `completed`, or when an advance cannot be admitted before a durable transition exists. The pause SHALL identify its reason, SHALL be presented on the card and in the task drawer, SHALL persist across reloads and restarts, and SHALL NOT be cleared by reading or acknowledging a conversation. The pause SHALL be cleared when an advance is admitted, when auto mode is disabled, or when the task moves.

An admitted advance that fails SHALL be reported through the task's transition state rather than as a new pause, SHALL keep auto mode enabled, and SHALL NOT be retried automatically. Auto mode SHALL remain armed after a pause, so the next completed turn attempts an advance again.

#### Scenario: Pause after a failed turn
- **WHEN** a turn ends with `error`
- **THEN** the task records a pause naming the failed turn
- **AND** the card and the drawer present that reason

#### Scenario: Pause after an admission failure
- **WHEN** an advance cannot be admitted before a durable transition exists
- **THEN** the task records a pause naming the admission failure
- **AND** auto mode remains enabled

#### Scenario: Clear the pause on the next advance
- **WHEN** a later completed turn admits an advance
- **THEN** the recorded pause is cleared

#### Scenario: Clear the pause when auto mode is disabled
- **WHEN** the user disables auto mode
- **THEN** the recorded pause is cleared

#### Scenario: Clear the pause on a manual move
- **WHEN** the user moves the paused task
- **THEN** the recorded pause is cleared
- **AND** auto mode remains enabled

#### Scenario: Reading does not clear the pause
- **WHEN** the user opens and reads the conversation whose turn did not complete
- **THEN** the pause remains presented

#### Scenario: No automatic retry
- **WHEN** an admitted advance fails
- **THEN** the plugin does not retry it automatically
- **AND** the task presents the failure with its existing recovery actions

### Requirement: Bulk deletion fan-out
The board SHALL provide an explicit selection mode that presents a selection control on each card and disables card dragging while active. The user SHALL be able to select multiple tasks across visible stages. A bulk deletion SHALL require one confirmation and SHALL apply the individual task deletion semantics to each selected task. On accept, the board SHALL close the confirmation, SHALL leave selection mode, and SHALL NOT present a result summary. A selected task whose persisted state permits admission SHALL be accepted for background deletion rather than reported as already deleted. A selected task that cannot be admitted SHALL remain on the board and SHALL be reported as a board error naming that task. The board SHALL NOT stop a conversation, resolve an operation, or discard local changes to force a bulk deletion, and SHALL present a later failure of an accepted task through the card status and the destructive-operation notice instead of as a bulk result. Leaving selection mode SHALL clear the selection.

#### Scenario: Enter selection mode and select tasks
- **WHEN** the user enters selection mode and activates cards in more than one stage
- **THEN** the board marks the selected tasks and disables dragging for them

#### Scenario: Delete an eligible selection
- **WHEN** the user confirms deletion of a selection whose tasks permit admission
- **THEN** each selected task is accepted for background deletion with the individual deletion semantics
- **AND** the confirmation closes and the board leaves selection mode immediately
- **AND** no result summary is presented and no task is reported as already deleted

#### Scenario: Report an admission rejection
- **WHEN** a selected task cannot be admitted, for example because it no longer exists or another operation holds it
- **THEN** that task remains on the board and the board reports an error naming it
- **AND** the other selected tasks proceed with their own admission

#### Scenario: Present a later failure
- **WHEN** an accepted task from the selection fails in its queued preflight
- **THEN** the card status and the destructive-operation notice present the failure and its recovery actions
- **AND** the other accepted deletions are unaffected

#### Scenario: Do not force a blocked task
- **WHEN** a selected task has a running conversation, an unresolved operation, or local worktree changes
- **THEN** the board does not stop the conversation, resolve the operation, or discard the changes to force deletion

#### Scenario: Leave selection mode
- **WHEN** the user leaves selection mode
- **THEN** the selection is cleared and normal card dragging is restored

### Requirement: Responsive board opening
The board SHALL be presented from the snapshot the client already holds when the Kanban page is selected, without waiting for a new host read and without discarding conversation attention that is already available. Selecting the page again after visiting another page SHALL behave the same way: the board is presented from the available snapshot and does not wait for a new host read before appearing. Opening the page SHALL NOT wait for any conversation's Session history to be read. A background reconciliation SHALL obtain a current snapshot so that a client whose live stream stopped still recovers, and the board SHALL apply its result without a page reload.

#### Scenario: Open from the published snapshot
- **WHEN** the user selects Kanban while the client holds a published board snapshot
- **THEN** the board is presented without waiting for a new host read
- **AND** no conversation history is read before the board is presented
- **AND** the Hub, board, workflow, and task content are presented

#### Scenario: Reopen without discarding attention
- **WHEN** the user leaves the Kanban page and selects it again
- **THEN** the board is presented without waiting for a new host read
- **AND** attention already resolved for its tasks is still presented

#### Scenario: Recover a stopped live stream
- **WHEN** the client has no current published snapshot or its live stream stopped
- **THEN** a background reconciliation obtains a current snapshot
- **AND** the board presents it without a page reload

### Requirement: Progressive attention presentation
The board SHALL remain interactive while conversation attention is still resolving. Facts for tasks with auto mode enabled and for conversations with observed activity SHALL be resolved before facts for idle historical conversations. A task's attention SHALL be presented when its conversations' facts resolve, without a page reload, and the final state after a burst of activity SHALL NOT be dropped. Before a conversation's facts resolve, its task MAY be presented without that conversation's attention indicators. An automatic advance decision SHALL NOT use a partially resolved attention projection.

#### Scenario: Board first, attention later
- **WHEN** the board is presented while conversation facts are still resolving
- **THEN** the board and its cards remain usable
- **AND** each task's attention appears when its facts resolve, without a reload

#### Scenario: Prioritize active tasks
- **WHEN** one task has auto mode enabled or has observed conversation activity and another task has only idle historical conversations
- **THEN** the active task's attention is resolved first

#### Scenario: Keep the final state after a burst
- **WHEN** several conversations of a task change attention in quick succession
- **THEN** the task presents the final aggregate attention without a reload
- **AND** the board's own attention indicators reflect the same final state

#### Scenario: Recover a failed read
- **WHEN** a conversation's fact read fails transiently
- **THEN** the board presents the correct execution state within two seconds without user action

#### Scenario: Never decide from partial attention
- **WHEN** an automatic advance is evaluated while attention is still resolving
- **THEN** the decision uses the conversations' durable facts rather than the partial presentation
- **AND** no advance is admitted while pending user work exists

### Requirement: Card commands isolated from unrelated work
A card command SHALL persist the change it describes and SHALL NOT perform work that its change does not require. Enabling or disabling a task's auto mode SHALL NOT dispatch pending transitions when no pending transition exists, SHALL NOT recompute team-sharing or authorization state, and SHALL NOT read a conversation's Session history. The auto-mode control SHALL present a pending state while its change is in flight, SHALL present the new setting only after the change is durably persisted, and SHALL NOT remain pending after the command completes or fails.

#### Scenario: Enable auto mode without unrelated work
- **WHEN** the user enables auto mode on a card and no task has a pending transition
- **THEN** the setting is persisted with the task
- **AND** no pending transition is dispatched
- **AND** conversation facts, team-sharing views, and authorization state are not recomputed by that command

#### Scenario: Persisted setting drives the control
- **WHEN** the auto-mode change is in flight
- **THEN** the control presents its pending state
- **AND** it presents the new setting after the change is durably persisted

#### Scenario: A failed change leaves the setting unchanged
- **WHEN** the auto-mode change fails
- **THEN** the control stops presenting the pending state
- **AND** it presents the task's stored setting
- **AND** the failure is reported on the board

#### Scenario: Disable without unrelated work
- **WHEN** the user disables auto mode on a card and no advance is in progress
- **THEN** the setting is removed from the task
- **AND** no pending transition is dispatched and no conversation history is read by that command

### Requirement: Startup reconciliation stays off the interaction path
Plugin startup SHALL restore persisted question projections before the board is presented, and SHALL reconcile Session history and workspace records in the background. The board SHALL remain usable while that background reconciliation runs. An unanswered question that was already persisted SHALL hold an automatic advance before the background reconciliation completes, as defined by Pending user work and Automatic advance after a completed turn. A failure during background reconciliation SHALL be reported and SHALL NOT block the board.

#### Scenario: Persisted questions are available at first paint
- **WHEN** the plugin starts and a conversation has a persisted unanswered question round
- **THEN** the round is available for pending-work evaluation before the board is presented

#### Scenario: Background reconciliation does not block
- **WHEN** the board is presented while Session-history replay or workspace reconciliation is still running
- **THEN** the board remains usable
- **AND** its content completes without a page reload

#### Scenario: The pending-work gate holds during reconciliation
- **WHEN** a completed turn ends before the background reconciliation finishes and a persisted unanswered question exists for that task
- **THEN** no automatic advance is admitted

#### Scenario: A reconciliation failure is reported
- **WHEN** background reconciliation fails for a conversation or workspace
- **THEN** the failure is reported
- **AND** the board is not blocked

### Requirement: Board project relocation notice
The active board SHALL present one compact notice above the board body while a project relocation is waiting for conversations or has failed. The notice SHALL identify the project and its state, SHALL offer retry for a failed relocation, SHALL update from host state without a reload, and SHALL NOT claim a relocation completed while it is unresolved. It SHALL NOT replace the Projects section as the authoritative relocation surface.

#### Scenario: Show a waiting relocation
- **WHEN** a project relocation is waiting for conversations to become idle
- **THEN** the board notice identifies the project and states that it is waiting
- **AND** the board remains usable

#### Scenario: Show a failed relocation with retry
- **WHEN** a project relocation failed
- **THEN** the board notice identifies the project, presents the recorded problem, and offers retry

#### Scenario: Clear the notice when the relocation resolves
- **WHEN** the relocation completes, is cancelled, or is no longer recorded
- **THEN** the notice no longer presents that project

### Requirement: Animated card movement on the board
The active board SHALL animate card movement. When a card's stage or position changes, that card SHALL move from its previous presented position to its new one, and every other card whose position changes SHALL move to its own new position, so a rearrangement reads as one continuous movement instead of a jump. The animation SHALL cover a change of stage and a reorder within the same stage, and SHALL apply regardless of what caused the change: a board drag and drop, the task drawer's stage control, a confirmed restricted move, an automatic advance, a team-sync update, or a task deletion.

A card that newly appears on the board SHALL enter with a brief fade. A card that leaves SHALL fade out as a non-interactive representation that neither delays its removal from the board nor extends the board's scrollable area. A change that only alters a card's size, such as a status line appearing, SHALL settle immediately without motion.

The board SHALL settle card changes immediately, without motion, whenever the presented view is replaced: changing Hub, changing board, or changing the text search or the project filter. The board SHALL also settle immediately when one presentation change makes more than eight cards enter or leave the board at once, so a bulk change never launches a large cascade. Cards that stay on the board and only change position SHALL NOT count toward that limit.

When the user prefers reduced motion, the board SHALL change card positions, entries, and exits without motion while keeping every card and its content unchanged and reachable.

Motion SHALL NOT change board data, commands, card content, the drag-and-drop contract, the board frame's position or height, focus, or click activation. A card SHALL remain activatable, focusable, and draggable while it is moving. Motion SHALL NOT extend the board's scrollable area and SHALL leave no interactive remnant once it completes.

#### Scenario: Move a card between stages
- **WHEN** the user drops a card on a permitted stage
- **THEN** the card moves from its previous position to the dropped position with motion
- **AND** the cards that made room for it move to their new positions with motion
- **AND** the board presents the task in the destination stage

#### Scenario: Reorder within the current stage
- **WHEN** the user drops a card at a new position inside its current stage
- **THEN** the card and the cards whose position changes move to their new positions with motion

#### Scenario: Move a card from the drawer
- **WHEN** the user changes a card's stage from the open task drawer's stage control
- **THEN** the card moves to the top of the destination stage with motion
- **AND** the cards below it move to their new positions with motion
- **AND** the drawer stays open and keeps its position

#### Scenario: An automatic advance moves a card
- **WHEN** an automatic advance moves a card while the user is not interacting with the board
- **THEN** the card and the affected cards move to their new positions with motion

#### Scenario: A team-sync update moves a card
- **WHEN** an accepted team update changes a card's stage or position
- **THEN** the card and the affected cards move to their new positions with motion

#### Scenario: A new card enters
- **WHEN** a task appears on the active board, including a task the user just created
- **THEN** its card enters with a brief fade
- **AND** the cards that make room for it move to their new positions with motion

#### Scenario: A removed card leaves
- **WHEN** a card leaves the active board, including through deletion
- **THEN** its card fades out without delaying its removal from the board
- **AND** the remaining cards move to their new positions with motion
- **AND** the fading card does not accept interaction and does not extend the board's scrollable area

#### Scenario: A size-only change settles immediately
- **WHEN** a card grows or shrinks without changing the membership or order of any list
- **THEN** the cards that shift because of that size change settle to their new positions without motion

#### Scenario: Replace the presented view
- **WHEN** the user changes Hub, changes board, changes the text search, or changes the project filter
- **THEN** the cards that remain, appear, or disappear settle immediately without motion

#### Scenario: Settle a large batch
- **WHEN** one presentation change makes more than eight cards enter or leave the board
- **THEN** the affected cards settle immediately without motion

#### Scenario: Move a card in a long stage
- **WHEN** the user moves a card inside or between stages that already present more than eight cards
- **THEN** the card and every card whose position changes move to their new positions with motion

#### Scenario: Reduced motion
- **WHEN** the user prefers reduced motion
- **THEN** cards change position, enter, and leave without motion
- **AND** every card's content, activation, and drag behavior are unchanged

#### Scenario: Keep interaction available during motion
- **WHEN** the user activates, focuses, or starts dragging a card while cards are moving
- **THEN** the card responds with its normal activation, focus, and drag behavior
- **AND** the board frame does not change position or height because of the motion

#### Scenario: Motion changes no board data
- **WHEN** the board animates any card movement
- **THEN** no command is sent and no board data changes because of the motion
- **AND** the presented positions match the board state the client already holds

### Requirement: Board presentation selection

The board SHALL present the active board in one of two presentations: the column board and the workflow diagram. A board SHALL open with the presentation that the user last chose for that board in this browser; when the user has not chosen for that board, it SHALL open with that board's configured default presentation, and a workflow without that setting SHALL open the column board. A view control in the board header SHALL switch the presentation, and switching SHALL store the chosen presentation for the active board in the browser. The stored choice SHALL be local to the browser: it SHALL NOT be sent to the host, SHALL NOT change the board's workflow, SHALL NOT be published to the team, and SHALL NOT be presented on another board or in another browser. A reload SHALL present the stored choice when there is one. Switching the presentation SHALL NOT change board data, tasks, commands, task positions, or the workflow, and every existing board behavior — drag and drop, the task drawer, search, the project filter, notices, and selection — SHALL remain available in the column board presentation.

#### Scenario: Open the column board by default

- **WHEN** the user opens a board whose workflow does not configure a default presentation and the browser stores no choice for that board
- **THEN** the board presents the column board

#### Scenario: Open the configured presentation

- **WHEN** the user opens a board whose workflow configures the workflow diagram as its default presentation and the browser stores no choice for that board
- **THEN** the board presents the workflow diagram

#### Scenario: Switch the presentation

- **WHEN** the user activates the workflow diagram in the board header's view control
- **THEN** the board presents the workflow diagram for the active board
- **AND** no command is sent to the host

#### Scenario: Return to the configured default after a reload

- **WHEN** the browser stores no choice for a board and the user reloads it
- **THEN** the board presents its configured default presentation

#### Scenario: Remember the chosen presentation

- **WHEN** the user switches the presentation and then reloads the board
- **THEN** the board presents the presentation the user chose for that board

#### Scenario: Use each board's own default

- **WHEN** the user switches from a board that presents the workflow diagram to a board that stores no choice and does not configure a default presentation
- **THEN** the second board presents the column board

#### Scenario: Keep each board's own choice

- **WHEN** the user chose a presentation for one board and switches to another board
- **THEN** the other board opens with its own stored choice, or with its configured default when it has none

#### Scenario: Switch without changing board data

- **WHEN** the user switches the presentation
- **THEN** no command is sent
- **AND** no task, stage, position, size, or workflow changes

### Requirement: Execution accent on task cards

A task card SHALL present agent execution through one visible execution accent: a bar at the trailing edge of the card. The accent SHALL pulse while agent execution is running and SHALL use the host theme's accent color, remaining legible in the host's light and dark appearances. The card SHALL NOT present a working text label. The working state SHALL be announced to assistive technology when it begins, and periodic animation updates SHALL NOT be announced. The card SHALL follow the host's reduced-motion preference by keeping the accent visible without animation. The execution accent SHALL NOT replace or hide the attention indicators, and it SHALL be presented whether or not the card also presents the run or advance actions. The card SHALL NOT present a background activity indicator; background activity SHALL remain available through the task drawer's Conversations section entry as defined by Coexisting attention indicators across task conversations.

#### Scenario: Card shows a running turn

- **WHEN** a task is running an assistant turn
- **THEN** its card presents the execution accent at its trailing edge
- **AND** the working state is announced once to assistive technology
- **AND** the card presents no working text label

#### Scenario: Card shows working while a subagent runs

- **WHEN** a task's assistant turn has ended and an owned subagent descendant is still running
- **THEN** its card still presents the execution accent
- **AND** the running subagent is not presented as background activity

#### Scenario: Background work does not use the accent

- **WHEN** a task has no owned agent running and still owns unsettled jobs or schedules
- **THEN** its card presents no execution accent
- **AND** its card presents no background activity indicator

#### Scenario: Activity is separate from identity

- **WHEN** a card presents an execution accent
- **THEN** the project name and the attention indicators remain presented in the context region
- **AND** the accent does not replace an attention indicator

#### Scenario: Reduced motion

- **WHEN** the user prefers reduced motion
- **THEN** the execution accent remains visible without animation

#### Scenario: Theme appearance

- **WHEN** the host application uses its light or dark appearance
- **THEN** the execution accent remains legible and uses host theme colors

### Requirement: Advance a task from its card

A task card SHALL expose an advance action that moves the task to the next stage in workflow order. The action SHALL present the drawer's next-stage affordance — the same icon, the same accessible name, and the same indication when the next stage requires confirmation — and SHALL use the board's move pipeline, so a restricted next stage requires explicit confirmation, a first execution presents Execution preparation before a task's first execution, and a move into an instructed stage arms the timed stage instruction. The action SHALL be presented only while a next stage exists. It SHALL be hidden while the task's agent execution is running and SHALL be unavailable while the task has an unresolved context operation or a confirmed transition, while selection mode is active, or while a move from the card is in flight. Activating it SHALL NOT open the task drawer, SHALL NOT begin a drag, and SHALL NOT change the task's diagram size or placement.

#### Scenario: Advance to the next stage

- **WHEN** the user activates the card's advance action on a task whose next stage is permitted
- **THEN** the task moves to that stage
- **AND** the task drawer does not open

#### Scenario: Hide while the task is running

- **WHEN** the task's agent execution is running
- **THEN** the card does not present the advance action
- **AND** the action returns when the execution settles

#### Scenario: Confirm a restricted next stage

- **WHEN** the next stage is not permitted from the task's current stage
- **THEN** the board asks for explicit confirmation before moving
- **AND** the accessible name of the action states that the move requires confirmation
- **AND** the task remains in its stage until the user confirms

#### Scenario: Prepare a first execution

- **WHEN** the user activates the advance action on a task that has no conversation
- **THEN** the execution preparation is presented before the task moves
- **AND** canceling the preparation leaves the task in its stage

#### Scenario: Arm the timed instruction

- **WHEN** the user activates the advance action and the destination stage has an entry instruction
- **THEN** the timed stage instruction is armed exactly as after a board drag
- **AND** the task moves to the destination

#### Scenario: No action without a next stage

- **WHEN** the task is in the last stage of the workflow
- **THEN** the card does not present the advance action

#### Scenario: Unavailable while busy

- **WHEN** the task has an unresolved context operation or a confirmed transition, or selection mode is active
- **THEN** the advance action is unavailable or not presented
- **AND** no move is sent

#### Scenario: Action does not disturb the diagram

- **WHEN** the user advances a task from its card in the workflow diagram
- **THEN** the task moves to the next stage
- **AND** no stage changes size or placement
