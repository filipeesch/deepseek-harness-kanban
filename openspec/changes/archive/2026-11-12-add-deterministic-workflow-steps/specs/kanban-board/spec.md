# Kanban Board Delta

## MODIFIED Requirements

### Requirement: YAML workflow configuration

Each board SHALL support its own workflow configuration in YAML, including the initial stage, grouped columns, allowed transitions with an optional condition for each target, optional stage entry instructions, each stage's stored placement, each stage's stored size, the board's default presentation, and an optional stable stage identity for each stage. A transition entry SHALL be authored either as a bare target identifier or as a mapping that carries the target identifier and an optional condition. Both forms SHALL be accepted, neither form SHALL be deprecated, both forms SHALL describe the same transition, and a single list MAY mix them. The condition SHALL describe when that transition is followed; it SHALL NOT change which transitions the workflow permits. The active board's workflow SHALL be used for rendering, transitions, and task creation. The product SHALL honor configured transition restrictions by requiring explicit confirmation before a restricted transition can proceed, and it SHALL honor column grouping.

A stage's stable identity SHALL be a value distinct from the stage identifier, SHALL be unique within the board, SHALL be preserved when the identifier or any other stage field is edited, and SHALL be preserved by every edit that does not present it. A workflow whose stages carry no stable identity SHALL be accepted: the configuration is valid without one, and an identity SHALL be assigned before the stage is published to a team. An authored field the editor does not present SHALL survive an edit unchanged.

This version SHALL NOT implement WIP limits and SHALL NOT introduce reusable workflow templates.

A stage SHALL additionally support the deterministic configuration defined by `deterministic-steps`. A deterministic stage SHALL NOT author a nonempty entry instruction or an allowed transitions list. Its named exit mappings SHALL be its configured destinations for workflow access and graph presentation; several exits MAY resolve to the same destination, which SHALL be presented once as a destination without collapsing the exit names. A deterministic stage SHALL NOT obtain a default route from the first exit or from workflow order. Exit names SHALL NOT be executable interpretations of a legacy transition condition, and legacy conditions SHALL retain their documentary meaning. A script SHALL NOT supply or override a destination stage identifier.

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

#### Scenario: Accept a bare transition identifier

- **WHEN** a stage configures a transition as a bare target identifier
- **THEN** the workflow is accepted and the transition is drawn and followed as before

#### Scenario: Accept a transition with a condition

- **WHEN** a stage configures a transition as a mapping with a target identifier and a condition
- **THEN** the workflow is accepted and the condition is kept with that transition

#### Scenario: Accept a mixed transition list

- **WHEN** one stage mixes bare target identifiers and conditioned transitions in the same list
- **THEN** the workflow is accepted and every entry describes one transition

#### Scenario: Reject a transition to an unknown stage

- **WHEN** a stage configures a transition whose target stage does not exist
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Keep the permitted set unchanged by a condition

- **WHEN** a stage configures the same targets with and without conditions
- **THEN** the same requests are permitted and the same requests require confirmation

#### Scenario: Keep a stage identity across an identifier rename

- **WHEN** a workflow configuration carries a stable identity for a stage and that stage's identifier is edited
- **THEN** the stage keeps its stable identity
- **AND** the resulting workflow is accepted

#### Scenario: Accept a workflow without stage identities

- **WHEN** a board whose stages carry no stable identity is opened
- **THEN** the configuration is accepted and the board renders normally
- **AND** no identity is fabricated while the board stays unpublished

#### Scenario: Preserve an authored identity the editor does not present

- **WHEN** the user edits one stage of a workflow whose stages carry stable identities
- **THEN** every stage keeps its authored identity
- **AND** no identity is moved to another stage

#### Scenario: Accept a deterministic stage without changing legacy conditions

- **WHEN** a workflow configures a deterministic stage with named exits and another stage with documentary transition conditions
- **THEN** the deterministic configuration is validated by the same workflow semantics as the host
- **AND** its exits determine its configured destinations without selecting a default exit
- **AND** the other stage retains its conditions and permitted targets unchanged

### Requirement: Top-level task creation
The active board SHALL provide the New task action in each of its presentations: at the top of its workflow's configured initial column in the column board, and in the header of that stage in the workflow diagram as defined by `workflow-view` Task creation in the initial stage. The two presentations SHALL open one shared creation experience, and neither SHALL build creation inputs, enablement, or receipt handling of its own. It SHALL collect a title, description, and project, an Auto mode option that is off by default, and, only when the initial stage has an entry instruction, a Start execution now option that is on by default. The project input SHALL offer only the projects of the active Hub that the active board allows, as defined by Board project scope configuration; a project that the board does not allow SHALL NOT be offered and SHALL NOT be accepted. The project input SHALL start unselected and SHALL be required; the board SHALL NOT preselect a project, including when a project filter is active. A board that allows no project SHALL present no selectable project and SHALL explain that the board accepts no new task, and saving SHALL be unavailable. Saving a new task SHALL place it in the active board's configured initial stage whichever presentation opened it, and SHALL record the selected auto-mode value. The board SHALL NOT offer any other stage as a creation target. When the initial stage has an entry instruction and the Start execution now option remains enabled, saving SHALL start the automatic first execution defined by Automatic first execution on task creation. Otherwise, saving SHALL NOT create a native DSH conversation, a workspace, or an agent execution. The board header SHALL NOT provide a separate New task action.

Creating a task directly in a deterministic initial stage SHALL create a new entry governed by `deterministic-steps`, even when Auto mode is disabled. The request to activate that entry SHALL be durably recorded in the same operation that creates the task and entry, before reading the program file, capturing code, resolving credentials, or asking for trust; a crash between creation and those later activities SHALL not lose the activation intent. The Start execution now option and agent first-execution preparation SHALL NOT apply to that entry. The host SHALL admit the deterministic entry without creating a conversation, model selection, or worktree solely to execute its script; execution SHALL wait for the required local trust and variables rather than implying authorization from creation.

#### Scenario: Open task creation from the board
- **WHEN** the user selects the New task action at the top of the active board's configured initial column
- **THEN** the creation experience provides title, description, project, and Auto mode inputs without asking the user to choose a stage
- **AND** it presents Start execution now only when the initial stage has an entry instruction
- **AND** the project input is unselected
- **AND** the project list contains only projects of the active Hub that the board allows

#### Scenario: Open the same creation experience from either presentation
- **WHEN** the user opens New task from the column board's initial column and, separately, from the workflow diagram's initial stage
- **THEN** both present the same creation experience with the same inputs and the same defaults
- **AND** saving from either creates the task in the configured initial stage with the same effect

#### Scenario: Enable the action identically in both presentations
- **WHEN** a board is read in the column board and in the workflow diagram with the same Hub registry
- **THEN** both presentations offer the action as available, or both withhold it, on the same condition: the Hub holds at least one registered project
- **AND** the board's project scope never withholds the action from one presentation alone, since a board that allows no project must stay reachable through either of them to explain itself

#### Scenario: Create into a customized initial stage
- **WHEN** the user saves a new task, the active board's workflow has a configured initial stage, and the start option does not apply or is disabled
- **THEN** the task is created in that stage with the supplied title, description, project, and auto-mode value
- **AND** the task belongs to the active board
- **AND** no native DSH conversation or workspace is created
- **AND** task creation does not initiate an agent execution

#### Scenario: Create a task with auto mode
- **WHEN** the user enables Auto mode in the New task dialog and saves
- **THEN** the task is persisted with auto mode enabled
- **AND** its stage and position are unchanged
- **AND** no agent execution starts unless Start execution now also applies

