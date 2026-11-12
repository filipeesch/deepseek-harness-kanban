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

Each board SHALL support its own workflow configuration in YAML, including the initial stage, grouped columns, allowed transitions with an optional condition for each target, optional stage entry instructions, each stage's stored placement, each stage's stored size, the board's default presentation, and an optional stable stage identity for each stage. A transition entry SHALL be authored either as a bare target identifier or as a mapping that carries the target identifier and an optional condition. Both forms SHALL be accepted, neither form SHALL be deprecated, both forms SHALL describe the same transition, and a single list MAY mix them. The condition SHALL describe when that transition is followed; it SHALL NOT change which transitions the workflow permits. The active board's workflow SHALL be used for rendering, transitions, and task creation. The product SHALL honor configured transition restrictions by requiring explicit confirmation before a restricted transition can proceed, and it SHALL honor column grouping.

A stage's stable identity SHALL be a value distinct from the stage identifier, SHALL be unique within the board, SHALL be preserved when the identifier or any other stage field is edited, and SHALL be preserved by every edit that does not present it. A workflow whose stages carry no stable identity SHALL be accepted: the configuration is valid without one, and an identity SHALL be assigned before the stage is published to a team. An authored field the editor does not present SHALL survive an edit unchanged.

This version SHALL NOT implement WIP limits and SHALL NOT introduce reusable workflow templates.

A stage SHALL additionally support the deterministic configuration defined by `deterministic-steps`. A deterministic stage SHALL NOT author a nonempty entry instruction or an allowed transitions list. Its named exit mappings SHALL be its configured destinations for workflow access and graph presentation; several exits MAY resolve to the same destination, which SHALL be presented as one connection to that destination. The exit names SHALL NOT be presented on the diagram's connections; each exit name and the destination it resolves to SHALL remain presented and editable in the stage editor. A deterministic stage SHALL NOT obtain a default route from the first exit or from workflow order. Exit names SHALL NOT be executable interpretations of a legacy transition condition, and legacy conditions SHALL retain their documentary meaning. A script SHALL NOT supply or override a destination stage identifier.

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

#### Scenario: Draw one connection for several exits without naming it on the path

- **WHEN** a deterministic stage maps two exit names to the same other stage
- **THEN** the diagram draws one connection to that destination
- **AND** that connection presents no exit name
- **AND** the stage editor presents both exit names and the destination they share

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

### Requirement: Text search and project filtering
The active board SHALL support text search over its task titles and descriptions and filtering by project, separately and together. The project filter SHALL list the projects that already have at least one card on the active board; it SHALL NOT list a project with no card on that board. The filter SHALL derive its options from the tasks of the active board, so removing a project from the board's scope SHALL NOT remove a project that still has cards there. The two inputs SHALL be presented by the board filter control defined by the Board filter control requirement. This scope SHALL NOT add activity or worktree-status filters.

#### Scenario: Find a task by its title or description
- **WHEN** the user searches for text that matches a task's title or description
- **THEN** that task is included in the board's matching results

#### Scenario: Filter tasks by project
- **WHEN** the user selects a project filter
- **THEN** the board displays only tasks associated with that project

#### Scenario: Combine search and project filtering
- **WHEN** the user applies text search and a project filter together
- **THEN** the displayed tasks satisfy both the text search and the selected project filter

#### Scenario: List only projects with cards on the board
- **WHEN** the active Hub has a project with no card on the active board
- **THEN** the project filter does not offer that project
- **AND** it offers every project that has at least one card on the board

#### Scenario: Keep the filter inside the active board
- **WHEN** the user changes from one board to another
- **THEN** the project filter options are limited to the projects with cards on the newly active board
- **AND** tasks from the previous board are not shown

#### Scenario: Reach both filters from one control
- **WHEN** the user wants to combine a text search with a project filter
- **THEN** both inputs are available in the same filter popover without leaving it

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
The Kanban configuration experience SHALL include a General section that is presented first and opened by default. The General section SHALL provide an optional worktree base path used as the parent directory for future task worktree destinations across all Hubs and boards. A non-empty worktree base path SHALL be an absolute path; saving SHALL require it to resolve to an existing directory and SHALL retain that canonical directory. Saving an empty worktree base path SHALL remove the configured value. When no worktree base path is configured, future worktree destinations for Git-backed tasks SHALL be derived beside the project's Git repository as defined by `worktree-management`. Changing or clearing the worktree base path SHALL NOT move, remove, or rename any existing worktree or branch.

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
- **AND** future worktree destinations for Git-backed tasks derive beside the project's Git repository
- **AND** every existing worktree, branch, and recorded destination remains unchanged

#### Scenario: Derive beside the repository without a base path
- **WHEN** no worktree base path is configured and a Git-backed task needs a worktree destination
- **THEN** the destination is derived beside the project's Git repository as defined by `worktree-management`

#### Scenario: Existing worktrees survive a base path change
- **WHEN** the user changes or clears the worktree base path while tasks have existing worktrees
- **THEN** every existing worktree, branch, and recorded destination remains unchanged

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
When the host sidebar is fully collapsed on macOS, the Kanban board header SHALL offset its leading content by the host-published frame leading clearance so the Kanban title, the Hub tabs, and the toolbar do not overlap the window traffic lights or the shell's sidebar and new-session controls. The header SHALL use its normal leading inset when the clearance is absent, SHALL use the fullscreen clearance when the host reports fullscreen, and SHALL wrap its content without clipping at supported widths.

#### Scenario: Collapse the sidebar on macOS
- **WHEN** the DSH sidebar is fully collapsed on macOS and the host publishes a frame leading clearance
- **THEN** the board header's leading content starts after that clearance
- **AND** the Kanban title, the Hub tabs, and the toolbar do not sit under the traffic lights or shell controls

#### Scenario: Keep the normal inset when expanded
- **WHEN** the sidebar is expanded or the host publishes no frame leading clearance
- **THEN** the board header uses its normal leading inset

#### Scenario: Keep the fullscreen clearance
- **WHEN** the collapsed macOS window is fullscreen and the host publishes the smaller clearance
- **THEN** the header clears the remaining shell controls without reserving the traffic-light band

