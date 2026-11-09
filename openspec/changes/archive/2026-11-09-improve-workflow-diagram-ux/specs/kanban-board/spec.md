# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Visible execution state on task cards

**Reason**: The working text label and the card-level background activity indicator are replaced by the single execution accent, and background activity is no longer presented on the card at all.

**Migration**: Use the execution accent defined by Execution accent on task cards for agent execution, and the task drawer's Conversations section entry for background activity.