#### Scenario: Create and start the first execution
- **WHEN** the user saves a new task in an initial stage with an entry instruction and keeps Start execution now enabled
- **THEN** the task is created in that stage
- **AND** the automatic first execution defined by Automatic first execution on task creation prepares the task and arms the countdown
- **AND** the card presents the task in that stage

#### Scenario: Capture a task without starting
- **WHEN** the initial stage has an entry instruction and the user disables Start execution now
- **THEN** no native DSH conversation, workspace, worktree, or agent execution is created
- **AND** the selected auto-mode value is persisted
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: No start option without an entry instruction
- **WHEN** the active board's initial stage has no entry instruction
- **THEN** the dialog does not present Start execution now
- **AND** task creation does not initiate an agent execution

#### Scenario: Require an explicit project choice
- **WHEN** the user opens New task with one or more allowed projects and does not select a project
- **THEN** the task cannot be created
- **AND** no project is silently chosen from the project list or the active project filter

#### Scenario: Offer only the allowed projects
- **WHEN** the active Hub has projects that the active board does not allow and the user opens New task from either presentation
- **THEN** the project input lists the allowed projects of that Hub only
- **AND** no project the board does not allow is offered

#### Scenario: Create from another board of the same Hub
- **WHEN** a task of one board creates a task on another board of the same Hub with a project that the destination board allows
- **THEN** the task is created on the destination board
- **AND** the creating board's own scope does not restrict the destination

#### Scenario: No task creation without a board
- **WHEN** the active Hub has no boards
- **THEN** the board surface presents the create-board empty state
- **AND** no New task action is available

#### Scenario: No creation target other than the initial stage
- **WHEN** the user opens New task from either presentation
- **THEN** the creation experience provides no stage input
- **AND** the saved task's stage is the configured initial stage regardless of the stage the user was looking at

#### Scenario: Start the first conversation after creation
- **WHEN** the user opens a newly created task's Conversations section and its creation did not start the first execution
- **THEN** the task has no native conversation
- **AND** the section presents the explicit start state defined by `task-conversations`

#### Scenario: Create directly in a deterministic initial stage

- **WHEN** a task is created in a deterministic initial stage with Auto mode disabled
- **THEN** its deterministic entry is admitted subject to local authorization
- **AND** no agent preparation, countdown, conversation, or model selection is created for the script
- **AND** the task keeps the selected Auto mode setting

#### Scenario: Recover creation admitted before script capture

- **WHEN** the host crashes after creating a task in a deterministic initial stage but before capturing or reviewing its program
- **THEN** startup recovers the activation intent associated with that persisted entry
- **AND** no manual stage change is required to discover the entry
- **AND** the script still requires valid capture and local authorization before launch

### Requirement: Automatic first execution on task creation
The system SHALL prepare a task's first execution immediately after its creation when the active board's initial stage has an entry instruction and the creation kept the Start execution now option enabled. The preparation SHALL be a host admission that does not depend on the creating board remaining mounted, SHALL present no dialog, SHALL NOT ask the worktree choice, and SHALL NOT present the native model selector. For a Git-backed project, the preparation SHALL create the task's default worktree using its title-derived defaults and SHALL wait until that worktree is ready. For a folder project, the task SHALL use its project directory. The preparation SHALL then create the task's first conversation and SHALL arm the five-second countdown defined by Timed stage instruction after a move for the created entry; expiry SHALL send the stage instruction through the same admission as a user run action. While the preparation runs, the card and the drawer SHALL present a preparing state, and the card's run action SHALL NOT be available. Canceling the countdown SHALL keep the created worktree and conversation, SHALL leave the unresolved entry, and SHALL expose the card's run action. A failed preparation or send SHALL keep the card and the unresolved entry, SHALL report the failure on the card and in the drawer, SHALL expose the run action, and SHALL NOT retry automatically. The preparation and the countdown SHALL NOT be persisted: a reload or plugin restart before the send SHALL send nothing and SHALL leave the entry unresolved. The agent tool surface SHALL prepare and dispatch the first execution in the same call as defined by the product-tools specification.

This preparation SHALL apply only to an agent entry instruction. A deterministic initial entry SHALL follow `deterministic-steps` instead and SHALL NOT acquire the default worktree, conversation, model selection, or five-second countdown described here merely because it executes code.

#### Scenario: Prepare and arm after creation
- **WHEN** a task is created in an instructed initial stage with Start execution now enabled and the task has no conversation
- **THEN** the preparation creates the default worktree for a Git-backed project or uses the project directory for a folder project
- **AND** the first conversation is created after the worktree is ready
- **AND** the five-second countdown is armed for the created entry
- **AND** no preparation dialog and no native model selector are presented

#### Scenario: Use the repository-sibling worktree default
- **WHEN** no worktree base path is configured and the created task's project is Git-backed
- **THEN** the preparation creates the worktree at the repository-sibling default defined by `worktree-management`
- **AND** the first conversation uses that worktree directory

#### Scenario: Present the preparing state
- **WHEN** the automatic first-execution preparation is running for a created task
- **THEN** the card and the drawer present a preparing state
- **AND** the card's run action is unavailable
- **AND** no instruction is sent before the countdown is armed

#### Scenario: Cancel the countdown
- **WHEN** the user cancels the countdown armed after the creation preparation
- **THEN** no instruction is sent
- **AND** the created worktree and conversation remain
- **AND** the entry remains unresolved and the card exposes the run action

#### Scenario: Failed preparation keeps the card
- **WHEN** the worktree or the first conversation cannot be prepared during creation
- **THEN** the card and the unresolved entry remain in the initial stage
- **AND** the failure is reported on the card and in the drawer
- **AND** the card exposes the run action
- **AND** no automatic retry occurs

#### Scenario: Failed timed send keeps the card
- **WHEN** the timed send after the creation preparation fails
- **THEN** the card and the unresolved entry remain in the initial stage
- **AND** the failure is reported on the card and in the drawer
- **AND** the card exposes the run action
- **AND** no automatic retry occurs

#### Scenario: Reload before the send
- **WHEN** the board reloads or the plugin restarts during the preparation or the countdown
- **THEN** no instruction is sent automatically
- **AND** the entry remains unresolved
- **AND** the card exposes the run action after reload

#### Scenario: Do not prepare without the start option
- **WHEN** a task is created in an instructed initial stage with Start execution now disabled
- **THEN** no worktree, first conversation, preparation, or countdown is created
- **AND** the card exposes the run action for the unresolved entry

#### Scenario: Do not apply agent creation preparation to a deterministic entry

- **WHEN** a task is created directly in a deterministic initial stage
- **THEN** this agent first-execution preparation is not performed
- **AND** deterministic execution is governed by its own authorization and execution contract

### Requirement: Execution preparation before a task's first execution

When a user move into an instructed stage or a card run action would start a task's first
execution — the task has no native conversation — the system SHALL present one execution
preparation before applying the move or admitting the instruction. The preparation SHALL contain
the worktree choice defined by the Worktree choice before a card's first execution requirement in
`worktree-management` when that choice applies, and the model selection defined by Model selection
for the first conversation in `task-conversations` when DSH's native model selector is available
and the board's default model rules in `kanban-board` make that step apply. When the task already
has a conversation, or when neither part applies, the system SHALL NOT present the preparation and
SHALL follow the current move and run behavior. A restricted-transition confirmation SHALL be
presented before the preparation; canceling that confirmation SHALL present nothing else. The
preparation SHALL NOT start an agent execution and SHALL NOT change the task's stage or position.
Completing the preparation SHALL leave the move or run action to proceed as defined by its own
requirement. Canceling the preparation after it created a worktree or the first conversation SHALL
keep those resources and SHALL leave the task's stage and position unchanged. The preparation SHALL
NOT be presented for a same-stage reorder or by an automatic advance.

