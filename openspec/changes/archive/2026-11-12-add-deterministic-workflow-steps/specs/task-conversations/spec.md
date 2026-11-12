# Task Conversations Delta

## MODIFIED Requirements

### Requirement: Task drawer sections

Opening a task card SHALL display a task drawer with a header and Conversations, Info, Git, Notes, and History sections. The header SHALL present the task title on one line with an ellipsis when it does not fit, the task's project as a chip beside the title, the section navigation, the workflow stage control, and the task's remaining header actions. The title's full text SHALL remain available through its tooltip, and the project SHALL NOT be repeated on a second header line. Conversations SHALL contain the task's native DSH chats, Info SHALL expose the task's title and Markdown description, Git SHALL expose its simplified worktree controls, Notes SHALL expose its shared task notes, and History SHALL present the task's recorded flow as defined by the History table in the task drawer requirement in `task-history`.

The section navigation SHALL be presented in the header as icon-only tabs. Each tab SHALL keep the section name in its accessible name and SHALL expose that name as a tooltip; the Conversations tab SHALL extend both with the activity facts defined by Drawer conversation activity indicator. The selected section SHALL be visibly distinguishable, and the tabs SHALL keep their keyboard navigation. The drawer SHALL keep the task title, the section navigation, and the conversation controls visible at every supported drawer width; when the available width cannot present them in one row, the header SHALL wrap into two rows instead of hiding a control.

The workflow stage control SHALL be presented in the drawer header and SHALL list every workflow stage in workflow order, including the current stage. Stages that the active board's workflow does not permit from the current stage SHALL remain selectable and SHALL be presented with lower visual emphasis than permitted stages, with the restriction also available to assistive technology. Selecting a permitted stage SHALL move the task immediately; when the task has no conversation and the destination has an entry instruction, the execution preparation defined by Execution preparation before a task's first execution in `kanban-board` SHALL be presented first, and the task SHALL NOT move until that preparation completes. Selecting a restricted stage SHALL require the explicit confirmation defined by the Explicit confirmation for a restricted transition requirement; when the confirmed destination would start the task's first execution, that preparation SHALL follow the confirmation and precede the move. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement in `kanban-board`; the drawer SHALL present that countdown notice above its section panel and SHALL expose the same cancel action. The drawer SHALL NOT insert text into the composer for a stage change.

The header SHALL also present the task's auto-mode control defined by Auto mode on a task card in `kanban-board`, with the same pressed state, effect, indication, and enabled or disabled behavior as the card control, including the held state while the task has pending user work. The auto-mode control's accessible name and tooltip SHALL carry the automatic-advance state, including the destination stage while an advance is admitted, the failure when an admitted advance failed, and the pause reason when auto mode is paused. The drawer SHALL NOT add a separate automatic-advance notice above its section panel, SHALL NOT add a separate entry for the held state, and SHALL NOT make reading or acknowledging a conversation clear a pause. An admitted or failed advance SHALL remain presented through the task's transition status as before.

The drawer SHALL additionally expose the current deterministic execution state and its applicable Stop and Play controls as defined by `deterministic-steps`, independently of Auto mode and of whether a native conversation exists. These controls and their action-local progress SHALL remain available without selecting a conversation or changing the current section. Their execution ownership SHALL follow the durable activation or control state of the current entry rather than a later saved stage mode; an owned active run SHALL keep Stop after a saved agent/manual mode change. Play SHALL not substitute an agent instruction when the latest configuration is no longer valid deterministic configuration and SHALL instead explain the configuration or new-entry action required. A script failure or trust request SHALL NOT be presented as a failed or unread conversation turn. A stage change through the header SHALL revoke the prior deterministic run when the move is accepted and SHALL admit a deterministic destination's entry subject to its own authorization, without an agent countdown, model preparation, or composer mutation. The section list, ordinary agent countdown, conversation controls, and automatic-advance status behavior SHALL otherwise remain unchanged.

#### Scenario: Open a task from the board
- **WHEN** a user opens a card on the Kanban board
- **THEN** the drawer header shows the task title, its project as a chip beside the title, and the section navigation
- **AND** the workflow stage control is part of that header
- **AND** the drawer provides Conversations, Info, Git, Notes, and History without replacing the card interaction with a separate main-chat navigation flow
- **AND** History is presented after Notes
- **AND** the project is not repeated on a second header line

