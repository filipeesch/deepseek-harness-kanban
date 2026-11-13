# Spec Delta

## MODIFIED Requirements

### Requirement: Coexisting attention indicators across task conversations

The board SHALL derive attention per task conversation and aggregate it across all conversations belonging to a task. It SHALL distinguish blue unread-message indicators, orange awaiting-reply indicators, and red failure indicators. Blue and red SHALL be derived by the conversation's last settled assistant turn and its stored per-conversation read acknowledgment: unread SHALL mean that the conversation has a settled turn newer than its acknowledgment, and failure SHALL mean that the settled turn ended with an error outcome and is still unread. Blue and red SHALL NOT be presented while any agent owned by that conversation is running. The orange indicator SHALL reflect a live awaiting-reply state and SHALL NOT require acknowledgment. Attention SHALL be derived from durable conversation facts and the stored acknowledgment, SHALL survive a reload or plugin restart, and SHALL NOT depend on a per-client native unread transition. A conversation with no stored acknowledgment SHALL present its last settled turn as unread. Simultaneously applicable indicators SHALL coexist rather than collapse to a single highest-priority indicator. Those attention indicators SHALL also coexist with the card's agent execution accent rather than replacing one another.

Background activity SHALL remain derived per task as unsettled work other than agent execution, and SHALL NOT be presented on the task card as a generic activity count or background indicator. Directly owned deterministic execution SHALL instead expose its own controls and runtime status as defined by `deterministic-steps`, without fabricating conversation attention. A pending executable approval SHALL be a task-level attention fact derived from the task's own deterministic control state; it SHALL present the approval attention defined by `Card attention surface`, and it SHALL NOT mark any conversation as unread, awaiting reply, or failed. Directly owned deterministic execution SHALL remain available through the task drawer's section navigation, whose Conversations entry SHALL expose the number of unsettled activities and their labels on hover and to assistive technology.

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

#### Scenario: Keep script state separate from conversation attention

- **WHEN** a task has an active, stopped, or failed deterministic execution but no unread or failed settled conversation turn
- **THEN** its deterministic status remains available on the card and drawer
- **AND** the script alone creates no blue, orange, or red conversation attention mark
- **AND** the card adds no generic background activity count

#### Scenario: Present a pending approval as task attention

- **WHEN** a task's current entry awaits executable approval and no conversation has unread, awaiting-reply, or failure attention
- **THEN** the card presents the approval attention defined by `Card attention surface`
- **AND** no conversation is marked unread, awaiting reply, or failed

### Requirement: Task card layout

The board SHALL render each task as a card composed of distinct regions in a fixed order: a title region, a context region, an activity region, and a status region. The context region SHALL present the task's project name and its unread, awaiting-reply, failure, and pending-approval attention indicators. The activity region SHALL present the auto-mode control defined by Auto mode on a task card, the stage run action defined by Run a stage instruction from a card, and the advance action defined by Advance a task from its card, kept on one line at the trailing edge of the card. The status region SHALL present unresolved context-operation, confirmed-transition, automatic-advance, and executable-approval state as defined by Task card status strip. The card's agent execution state SHALL be presented by the execution accent defined by Execution accent on task cards and SHALL NOT occupy a region of its own.

The project name SHALL remain visible on every card, SHALL be visually quieter than the title, and SHALL expose the complete name when the available width truncates it. The title SHALL NOT be clamped to a fixed number of lines. In selection mode the card SHALL present its selection control at the leading edge of the context region. The whole card surface SHALL remain activatable as defined by Open a task drawer, except for nested controls, which SHALL perform their own action without opening the drawer.

For an entry owned by durable deterministic activation or control state, the activity region SHALL additionally present the applicable Stop, Play, or approval action defined by `deterministic-steps`, not an agent instruction countdown. While that entry awaits approval, the approval action SHALL take the place of Stop and Play in the same single control slot. Ownership SHALL follow that persisted entry state rather than the latest saved workflow mode, so changing the saved stage to an agent or manual mode SHALL NOT hide Stop for its owned active run. The status region SHALL include its deterministic execution state. These controls SHALL preserve the single activity row, nested-control activation rules, project visibility, selection behavior, and independent conversation attention of the existing card.

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