The first execution described here SHALL mean execution of an agent stage instruction, not a deterministic script. A deterministic stage's Play action and a move into a deterministic stage SHALL NOT create a native conversation or present a model selector through this preparation. Its working directory SHALL follow the task-or-project selection defined by `deterministic-steps`.

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
- **WHEN** the task has no conversation but neither a worktree choice nor a model selection applies, including because the board's default model is available
- **THEN** no execution preparation is presented
- **AND** the move or run behavior follows its own requirement

#### Scenario: Prepare the worktree choice without a model step
- **WHEN** the task has no conversation and no worktree, and the board's default model is available
- **THEN** the preparation presents the worktree choice only
- **AND** the first conversation is created on the board's default model

#### Scenario: Cancel before any resource exists
- **WHEN** the user cancels the preparation before a worktree or the first conversation has been created
- **THEN** no worktree, branch, or conversation is created
- **AND** the task's stage, position, and conversations are unchanged

#### Scenario: Cancel after provisioning
- **WHEN** the user cancels the preparation after it created a worktree or the first conversation
- **THEN** the created worktree and conversation are kept
- **AND** the task's stage and position are unchanged
- **AND** no agent instruction is sent

#### Scenario: Do not prepare a conversation for script execution

- **WHEN** a task with no conversation enters a deterministic stage or uses its Play action
- **THEN** this agent execution preparation is not presented
- **AND** the absence of a conversation does not by itself prevent authorized deterministic execution

### Requirement: Direct stage manipulation on the board
The task card SHALL NOT provide an independent stage selector. A user SHALL change a task's stage through board drag and drop or through the stage control in the open task drawer. A stage change that requests no position, including a drawer stage change and a confirmed restricted drawer change, SHALL place the task at the top of the destination stage. A drag SHALL present a distinct dragged representation and a drop indicator, and a drop SHALL place the task at the dropped position, including before a chosen card and after the last card of the destination stage. Dropping on a permitted stage SHALL move the task immediately, whether or not that stage has an entry instruction, except when the drop would start the task's first execution: that drop SHALL present the execution preparation defined by Execution preparation before a task's first execution, and the move SHALL follow the preparation. Hovering a restricted stage during a drag SHALL present a distinct warning affordance. Dropping on a restricted stage SHALL require explicit confirmation before moving the task; canceling SHALL leave the task's stage and position unchanged. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement; neither the drop, the drawer stage change, nor a restricted-move confirmation SHALL initiate an agent execution at the time of the move. Dropping within the current stage SHALL reorder the task relative to its neighbors without arming a new timed instruction. A prohibited or canceled change SHALL leave the task unchanged. The board SHALL offer worktree creation during a drop only through that execution preparation. The host's automatic advance, defined by Automatic advance after a completed turn, SHALL NOT be presented as board stage manipulation, SHALL NOT add a card stage selector, and SHALL NOT require a confirmation.

An accepted stage change SHALL durably revoke the deterministic execution that owns the previous entry and record any new deterministic activation intent in the same operation that places the task into its new entry, before requesting cancellation or reading files, capturing code, resolving credentials, or asking for trust. The previous run SHALL be canceled and its late results invalidated before that execution can move the task again. A refused or canceled move SHALL NOT stop it. Entering a deterministic destination SHALL admit its new deterministic entry, subject to local trust, regardless of Auto mode and without the agent countdown or conversation preparation. A same-stage reorder SHALL preserve the current deterministic entry and SHALL NOT restart its program. The configured destination rules and explicit confirmation for a restricted user move SHALL remain in force.

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

#### Scenario: Move away from an active deterministic entry

- **WHEN** a permitted or explicitly confirmed user move changes the stage of a task whose deterministic script is running
- **THEN** the task moves through the normal placement pipeline
- **AND** the previous program and its linked Bash work are canceled
- **AND** a late result from that execution cannot move the task or deliver a handoff

#### Scenario: Recover a placed entry before script capture

- **WHEN** the host crashes after accepting a move into a deterministic stage but before reading its external script
- **THEN** the stored placement and the activation intent describe the same destination entry
- **AND** startup continues capture and authorization for that entry without fabricating a second move
- **AND** the revoked source run cannot act on the new entry

### Requirement: Execution activity is independent of workflow and attention
The board SHALL represent task execution state independently of the task's workflow stage and of its unread, awaiting-reply, and failure attention indicators. Execution state SHALL consist of two distinct facts. Agent execution SHALL mean that at least one agent owned by the task's conversations is running: a conversation's own assistant turn or an owned native subagent descendant. Background activity SHALL mean that the task owns unsettled work other than agent execution, such as jobs or schedules. Agent execution SHALL aggregate across all of the task's conversations rather than only the currently selected conversation. Background activity SHALL aggregate the task's conversation-owned background work and its directly owned deterministic script execution, including when the task has no conversation. Completing or failing an execution SHALL NOT, by itself, redefine the task's workflow stage. A task SHALL be presented as working while at least one owned agent is running, including when the main turn has ended and only an owned subagent descendant is still running. Work that is not agent execution and outlives the turn SHALL be presented as background activity instead.

A deterministic script SHALL NOT count as an agent, assistant turn, or native subagent. Its run, stopped, trust, and failure states SHALL be presented as deterministic execution state rather than fabricated unread-message or failed-turn attention. A named terminal result SHALL request its separately validated transition; mere process exit SHALL NOT redefine the task's workflow stage.

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

#### Scenario: Count a script without inventing an agent conversation

- **WHEN** a task with no native conversation is executing a deterministic script
- **THEN** the task has directly owned background activity
- **AND** it has no agent execution or conversation attention solely because of that script
- **AND** no conversation is created to represent the activity

### Requirement: Coexisting attention indicators across task conversations

The board SHALL derive attention per task conversation and aggregate it across all conversations belonging to a task. It SHALL distinguish blue unread-message indicators, orange awaiting-reply indicators, and red failure indicators. Blue and red SHALL be derived by the conversation's last settled assistant turn and its stored per-conversation read acknowledgment: unread SHALL mean that the conversation has a settled turn newer than its acknowledgment, and failure SHALL mean that the settled turn ended with an error outcome and is still unread. Blue and red SHALL NOT be presented while any agent owned by that conversation is running. The orange indicator SHALL reflect a live awaiting-reply state and SHALL NOT require acknowledgment. Attention SHALL be derived from durable conversation facts and the stored acknowledgment, SHALL survive a reload or plugin restart, and SHALL NOT depend on a per-client native unread transition. A conversation with no stored acknowledgment SHALL present its last settled turn as unread. Simultaneously applicable indicators SHALL coexist rather than collapse to a single highest-priority indicator. Those attention indicators SHALL also coexist with the card's agent execution accent rather than replacing one another.

Background activity SHALL remain derived per task as unsettled work other than agent execution, and SHALL NOT be presented on the task card as a generic activity count or background indicator. Directly owned deterministic execution SHALL instead expose its own controls and runtime status as defined by `deterministic-steps`, without fabricating conversation attention. It SHALL remain available through the task drawer's section navigation, whose Conversations entry SHALL expose the number of unsettled activities and their labels on hover and to assistive technology.

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