#### Scenario: Keep the header compact at a narrow width
- **WHEN** the drawer is narrow enough that the title, section navigation, and conversation controls cannot share one row
- **THEN** the header wraps into two rows
- **AND** no header control or section is hidden
- **AND** the title truncates with an ellipsis instead of wrapping

#### Scenario: Present icon-only section navigation
- **WHEN** the user inspects the drawer header
- **THEN** each section is an icon-only tab
- **AND** each tab keeps its section name in its accessible name and tooltip
- **AND** the Conversations tab extends both with its activity facts
- **AND** the selected section is visibly distinguishable
- **AND** arrow-key navigation between the tabs keeps working

#### Scenario: List the complete workflow
- **WHEN** the user opens the drawer for a task
- **THEN** the stage control lists every workflow stage in workflow order
- **AND** the current stage is included

#### Scenario: Present restricted stages with lower emphasis
- **WHEN** the active board's workflow does not permit a transition from the current stage to another listed stage
- **THEN** that stage is presented with lower visual emphasis than permitted stages
- **AND** it remains selectable
- **AND** its restriction is available to assistive technology without adding visible explanatory text

#### Scenario: Change stage from the drawer
- **WHEN** the user selects a permitted destination from the drawer's stage control
- **THEN** the same workflow transition rules apply as for a board drop
- **AND** the task moves immediately after any required first-execution preparation
- **AND** the drawer stays in its current section
- **AND** an instructed destination presents the countdown notice with the stage and remaining time
- **AND** the composer is not changed

#### Scenario: Prepare the first execution from the drawer
- **WHEN** the user selects a permitted instructed destination for a task that has no conversation
- **THEN** the execution preparation is presented before the task moves
- **AND** the task remains in its current stage until the preparation completes
- **AND** canceling the preparation leaves the task in its current stage and the drawer in its current section

#### Scenario: Change to a restricted stage from the drawer
- **WHEN** the user selects a destination that the workflow does not permit from the current stage
- **THEN** the same explicit confirmation applies as for a restricted board drop
- **AND** the task remains in its current stage until the user confirms
- **AND** canceling leaves the task in its current stage and the stage control at its current value
- **AND** after confirmation, any required first-execution preparation is presented before the move
- **AND** after confirmation, an instructed destination presents the countdown notice instead of writing to the composer

#### Scenario: Cancel a drawer countdown
- **WHEN** the user cancels from the drawer's countdown notice
- **THEN** no instruction is sent
- **AND** the task stays in the destination stage at the same position
- **AND** the drawer stays in its current section
- **AND** the card exposes the stage run action for the unresolved entry

#### Scenario: Change to an uninstructed stage
- **WHEN** the user selects a destination without an entry instruction
- **THEN** the task moves after any required confirmation
- **AND** the drawer stays in its current section
- **AND** no countdown is armed
- **AND** no composer draft is created by the change

#### Scenario: Execution status stays visible across sections
- **WHEN** the open task is running an owned agent or owns unsettled background work and the user switches between the drawer's sections
- **THEN** the conversation activity indicator remains visible on the Conversations section tab on every section

#### Scenario: Execution status follows a delegated subagent
- **WHEN** the task's assistant turn ends while an owned subagent descendant is still running
- **THEN** the conversation activity indicator keeps presenting the agent execution state

#### Scenario: Execution status clears when the turn ends
- **WHEN** the last owned agent and the last background activity of the open task have settled
- **THEN** the conversation activity indicator stops presenting that state without a reload

#### Scenario: Toggle auto mode from the drawer
- **WHEN** the user activates the auto-mode control in the drawer header
- **THEN** the setting changes exactly as the card control changes it
- **AND** the drawer stays in its current section
- **AND** the task's stage and position are unchanged

#### Scenario: Mirror the held auto-mode state
- **WHEN** the open task has auto mode enabled and pending user work
- **THEN** the drawer's auto-mode control presents the held state
- **AND** the control's accessible name states what the user still owes the task
- **AND** no separate entry for that state is added above the section panel

#### Scenario: Present an admitted automatic advance
- **WHEN** an automatic advance is admitted for the open task
- **THEN** the auto-mode control's accessible name and tooltip name the destination stage
- **AND** the drawer does not add a separate notice above the section panel
- **AND** the drawer does not change sections