- **WHEN** a card has no unresolved context operation, confirmed transition, automatic-advance state, executable approval, or run-action failure
- **THEN** the card presents no status-region content

#### Scenario: Present deterministic controls without replacing card regions

- **WHEN** a task card is in a deterministic stage
- **THEN** its applicable Stop, Play, or approval control is placed in the activity region
- **AND** its deterministic status is placed in the status region
- **AND** no new card region or separate action row is introduced

#### Scenario: Present deterministic parameter data in the status region

- **WHEN** a deterministic entry declares parameters
- **THEN** the status region presents the entry's parameter values read-only
- **AND** it offers an inline edit action while the entry exists and its execution is not active or stopping
- **AND** the data and action stay inside the status region without adding an activity control or a separate card region

#### Scenario: Keep owned Stop after a saved mode change

- **WHEN** a task owns an active deterministic run and the saved stage is changed to agent or manual mode
- **THEN** the card keeps Stop for that owned execution
- **AND** no agent countdown or stage-run action replaces it
- **AND** a later Play is offered only for valid latest deterministic configuration, otherwise the interface explains the required configuration or new entry

#### Scenario: Replace Stop with approval while an entry waits

- **WHEN** a task's current deterministic entry awaits approval
- **THEN** the activity region presents the approval action in the place of Stop and Play
- **AND** the status region presents the pending approval

### Requirement: Single-line activity strip on task cards

The card's activity region SHALL keep its content on one line. It SHALL present the auto-mode control, the stage run action or its countdown control, and the advance action at the trailing edge, and it SHALL NOT present a background activity indicator. The card SHALL reserve the activity region's height in every task state, so that starting or ending a turn, or showing or hiding the run and advance actions, SHALL NOT change the card's height. The controls SHALL share one row and SHALL NOT add a separate action row.

A deterministic Stop, Play, or approval control SHALL share this same reserved one-line activity region. It SHALL NOT be represented as an agent stage-instruction action or a background-count indicator, and changes between stopped, running, and awaiting approval SHALL NOT introduce another action row or resize the reserved activity region.

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

#### Scenario: Keep deterministic controls on the reserved row

- **WHEN** a deterministic execution starts, stops, or starts waiting for approval and its card changes between Play, Stop, and the approval action
- **THEN** the control remains on the same single activity row
- **AND** the reserved activity-region height is unchanged

### Requirement: Task card status strip

The board SHALL present a card's unresolved context operation, confirmed transition, and automatic-advance state in one status region below the activity region. Each status SHALL carry a tone that distinguishes a failure from a pending state and SHALL present a short label that names the state. A destructive operation's label SHALL use task-deletion or worktree-removal language and SHALL distinguish checking, queued, in progress, and failed states rather than exposing a raw phase token. A status SHALL remain visible while its operation or transition is unresolved. The automatic-advance status SHALL name the destination stage while an advance is admitted, name a failure when an admitted advance failed, and name the pause reason when auto mode is paused, distinguishing a pause requested by the agent from a diagnostic pause. The status region SHALL NOT report the held state defined by Auto mode on a task card, which the auto-mode control presents instead. A run-action admission failure SHALL be reported in the same status region. A failure of the automatic first-execution preparation on task creation SHALL be reported in the same status region. When a card has more than one such fact, the status region SHALL present them together without replacing one with another.

A pause requested by the agent SHALL present the reason the agent recorded, and a diagnostic pause recorded for the same task SHALL remain presented beside it, so a turn that failed while the task was paused is not hidden by the pause.