### Requirement: Task card layout

The board SHALL render each task as a card composed of distinct regions in a fixed order: a title region, a context region, an activity region, and a status region. The context region SHALL present the task's project name and its unread, awaiting-reply, and failure attention indicators. The activity region SHALL present the auto-mode control defined by Auto mode on a task card, the stage run action defined by Run a stage instruction from a card, and the advance action defined by Advance a task from its card, kept on one line at the trailing edge of the card. The status region SHALL present unresolved context-operation, confirmed-transition, and automatic-advance state as defined by Task card status strip. The card's agent execution state SHALL be presented by the execution accent defined by Execution accent on task cards and SHALL NOT occupy a region of its own.

The project name SHALL remain visible on every card, SHALL be visually quieter than the title, and SHALL expose the complete name when the available width truncates it. The title SHALL NOT be clamped to a fixed number of lines. In selection mode the card SHALL present its selection control at the leading edge of the context region. The whole card surface SHALL remain activatable as defined by Open a task drawer, except for nested controls, which SHALL perform their own action without opening the drawer.

For an entry owned by durable deterministic activation or control state, the activity region SHALL additionally present the applicable Stop or Play control defined by `deterministic-steps`, not an agent instruction countdown. Ownership SHALL follow that persisted entry state rather than the latest saved workflow mode, so changing the saved stage to an agent or manual mode SHALL NOT hide Stop for its owned active run. The status region SHALL include its deterministic execution state. These controls SHALL preserve the single activity row, nested-control activation rules, project visibility, selection behavior, and independent conversation attention of the existing card.

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

#### Scenario: Present deterministic controls without replacing card regions

- **WHEN** a task card is in a deterministic stage
- **THEN** its applicable Stop or Play control is placed in the activity region
- **AND** its deterministic status is placed in the status region
- **AND** no new card region or separate action row is introduced

#### Scenario: Keep owned Stop after a saved mode change

- **WHEN** a task owns an active deterministic run and the saved stage is changed to agent or manual mode
- **THEN** the card keeps Stop for that owned execution
- **AND** no agent countdown or stage-run action replaces it
- **AND** a later Play is offered only for valid latest deterministic configuration, otherwise the interface explains the required configuration or new entry

### Requirement: Single-line activity strip on task cards

The card's activity region SHALL keep its content on one line. It SHALL present the auto-mode control, the stage run action or its countdown control, and the advance action at the trailing edge, and it SHALL NOT present a background activity indicator. The card SHALL reserve the activity region's height in every task state, so that starting or ending a turn, or showing or hiding the run and advance actions, SHALL NOT change the card's height. The controls SHALL share one row and SHALL NOT add a separate action row.

A deterministic Stop or Play control SHALL share this same reserved one-line activity region. It SHALL NOT be represented as an agent stage-instruction action or a background-count indicator, and changes between stopped and running SHALL NOT introduce another action row or resize the reserved activity region.

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

- **WHEN** a deterministic execution starts or stops and its card changes between Play and Stop
- **THEN** the control remains on the same single activity row
- **AND** the reserved activity-region height is unchanged

### Requirement: Task card status strip

The board SHALL present a card's unresolved context operation, confirmed transition, and automatic-advance state in one status region below the activity region. Each status SHALL carry a tone that distinguishes a failure from a pending state and SHALL present a short label that names the state. A destructive operation's label SHALL use task-deletion or worktree-removal language and SHALL distinguish checking, queued, in progress, and failed states rather than exposing a raw phase token. A status SHALL remain visible while its operation or transition is unresolved. The automatic-advance status SHALL name the destination stage while an advance is admitted, name a failure when an admitted advance failed, and name the pause reason when auto mode is paused, distinguishing a pause requested by the agent from a diagnostic pause. The status region SHALL NOT report the held state defined by Auto mode on a task card, which the auto-mode control presents instead. A run-action admission failure SHALL be reported in the same status region. A failure of the automatic first-execution preparation on task creation SHALL be reported in the same status region. When a card has more than one such fact, the status region SHALL present them together without replacing one with another.

A pause requested by the agent SHALL present the reason the agent recorded, and a diagnostic pause recorded for the same task SHALL remain presented beside it, so a turn that failed while the task was paused is not hidden by the pause.

The same status region SHALL present deterministic execution state defined by `deterministic-steps`, including authorization needed, running, stopped, and a recoverable execution or handoff failure. Stopped SHALL NOT be reported as an executor error or an Auto mode pause. These states SHALL coexist with applicable operation, transition, and conversation-derived facts without replacing them, and SHALL NOT disappear merely because a conversation was read.

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

### Requirement: Run a stage instruction from a card

When a task's current stage has an entry instruction, its card SHALL expose a run action only while the current entry into that stage is unresolved. The entry SHALL be unresolved when a persisted entry marker exists for the current stage and no successful user prompt has been sent in any open conversation of the task since that entry. The marker SHALL be created on every move into an instructed stage, including a task created directly in an instructed initial stage. A same-stage reorder SHALL NOT reset the marker; leaving and re-entering the stage SHALL create a new marker. A successful user prompt in any open conversation SHALL clear the marker, and a successful stage-instruction delivery for that entry SHALL clear it as well. An admission failure SHALL NOT clear it. A task already in an instructed stage without a marker SHALL NOT show the action until its next entry. While the timed instruction for the entry is counting down or being sent, the card SHALL expose the countdown control defined by the Timed stage instruction after a move requirement instead of the run action; canceling that countdown or a failed timed send SHALL expose the run action for the same unresolved entry. When visible, the action SHALL deliver the stage's entry instruction to the task's first open conversation in conversation order as the stage-instruction context message defined by Stage instruction delivery as context in `task-conversations`, followed by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies. When the task has no conversation, activating the action SHALL first present the execution preparation defined by Execution preparation before a task's first execution; when no conversation is open after the preparation, the action SHALL create a new conversation and use that conversation as the target. The action SHALL carry the entry identity it was displayed for — the entry's stage and entry timestamp — and the host SHALL reject a request for an entry that has been resolved or replaced. The action SHALL NOT move the task or change its position, SHALL NOT offer a conversation picker, and SHALL NOT be available in selection mode. It SHALL be unavailable while the task has an unresolved context operation or confirmed transition. The delivered context message SHALL contain the stage instruction and, when it applies, the transition briefing; the conversation's first-turn task context supplies the task context. Admission failures SHALL be reported without changing the stage or position and without creating another conversation beyond the resolved target.

This action and its unresolved-instruction marker SHALL remain specific to agent entry instructions. An entry owned by durable deterministic activation or control state SHALL instead expose its own applicable Stop and Play controls, whose availability SHALL NOT be cleared by an ordinary conversation prompt or by a later saved change to the stage mode. While that deterministic ownership remains, a newly saved agent instruction SHALL NOT expose an agent stage-run action or countdown for that entry. Play SHALL be available only when the latest saved configuration is valid deterministic configuration; otherwise the interface SHALL explain that deterministic configuration or a new stage entry is required and SHALL NOT silently start an agent or manual-mode execution. A pending deterministic handoff SHALL be included as its own identified block in an agent instruction delivery as defined by `task-conversations`; it SHALL NOT replace the instruction or be recast as an agent-declared transition reason.

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

- **WHEN** a task is created directly in an instructed initial stage with Start execution now disabled
- **THEN** the card exposes the run action until a prompt is sent
- **AND** no countdown is armed by the creation
- **AND** the task is not moved by the action