#### Scenario: Wrap at a narrow width
- **WHEN** the board header is narrower than its title, Hub tabs, and toolbar together
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

Creating a board SHALL require a name and SHALL initialize it with the default workflow. Renaming a board SHALL NOT change its tasks, workflow, conversations, or worktrees. A board SHALL be deletable only when it contains no tasks. Deleting a board that is bound to a published board SHALL require choosing whether the removal applies only to this installation or to the team. A local-only removal SHALL remove the board locally and SHALL keep it out of later team updates. A team-wide removal SHALL remove the board locally and SHALL append a removal event to that board's published log when the user next publishes that board; a team-wide removal SHALL NOT be sent by any automatic action. Deleting the last board SHALL leave the Hub with no boards and SHALL present the Hub's create-board empty state. Deleting a board SHALL NOT delete its projects, project directories, worktrees, branches, native conversations, or native workspaces.

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

- **WHEN** the user deletes a board that is bound to a published board and the board has no tasks
- **THEN** the confirmation offers removing it only from this installation or for the team
- **AND** no deletion happens before one of those choices

#### Scenario: Remove a board only from this installation

- **WHEN** the user confirms removing a published board only from this installation
- **THEN** the board disappears from this installation
- **AND** the published layout is unchanged
- **AND** later team updates do not recreate the board here

#### Scenario: Remove a board for the team

- **WHEN** the user confirms removing a published board for the team
- **THEN** the board disappears from this installation
- **AND** the board's published log gains a removal event
- **AND** no other board's log is written

#### Scenario: Remove a board for the team on Google Drive

- **WHEN** the user confirms removing a published board for the team on a Google Drive binding
- **THEN** the board disappears from this installation
- **AND** the board's published log gains a removal event
- **AND** nothing is sent by an automatic check

#### Scenario: Remove a board for the team on a local folder

- **WHEN** the user confirms removing a published board for the team on a local folder binding
- **THEN** the board disappears from this installation
- **AND** the board's published log gains a removal event
- **AND** nothing is sent by an automatic check

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

### Requirement: Board notice dismissal

The active board SHALL present one dismiss control on each notice it allows the user to dismiss: a retained-checkout entry, the board command-failure notice, and the team-changes banner. The control SHALL be a compact icon-only button at the notice's trailing edge, SHALL carry an accessible name that identifies the notice it dismisses, SHALL have a visible tooltip, SHALL be reachable and operable with the keyboard, and SHALL NOT displace the notice's message, facts, or actions.

The board SHALL NOT offer a dismiss control on a notice that reports work still to resolve: the board load failure, a failed destructive operation, and a project relocation that is waiting or failed. Those notices clear only from host state or from their own recovery action.

Dismissing one notice SHALL remove only that notice. When the dismissed notice was the last dismissible notice on the board, focus SHALL move to the board body; otherwise focus SHALL move to the dismiss control of the next dismissible notice. A dismissal SHALL NOT change task, project, workflow, or publishing state.

A dismissed board command-failure notice SHALL remain dismissed for the current page session, SHALL be replaced by the next failure, and SHALL NOT be stored on the host. Dismissing a retained-checkout entry SHALL be recorded by the host, as defined by the board destructive-operation notice requirement in this capability. Dismissing the team-changes banner SHALL follow the dismissible team-changes banner requirement in `hub-sharing`.

#### Scenario: Dismiss a board command failure

- **WHEN** the board presents a notice that the last command failed and the user activates its dismiss control
- **THEN** the notice is removed from the board
- **AND** the card, drawer, and operation surfaces keep whatever status they already present

#### Scenario: The dismiss control is keyboard operable

- **WHEN** keyboard focus reaches a dismissible notice's dismiss control
- **THEN** the control exposes an accessible name for the notice it dismisses
- **AND** activating it with the keyboard dismisses that notice

#### Scenario: Focus moves after a dismissal

- **WHEN** the user dismisses a notice and another dismissible notice remains
- **THEN** focus moves to that notice's dismiss control
- **WHEN** no dismissible notice remains
- **THEN** focus moves to the board body

#### Scenario: A notice that still needs resolution has no dismiss control

- **WHEN** the board reports a load failure, a failed destructive operation, or an unresolved project relocation
- **THEN** the notice presents no dismiss control
- **AND** its recovery action or its owning surface stays available

#### Scenario: A reload does not restore a dismissed command failure

- **WHEN** the user dismisses a board command-failure notice and reloads the page
- **THEN** the board presents no failure notice until another command fails

### Requirement: Board destructive-operation notice

The active board SHALL present one persistent notice above the board body while a destructive operation is queued or running, while a destructive operation needs attention, or while a deletion retained a checkout path on disk. The notice SHALL present running, queued, and failed operations in an operation group and retained checkouts in a retained group; the operation group SHALL NOT be dismissible, and the retained group SHALL be dismissible.

The operation group SHALL summarize in-progress and queued deletions and worktree removals with the affected task titles. For a failed operation, the operation group SHALL identify the task and offer recovery actions appropriate to the recorded operation, including retry, return when permitted, and force when the failure is `SHARED_WORKTREE`.

The retained group SHALL have its own heading, separate from the operation group, and SHALL report each retained path with the reason its checkout was kept: the checkout is not Git-managed, or the project path or Git root could not be resolved. Each retained entry SHALL be dismissible on its own, and the retained group SHALL offer one action that dismisses every entry it reports, present whenever it reports more than one. Dismissing a retained entry SHALL record the dismissal on the host, SHALL leave the directory on disk untouched, SHALL NOT affect any task, and SHALL NOT be undone by a reload, a panel switch, or another client. A retained record whose directory no longer exists SHALL be removed without a user action.

The notice SHALL update from host state without a reload, SHALL not claim success for an unresolved or failed operation, and SHALL NOT replace the drawer operation status or the card status.

#### Scenario: Show queued and in-progress deletions

- **WHEN** one or more accepted deletions are queued or executing
- **THEN** the board notice identifies the affected tasks and their aggregate state
- **AND** the rest of the board remains usable
- **AND** the operation group presents no dismiss control

#### Scenario: Show a failed destructive operation with recovery