The same status region SHALL present deterministic execution state defined by `deterministic-steps`, including awaiting approval, running, stopped, and a recoverable execution or handoff failure. Awaiting approval SHALL be presented as a pending status whose label states that the executable version needs approval, and SHALL NOT be presented as an executor failure, an agent turn, or an Auto mode pause. Stopped SHALL NOT be reported as an executor error or an Auto mode pause. These states SHALL coexist with applicable operation, transition, and conversation-derived facts without replacing them, and SHALL NOT disappear merely because a conversation was read.

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

#### Scenario: Report a pause requested by the agent
- **WHEN** a task carries the agent-requested pause
- **THEN** the status region presents a pending-toned status whose label contains the reason the agent recorded
- **AND** the label identifies the pause as requested rather than as a failure

#### Scenario: Present an agent pause beside an advance in flight
- **WHEN** an automatic advance is admitted or has failed while the task carries the agent-requested pause
- **THEN** the status region presents the advance state and the agent's reason together
- **AND** the auto-mode control's tooltip and accessible name carry both

#### Scenario: Present an agent pause and a failed turn together
- **WHEN** a task carries the agent-requested pause while a diagnostic pause is also recorded
- **THEN** the status region presents both statuses
- **AND** neither replaces the other

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

#### Scenario: Report a creation preparation failure
- **WHEN** the automatic first-execution preparation for a newly created task fails
- **THEN** the status region reports the failure
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: Clear a resolved status
- **WHEN** the operation, confirmed transition, or automatic-advance state resolves
- **THEN** the corresponding status is no longer presented in the status region
- **AND** reading a conversation does not clear an automatic-advance pause by itself

#### Scenario: Report a stopped or failed script separately from Auto mode

- **WHEN** a deterministic execution is stopped or fails without a configured error route
- **THEN** the status region identifies the deterministic state and its available recovery
- **AND** it does not fabricate an Auto mode pause or a failed conversation turn
- **AND** the applicable Play action remains available without requiring a stage change

#### Scenario: Report a pending executable approval

- **WHEN** a task's current deterministic entry awaits approval
- **THEN** the status region presents a pending status stating that the executable version needs approval
- **AND** it does not present the approval as a failure, an agent turn, or an Auto mode pause

### Requirement: Card attention surface

The board SHALL present a task's dominant attention state as a tint of the card surface. The dominant state SHALL be selected from the task's attention facts by a fixed priority: a failure, then a pending executable approval, then an awaiting reply, then agent execution, then unread messages. The tint SHALL be the state's attention color mixed into the host surface at a low share, so that the card stays legible as text while its surface reads as area. The tint SHALL NOT be the only presentation of the state: the attention marks defined by Coexisting attention indicators across task conversations SHALL remain presented, including for every state that does not win the surface. The pending executable approval SHALL present the attention mark with the accessible name for awaiting approval, and it SHALL present the status line defined by Task card status strip. The surface SHALL present no tint when none of those states applies. The tint SHALL NOT change the card's height, SHALL NOT add, remove, or reorder a region of the card, and SHALL NOT affect the task's workflow stage, its position, or its drag behavior. Task-level context-operation, confirmed-transition, and automatic-advance state SHALL NOT tint the card; those remain in the status region as defined by Task card status strip.

#### Scenario: Paint the dominant state

- **WHEN** a task has a failure and also has unread messages
- **THEN** the card surface is tinted with the failure color
- **AND** the unread mark is still presented in the context region

#### Scenario: Keep the card text legible

- **WHEN** a card presents a tint in either the host's light or dark appearance
- **THEN** the title, the project name, and the status-region text keep at least 4.5:1 contrast against the painted surface

#### Scenario: Present no tint without attention

- **WHEN** a task has no failure, no pending approval, no awaiting reply, no running agent, and no unread messages
- **THEN** the card surface presents no tint

#### Scenario: Keep the card height stable

- **WHEN** a card gains or loses a tint
- **THEN** its height and the positions of its regions do not change

#### Scenario: Keep status state out of the surface

- **WHEN** a task has a failed context operation and no failure, pending approval, awaiting reply, running agent, or unread message
- **THEN** the card surface presents no tint
- **AND** the status region reports the failed operation