#### Scenario: Present a paused automatic advance
- **WHEN** auto mode is paused for the open task
- **THEN** the auto-mode control's accessible name and tooltip carry the pause reason
- **AND** the drawer does not add a separate notice above the section panel
- **AND** reading the conversation does not clear it

#### Scenario: Present a failed automatic advance
- **WHEN** an admitted automatic advance fails for the open task
- **THEN** the auto-mode control carries the failure state
- **AND** the task transition status keeps presenting the failure
- **AND** the stage run action remains available for an unresolved destination entry

#### Scenario: Control a script from the current drawer section

- **WHEN** the user inspects Info, Git, Notes, or History for a task in a deterministic stage
- **THEN** the current deterministic state and applicable Stop or Play action remain reachable
- **AND** invoking that action does not change the selected section, insert a composer draft, or create a conversation

### Requirement: Drawer conversation activity indicator

The drawer SHALL present the task's agent execution status and unsettled background activity through a single activity indicator on the Conversations section tab. The indicator SHALL remain visible while the user inspects any of the drawer's sections. It SHALL be presented as a dot without text, and it SHALL pulse while at least one agent owned by the task's conversations is running or while the task owns unsettled background work. The indicator SHALL NOT visually distinguish agent execution from background activity. Its accessible name and tooltip SHALL name the facts behind the indicator, including the labels of the task's unsettled background activities, and SHALL stop reporting background activity when none remains. Agent execution SHALL include the task conversations' own assistant turns and their owned subagent descendants, and a running owned subagent SHALL NOT be reported as background activity. The drawer header SHALL NOT present a separate Working or Background line, and the indicator SHALL NOT introduce a second live region for this state.

A directly owned active deterministic script SHALL be included among the task's non-agent activity facts even when no native conversation exists. The indicator's tooltip and accessible name SHALL identify that script activity without calling it an assistant turn or creating a conversation tab. When no other activity remains, a stopped, failed, or untrusted deterministic entry SHALL NOT keep the indicator pulsing merely because it needs an action; its deterministic status SHALL remain available through the drawer controls.

#### Scenario: Show the indicator while an agent runs
- **WHEN** the user opens the drawer for a task whose conversation is running an owned agent
- **THEN** the Conversations section tab presents a pulsing activity dot

#### Scenario: Keep the indicator visible from another section
- **WHEN** the user selects Info, Git, or Notes while the task is running an owned agent
- **THEN** the Conversations section tab keeps presenting the pulsing activity dot

#### Scenario: Name the background activity in the tooltip
- **WHEN** the user opens the drawer for a task that owns unsettled jobs or schedules
- **THEN** the activity indicator pulses
- **AND** its accessible name and tooltip name the labels of those activities

#### Scenario: A running subagent is execution, not background activity
- **WHEN** the main assistant turn has ended and an owned subagent descendant is still running
- **THEN** the activity indicator keeps presenting the execution state
- **AND** the subagent is not named as background activity

#### Scenario: Clear the indicator when the task settles
- **WHEN** the last owned agent and the last background activity of the open task have settled
- **THEN** the activity indicator stops presenting that state without a reload

#### Scenario: Do not duplicate the status as header text
- **WHEN** the task is running an owned agent and also owns background activity
- **THEN** the drawer header presents neither a Working line nor a Background line
- **AND** the single activity indicator carries both facts

#### Scenario: Represent a script without a conversation tab

- **WHEN** a task with no native conversation is running a deterministic script
- **THEN** the drawer activity indicator reports the task-owned script activity
- **AND** no native conversation tab, agent execution, or conversation attention is fabricated
- **AND** stopping the only active script clears the activity indicator without hiding its stopped status

### Requirement: Nested native conversation tabs

A task SHALL begin with no native DSH conversation in its Conversations section. The section SHALL provide an explicit start action, presented as the agent-preset cards, that creates the first distinct native DSH conversation as a tab within the same task, and a plus action that opens the same preset choice to create another distinct native DSH conversation. The first conversation SHALL be created only by that explicit choice, by the execution preparation that precedes a task's first execution, including the automatic first-execution preparation on task creation, by a stage instruction that needs a conversation and finds none open, including a stage instruction dispatched from a card, a confirmed transition, or an automatic advance, or by a cross-card message delivery that needs a conversation and finds none open. When an execution preparation creates the first conversation, it SHALL do so after the worktree is ready and before the move or run action is applied, and the conversation SHALL use that directory. For a Git-backed task without a worktree, the explicit start action SHALL remain unavailable until the worktree choice is resolved as defined by `worktree-management`. The first conversation SHALL use the task's current effective directory at creation time. A conversation created from a card SHALL receive the card's preset; conversations created by the execution preparation, including the automatic creation preparation, by a stage instruction, or by a cross-card message delivery use the board's default model when the board names one and the deployment default otherwise.