- **WHEN** an accepted deletion or worktree removal fails
- **THEN** the board notice presents the failure and the recovery actions
- **AND** it offers force only when the failure is `SHARED_WORKTREE`
- **AND** it offers return only when returning the task's conversations is permitted
- **AND** the operation group presents no dismiss control

#### Scenario: Report a retained plain checkout

- **WHEN** a deletion completes and leaves a plain checkout on disk because its project is not Git-managed
- **THEN** the retained group reports the retained path
- **AND** the retained group reports that the checkout is not Git-managed
- **AND** the retained group offers a dismiss control for that entry

#### Scenario: Report a retained unverifiable checkout

- **WHEN** a deletion completes after leaving a checkout on disk because the project path or Git root could not be resolved
- **THEN** the retained group reports the retained checkout path
- **AND** the retained group reports that the project path or Git root could not be resolved
- **AND** it does not report that checkout as removed
- **AND** the retained group offers a dismiss control for that entry

#### Scenario: Dismiss one retained checkout

- **WHEN** the user dismisses one entry of the retained group
- **THEN** that entry is removed from the board
- **AND** every other entry of the retained group stays presented
- **AND** the retained checkout directory remains on disk

#### Scenario: Dismiss every retained checkout

- **WHEN** the retained group reports more than one entry and the user activates its dismiss-all action
- **THEN** every reported entry is removed from the board
- **AND** the retained group is no longer presented when no retained checkout remains

#### Scenario: A dismissed retained checkout stays dismissed

- **WHEN** the user dismisses a retained entry and then switches the Kanban panel, or reloads, or connects another client
- **THEN** that entry is not presented again

#### Scenario: Prune a retained checkout whose directory is gone

- **WHEN** the directory of a retained checkout no longer exists
- **THEN** the entry is removed from the board without a user action
- **AND** no other retained entry is removed for that reason

#### Scenario: Notice clears when the operation resolves

- **WHEN** every tracked queued or failed destructive operation resolves or is cleared
- **THEN** the notice no longer presents that operation
- **AND** the card and drawer status remain the authoritative per-task surfaces

### Requirement: Pending user work
Pending user work SHALL mean any input a task's conversation still owes the user's counterpart: an unanswered structured question round, an unanswered native question, a pending approval or permission request, and a user message queued for the next turn. Pending user work SHALL be evaluated for every conversation of the task, including a conversation whose tab is closed and a conversation the client has never displayed. A stage-instruction message the host delivered to a conversation SHALL NOT count as pending user work: it carries a plugin source instead of a user source, so it is never input the user owes the task.

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
- **AND** the classification follows from the message source rather than from a plugin-side record of prompts the host admitted

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

### Requirement: Automatic advance pause and failure

A pause SHALL be recorded with a task whose auto mode is enabled when a turn ends for a reason other than `completed`, or when an advance cannot be admitted before a durable transition exists. A task whose auto mode is disabled SHALL record no pause: a turn that ends for a reason other than `completed` advances nothing, and the recorded transition SHALL survive for the next completed turn. The pause SHALL identify its reason, SHALL be presented on the card and in the task drawer, SHALL persist across reloads and restarts, and SHALL NOT be cleared by reading or acknowledging a conversation. The pause SHALL be cleared when an advance is admitted, when auto mode is disabled, or when the task moves.

An admitted advance that fails SHALL be reported through the task's transition state rather than as a new pause, SHALL keep auto mode enabled when it was enabled, and SHALL NOT be retried automatically. A failed advance that consumed a recorded transition SHALL keep the reason it carried available to the manual retry of that entry. Auto mode SHALL remain armed after a pause, so the next completed turn attempts an advance again.

The pause described here SHALL be a diagnostic record, distinct from the pause requested by the agent defined by Agent-requested task pause. A turn that ends for a reason other than `completed` while the task carries the agent-requested pause SHALL record its diagnostic reason without replacing, shortening, or clearing the agent's reason, and the card SHALL present both. Clearing a diagnostic record SHALL NOT clear the agent-requested pause. Resuming the agent-requested pause SHALL clear any diagnostic record held for the same task, and the task SHALL then advance on its next completed turn like any other armed task.

#### Scenario: Pause after a failed turn

- **WHEN** a turn of an auto-mode task ends with `error`
- **THEN** the task records a pause naming the failed turn
- **AND** the card and the drawer present that reason

#### Scenario: Record no pause without auto mode

- **WHEN** a turn of a task whose auto mode is disabled ends with `error` and the task has a recorded transition
- **THEN** no pause is recorded
- **AND** the recorded transition is preserved
- **AND** the next completed turn advances the task

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

#### Scenario: Keep the agent reason when a paused turn fails

- **WHEN** a turn ends with `error` while the task carries the pause requested by the agent
- **THEN** the diagnostic pause is recorded beside the agent-requested pause
- **AND** the agent's recorded reason is still presented

#### Scenario: Resume clears the diagnostic record

- **WHEN** the paused task is resumed after a diagnostic pause was also recorded
- **THEN** both records are cleared
- **AND** the next completed turn attempts an advance

### Requirement: Agent-requested task pause

A task SHALL support a pause requested by the agent that suspends its automatic advance while leaving auto mode enabled. The pause SHALL be persisted with the task, SHALL carry a reason written by the agent, and SHALL survive reloads, restarts, and reading a conversation.

The reason SHALL be required and SHALL be nonempty after trimming. A blank reason SHALL be rejected. A reason longer than the accepted length SHALL be rejected with an actionable error, and the recorded reason SHALL never be a silent truncation of what the agent asked for. The recorded reason SHALL be presented in the card status region and in the auto-mode control's tooltip and accessible name.

The pause SHALL suspend the automatic advance and SHALL NOT do anything else: it SHALL NOT move the task, change its position, clear or replace the recorded transition, send a message, start an execution, disable auto mode, or retract an advance that was already admitted. The stage run action, the next-stage action, a user drag, and a user-sent prompt SHALL remain available while the task is paused.

A task SHALL be resumed by activating the auto-mode control, by the resume operation of the agent surface, or by a user movement of the task. Sending a prompt from a conversation SHALL NOT resume it. Resuming SHALL clear the pause, SHALL leave auto mode enabled, SHALL NOT move the task or send an instruction, and SHALL NOT cause an advance for a turn that already ended. Disabling auto mode SHALL clear the pause along with the setting. Moving the task SHALL clear the pause and SHALL keep auto mode enabled.