#### Scenario: Keep the tint in selection mode

- **WHEN** the board is in card-selection mode and a card has an attention state
- **THEN** the card still presents its tint
- **AND** the selection control and the selection accent remain presented

#### Scenario: Paint a pending executable approval

- **WHEN** a task's current entry awaits approval and the task has no failure
- **THEN** the card surface is tinted with the attention color
- **AND** the approval mark is presented in the context region
- **AND** the status region names the pending approval

#### Scenario: A failure outranks a pending approval

- **WHEN** a task has a failure and also waits for executable approval
- **THEN** the card surface is tinted with the failure color
- **AND** the approval mark and status line remain presented

### Requirement: Attention marks keep a readable size in the diagram

The board SHALL present each attention mark at a readable on-screen size in the column board and in the workflow diagram. A mark's on-screen size SHALL remain constant while the diagram's zoom is between 0.29 and 1, SHALL follow the diagram's zoom above 1, and SHALL NOT exceed 3.5 times its authored size at any zoom, including the diagram's minimum zoom. Marks SHALL remain circles in the fixed order of approval, unread, awaiting reply, and failure; each mark SHALL keep its own accessible name at every zoom, so marks that share a color remain distinguishable by their order and name. The card SHALL NOT present a mark for agent execution.

#### Scenario: Keep a constant size above the bound

- **WHEN** the workflow diagram presents a workflow at zoom 1 or at zoom 0.5
- **THEN** each attention mark renders at its authored on-screen size

#### Scenario: Bound the size at the minimum zoom

- **WHEN** the workflow diagram presents a workflow at its minimum zoom of 0.2
- **THEN** each attention mark renders at no more than 3.5 times its authored size
- **AND** it remains visible

#### Scenario: Present the authored size in the column board

- **WHEN** the board presents its columns instead of the diagram
- **THEN** each attention mark renders at its authored on-screen size

#### Scenario: Keep the marks named

- **WHEN** assistive technology reads a card that presents attention marks at any zoom
- **THEN** each mark exposes the name of its state

#### Scenario: Keep the approval mark named

- **WHEN** a card waits for executable approval
- **THEN** its approval mark exposes the name for awaiting approval
- **AND** it does not reuse the awaiting-reply name

## ADDED Requirements

### Requirement: Board approval queue

The active board SHALL present an approval queue while at least one card of that board waits for executable approval. The queue SHALL present one item per unapproved executable version of a board stage, together with the number of cards waiting for that version and the project identities only when more than one project waits. The queue SHALL NOT present one item per card. Activating an item SHALL open the executable-version review defined by `deterministic-steps` for that version. Approving from the queue SHALL resume the waiting entries as defined by `deterministic-steps`, and the item SHALL disappear once no card remains waiting for that version. The queue SHALL NOT be dismissible while it holds an item, SHALL NOT claim an agent turn or a failed conversation turn, and SHALL coexist with the board's other notices without replacing them. The queue SHALL NOT include an approved version or a version with no waiting card.

#### Scenario: List one item per waiting version

- **WHEN** four cards of one stage wait for the same executable version, and one card of another stage waits for a different version
- **THEN** the queue presents two items
- **AND** the first names four waiting cards and the second names one

#### Scenario: Open the review from the queue

- **WHEN** the user activates a queue item
- **THEN** the board opens the review for that exact executable version
- **AND** approving it resumes every waiting card of that version

#### Scenario: Remove a resolved item

- **WHEN** the last waiting card of an executable version starts after approval
- **THEN** the queue no longer presents that item

#### Scenario: Keep the queue while work is pending

- **WHEN** the queue holds an item
- **THEN** the queue presents no dismissal control
- **AND** it remains presented across a reload until the approval or the waiting entry resolves

#### Scenario: Do not claim an agent turn

- **WHEN** the queue presents a waiting executable version
- **THEN** no card is presented as running an agent because of that item
- **AND** no conversation attention is fabricated