A deterministic entry SHALL NOT create a conversation, select a preset or model, or start a model turn solely to execute code. A task whose first execution is deterministic SHALL remain able to have zero native conversations. When that execution later selects an agent destination whose instruction needs a conversation, the host SHALL create or resolve only the conversation required by that instruction using the normal directory and board-model rules; the deterministic handoff SHALL accompany the instruction. A script or manual destination SHALL receive or retain its handoff without creating a conversation.

#### Scenario: Open a newly created task

- **WHEN** a user opens a newly created task's Conversations section and its creation did not start the first execution
- **THEN** no native conversation tab exists
- **AND** the agent-preset cards and the plus action are available, subject to the worktree choice

#### Scenario: Open a created task that started

- **WHEN** a user opens a newly created task whose creation started the agent first-execution preparation
- **THEN** the first native DSH conversation created by the preparation is present as a tab
- **AND** it uses the task's effective directory resolved by the preparation

#### Scenario: Start the first conversation

- **WHEN** the user selects a preset card as the first conversation's start action
- **THEN** a native DSH conversation tab is added
- **AND** the card's preset is selected on that conversation
- **AND** its native session uses the task's current effective directory

#### Scenario: Add another continuous conversation

- **WHEN** the user selects the plus action in a task that already has a conversation and then selects a preset card
- **THEN** a new native DSH conversation is added as another tab associated with that same task
- **AND** the card's preset is selected on that conversation

#### Scenario: Prepare the first conversation

- **WHEN** an execution preparation runs for a task that has no conversation
- **THEN** the first native DSH conversation is created after the worktree choice is resolved
- **AND** it is created before the move or run action is applied
- **AND** it uses the task's current effective directory

#### Scenario: Prepare the first conversation on task creation

- **WHEN** the automatic first execution on task creation prepares a task with no conversation
- **THEN** the first native DSH conversation is created after the default worktree is ready
- **AND** it uses the worktree directory, or the project directory for a folder project
- **AND** no preset is selected and no model selector is presented

#### Scenario: A stage instruction creates the first conversation

- **WHEN** a stage instruction needs a conversation, the task has no open conversation, and no execution preparation applies, for example a dispatched confirmed transition or an automatic advance
- **THEN** the first native DSH conversation is created in the task's current effective directory
- **AND** the stage instruction is sent to it

#### Scenario: An automatic advance creates the first conversation

- **WHEN** an automatic advance needs a conversation and the task has no open conversation
- **THEN** one native DSH conversation is created
- **AND** the destination instruction is sent to it

#### Scenario: A cross-card message creates the first conversation

- **WHEN** a cross-card message delivery needs a conversation and the target task has no open conversation
- **THEN** the first native DSH conversation is created after the task's worktree or base-project preparation completes
- **AND** the cross-card message is delivered to that conversation
- **AND** the conversation uses the board's default model when the board names one and the deployment default otherwise, rather than a card preset

#### Scenario: Withhold the explicit start until the worktree choice

- **WHEN** the user requests the explicit first start for a Git-backed task with no worktree, no recorded base-project choice, and no conversation
- **THEN** no conversation is created
- **AND** the Conversations section presents the pending worktree choice

#### Scenario: Start the first conversation after a worktree choice

- **WHEN** the task has a ready worktree, an attached worktree, or a recorded base-project choice
- **THEN** the card start creates the first conversation at the task's current effective directory

#### Scenario: Run a deterministic first stage without creating a chat

- **WHEN** a newly created task enters a deterministic initial stage
- **THEN** its script-only execution has no native conversation tab
- **AND** the normal explicit native conversation actions remain available under their existing preconditions

#### Scenario: Create a conversation only for a downstream agent instruction

- **WHEN** a deterministic output enters an agent stage and the task has no open conversation
- **THEN** one conversation is created in the task's effective directory for that agent instruction
- **AND** the instruction includes the identified deterministic handoff
- **AND** no conversation was required for the source script