The pause SHALL be requested only while the task's auto mode is enabled. A request against a task whose auto mode is disabled SHALL succeed with a result stating that auto mode is disabled and that the task therefore does not advance, and SHALL NOT record a pause.

#### Scenario: Pause a task with a reason
- **WHEN** the agent pauses a task whose auto mode is enabled and supplies a reason
- **THEN** the pause is persisted with the task and its reason
- **AND** auto mode remains enabled
- **AND** the task's stage, position, and recorded transition are unchanged
- **AND** no message is sent and no agent execution starts

#### Scenario: Report the pause after the call
- **WHEN** the pause or the resume succeeds
- **THEN** the result reports the task, its stage, whether auto mode is enabled, and the pause in effect with its reason

#### Scenario: Reject an empty reason
- **WHEN** the agent requests a pause with a blank reason
- **THEN** the request is rejected with an actionable error
- **AND** no pause is recorded

#### Scenario: Reject an oversized reason
- **WHEN** the agent requests a pause with a reason longer than the accepted length
- **THEN** the request is rejected with an actionable error
- **AND** no pause is recorded
- **AND** no truncated reason is stored

#### Scenario: Do not advance while paused
- **WHEN** a paused task's conversation ends a completed turn
- **THEN** no automatic advance is admitted
- **AND** the task remains in its stage with its pause and reason intact

#### Scenario: Keep the user's actions available
- **WHEN** a task is paused
- **THEN** the stage run action, the next-stage action, and a drag remain available
- **AND** using one of them is not refused because of the pause

#### Scenario: Resume from the auto-mode control
- **WHEN** the user activates the auto-mode control of a paused task
- **THEN** the pause is cleared and auto mode remains enabled
- **AND** the task's stage and position are unchanged

#### Scenario: Resume through the agent surface
- **WHEN** the agent resumes a task that carries the pause
- **THEN** the pause is cleared and auto mode remains enabled
- **AND** the task's stage and position are unchanged

#### Scenario: A user prompt does not resume
- **WHEN** the user sends a prompt in a conversation of a paused task
- **THEN** the pause remains recorded with its reason
- **AND** the completed turn of that prompt does not advance the task

#### Scenario: Resume on a user movement
- **WHEN** the user moves a paused task to another stage or another position
- **THEN** the pause is cleared
- **AND** auto mode remains enabled
- **AND** the next completed turn advances from the new stage

#### Scenario: Resume never advances by itself
- **WHEN** the pause is cleared without a completed turn ending
- **THEN** no advance is admitted
- **AND** the task remains in its stage

#### Scenario: Disabling auto mode clears the pause
- **WHEN** the user disables auto mode on a paused task
- **THEN** the pause is cleared along with the setting
- **AND** no advance is admitted

#### Scenario: Do not retract an admitted advance
- **WHEN** the agent pauses a task with an automatic advance already admitted
- **THEN** the admitted advance is not retracted
- **AND** no later advance is admitted until the task is resumed

#### Scenario: Request a pause with auto mode disabled
- **WHEN** the agent pauses a task whose auto mode is disabled
- **THEN** the call succeeds and reports that the task does not advance because auto mode is disabled
- **AND** no pause is recorded

#### Scenario: The pause does not clear the routing
- **WHEN** the agent pauses a task that has a recorded transition
- **THEN** the recorded transition and its target stage are unchanged
- **AND** clearing the recorded transition does not pause the task

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

### Requirement: Recorded transition for the next advance

A task SHALL be able to record at most one transition for its current stage. The recorded transition SHALL name an existing stage that the current stage's configured transitions list and SHALL carry a reason written by the agent. A recording SHALL be rejected when the current stage does not configure transitions, when the named stage is the task's current stage, when the named stage is not one of the configured targets, or when it names no reason. The reason SHALL be nonempty after trimming; a blank reason SHALL be rejected, and a reason longer than the accepted length SHALL be rejected rather than truncated. Clearing a recording SHALL require no reason. Recording, replacing, or clearing a recorded transition SHALL NOT move the task, change its position, send a message, or change auto mode, and SHALL be available while auto mode is disabled.

A recorded transition that carries a reason SHALL make the task advance at the end of its next completed turn, whether or not auto mode is enabled, and SHALL be the destination of that advance and of the drawer's next-stage action while it resolves. A recording stored without a reason — which an earlier release allowed — SHALL NOT advance the task by itself and SHALL remain the destination of an advance that auto mode admits. It SHALL be discarded when the task leaves the stage it was recorded for, including a manual move, a confirmed transition, and an automatic advance; a same-stage reorder SHALL preserve it. A recorded transition SHALL no longer resolve when its target stage no longer exists or when the current stage no longer lists it as a configured target. A recording that no longer resolves SHALL advance nothing, and SHALL pause auto mode only as defined by Automatic advance destination and dispatch.

The reason SHALL travel with the recording until the advance is dispatched and SHALL NOT outlive it: the recording no longer exists once the task leaves the stage, and the advance that consumed it carries the reason only in the context message it delivers.

#### Scenario: Record a transition

- **WHEN** a task in a stage that configures two targets records one of them with a reason
- **THEN** the task stores that transition and its reason as the one it will follow next
- **AND** its stage and position are unchanged
- **AND** no message is sent and no agent execution starts

#### Scenario: Reject a declaration without a reason

- **WHEN** a recording names a target and no reason, or a reason that is blank after trimming
- **THEN** the recording is rejected without changing the task
- **AND** any previously recorded transition is preserved

#### Scenario: Reject a reason over the accepted length

- **WHEN** a recording names a reason longer than the accepted length
- **THEN** the recording is rejected without changing the task
- **AND** the stored reason is never a silent truncation of what the agent wrote

#### Scenario: Replace a recorded transition

- **WHEN** a task with a recorded transition records the other configured target with a reason
- **THEN** the recorded transition becomes the newly named target with the new reason
- **AND** the task's stage and position are unchanged

#### Scenario: Clear a recorded transition

- **WHEN** a task with a recorded transition records no target
- **THEN** the task has no recorded transition
- **AND** its stage and position are unchanged
- **AND** no reason is required