#### Scenario: Existing task without an entry marker

- **WHEN** a task is already in an instructed stage without an entry marker
- **THEN** the card does not expose the run action
- **AND** the action becomes available only after its next entry

#### Scenario: Run an instruction from a card

- **WHEN** the user activates the run action on a card whose stage has an entry instruction and whose first conversation is open
- **THEN** the stage instruction is delivered to that first open conversation as a stage-instruction context message
- **AND** no user message records the instruction
- **AND** the task's stage and position are unchanged
- **AND** no conversation picker is presented

#### Scenario: Include the transition briefing

- **WHEN** the user activates the run action on a card whose stage configures two or more targets
- **THEN** the delivered context message contains the stage instruction followed by the transition briefing

#### Scenario: Prepare the first run from a card

- **WHEN** the user activates the run action on a card whose task has no conversation
- **THEN** the execution preparation is presented before a conversation is created or the instruction is admitted
- **AND** after the preparation the instruction is delivered to the conversation created by it
- **AND** the task's stage and position are unchanged

#### Scenario: Run the instruction again

- **WHEN** a stage instruction has already been admitted and the card later re-enters that instructed stage
- **THEN** a new unresolved entry is created
- **AND** the action is available and sends the current stage instruction again to the resolved target

#### Scenario: Run when every conversation is closed

- **WHEN** the user activates the run action and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** the stage instruction is delivered to that new conversation
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

#### Scenario: Do not consume deterministic Play with a conversation prompt

- **WHEN** an ordinary conversation prompt is sent while the task remains in a deterministic stage
- **THEN** it does not resolve, stop, restart, or hide that stage's deterministic controls
- **AND** the agent instruction marker does not govern the deterministic execution

### Requirement: Movement never runs an agent
A user movement of a task, including into a stage with an entry instruction, SHALL update its workflow stage and position without initiating an agent execution at the time of the move. An instructed user move SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement; that scheduled execution is separate from the move. Agent execution SHALL otherwise require a separate explicit card run action or a user-sent message from the conversation composer. A host transition admitted after a completed turn or after a deterministic result SHALL dispatch the destination instruction itself when that destination is an agent stage, and SHALL NOT arm the timed stage instruction. A reason-carrying agent-declared transition SHALL remain able to advance after its completed turn without Auto mode, and a deterministic result SHALL remain able to route without Auto mode. A default turn-driven advance without such a declaration SHALL require Auto mode. Optional worktree creation and directory switching SHALL follow the separate worktree-management requirements.

A user move into a deterministic stage SHALL start only its authorized non-model program. A deterministic output transition into an agent stage SHALL deliver that stage's own prompt with the result handoff, even while Auto mode is disabled. It SHALL NOT cause a script-only or manual destination to create an agent turn.

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

#### Scenario: Dispatch an agent destination after a deterministic result without Auto mode

- **WHEN** an authorized deterministic execution returns a configured exit for an agent stage while Auto mode is disabled
- **THEN** the result transition moves exactly to that destination and dispatches its own entry instruction with the handoff
- **AND** Auto mode remains disabled
- **AND** no five-second countdown is armed

### Requirement: Timed stage instruction after a move
When a permitted move changes a task's stage to a stage with an entry instruction, or a task created directly in an instructed initial stage completes the automatic first-execution preparation defined by Automatic first execution on task creation, the system SHALL arm one five-second countdown for that entry. The countdown SHALL be armed for board drops, drawer stage changes, and the automatic creation preparation. It SHALL NOT be armed for a same-stage reorder, for a creation whose Start execution now option is disabled, or for a move into a stage without an entry instruction. When the task has no conversation, the countdown SHALL be armed only after the first-execution preparation (the interactive preparation defined by Execution preparation before a task's first execution or the automatic creation preparation) completes, and the conversation that preparation created SHALL be the target. The target SHALL be the task's first open conversation in conversation order; when no conversation is open, the system SHALL create a new conversation and use it. When the five seconds elapse without cancellation, the system SHALL deliver that stage's entry instruction to the target as the stage-instruction context message defined by Stage instruction delivery as context in `task-conversations`, followed by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies. Cancel SHALL stop only the automatic send: the task's stage, position, and unresolved entry SHALL remain, and the card's run action SHALL be available. A new instructed entry for the task SHALL replace the pending countdown for the previous entry. The countdown SHALL be canceled without sending when a successful user prompt resolves the entry, when the task is deleted, or when the entry marker is removed for any other reason. The card SHALL present the countdown as a control that cancels when activated. The drawer for the task SHALL present a matching countdown notice above its section panel with the same cancel action. Both notices SHALL identify the stage whose instruction will run. A countdown SHALL continue when its card is not rendered, when the Kanban panel is not visible, or when the user switches to another board or Hub. The automatic send SHALL NOT depend on the board that armed it being mounted or visible. Unsent composer text or attachments in the target conversation SHALL NOT prevent the send and SHALL remain unchanged. The countdown SHALL NOT be persisted: a reload or plugin restart SHALL send nothing and SHALL leave the entry unresolved with its run action available. A failed timed delivery SHALL stop the countdown, report the failure on the card and in the drawer notice, restore the run action for the unresolved entry, and SHALL NOT retry automatically. When admission reports that the entry was already resolved, the countdown SHALL end without reporting a failure. The delay SHALL be fixed at five seconds and SHALL NOT be configurable.

This countdown SHALL remain specific to agent entry instructions and SHALL NOT schedule deterministic polling or delay a deterministic entry. When an agent entry has a pending deterministic handoff, its message SHALL include that identified handoff block in the order defined by `task-conversations`, in addition to the instruction and applicable briefing. The countdown's non-durable reload behavior SHALL NOT stop or redefine the separate durable recovery of deterministic programs.

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

#### Scenario: Arm after the creation preparation
- **WHEN** a task is created directly in an instructed initial stage with Start execution now enabled and the automatic first-execution preparation completes
- **THEN** the countdown for the created entry is armed
- **AND** the target is the conversation the preparation created
- **AND** no instruction is sent while the countdown is active

#### Scenario: No countdown for task creation
- **WHEN** a task is created directly in an instructed initial stage with Start execution now disabled
- **THEN** no countdown is armed
- **AND** the card exposes the run action for the new entry

#### Scenario: Send only the instruction on expiry
- **WHEN** the five-second countdown ends without cancellation
- **THEN** the stage's entry instruction and any pending deterministic handoff are delivered to the task's first open conversation as a stage-instruction context message, followed by the transition briefing when the stage configures two or more targets
- **AND** the unresolved entry is resolved
- **AND** no conversation picker or confirmation is presented

#### Scenario: Include the briefing with the timed send
- **WHEN** the countdown ends for a stage that configures two or more transition targets
- **THEN** the delivered context message contains the instruction followed by the transition briefing
- **AND** the briefing is derived at the moment of sending

#### Scenario: Create a conversation when none is open
- **WHEN** the countdown ends and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** the stage's entry instruction and any pending deterministic handoff are delivered to that new conversation
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

#### Scenario: Continue when the card is not visible
- **WHEN** the card is hidden by search, a project filter, selection mode, or another panel before the countdown ends
- **THEN** the countdown keeps running
- **AND** the instruction is delivered when the remaining time elapses unless it is canceled

#### Scenario: Continue across board and Hub switches
- **WHEN** the user switches to another board or Hub before the countdown ends
- **THEN** the countdown keeps running
- **AND** the instruction is delivered when the remaining time elapses unless it is canceled
- **AND** the unresolved entry is resolved for the task on its own board