### Requirement: Host compatibility for the conversation window

The client SHALL render the public `conversation.window` occurrence when the running host declares it. When the Factory is not declared, the drawer SHALL present an explicit notice that the DSH version must be updated and SHALL NOT render a blank conversation area, a manually assembled header, or a plugin-owned replica of the window. The plugin SHALL use the supported DSH 0.2.2 compatibility baseline defined by `plugin-distribution` and SHALL NOT retain 0.2.1-rc.2 as an installation constraint or require a DSH patch. The absence of this public window capability SHALL remain an explicit update diagnostic rather than justification for a plugin-owned replica.

#### Scenario: Render on a supported host

- **WHEN** the plugin runs on a DSH host that declares `conversation.window`
- **THEN** the drawer renders the host window without a DSH patch

#### Scenario: Report an unsupported host

- **WHEN** the running DSH host does not declare `conversation.window`
- **THEN** the drawer presents an explicit notice that the DSH version must be updated
- **AND** it does not present an empty conversation area as if the conversation were unavailable

#### Scenario: Do not resurrect the manual header

- **WHEN** the Factory is unavailable
- **THEN** the drawer does not fall back to a hand-assembled native header or a plugin-owned header replica

### Requirement: Stage instruction delivery as context

When a task's current stage has an entry instruction and the host delivers that instruction to a task conversation, the host SHALL deliver exactly one plugin-sourced native message and SHALL NOT send it as a user prompt. The message SHALL start the turn that executes the instruction. Its durable source SHALL identify the stage-instruction producer and the delivery identity. Its model-facing content SHALL be the entry instruction, then the reason the recorded transition carried when the advance consumed one, then an identified deterministic handoff block when one is pending for this entry, then the transition briefing defined by `kanban-board` when that briefing applies.

The reason SHALL appear only when the delivery follows a transition the agent declared for the stage the task left, and SHALL be presented as its own block that names the stage the task came from and quotes the reason the agent recorded. A delivery that consumed no recorded reason SHALL contain no reason block.

The message SHALL declare the host's notice context form with a one-line summary. The summary SHALL name the entering stage and, when a transition destination applies, that destination — the task's recorded transition while it resolves, otherwise the first configured transition, otherwise the next stage in workflow order. A stage with no applicable destination SHALL produce a summary that names only the entering stage. The summary SHALL be bounded by the host's notice-summary limit and SHALL NOT include the reason block.

The plugin SHALL claim the message with an exclusive Chat Definition and SHALL present it with the host's native context-injection presentation as part of the transcript flow: one collapsed row that expands to the full instruction text, including the declared-reason block, deterministic handoff block, and briefing when they apply. If that presentation is unavailable, an inline fallback row SHALL preserve the full text. The row SHALL be visible wherever the task conversation is rendered, including the task drawer and ordinary native DSH chat.

The delivery SHALL NOT be recorded as user input. It SHALL NOT be presented as a user message, SHALL NOT count as pending user work, and SHALL NOT derive a conversation title.

A delivery SHALL be admitted at most once per delivery identity. Before delivering, the host SHALL read the conversation's durable log and SHALL NOT deliver another message when a stage-instruction message with the same identity is already delivered or still pending. A delivery that has a recorded failure SHALL report the failure, SHALL leave the stage entry unresolved, and SHALL NOT be retried automatically, including after a host restart. A durable deterministic handoff whose admission was interrupted or uncertain without a recorded delivery failure SHALL instead be reconciled on startup using its same delivery identity: the host SHALL first recognize already-recorded or pending context and SHALL resume only the interrupted admission when needed. This reconciliation SHALL NOT rerun the source script, duplicate accepted context, or turn a recorded failure into an automatic retry.

A deterministic handoff block SHALL identify the source stage and execution, the named exit, the output message, and its delivery provenance. It SHALL remain separate from an agent-declared reason: a script result SHALL NOT fabricate a declaration or populate the agent's recorded-transition reason. The block SHALL accompany the destination's own instruction within the same identified native context message, not as a second user prompt or a second model turn. Its message SHALL NOT be included in the collapsed summary, SHALL NOT derive a conversation title, and SHALL NOT repeat the conversation's first-turn task context. Known secret values SHALL be redacted before persistence or display as defined by `deterministic-steps`. A source recovery or delivery retry SHALL preserve the same delivery identity, and a handoff bound to another stage entry SHALL NOT be injected here. At actual native admission, after every awaited conversation resume, execution-context check, and durable-log read, the host SHALL confirm that both the destination entry identity and the handoff delivery identity are still authorized for the task. The final identity check and context enqueue SHALL be serialized with entry replacement. Matching only the stage identifier or finding no duplicate message SHALL NOT authorize delivery into an entry that has been replaced.