#### Scenario: Reject a target the stage does not configure

- **WHEN** a recording names a stage that is not one of the current stage's configured targets
- **THEN** the recording is rejected without changing the task
- **AND** any previously recorded transition is preserved

#### Scenario: Reject a recording without configured transitions

- **WHEN** a recording is attempted for a stage that does not configure transitions
- **THEN** the recording is rejected without changing the task

#### Scenario: Record while auto mode is disabled

- **WHEN** a task without auto mode records a transition with a reason
- **THEN** the recording is stored
- **AND** auto mode remains disabled

#### Scenario: Arm the next completed turn without auto mode

- **WHEN** a task without auto mode records a transition and its next turn completes
- **THEN** the task advances to the recorded stage
- **AND** auto mode remains disabled

#### Scenario: Do not move before the turn ends

- **WHEN** a task records a transition during a turn
- **THEN** its stage and position are unchanged for the rest of that turn
- **AND** the advance happens at the end of the completed turn, or not at all when the turn ends otherwise

#### Scenario: Disarm the advance by clearing the recording

- **WHEN** a task without auto mode clears its recorded transition and its next turn completes
- **THEN** the task does not advance

#### Scenario: Keep a recording without a reason inert

- **WHEN** a task carries a transition recorded without a reason and its auto mode is disabled
- **THEN** its next completed turn advances nothing
- **AND** auto mode, when the user enables it, still uses that recording as its destination

#### Scenario: Discard the recording on leaving the stage

- **WHEN** a task with a recorded transition moves to another stage
- **THEN** the task no longer has a recorded transition
- **AND** its reason is discarded with it

#### Scenario: Preserve the recording across a same-stage reorder

- **WHEN** a task with a recorded transition is reordered inside its stage
- **THEN** the recorded transition and its reason are preserved

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

### Requirement: Execution accent on task cards

A task card SHALL present agent execution through one visible execution accent carried by two surfaces: a bar at the trailing edge of the card and the card's border. Both surfaces SHALL use the host theme's accent color and SHALL pulse while agent execution is running, remaining legible in the host's light and dark appearances. The accent SHALL NOT be presented as an attention mark: a card whose task is running SHALL NOT add a mark to the context region for that state. The card SHALL NOT present a working text label. The working state SHALL be announced to assistive technology when it begins, and periodic animation updates SHALL NOT be announced. The card SHALL follow the host's reduced-motion preference by keeping both accent surfaces visible without animation. The execution accent SHALL NOT replace or hide the attention indicators, and it SHALL be presented whether or not the card also presents the run or advance actions. The card SHALL NOT present a background activity indicator; background activity SHALL remain available through the task drawer's Conversations section entry as defined by Coexisting attention indicators across task conversations.

#### Scenario: Card shows a running turn

- **WHEN** a task is running an assistant turn
- **THEN** its card presents the trailing accent bar and the accent-colored border
- **AND** the working state is announced once to assistive technology
- **AND** the card presents no working text label

#### Scenario: Card shows working while a subagent runs

- **WHEN** a task's assistant turn has ended and an owned subagent descendant is still running
- **THEN** its card still presents both accent surfaces
- **AND** the running subagent is not presented as background activity

#### Scenario: Running carries no attention mark

- **WHEN** a card presents the execution accent
- **THEN** the context region presents no mark for agent execution
- **AND** the marks for unread messages, an awaiting reply, and a failure remain presented when they apply

#### Scenario: Distinguish running from unread without motion

- **WHEN** the host prefers reduced motion and one card is running while another card is unread
- **THEN** both cards present the same blue surface
- **AND** only the running card presents the accent-colored border

#### Scenario: Background work does not use the accent

- **WHEN** a task has no owned agent running and still owns unsettled jobs or schedules
- **THEN** its card presents no execution accent
- **AND** its card presents no background activity indicator

#### Scenario: Activity is separate from identity

- **WHEN** a card presents an execution accent
- **THEN** the project name and the attention marks remain presented in the context region
- **AND** the accent does not replace an attention mark

#### Scenario: Reduced motion

- **WHEN** the user prefers reduced motion
- **THEN** both accent surfaces remain visible without animation

#### Scenario: Theme appearance

- **WHEN** the host application uses its light or dark appearance
- **THEN** both accent surfaces remain legible and use host theme colors

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

### Requirement: Compact board header
The Kanban page SHALL present its chrome inside the board header in two rows: a first row with the Kanban title, the Hub tabs of the available Hubs in Hub order followed by the create-Hub action, and the page toolbar; and a second row with the board tabs of the active Hub in board order followed by the create-board action. The header SHALL NOT present a subtitle beneath the title, and the title SHALL keep its current size as the leading content of the first row.

Every interactive control in the first-row toolbar SHALL have the same height, and that height SHALL equal the height of a Hub tab so that the row reads as one line. Both rows SHALL stay horizontally scrollable rather than truncated when their tabs exceed the available width. When a row cannot present its content on one line, the toolbar SHALL wrap below that row and no control SHALL be hidden.

At a viewport width of at least 1100px each row SHALL fit on a single line, and the board header SHALL NOT be taller than 112px.

The board tabs SHALL be presented as compact chips visually smaller than the Hub tabs while the second row keeps its height, so that content below the header does not shift when the chips change. Each board chip SHALL keep the attention and publishing indicators, the running-task count, and the accessible name defined by Board attention aggregation, and the active board SHALL remain visibly distinguishable.

#### Scenario: Present the header in two rows
- **WHEN** the Kanban page renders a Hub with at least one board
- **THEN** the first row shows the Kanban title, the Hub tabs with the create-Hub action, and the page toolbar
- **AND** the second row shows the board tabs with the create-board action
- **AND** the two rows sit above the board body

#### Scenario: Omit the header subtitle
- **WHEN** the Kanban page renders its header
- **THEN** no subtitle is presented beneath the Kanban title
- **AND** the title is presented at its existing size

#### Scenario: Keep one line height across the toolbar
- **WHEN** the user inspects the filter control, the presentation switch, the select-cards action, and the configuration action
- **THEN** each has the same height as a Hub tab
- **AND** they share one baseline on the first row