#### Scenario: Send while the Kanban panel is hidden
- **WHEN** the countdown ends while the Kanban panel is not visible and its board is not mounted
- **THEN** the stage's entry instruction and any pending deterministic handoff are delivered to the resolved target
- **AND** the unresolved entry is resolved without requiring the board to be reopened

#### Scenario: Unsent draft does not block the send
- **WHEN** the target conversation has unsent composer text or attachments when the countdown ends
- **THEN** the stage instruction is delivered anyway
- **AND** the unsent text and attachments remain unchanged

#### Scenario: Failed timed send restores the run action
- **WHEN** the timed instruction cannot be admitted or delivered
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

#### Scenario: Keep script recovery separate from the agent countdown

- **WHEN** the host restarts while a deterministic script was active and another task had an agent countdown
- **THEN** the script follows deterministic recovery from the beginning of its captured program
- **AND** the agent countdown still sends nothing after restart and leaves its instruction entry unresolved

### Requirement: Board attention aggregation
The board tab SHALL present aggregated attention for all tasks on that board. Attention SHALL consist of the unread indicator, the awaiting-reply indicator, the failure indicator, and a running-task indicator. The unread, awaiting-reply, and failure indicators SHALL be presented first, in that order, and the running-task indicator SHALL follow them. The running-task indicator SHALL be presented as a pulsing ring in the host accent with an adjacent numeral, and SHALL be present whenever at least one task on the board is running, including when exactly one task is running. The numeral SHALL be the number of running tasks, counting each task once regardless of how many agents, subagents, jobs, or schedules it owns. A task SHALL count as running while it has a running agent turn, an owned subagent still running after the turn ends, or unsettled background work such as jobs or schedules. The numeral SHALL be legible in the host's light and dark appearances, SHALL use tabular figures so the board label does not shift as the count changes, and SHALL remain visible without animation when the host prefers reduced motion. Hovering the indicator SHALL expose the titles of the running tasks. The board tab's accessible name SHALL include the running-task count. The unread, awaiting-reply, and failure indicators SHALL coexist with the running-task indicator. The running-task indicator SHALL communicate both the presence and the number of running tasks rather than a static status color alone. The running count SHALL clear when no task on the board is running. Attention on a board that is not active SHALL remain visible on its tab.

A task's running deterministic execution SHALL contribute one to this running-task count, even when the task has no native conversation. Its script SHALL NOT add an agent-turn unread, awaiting-reply, or failure indicator. A stopped execution, trust request, or settled script failure SHALL NOT count as running merely because it needs recovery; their deterministic status SHALL remain available on the task.

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

#### Scenario: Count directly owned deterministic work once

- **WHEN** a task with no native conversation runs a deterministic script
- **THEN** its board's running-task count includes that task once
- **AND** stopping or settling that script removes its running contribution when no other owned activity remains

### Requirement: Auto mode on a task card

A task SHALL have an optional auto-mode setting that is disabled unless the user enables it, including while creating the task, is persisted with the task, and is independent of its stage, position, and conversations. The card SHALL present the setting as an always-visible toggle that also indicates its state, SHALL expose its pressed state and purpose to assistive technology, and SHALL NOT open the task drawer or begin a drag when activated. The control SHALL NOT be presented in selection mode.

Enabling auto mode SHALL arm the task and SHALL NOT move it, change its position, or send an instruction; the next completed turn remains the only trigger. Enabling it while creating a task SHALL persist the setting and SHALL NOT by itself start the first execution; the Start execution now option and Automatic first execution on task creation govern that execution. Disabling it SHALL stop future automatic advances and SHALL NOT retract an advance that is already admitted. A user movement of the task SHALL preserve the setting. The indicator SHALL distinguish disabled, armed, advancing, held, and paused. A paused state SHALL be explained in the status region defined by Task card status strip. A held state SHALL be presented by the control itself, including its accessible name, and SHALL NOT add a status-region entry, because it is derived from pending user work rather than a recorded cause. Held SHALL mean the task has pending user work as defined by Pending user work, and the state SHALL clear when that work is consumed, SHALL NOT be persisted, and SHALL NOT require a user action. The control SHALL name the stage the next completed turn reaches: the recorded transition's stage while that transition resolves, otherwise the default destination. A recorded transition that no longer resolves SHALL be presented as a pause with the `transition-stale` reason, and reading a conversation SHALL NOT change the setting or clear that pause.

The paused state SHALL also present a pause requested by the agent as defined by Agent-requested task pause, and a task carrying that pause SHALL keep auto mode enabled. Activating the control while the task carries a recorded pause — the agent pause or a diagnostic pause — SHALL resume the task and SHALL NOT disable auto mode, whatever the recorded reason; activating it in every other state SHALL toggle the setting as before. A pause derived from a recorded transition that no longer resolves is not a recorded pause, so that presentation SHALL keep the setting toggle. Because a recorded pause resumes when the control is activated, the control SHALL present a task carrying a recorded pause as not pressed even while auto mode is enabled, so the pressed state continues to describe the action the control performs. Resuming SHALL NOT move the task, change its position, send an instruction, or start an execution, and the next completed turn SHALL remain the only trigger.

The completed-turn trigger, future-advance control, and resume behavior described here SHALL apply to turn-driven agent advancement, not to deterministic stage supervision. A deterministic stage SHALL start on entry and route its named result even when Auto mode is disabled. Toggling or resuming Auto mode SHALL NOT stop, start, resume, or restart a deterministic program; its Stop and Play actions SHALL remain independent. While durable activation or control state owns the current entry as deterministic, the control SHALL NOT imply that an incidental completed conversation turn selects an exit or bypasses the script. A later saved mode change SHALL NOT relinquish that ownership or let Auto mode substitute the new instruction or default route for the owned run.

#### Scenario: Auto mode is disabled by default

- **WHEN** a task is created without enabling Auto mode
- **THEN** its auto mode is disabled
- **AND** the card presents the auto-mode control in its disabled state

#### Scenario: Enable auto mode while creating

- **WHEN** the user enables Auto mode in the New task dialog and saves
- **THEN** the task is persisted with auto mode enabled
- **AND** its stage and position are unchanged
- **AND** no instruction is sent and no agent execution starts unless Start execution now also applies

#### Scenario: Enable auto mode

- **WHEN** the user enables auto mode on a card
- **THEN** the task is armed
- **AND** its stage and position are unchanged
- **AND** no instruction is sent and no agent execution starts

#### Scenario: Disable auto mode

- **WHEN** the user activates the control of an armed task
- **THEN** auto mode is disabled and future automatic advances stop
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

#### Scenario: Present the recorded destination

- **WHEN** an armed task has a recorded transition that still resolves
- **THEN** the control names that transition's stage as the destination of the next completed turn

#### Scenario: Present a stale recorded transition

- **WHEN** an armed task has a recorded transition that no longer resolves
- **THEN** the control presents a pause whose label states that the recorded transition is no longer valid
- **AND** the task's stage and position are unchanged

#### Scenario: Present a pause requested by the agent

- **WHEN** a task carries the agent-requested pause
- **THEN** the control presents the paused state
- **AND** auto mode remains enabled
- **AND** the control presents the recorded reason in its tooltip and its accessible name

#### Scenario: Resume a paused task from the control

- **WHEN** the user activates the control of a task that carries a recorded pause for any reason
- **THEN** the pause is cleared and the task returns to armed
- **AND** auto mode is not disabled
- **AND** the task's stage and position are unchanged
- **AND** no instruction is sent and no agent execution starts