#### Scenario: Deliver the instruction as context

- **WHEN** the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, or the first execution of a task created by an agent delivers a stage instruction
- **THEN** the conversation receives one plugin-sourced stage-instruction message
- **AND** that message starts the turn that executes the instruction
- **AND** its content is the entry instruction, then the declared transition's reason when one applies, then the deterministic handoff when one applies, then the transition briefing when the stage configures two or more targets

#### Scenario: Include the declared reason

- **WHEN** an advance follows a transition the agent declared and the destination stage has an entry instruction
- **THEN** the delivered message contains the reason block after the instruction
- **AND** the block names the stage the task came from and quotes the recorded reason
- **AND** the deterministic handoff, when it applies, follows the reason block
- **AND** the transition briefing, when it applies, follows those context blocks

#### Scenario: Omit the reason without a declared transition

- **WHEN** a stage instruction is delivered for a move or an advance that consumed no recorded reason
- **THEN** the delivered message contains no reason block
- **AND** its content is the instruction followed by any pending deterministic handoff and then the briefing when that briefing applies

#### Scenario: Do not record user input

- **WHEN** a stage instruction is delivered
- **THEN** no user message records it
- **AND** the conversation's pending user work does not count it
- **AND** no conversation title is derived from it

#### Scenario: Present the native context row

- **WHEN** a delivered stage instruction is displayed in a task conversation
- **THEN** it appears as a collapsed context-injection row at its position in the transcript
- **AND** expanding the row shows the instruction text, the declared-reason block, deterministic handoff, and briefing when they apply
- **AND** the plugin Definition delegates to the host renderer, with an inline fallback that keeps the text visible

#### Scenario: Name the stage and its target in the summary

- **WHEN** the summary is composed for a task whose stage configures transition targets and whose recorded transition resolves
- **THEN** the summary names the entering stage and the recorded target
- **AND** the summary stays within the host's notice-summary limit

#### Scenario: Keep the reason out of the summary

- **WHEN** the delivered message carries a reason block
- **THEN** the collapsed summary does not include the reason

#### Scenario: Name the default target without a recording

- **WHEN** the summary is composed for a stage that configures transition targets and the task has no recorded transition for that stage
- **THEN** the summary names the entering stage and the first configured target

#### Scenario: Name the next stage without configured transitions

- **WHEN** the summary is composed for a stage that configures no transition and a later stage exists in workflow order
- **THEN** the summary names the entering stage and that next stage

#### Scenario: Omit the target when none applies

- **WHEN** the summary is composed for a stage with no applicable destination — no recorded transition, no configured transition, and no later stage in workflow order
- **THEN** the summary names only the entering stage

#### Scenario: Visible in ordinary native chat

- **WHEN** a task conversation containing a delivered stage instruction is opened in ordinary native DSH chat
- **THEN** the context-injection row is visible there as well
- **AND** the presentation is the same as in the drawer

#### Scenario: Deliver at most once per identity

- **WHEN** a delivery is repeated with an identity already recorded or still pending in the conversation
- **THEN** no second stage-instruction message is delivered
- **AND** the conversation keeps the first message

#### Scenario: Report a failed delivery

- **WHEN** a stage-instruction delivery fails
- **THEN** the failure is reported
- **AND** the stage entry remains unresolved
- **AND** no automatic retry occurs

#### Scenario: Deliver a deterministic result with the destination instruction

- **WHEN** a saved deterministic result selects an agent destination while Auto mode is disabled
- **THEN** the destination conversation receives its own entry instruction and one identified handoff block in the same native context message
- **AND** the block contains the named exit and redacted message without pretending an agent declared a transition
- **AND** Auto mode remains disabled
- **AND** no user message, queued user work, or second model turn is created for the handoff

#### Scenario: Reconcile an interrupted deterministic admission

- **WHEN** the host restarts with a durable deterministic handoff whose native admission was interrupted and has no recorded delivery failure
- **THEN** recovery checks the same delivery identity against recorded and pending native context
- **AND** it resumes only the unfinished admission when no prior admission exists
- **AND** it does not run the source script again