#### Scenario: Stay on single rows at a desktop width
- **WHEN** the Kanban page renders at a viewport width of at least 1100px
- **THEN** the first row and the second row each occupy one line
- **AND** the board header is no taller than 112px

#### Scenario: Reflow the header at a narrow width
- **WHEN** the board header is narrower than the first row's title, Hub tabs, and toolbar together
- **THEN** the toolbar wraps below the row
- **AND** the tab rows scroll horizontally
- **AND** no title, tab, or toolbar control is hidden or clipped

#### Scenario: Present compact board chips
- **WHEN** the active Hub has more than one board
- **THEN** each board is a chip smaller than a Hub tab
- **AND** the second row keeps its height
- **AND** each chip keeps its attention indicators, its running-task count, and its publishing indicator
- **AND** the active board is visibly distinguishable

### Requirement: Board filter control
The board header SHALL present one filter control in the page toolbar that opens an anchored, non-modal popover containing the text-search input and the project select. Those two inputs are the only way to set the filters from the header: the header SHALL NOT present an always-visible search field or a separate clear-filters button, and it SHALL NOT require a keyboard shortcut to reach the search input. The project select SHALL NOT size itself to its longest option; it SHALL truncate the selected value and expose the full name through its tooltip.

Filtering SHALL apply live as the user types or changes the selected project. The popover SHALL NOT require an apply action and SHALL remain open while either input changes. The popover SHALL present a footer with a clear action and a close action, each icon-only and each carrying its name in its accessible name and tooltip. The clear action SHALL remove both filters and close the popover. The close action SHALL leave the filters unchanged.

When at least one of the two filters is active, the filter control SHALL present an accent indicator. When both are active it SHALL present a numeral stating the count of active filters. The indicator SHALL NOT change the control's height, and the control's accessible name SHALL state which filters are active.

The filter control SHALL be presented together with the presentation switch, the select-cards action, and the configuration action, and SHALL NOT be presented while card selection is active. The popover SHALL close on Escape and on an outside click and SHALL return focus to the filter control; while a task drawer is open, Escape SHALL dismiss only the popover. The popover belongs to its caller's layer: it SHALL present above the board content and below the task drawer, leaving other components free to overlap it, and it SHALL NOT move the board or change its size. When the popover opens, focus SHALL move to the search input. When the active Hub or board changes, the filters SHALL reset as defined by Board selection and persistence and the popover SHALL close. The filter control and the filters it holds SHALL remain available in both presentations defined by Board presentation selection.

#### Scenario: Open the filter popover
- **WHEN** the user activates the filter control
- **THEN** an anchored non-modal popover presents the text-search input and the project select
- **AND** focus moves to the search input
- **AND** the board keeps its position and size

#### Scenario: Filter while the popover stays open
- **WHEN** the user types in the search input or selects a project inside the popover
- **THEN** the board updates with that filter
- **AND** the popover remains open with both inputs available

#### Scenario: Indicate one active filter
- **WHEN** the user has entered search text or selected a project and closed the popover
- **THEN** the filter control presents an accent indicator
- **AND** its accessible name states which filter is active

#### Scenario: Indicate two active filters with a count
- **WHEN** search text and a project filter are both active
- **THEN** the filter control presents the indicator with the numeral 2
- **AND** the control keeps the same height as the other toolbar controls

#### Scenario: Clear both filters from the popover
- **WHEN** the user activates the clear action in the popover footer
- **THEN** the search text and the project filter are both removed
- **AND** the board presents all of its tasks
- **AND** the popover closes
- **AND** focus returns to the filter control

#### Scenario: Close the popover without changing filters
- **WHEN** the user activates the close action in the popover footer
- **THEN** the popover closes
- **AND** the search text and the project filter are unchanged

#### Scenario: Present the popover under the task drawer
- **WHEN** the filter popover is open over the board and a task drawer opens over it
- **THEN** the task drawer presents above the popover
- **AND** the popover stays open until the user dismisses it

#### Scenario: Dismiss the popover without closing the drawer
- **WHEN** the filter popover is open, a task drawer is open over it, and the user presses Escape or clicks the task drawer
- **THEN** only the popover closes
- **AND** the task drawer remains open
- **AND** Escape returns focus to the filter control
- **AND** a click that lands on a control in the drawer leaves focus on that control

#### Scenario: Keep the popover inside the viewport on a narrow header
- **WHEN** the filter popover is open and the page is narrower than 760 pixels
- **THEN** the popover is anchored to the leading edge of the filter control
- **AND** both of its edges stay inside the viewport
- **AND** the search input and the project select can both be reached and used

#### Scenario: Hide the filter control during card selection
- **WHEN** the user enters card selection mode
- **THEN** the filter control is not presented
- **AND** the selection count, delete, and cancel actions are presented instead

#### Scenario: Keep filtering available in the workflow diagram
- **WHEN** the board presents the workflow diagram and a filter is active
- **THEN** the filter control is presented in the toolbar
- **AND** the diagram presents only the tasks that match the active filters

#### Scenario: Reset and close the popover on navigation
- **WHEN** the user switches the active Hub or the active board while the filter popover is open
- **THEN** the popover closes
- **AND** the search text and the project filter are cleared

### Requirement: Board project scope configuration
A board SHALL carry its own project scope that states which projects may create tasks on it. The scope SHALL be stored on the board and SHALL NOT be stored in the board's workflow YAML. The scope SHALL have two states: unrestricted, meaning every project of the Hub may create tasks, and restricted to an explicit set of project keys. A board with no recorded scope SHALL be unrestricted, and a restriction SHALL be recorded as an explicit set that SHALL be able to be empty. A board restricted to an empty set SHALL accept no new task and SHALL be presented as closed for creation. The board's configuration SHALL present both states with the projects of the active Hub so a user can choose between them and change the selected set. Removing a project from the scope SHALL NOT change the tasks already on the board, SHALL NOT move them, and SHALL NOT remove them. Saving the scope SHALL be a board write that carries the Hub revision as its precondition and SHALL follow the same publishing behavior as the other board writes. The scope SHALL be local to the Hub that owns the board and SHALL be published only as described by the hub-sharing specification.

#### Scenario: Restrict a board to selected projects
- **WHEN** the user selects specific projects for a board and saves the board configuration
- **THEN** the board allows those projects and refuses every other project of the Hub
- **AND** the New task input offers the selected projects only