#### Scenario: Present a paused task as not pressed

- **WHEN** an enabled task carries a recorded pause
- **THEN** the control presents itself as not pressed
- **AND** its accessible name states the pause before the action the activation performs

#### Scenario: Keep the setting toggle for a derived stale pause

- **WHEN** an enabled task has a recorded transition that no longer resolves and carries no recorded pause
- **THEN** the control presents itself as pressed
- **AND** activating it disables auto mode instead of resuming

#### Scenario: Keep deterministic execution independent of the Auto mode toggle

- **WHEN** the user disables or resumes Auto mode while a deterministic entry is active or stopped
- **THEN** the deterministic run or stopped state is unchanged
- **AND** only its own entry, Stop, Play, recovery, and result rules control that execution

### Requirement: Automatic advance after a completed turn
When a conversation of a task whose auto mode is enabled or whose reason-carrying recorded transition resolves ends a turn whose reason is `completed`, and no open conversation of the task is running a turn, and the task has no pending user work as defined by Pending user work, and the task does not carry the pause requested by the agent, the host SHALL admit exactly one automatic advance. The host SHALL perform the advance without requiring the board to be mounted, without a confirmation, without a conversation picker, and without arming the timed stage instruction. An admitted advance SHALL be durable: reloading the board SHALL NOT cancel it, and a host restart SHALL dispatch it when it had not been dispatched.

The host SHALL evaluate pending user work when the completed turn ends and SHALL re-evaluate it when the advance is admitted, and SHALL NOT admit the advance when pending user work exists at either evaluation. Consuming pending user work SHALL NOT itself move the task; only an observed completed turn triggers an advance. A blocked advance SHALL NOT record a pause and SHALL NOT be dropped silently: the task SHALL present the held state defined by Auto mode on a task card, and the next completed turn SHALL re-evaluate the task.

A turn ending for any other reason SHALL NOT advance the task. The host SHALL NOT admit an advance while the task has an unresolved context operation, an unresolved confirmed transition, or an unresolved entry for its current stage; those conditions SHALL NOT be recorded as a pause and the next completed turn SHALL re-evaluate them. The host SHALL NOT admit an advance while the task carries the agent-requested pause defined by Agent-requested task pause; that pause SHALL NOT be recorded again or cleared by the evaluation, and a later completed turn SHALL re-evaluate it without advancing.

The host SHALL NOT replay a turn that ended while it was not observing the task's conversations. Only a turn end observed while the host is running SHALL trigger an advance.

This trigger SHALL NOT advance a task out of an entry owned by durable deterministic activation or control state, including an entry waiting for trust, running, stopped, failed, or awaiting result delivery. That ownership SHALL NOT be recomputed from a later saved YAML mode: switching the saved stage to agent or manual mode SHALL NOT enable a conversation turn to bypass the captured run or its stopped state. A completed turn from one of its conversations SHALL NOT replace the named result of that entry or restart its program. The no-catch-up rule above SHALL remain a rule about unobserved conversation turns; automatic recovery of a previously active deterministic run SHALL follow `deterministic-steps` without replaying a conversation turn.

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

#### Scenario: Do not advance a task paused by the agent
- **WHEN** a completed turn ends while the task carries the pause requested by the agent
- **THEN** no advance is admitted
- **AND** the task remains in its current stage
- **AND** the recorded pause and its reason are unchanged

#### Scenario: Re-evaluate the agent pause at admission
- **WHEN** the pause requested by the agent is recorded after the completed turn was evaluated and before the advance is admitted
- **THEN** no advance is admitted
- **AND** the task's stage and position are unchanged

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

#### Scenario: Ignore incidental turns in a deterministic entry

- **WHEN** a task occupies a deterministic entry and one of its conversations completes a turn with Auto mode enabled
- **THEN** that turn admits no advance out of the deterministic entry
- **AND** its run, stopped state, captured configuration, and pending handoff are not changed

### Requirement: Automatic advance destination and dispatch

A completed turn SHALL advance the task when its auto mode is enabled or when a reason-carrying recorded transition for its current stage resolves. A recording stored without a reason arms nothing, as the recording requirement states. The advance SHALL NOT be admitted while the task owes the user anything as defined by Pending user work, while a context operation is pending, or while a confirmed transition is already recorded.

The destination SHALL be the stage of the task's recorded transition for its current stage while that transition resolves. Otherwise, and only for a task whose auto mode is enabled, it SHALL be the first entry of the current stage's configured transitions, or the stage that follows the current stage in workflow order when the stage does not configure transitions. There SHALL be no default destination when the configured list is empty or the resolved stage is the current stage.

When the destination is the recorded transition, the advance SHALL move the task exactly to that stage and SHALL NOT continue resolution beyond it. While the default destination has neither an entry instruction nor deterministic configuration, resolution SHALL continue from that destination. Resolution SHALL stop at the first stage that has an entry instruction or deterministic configuration, or at the last reachable stage when no reachable stage has either. A stage already visited during the same resolution SHALL NOT be revisited. The resolved destination and its entry instruction SHALL be captured when the advance is admitted, so a workflow edit after admission SHALL NOT change that advance.

A recorded transition that no longer resolves SHALL NOT be replaced by the default destination. The host SHALL NOT advance the task. When the task's auto mode is enabled, the host SHALL pause auto mode with the `transition-stale` reason defined by Auto mode on a task card; a task whose auto mode is disabled SHALL stay in its stage without recording a pause.

The task SHALL be placed at the top of the destination stage, before every card that stage already contains. When the destination has an entry instruction, that instruction SHALL be delivered to the task's first open conversation as the stage-instruction context message defined by Stage instruction delivery as context in `task-conversations`, followed by the reason the recorded transition carried and then by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies; when no conversation is open, a new conversation SHALL be created and used as the target. The delivered context message SHALL contain the stage instruction, the declared reason when one applies, and, when it applies, the briefing. An advance that consumed no recorded reason SHALL deliver no reason block. The advance SHALL NOT create more than one conversation beyond that target. The destination entry SHALL remain unresolved until a prompt or a stage instruction is delivered.

A deterministic destination SHALL admit its own authorized execution rather than create a conversation or consume an agent instruction marker. A named deterministic result SHALL resolve exactly through the captured exit mapping of its execution, SHALL NOT select the first exit as a default, and SHALL NOT cross an intermediate manual or deterministic destination to reach a later instructed stage. Protected destinations SHALL remain protected: the script SHALL NOT supply a destination or use a human-only override, and a missing or invalid authorized destination SHALL produce a visible failure instead of a fallback. A valid destination agent instruction SHALL additionally carry the deterministic handoff defined by `task-conversations`, without mislabeling it as a recorded agent reason. For a deterministic result, route authority SHALL come from the approved mapping captured by that execution, not a later authored allowed-target set. Editing an active exit from one destination to another SHALL not change or invalidate the approved captured destination merely because the latest configuration differs. Routing SHALL resolve the captured destination to the same stable stage after an identifier rename and SHALL reject identifier reuse by a different stage. It SHALL still validate the current entry and run, destination existence and stable identity, task context, and pending user work; it SHALL not use a generic human transition override to bypass those checks.

#### Scenario: Use the recorded transition

- **WHEN** the current stage configures multiple permitted transitions, the task recorded one of them, and a completed turn advances the task
- **THEN** the task moves to the stage of the recorded transition