#### Scenario: Keep an actual deterministic delivery failure manual after restart

- **WHEN** a deterministic handoff has a recorded delivery failure and the host restarts
- **THEN** the failure and unresolved destination entry remain visible
- **AND** no automatic delivery retry is performed
- **AND** a user-requested retry retains the same delivery identity

#### Scenario: Do not duplicate a recovered deterministic handoff

- **WHEN** host recovery retries delivery of a deterministic handoff whose native context identity is already recorded or pending
- **THEN** no second context message or handoff block is delivered
- **AND** the source script is not executed again to recover that delivery

#### Scenario: Reject combined context when admission awaits outlive the entry

- **WHEN** native instruction admission awaits conversation or log reads and the task leaves and reenters the same stage before final admission
- **THEN** the replaced destination entry identity causes the old instruction and handoff request to be rejected
- **AND** neither the stale prompt nor its context is enqueued even when the stage identifier matches and no duplicate delivery exists

## ADDED Requirements

### Requirement: Manual destination handoff before explicit conversation execution

When a deterministic result enters a manual destination and preserves a handoff for that exact entry, the host SHALL inject it as identified plugin-sourced native context before the input of the next explicit native conversation execution in that entry. This SHALL cover an explicit user prompt or a turn initiated by the user's normal native preset action when that action actually executes. Merely opening a preset or conversation SHALL NOT force a turn. The handoff SHALL contain its named exit, redacted message, and source provenance and SHALL use native inline context presentation with an inline fallback. It SHALL NOT become user input, pending user work, a system prompt, or composer text, start a second turn, or derive a conversation title. First-turn task context SHALL NOT be repeated; when it also applies, that context SHALL precede the handoff and explicit input.

The handoff SHALL NOT create or select a conversation itself. Explicit conversation creation through the normal preset or plus action SHALL keep native creation and model rules unchanged; the handoff SHALL wait for that conversation's eligible execution. Native execution and permission gates SHALL run before consuming it. Rejected or canceled admission SHALL retain it unless durable native state proves the same identified context was admitted. Injection SHALL be admitted at most once for the destination entry and handoff delivery identity, including across concurrent conversations and restart. A later entry into the same stage SHALL NOT receive an unrelated old entry's handoff.

After every awaited resume, execution-context, or durable-history read, actual native admission SHALL still require the current destination entry identity and authorized handoff delivery identity. The final identity check and context enqueue SHALL be serialized with entry replacement. Neither a matching stage identifier nor message deduplication SHALL authorize injection into a replaced entry.

#### Scenario: Inject before an explicit user message in the manual destination

- **WHEN** a task remains in its manual destination entry with a pending deterministic handoff and the user sends a native conversation message
- **THEN** that same execution receives the identified handoff before the user input
- **AND** the composer text and attachments are unchanged
- **AND** no additional turn is started for the handoff

#### Scenario: Wait for normal explicit conversation creation

- **WHEN** the manual destination has no native conversation and a pending handoff
- **THEN** the handoff alone creates no conversation or turn
- **AND** the user can create a conversation through the normal native preset action
- **AND** the handoff is injected only when an eligible explicit execution in that entry is admitted

#### Scenario: Preserve a handoff when execution is not admitted

- **WHEN** native execution or permission gates reject or cancel execution before handoff context is admitted
- **THEN** the handoff remains pending for the same destination entry
- **AND** no model turn or task-history handoff acceptance is fabricated

#### Scenario: Do not inject the manual handoff twice

- **WHEN** concurrent attempts or restart encounter the same already-admitted entry and handoff delivery identity
- **THEN** at most one identified handoff context is admitted
- **AND** later conversation executions in that entry do not repeat it

#### Scenario: Keep a manual handoff out of an unrelated later visit

- **WHEN** a task leaves a manual entry and later returns to the same stage with a different entry identity
- **THEN** the old entry's pending or consumed handoff is not injected into the new entry

#### Scenario: Reject a manual handoff replaced during admission

- **WHEN** manual pre-step handoff admission awaits native reads and the task moves away and returns to the same stage before final enqueue
- **THEN** the replaced entry identity invalidates the old handoff request
- **AND** no stale context is injected even if the stage identifier matches and the old delivery does not appear in the log