#### Scenario: Allow every project on a board
- **WHEN** the user chooses to allow every project for a board that was restricted
- **THEN** the board records no restriction
- **AND** every project of the Hub may create tasks on that board again

#### Scenario: Close a board to new tasks
- **WHEN** the user selects specific projects and leaves none selected
- **THEN** the board accepts no new task
- **AND** New task explains that the board is closed for creation instead of offering an empty project input

#### Scenario: Keep existing cards when a project leaves the scope
- **WHEN** the user removes from the board's scope a project that has cards on that board
- **THEN** the scope no longer allows that project
- **AND** the existing cards stay in their stages with their conversations and worktrees unchanged

#### Scenario: Present the scope beside the rest of the board configuration
- **WHEN** the user opens the board's configuration
- **THEN** the project scope is presented with the board's other configuration
- **AND** it presents the board's current state and the projects of the active Hub

#### Scenario: Do not store the scope in the workflow
- **WHEN** the user saves a board project scope
- **THEN** the board's workflow YAML is unchanged
- **AND** the scope does not appear in the workflow editor

### Requirement: Stage edit action in the column board stage header

Every stage header of the column board SHALL present the stage edit action defined by `stage-editing` at the header's top right, after the stage's card count and, on the initial stage, after the task creation action. The action SHALL carry an accessible name naming the stage it edits and SHALL activate from the keyboard as readily as from the pointer.

The action SHALL be available while card selection is active and while the search or project filter hides every card of the stage. Activating it SHALL open the same stage editor the workflow diagram opens, with the same fields, validation, and effects, and SHALL NOT move, reorder, or otherwise change the stage by itself.

#### Scenario: Present the action in the column board

- **WHEN** the column board presents a workflow with four stages
- **THEN** each stage header presents the stage edit action after its card count

#### Scenario: Open the editor from the column board

- **WHEN** the user activates the stage edit action of a stage in the column board
- **THEN** the stage editor opens for that stage
- **AND** it presents the same fields and validation the diagram's editor presents

#### Scenario: Keep the action available during card selection

- **WHEN** card selection is active and the user activates the stage edit action
- **THEN** the stage editor opens
- **AND** no card selection changes

#### Scenario: Save from the column board

- **WHEN** the user changes the stage name in the editor opened from the column board and saves
- **THEN** the column board presents the stored name
- **AND** the cards in that stage keep their order and stage

### Requirement: Card attention surface

The board SHALL present a task's dominant attention state as a tint of the card surface. The dominant state SHALL be selected from the task's attention facts by a fixed priority: a failure, then an awaiting reply, then agent execution, then unread messages. The tint SHALL be the state's attention color mixed into the host surface at a low share, so that the card stays legible as text while its surface reads as area. The tint SHALL NOT be the only presentation of the state: the attention marks defined by Coexisting attention indicators across task conversations SHALL remain presented, including for every state that does not win the surface. The surface SHALL present no tint when none of those states applies. The tint SHALL NOT change the card's height, SHALL NOT add, remove, or reorder a region of the card, and SHALL NOT affect the task's workflow stage, its position, or its drag behavior. Task-level context-operation, confirmed-transition, and automatic-advance state SHALL NOT tint the card; those remain in the status region as defined by Task card status strip.

#### Scenario: Paint the dominant state

- **WHEN** a task has a failure and also has unread messages
- **THEN** the card surface is tinted with the failure color
- **AND** the unread mark is still presented in the context region

#### Scenario: Keep the card text legible

- **WHEN** a card presents a tint in either the host's light or dark appearance
- **THEN** the title, the project name, and the status-region text keep at least 4.5:1 contrast against the painted surface

#### Scenario: Present no tint without attention

- **WHEN** a task has no failure, no awaiting reply, no running agent, and no unread messages
- **THEN** the card surface presents no tint

#### Scenario: Keep the card height stable

- **WHEN** a card gains or loses a tint
- **THEN** its height and the positions of its regions do not change

#### Scenario: Keep status state out of the surface

- **WHEN** a task has a failed context operation and no failure, awaiting reply, running agent, or unread message
- **THEN** the card surface presents no tint
- **AND** the status region reports the failed operation

#### Scenario: Keep the tint in selection mode

- **WHEN** the board is in card-selection mode and a card has an attention state
- **THEN** the card still presents its tint
- **AND** the selection control and the selection accent remain presented

### Requirement: Attention marks keep a readable size in the diagram

The board SHALL present each attention mark at a readable on-screen size in the column board and in the workflow diagram. A mark's on-screen size SHALL remain constant while the diagram's zoom is between 0.29 and 1, SHALL follow the diagram's zoom above 1, and SHALL NOT exceed 3.5 times its authored size at any zoom, including the diagram's minimum zoom. Marks SHALL remain circles distinguished by their attention color and their fixed order of unread, awaiting reply, and failure. The card SHALL NOT present a mark for agent execution. Each mark SHALL keep the accessible name for its state at every zoom.

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

### Requirement: Board-wide mark all as read

The active board's header SHALL present a mark-all-read action. The action SHALL be presented whenever the board is not in card-selection mode, and SHALL be unavailable while the active board has no unread and no failed settled turn. Activating it SHALL acknowledge the last settled turn of every conversation belonging to every task on the active board, SHALL clear those tasks' unread and failure indicators, and SHALL persist the acknowledgment across reloads and plugin restarts. It SHALL NOT clear an awaiting-reply state, which is live rather than recorded. It SHALL NOT acknowledge a conversation of a task on another board or in another Hub. It SHALL NOT require a confirmation step, and it SHALL expose a short accessible name that states its effect.

#### Scenario: Clear a whole board

- **WHEN** the user activates the mark-all-read action on a board whose tasks have unread and failed settled turns
- **THEN** every card on that board stops presenting its unread and failure indicators
- **AND** a reload does not restore them

#### Scenario: Be unavailable when nothing is pending

- **WHEN** the active board has no unread and no failed settled turn
- **THEN** the mark-all-read action is unavailable

#### Scenario: Keep the other boards unread

- **WHEN** the user activates the mark-all-read action on one board
- **THEN** the tasks on every other board keep their indicators