#### Scenario: Advance on a declared transition without auto mode

- **WHEN** a task whose auto mode is disabled has a reason-carrying recorded transition for its current stage and its turn completes
- **THEN** the task moves to the stage of the recorded transition
- **AND** auto mode remains disabled

#### Scenario: Do not advance without auto mode or a recording

- **WHEN** a task whose auto mode is disabled has no reason-carrying recorded transition and its turn completes
- **THEN** no advance is admitted
- **AND** the task's stage and position are unchanged

#### Scenario: Hold the advance while the task owes the user

- **WHEN** a completed turn ends for a task whose auto mode is disabled and whose reason-carrying recorded transition resolves, and the task has pending user work
- **THEN** no advance is admitted
- **AND** the recorded transition is preserved

#### Scenario: Deliver the declared reason with the instruction

- **WHEN** an advance follows a recorded transition and the destination has an entry instruction
- **THEN** the delivered context message is the entry instruction, then the recorded reason, then the briefing when it applies

#### Scenario: Stop at the recorded destination

- **WHEN** the recorded transition names a stage without an entry instruction and a later reachable stage has one
- **THEN** the task moves exactly to the recorded stage
- **AND** no later stage is crossed and no instruction is sent

#### Scenario: Pause on a recorded transition that no longer resolves

- **WHEN** a completed turn would advance a task whose auto mode is enabled and whose recorded transition is no longer a configured target of its current stage
- **THEN** no advance is admitted
- **AND** auto mode is paused with the `transition-stale` reason
- **AND** the task remains in its current stage

#### Scenario: Do not pause a stale recording without auto mode

- **WHEN** a completed turn would advance a task whose auto mode is disabled and whose recorded transition no longer resolves
- **THEN** no advance is admitted
- **AND** no pause is recorded
- **AND** the task remains in its current stage

#### Scenario: Use the first configured transition

- **WHEN** the current stage configures multiple permitted transitions, no transition is recorded, auto mode is enabled, and a completed turn advances the task
- **THEN** the task moves to the first configured transition's stage

#### Scenario: Fall back to workflow order

- **WHEN** the current stage does not configure transitions, no transition is recorded, auto mode is enabled, and a completed turn advances the task
- **THEN** the task moves to the next stage in workflow order

#### Scenario: Cross a stage without an instruction

- **WHEN** the next stage has neither an entry instruction nor deterministic configuration and a later reachable stage has an entry instruction
- **THEN** the task moves to that later stage in one advance
- **AND** that stage's instruction is delivered

#### Scenario: Stop at the last reachable stage

- **WHEN** no reachable stage ahead has an entry instruction or deterministic configuration
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

- **WHEN** the instruction cannot be delivered after the task moved
- **THEN** the task stays in the destination
- **AND** the destination entry remains unresolved
- **AND** the card exposes the stage run action for that entry

#### Scenario: Stop default resolution at a deterministic stage

- **WHEN** a default turn-driven advance reaches a deterministic stage before a later instructed stage
- **THEN** the task stops in the deterministic stage and admits that entry subject to local authorization
- **AND** no later stage is crossed or agent conversation created for the script

#### Scenario: Stop a named output at its exact destination

- **WHEN** a deterministic result maps to a manual stage with a later instructed stage reachable beyond it
- **THEN** the task moves only to the mapped manual stage
- **AND** its output message is preserved as handoff without starting a later agent stage

#### Scenario: Keep the approved destination after an active mapping edit

- **WHEN** an active execution captured an approved exit to stage B and the saved workflow later maps that exit to stage C
- **THEN** its completed result still selects stage B if the same stable destination exists and current run, entry, context, and pending-user-work guards permit admission
- **AND** it neither follows C nor requests a generic human override merely because the latest mapping differs

#### Scenario: Follow a renamed target without accepting identifier reuse

- **WHEN** a captured destination has been renamed while retaining its stable identity
- **THEN** routing resolves the same destination under its new identifier
- **AND** a replacement stage that merely reuses the old identifier is not accepted as that destination

### Requirement: Transition briefing for an instructed stage

When a stage configures two or more transition targets and the host delivers that stage's entry instruction, the delivery SHALL include a host-generated briefing after the instruction and, when the delivery carries a declared transition's reason, after that reason. The briefing SHALL list every configured target with its stage name and its authored condition when the stage authored one, SHALL name the recorded transition when the task already recorded one for that stage, SHALL name the target that applies when nothing is recorded, and SHALL name the tool that records the choice together with its required reason. The briefing SHALL state that the declared transition is followed at the end of the turn. The briefing SHALL be derived from the active workflow at the moment of delivery and SHALL appear on every delivery path: the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, and the first execution of a task created by an agent. A stage that configures fewer than two targets SHALL produce no briefing, and its context message SHALL contain the entry instruction and, when one applies, the declared transition's reason.

When instruction delivery carries a deterministic handoff, the handoff SHALL be a separate identified block after any declared agent reason and before this briefing. It SHALL NOT change the briefing's documentary conditions, configured destinations, or end-of-turn declaration guidance. A stage with fewer than two targets SHALL still receive its pending handoff even though it produces no briefing. The handoff SHALL NOT be presented as a reason the agent declared.

#### Scenario: Include the briefing with two or more targets

- **WHEN** the host delivers the entry instruction of a stage that configures two or more targets
- **THEN** the delivered context message contains the instruction followed by the transition briefing

#### Scenario: Place the briefing after the declared reason

- **WHEN** the delivery carries both a declared transition's reason and a briefing
- **THEN** the message orders the instruction, then the reason, then the briefing

#### Scenario: Omit the briefing with one target

- **WHEN** the host delivers the entry instruction of a stage that configures exactly one target
- **THEN** the delivered context message contains the entry instruction and, when one applies, the declared transition's reason
- **AND** it contains no briefing

#### Scenario: Omit the briefing without configured transitions

- **WHEN** the host delivers the entry instruction of a stage that does not configure transitions
- **THEN** the delivered context message contains the entry instruction and, when one applies, the declared transition's reason
- **AND** it contains no briefing

#### Scenario: State the required reason and the end-of-turn timing

- **WHEN** the briefing names the tool that records the choice
- **THEN** it states that recording a destination requires a reason
- **AND** it states that the declared transition is followed at the end of the turn

#### Scenario: List each target with its condition

- **WHEN** the briefing is generated for a stage whose targets carry authored conditions
- **THEN** every target is listed with its stage name and its condition
- **AND** a target without a condition is listed without one

#### Scenario: Name the target that applies without a recording

- **WHEN** the briefing is generated and the task has no recorded transition for that stage
- **THEN** the briefing names the target the host uses when nothing is recorded

#### Scenario: Name the recorded transition

- **WHEN** the briefing is generated and the task already recorded a transition for that stage
- **THEN** the briefing names the recorded transition

#### Scenario: Derive the briefing at send time

- **WHEN** the workflow changes between the admission of an instruction and its delivery
- **THEN** the briefing reflects the targets the stage configures at the moment of delivery

#### Scenario: Include the briefing on every send path

- **WHEN** a stage instruction is delivered by the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, or the first execution of a task created by an agent
- **THEN** the delivered context message includes the briefing whenever the stage configures two or more targets

#### Scenario: Keep deterministic handoff when no briefing applies

- **WHEN** an instructed destination receives a deterministic handoff and configures fewer than two transition targets
- **THEN** its context message includes the instruction and the separate deterministic handoff block
- **AND** no transition briefing is generated
- **AND** no agent-declared reason is fabricated