#### Scenario: Keep an awaiting reply

- **WHEN** a task on the active board is awaiting a reply
- **THEN** activating the mark-all-read action does not clear that state

#### Scenario: Stay out of selection mode

- **WHEN** the board is in card-selection mode
- **THEN** the mark-all-read action is not presented

#### Scenario: Act without confirmation

- **WHEN** the user activates the mark-all-read action
- **THEN** no confirmation dialog is presented
- **AND** the action takes effect immediately

### Requirement: Board default model

Each board's workflow SHALL accept an optional root model mapping that names the model the
board's new conversations start on. The mapping SHALL carry a provider and a model, and MAY carry
a reasoning effort. A workflow without the mapping SHALL keep today's behavior and start those
conversations on the deployment default. The mapping SHALL be validated with the same accepted
workflow semantics as the rest of the workflow: a mapping whose provider or model is missing or
empty, whose reasoning effort is empty, or that carries a field the workflow does not define
SHALL be rejected as invalid and SHALL NOT replace the last valid workflow. The board's stored
parsed workflow and its authored YAML SHALL agree on the mapping, in the same way they agree on
every other workflow field. The board's default model SHALL be part of the workflow's meaning and
SHALL NOT be part of its layout. The board's default model SHALL be stored in the board's
workflow and SHALL NOT be stored in a board setting outside it.

#### Scenario: Accept a board default model

- **WHEN** a workflow configures a root model mapping with a provider, a model, and a reasoning effort
- **THEN** the configuration is accepted and the board keeps that model as its default
- **AND** the stored parsed workflow and the authored YAML agree

#### Scenario: Keep the deployment default when the field is absent

- **WHEN** a workflow configures no root model mapping
- **THEN** the configuration is accepted
- **AND** the board has no default model of its own

#### Scenario: Reject a model mapping without a model

- **WHEN** a workflow configures a root model mapping whose model is missing or empty
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Reject an unsupported field in the model mapping

- **WHEN** a workflow configures a root model mapping that carries a field the workflow does not define
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Count a model change as a workflow change

- **WHEN** a board's workflow differs from another version of that workflow only in its model mapping
- **THEN** that difference is a change to the workflow's meaning and not a layout difference

### Requirement: Board default model configuration

The board section of the board configuration SHALL present a control that names the model the
board's new conversations start on. The control SHALL offer the models the host reports as
available, each with its provider, SHALL offer the reasoning efforts that the chosen model
reports, and SHALL offer an explicit option that keeps the deployment default. Choosing a model
SHALL write the root model mapping into the board's authored workflow YAML and SHALL preserve the
text and comments outside that mapping. Choosing to keep the deployment default SHALL remove that
mapping from the authored YAML. Saving the board SHALL follow the same guarded save as the rest of
the board's workflow, so an invalid document SHALL NOT replace the stored workflow. When the
board's stored model is not among the models the host reports as available, the control SHALL
present the stored provider and model and state that they are unavailable, and SHALL NOT remove
them or alter the board on its own.

#### Scenario: Choose a model for the board

- **WHEN** the user chooses an available model and a reasoning effort in the board configuration and saves
- **THEN** the board's authored workflow YAML carries that model mapping at the document root
- **AND** the text and comments outside that mapping are unchanged

#### Scenario: Keep the deployment default

- **WHEN** the user chooses the option that keeps the deployment default and saves
- **THEN** the board's authored workflow YAML no longer carries a model mapping
- **AND** the board's new conversations start on the deployment default

#### Scenario: Offer the reasoning effort of the chosen model

- **WHEN** the user chooses a model that reports reasoning efforts
- **THEN** the control offers those efforts and an option that keeps the model's own default

#### Scenario: Reject an invalid document

- **WHEN** the board's workflow document is invalid at save time
- **THEN** the save is refused and the stored workflow is unchanged
- **AND** the problem stays visible in the configuration

#### Scenario: Present a stored model that the host no longer offers

- **WHEN** the board's stored model is absent from the models the host reports as available
- **THEN** the board configuration presents the stored provider and model and states that they are unavailable
- **AND** the stored model is neither removed nor rewritten

### Requirement: Stage with no destination

A board's workflow MAY author an empty allowed transitions list for a stage, and such a stage SHALL permit no destination. An empty list SHALL be valid and SHALL NOT be rejected as an invalid workflow, and it SHALL NOT be interpreted as a stage that allows any other stage, which is the meaning of omitting the list. A stage with no destination SHALL have no outgoing connection drawn for it, SHALL NOT be advanced automatically, and SHALL require the explicit confirmation already defined for a restricted transition before any task leaves it. A task in a stage with no destination SHALL still be reorderable inside that stage. Making a stage author no destination, and restoring it to allow any other stage, SHALL each be an ordinary workflow write.

#### Scenario: Accept a stage with no destination

- **WHEN** a workflow configuration stores an empty allowed transitions list for a stage
- **THEN** the configuration is accepted
- **AND** the stage permits no destination

#### Scenario: Distinguish an empty list from an omitted list

- **WHEN** one stage omits its allowed transitions and another stage stores an empty list
- **THEN** the stage that omits them permits any other stage
- **AND** the stage that stores an empty list permits none

#### Scenario: Require confirmation to leave a stage with no destination

- **WHEN** a user requests a move out of a stage that permits no destination
- **THEN** the board asks for the restricted-transition confirmation before moving the task
- **AND** the task remains in its stage until the user confirms

#### Scenario: Do not advance out of a stage with no destination

- **WHEN** a task in a stage that permits no destination completes a turn with automatic advance in effect
- **THEN** the task is not moved to another stage
- **AND** no execution is initiated by an automatic advance

#### Scenario: Present no advance action in a stage with no destination

- **WHEN** a card is presented in a stage that permits no destination
- **THEN** the card presents no advance action
- **AND** its other card actions behave as they do in any other stage

#### Scenario: Reorder inside a stage with no destination

- **WHEN** the user reorders a task inside a stage that permits no destination
- **THEN** the task keeps its stage
- **AND** its position changes as requested

#### Scenario: Restore a stage that allows any other stage

- **WHEN** a stage that authored an empty list is stored with its allowed transitions omitted
- **THEN** any other stage may be a destination again
