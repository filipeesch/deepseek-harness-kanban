# Spec Delta

## ADDED Requirements

### Requirement: Agent conversation for an instructed stage

When a permitted move, a timed instruction, a card run action, an automatic advance, or an automatic first-execution preparation needs to deliver the entry instruction of a stage that names an agent, the target SHALL be that agent's conversation in the task. The host SHALL create that conversation on first use in the task's current effective directory, with the agent's preset and model selected before its first turn and its native title set to the agent's name, SHALL add it to the task as an ordinary conversation, and SHALL present it in the task drawer. A conversation that already exists for that agent in the task SHALL be reused and SHALL keep its history; a conversation the person closed SHALL be reopened instead of replaced, and a conversation whose agent the workflow no longer names SHALL remain as an ordinary conversation with no binding.

The conversation SHALL remain an ordinary task conversation: it counts for the task's pending user work and activity, it receives the task context and the stage notices every task conversation receives, and it is archived with the task. The stage instruction SHALL reach it as the same stage-instruction context message a shared stage delivers, with the same transition briefing, declared reason, and scripted handoff. Its preset SHALL stay locked after the first turn, so a later workflow edit to that agent's preset SHALL apply only to conversations created afterwards.

The specialist SHALL route as any instructed agent stage does: it declares a transition, auto mode moves the task, or the person moves it. A completed turn of the agent conversation SHALL NOT move the task on its own while auto mode is disabled and no transition was declared.

#### Scenario: Deliver an instructed agent stage to its conversation

- **WHEN** a permitted move enters a stage that names an agent and has an entry instruction
- **THEN** the instruction is delivered to that agent's conversation
- **AND** the main conversation receives no instruction for that stage

#### Scenario: Create the agent conversation with the preset and model

- **WHEN** a stage that names an agent with a preset and a model is entered and the task has no conversation for that agent
- **THEN** one conversation is created in the task's effective directory
- **AND** it runs the agent's preset and model
- **AND** its native title is the agent's name

#### Scenario: Present the agent conversation in the drawer

- **WHEN** the agent conversation is created for a stage that starts
- **THEN** it is presented as a conversation tab of the task and opened in the task drawer

#### Scenario: Reuse the conversation for a later stage that names the same agent

- **WHEN** a task enters a second stage that names an agent it already has a conversation for
- **THEN** the instruction is delivered to that existing conversation
- **AND** its history is preserved and no second conversation is created

#### Scenario: Reopen a closed agent conversation

- **WHEN** a stage that names an agent needs its conversation and the person had closed it
- **THEN** the same conversation is reopened
- **AND** its history is preserved

#### Scenario: Keep the conversation after the workflow stops naming the agent

- **WHEN** a workflow edit removes or renames the agent a conversation was created for
- **THEN** the conversation remains an ordinary conversation of the task
- **AND** it is not closed, archived, or removed by the edit

#### Scenario: Prepare the first execution in an agent initial stage

- **WHEN** a task is created directly in an initial stage that names an agent and the automatic first-execution preparation runs
- **THEN** the conversation the preparation creates is that agent's conversation
- **AND** it runs the agent's preset and model

#### Scenario: Do not advance on a completed turn without a declaration

- **WHEN** the agent conversation ends a completed turn, auto mode is disabled, and no transition was declared
- **THEN** no advance is admitted
- **AND** the task remains in its current stage

### Requirement: Stage entry held while its agent preset is unavailable

When the conversation a stage entry needs names an agent whose preset the running host does not offer, the host SHALL NOT create the conversation and SHALL NOT deliver the instruction. The entry SHALL remain unresolved, the card's status region SHALL present a status that names the agent and its missing preset, and the stage's run action SHALL remain available to retry. The host SHALL record no automatic-mode pause, SHALL keep auto mode as it was, and SHALL NOT retry automatically.

A retry SHALL apply the same creation and admission rules as the first attempt, and a successful retry SHALL resolve the entry through the ordinary admission, so a failed attempt leaves the entry held rather than lost. When the agent's model is unavailable while its preset is offered, the entry SHALL proceed: the conversation SHALL be created on the main agent's model and then on the deployment default, and the fallback SHALL be reported on the card and in the conversation.

#### Scenario: Hold the entry instead of running another agent

- **WHEN** a task enters a stage whose agent names a preset the running host does not offer
- **THEN** no conversation is created and no instruction is delivered
- **AND** the entry remains unresolved
- **AND** the card presents a status naming the agent and the missing preset

#### Scenario: Retry after the preset is installed

- **WHEN** the person activates the run action after the missing preset becomes available
- **THEN** the agent conversation is created and the instruction is delivered
- **AND** the entry is resolved through the ordinary admission

#### Scenario: Record no pause and no automatic retry

- **WHEN** the entry is held for a missing preset
- **THEN** no automatic-mode pause is recorded
- **AND** the host does not retry the delivery on its own

#### Scenario: Fall back to the main agent's model

- **WHEN** the agent's preset is available and its declared model is not offered by the running host
- **THEN** the conversation is created on the main agent's model
- **AND** the fallback is reported on the card and in the conversation

#### Scenario: Fall back to the deployment default model

- **WHEN** neither the agent's model nor the main agent's model is offered by the running host
- **THEN** the conversation is created on the deployment default model
- **AND** the fallback is reported on the card and in the conversation

#### Scenario: Keep the entry after a failed attempt

- **WHEN** a send to an agent stage fails because its agent preset is unavailable
- **THEN** the entry remains unresolved and the card exposes the run action
- **AND** the task keeps its stage and auto mode unchanged

## MODIFIED Requirements

### Requirement: Board default agent preset

Each board's workflow SHALL accept agents that name the preset their conversations start on, as defined by Board agents in the workflow document in `workflow-authoring`. The main agent's preset SHALL be the board's default agent preset for the main conversation. A document that authors no `agents` section SHALL keep accepting the legacy root `agent_preset` scalar for the same purpose, and that scalar SHALL take precedence over board-default metadata exactly as before. Invalid workflow fields or an empty preset SHALL NOT replace the last valid workflow. A stored preset unavailable on the host SHALL remain stored and SHALL be reported as unavailable; for the main conversation, host-default fallback SHALL remain available, and an agent conversation whose preset is unavailable SHALL hold its entry as defined by Stage entry held while its agent preset is unavailable.

For a newly created board whose document authors no `agents.main` and no root `agent_preset`, the product SHALL record a versioned implicit workflow-operator selection in board-owned shareable metadata separate from authored YAML. A user-selected host default SHALL be persisted as an explicit distinct choice; legacy absence on an existing board SHALL continue to mean host default. A document that authors `agents.main` SHALL take that entry as the effective choice: without a preset it is an explicit host default, and with a preset it names that preset; the board metadata SHALL then no longer decide the choice, and the guarded write that authored the entry SHALL retire it. Imported or received already-authored boards SHALL NOT be reclassified as newly created. The effective choice and its origin SHALL be visible in board settings. These selections SHALL be preserved in schema validation, revisions, publication, synchronization, replay, conflict handling, and recovery; incompatible peers SHALL fail explicitly rather than discard them. No existing conversation or other board SHALL be changed by editing the choice.

#### Scenario: Accept a board default agent preset

- **WHEN** a workflow declares `main` with a preset identity
- **THEN** the configuration is accepted and the board keeps that preset as its default
- **AND** the stored parsed workflow and the authored YAML agree

#### Scenario: Keep the host default when the field is absent

- **WHEN** an existing legacy board authors no `agents.main`, no root `agent_preset`, and no board-default selection metadata
- **THEN** the configuration is accepted
- **AND** the board names no default agent preset of its own and the main conversation uses the host default

#### Scenario: Accept the legacy root scalar

- **WHEN** a workflow authors no `agents` section and authors a root `agent_preset` scalar
- **THEN** the board keeps that preset as the default of its main conversation

#### Scenario: Reject an empty preset

- **WHEN** a workflow configures an agent preset that is empty or blank
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Count a preset change as a workflow change

- **WHEN** a board's workflow differs from another version of that workflow only in an agent's preset
- **THEN** that difference is a change to the workflow's meaning and not a layout difference

#### Scenario: Preserve a stored preset the host no longer offers

- **WHEN** a board stores an agent preset that is absent from the running host's roster
- **THEN** the stored value remains in the workflow
- **AND** the board configuration does not remove or rewrite it

#### Scenario: Default a new board without rewriting custom YAML

- **WHEN** a new board is created with custom YAML without an authored main agent or other explicit selection
- **THEN** versioned shareable board metadata selects the workflow operator implicitly
- **AND** the supplied YAML bytes remain exact and an `expect_sha256` check and dry run use that exact document

#### Scenario: Honor an explicit authored or host-default choice

- **WHEN** a board authors `main` with a preset or authors `main` without one
- **THEN** the authored entry decides the effective choice over the implicit operator default
- **AND** `main` without a preset remains distinguishable from legacy absence

#### Scenario: Preserve shared and imported defaults

- **WHEN** a new board with operator-default metadata is published, synchronized, or restored
- **THEN** its selection and origin are preserved without rewriting authored YAML
- **AND** an imported existing board with no selection remains on the host default
- **AND** an incompatible peer reports incompatibility rather than losing the selection

### Requirement: Board default agent preset configuration

The board configuration SHALL present the board's agents in its own Agents sub-section, with its own draft, its own save action, and its own leave guard; the Defaults sub-section SHALL keep only the MCP tool allowlist. The Agents sub-section SHALL present the agents as one collapsible list with the main agent pinned first and every row closed until the person opens it. A closed row SHALL already name the agent, its model, and its preset. An opened row SHALL present the name, the identifier, the model, and the preset, in that order. The identifier SHALL follow the name until the agent is first saved and SHALL be read-only afterwards. The main agent SHALL NOT be removable, and an agent a stage names SHALL NOT be removed: the row SHALL name the stages that use it. The surface SHALL present the presets the host reports with their names and descriptions and an explicit option that keeps the host default preset, SHALL present the host's native model selector for the main agent, and SHALL present the routes the host catalog reports, with the reasoning effort those routes report, for every other agent; a missing route SHALL mean the main agent's model. A stored preset or model that the host does not report SHALL remain presented and SHALL NOT be removed or rewritten. When the preset roster or the model catalog cannot be read, the surface SHALL report the failure with a retry action, SHALL keep presenting the stored values, and SHALL NOT remove or rewrite them.

Editing this surface SHALL write one guarded workflow document with the revision the form was opened with, and SHALL NOT send a preset-choice hint: the authored `main` entry is the choice. Choosing an available preset SHALL store that identity on the agent; choosing the host default for the main agent SHALL store `main` without a preset; clearing an agent's model SHALL remove its model mapping. The write SHALL preserve the text and comments outside the fields it rewrites, SHALL NOT clear a stored field the person did not edit, and SHALL apply the same validation the board editor enforces. A document that authors no `agents` section SHALL gain one on this edit, materializing the effective main-agent choice and retiring the legacy root fields and the implicit-selection metadata. While the Workflow sub-section holds unsaved edits, the agents controls SHALL remain available for editing, saving SHALL be unavailable with an explanation and a way to open the Workflow sub-section, and nothing SHALL be written. This settings edit SHALL NOT be confused with new-board creation: creation with supplied custom YAML preserves that document's exact bytes and digest.

#### Scenario: List the board's agents

- **WHEN** the Agents sub-section opens for a board that declares a main agent and another agent
- **THEN** every row is closed and the main agent is listed first and cannot be removed
- **AND** each closed row names the agent, its model, and its preset
- **AND** opening a row presents the name, the identifier, the model, and the preset in that order

#### Scenario: Add an agent

- **WHEN** the person adds an agent, types its name, and saves
- **THEN** the identifier follows the name until that first save
- **AND** the board's authored workflow YAML declares that agent with that identifier
- **AND** the text and comments outside the rewritten fields are unchanged

#### Scenario: Remove an agent no stage names

- **WHEN** the person removes an agent that no stage references and saves
- **THEN** the authored workflow YAML no longer declares that agent
- **AND** every stage and agent that remains is unchanged

#### Scenario: Refuse to remove the main agent or a referenced agent

- **WHEN** the surface is asked to remove the main agent, or an agent a stage still references
- **THEN** the removal is unavailable and the surface names the stages that use it
- **AND** nothing is written

#### Scenario: Choose an available preset

- **WHEN** the user chooses an available preset for an agent and saves
- **THEN** the board's authored workflow YAML carries that identity on that agent
- **AND** the text and comments outside those fields are unchanged

#### Scenario: Keep the host default preset

- **WHEN** the user chooses the option that keeps the host default preset for the main agent and saves
- **THEN** the authored `main` entry carries no preset
- **AND** the board's main conversation starts on the host default preset
- **AND** no legacy root `agent_preset` and no implicit selection decides it

#### Scenario: Present a stored preset the host no longer offers

- **WHEN** an agent's stored preset or model is absent from what the host reports
- **THEN** the surface presents the stored identity and states that it is unavailable
- **AND** the stored value is neither removed nor rewritten

#### Scenario: Report a roster failure with retry

- **WHEN** the host's preset roster or model catalog cannot be read
- **THEN** the surface reports the failure and offers a retry action
- **AND** the stored values remain presented and unchanged

#### Scenario: Replace an authored preset in settings

- **WHEN** a board already authors a main-agent preset and the user selects another available preset and saves
- **THEN** one guarded reviewed write replaces the authored value
- **AND** the selected preset is effective without changing other YAML text or comments

#### Scenario: Explicitly select host default over an authored preset

- **WHEN** a board already authors a main-agent preset and the user selects the host default and saves
- **THEN** one guarded reviewed write removes that preset from the main agent
- **AND** new conversations use the host default rather than the removed preset or implicit operator

#### Scenario: Show the effective default and origin

- **WHEN** the Agents sub-section opens for a document that authors no `main` entry and an implicit operator default, an explicit host default, a named preset, or a legacy root preset
- **THEN** the main agent row presents the effective preset and model as its draft
- **AND** a missing preset is presented as unavailable without rewriting the selection

#### Scenario: Migrate a legacy document on this edit

- **WHEN** the person saves this surface for a board whose document authors no `agents` section
- **THEN** the stored document gains that section with the effective main-agent choice materialized
- **AND** the legacy root fields and the implicit-selection metadata no longer decide the choice

#### Scenario: Keep the defaults controls while the workflow is dirty

- **WHEN** the Workflow sub-section holds unsaved edits and the user opens Agents
- **THEN** the agent controls remain editable
- **AND** saving is unavailable with an explanation and a way to open the Workflow sub-section
- **AND** no write is sent and the workflow draft is untouched

#### Scenario: Keep existing sessions and other boards unchanged

- **WHEN** the user changes the board's agents
- **THEN** other boards and existing conversations retain their presets and models
- **AND** only conversations created afterwards use the new agent choices

### Requirement: Board default model

Each board's workflow SHALL accept an optional model mapping on the main agent that names the model the board's main conversation starts on, and SHALL keep accepting a legacy root model mapping for the same purpose while the document authors no `agents` section. The mapping SHALL carry a provider and a model, and MAY carry a reasoning effort. A board whose workflow names neither mapping SHALL start its main conversation on the deployment default. The mapping SHALL be validated with the same accepted workflow semantics as the rest of the workflow: a mapping whose provider or model is missing or empty, whose reasoning effort is empty, or that carries a field the workflow does not define SHALL be rejected as invalid and SHALL NOT replace the last valid workflow. The board's stored parsed workflow and its authored YAML SHALL agree on the mapping, in the same way they agree on every other workflow field. An agent's model SHALL be part of the workflow's meaning and SHALL NOT be part of its layout. A model SHALL be stored in the board's workflow and SHALL NOT be stored in a board setting outside it.

#### Scenario: Accept a board default model

- **WHEN** a workflow declares a main agent with a model mapping that carries a provider, a model, and a reasoning effort
- **THEN** the configuration is accepted and the board's main conversation keeps that model as its default
- **AND** the stored parsed workflow and the authored YAML agree

#### Scenario: Accept the legacy root model mapping

- **WHEN** a workflow authors no `agents` section and authors a root model mapping
- **THEN** the configuration is accepted and the board's main conversation keeps that model as its default

#### Scenario: Keep the deployment default when the field is absent

- **WHEN** a workflow names no model for the main agent and authors no root model mapping
- **THEN** the configuration is accepted
- **AND** the board has no default model of its own

#### Scenario: Reject a model mapping without a model

- **WHEN** a workflow configures an agent model mapping whose model is missing or empty
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Reject an unsupported field in the model mapping

- **WHEN** a workflow configures an agent model mapping that carries a field the workflow does not define
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Count a model change as a workflow change

- **WHEN** a board's workflow differs from another version of that workflow only in an agent's model mapping
- **THEN** that difference is a change to the workflow's meaning and not a layout difference

### Requirement: Run a stage instruction from a card

When a task's current stage has an entry instruction, its card SHALL expose a run action only while the current entry into that stage is unresolved. The entry SHALL be unresolved when a persisted entry marker exists for the current stage and no successful user prompt has been sent in any open conversation of the task since that entry. The marker SHALL be created on every move into an instructed stage, including a task created directly in an instructed initial stage. A same-stage reorder SHALL NOT reset the marker; leaving and re-entering the stage SHALL create a new marker. A successful user prompt in any open conversation SHALL clear the marker, and a successful stage-instruction delivery for that entry SHALL clear it as well. An admission failure SHALL NOT clear it. A task already in an instructed stage without a marker SHALL NOT show the action until its next entry. While the timed instruction for the entry is counting down or being sent, the card SHALL expose the countdown control defined by the Timed stage instruction after a move requirement instead of the run action; canceling that countdown or a failed timed send SHALL expose the run action for the same unresolved entry. When visible, the action SHALL deliver the stage's entry instruction to the conversation that owns the stage — the declared agent's conversation when the stage names an agent, and the task's main conversation otherwise — as the stage-instruction context message defined by Stage instruction delivery as context in `task-conversations`, followed by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies. When the task has no conversation, activating the action SHALL first present the worktree choice defined by Execution preparation before a task's first execution; answering it SHALL start the run, which SHALL admit the worktree creation in the background, create the conversation that owns the stage once the worktree is ready, and admit the instruction to that conversation. When no conversation that the stage owns is open after that preparation, the action SHALL create that conversation and use it as the target. The action SHALL carry the entry identity it was displayed for — the entry's stage and entry timestamp — and the host SHALL reject a request for an entry that has been resolved or replaced. The action SHALL NOT move the task or change its position, SHALL NOT offer a conversation picker, and SHALL NOT be available in selection mode. It SHALL be unavailable while the task has an unresolved context operation or confirmed transition. The delivered context message SHALL contain the stage instruction and, when it applies, the transition briefing; the conversation's first-turn task context supplies the task context. Admission failures SHALL be reported without changing the stage or position and without creating another conversation beyond the resolved target.

This action and its unresolved-instruction marker SHALL remain specific to agent entry instructions. An entry owned by durable scripted activation or control state SHALL instead expose its own applicable Stop and Play controls, whose availability SHALL NOT be cleared by an ordinary conversation prompt or by a later saved change to the stage mode. While that scripted ownership remains, a newly saved agent instruction SHALL NOT expose an agent stage-run action or countdown for that entry. Play SHALL be available only when the latest saved configuration is valid scripted configuration; otherwise the interface SHALL explain that scripted configuration or a new stage entry is required and SHALL NOT silently start an agent or manual-mode execution. A pending scripted handoff SHALL be included as its own identified block in an agent instruction delivery as defined by `task-conversations`; it SHALL NOT replace the instruction or be recast as an agent-declared transition reason.

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

- **WHEN** the user activates the run action on a card whose stage has an entry instruction, names no agent, and whose first conversation is open
- **THEN** the stage instruction is delivered to that main conversation as a stage-instruction context message
- **AND** no user message records the instruction
- **AND** the task's stage and position are unchanged
- **AND** no conversation picker is presented

#### Scenario: Run an instructed agent stage from a card

- **WHEN** the user activates the run action on a card whose stage names an agent
- **THEN** the stage instruction is delivered to that agent's conversation as a stage-instruction context message
- **AND** the task's stage and position are unchanged
- **AND** no conversation picker is presented

#### Scenario: Include the transition briefing

- **WHEN** the user activates the run action on a card whose stage configures two or more targets
- **THEN** the delivered context message contains the stage instruction followed by the transition briefing

#### Scenario: Prepare the first run from a card

- **WHEN** the user activates the run action on a card whose task has no conversation
- **THEN** the worktree question is presented before a conversation is created or the instruction is admitted
- **AND** while the worktree is created the card presents a preparing state
- **AND** after the answer the instruction is delivered to the conversation created once the worktree is ready
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

#### Scenario: Do not consume scripted Play with a conversation prompt

- **WHEN** an ordinary conversation prompt is sent while the task remains in a scripted stage
- **THEN** it does not resolve, stop, restart, or hide that stage's scripted controls
- **AND** the agent instruction marker does not govern the scripted execution

### Requirement: Timed stage instruction after a move

When a permitted move changes a task's stage to a stage with an entry instruction, or a task created directly in an instructed initial stage completes the automatic first-execution preparation defined by Automatic first execution on task creation, the system SHALL arm one five-second countdown for that entry. The countdown SHALL be armed for board drops, drawer stage changes, and the automatic creation preparation. It SHALL NOT be armed for a same-stage reorder, for a creation whose Start execution now option is disabled, or for a move into a stage without an entry instruction. When the task has no conversation, the countdown SHALL be armed only after the first conversation exists, which for a task that needed a worktree SHALL be after the background worktree creation is ready; the countdown SHALL NOT be armed from a conversation that does not exist yet. The target SHALL be the conversation that owns the stage: the declared agent's conversation when the stage names an agent, and the task's main conversation otherwise. When no such conversation is open, the system SHALL create it and use it. When the stage names an agent whose preset the running host does not offer, the send fails into the held entry defined by Stage entry held while its agent preset is unavailable: the entry stays unresolved, the card names the missing preset, and the card exposes the run action. When the five seconds elapse without cancellation, the system SHALL deliver that stage's entry instruction to the target as the stage-instruction context message defined by Stage instruction delivery as context in `task-conversations`, followed by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies. Cancel SHALL stop only the automatic send: the task's stage, position, and unresolved entry SHALL remain, and the card's run action SHALL be available. A new instructed entry for the task SHALL replace the pending countdown for the previous entry. The countdown SHALL be canceled without sending when a successful user prompt resolves the entry, when the task is deleted, or when the entry marker is removed for any other reason. The card SHALL present the countdown as a control that cancels when activated. The drawer for the task SHALL present a matching countdown notice above its section panel with the same cancel action. Both notices SHALL identify the stage whose instruction will run. A countdown SHALL continue when its card is not rendered, when the Kanban panel is not visible, or when the user switches to another board or Hub. The automatic send SHALL NOT depend on the board that armed it being mounted or visible. Unsent composer text or attachments in the target conversation SHALL NOT prevent the send and SHALL remain unchanged. The countdown SHALL NOT be persisted: a reload or plugin restart SHALL send nothing and SHALL leave the entry unresolved with its run action available. A failed timed delivery SHALL stop the countdown, report the failure on the card and in the drawer notice, restore the run action for the unresolved entry, and SHALL NOT retry automatically. When admission reports that the entry was already resolved, the countdown SHALL end without reporting a failure. The delay SHALL be fixed at five seconds and SHALL NOT be configurable.

This countdown SHALL remain specific to agent entry instructions and SHALL NOT schedule scripted polling or delay a scripted entry. When an agent entry has a pending scripted handoff, its message SHALL include that identified handoff block in the order defined by `task-conversations`, in addition to the instruction and applicable briefing. The countdown's non-durable reload behavior SHALL NOT stop or redefine the separate durable recovery of scripted programs.

#### Scenario: Arm on a board drop
- **WHEN** the user drops a card on a permitted stage with an entry instruction
- **THEN** the card exposes a countdown for that entry
- **AND** no instruction is sent while the countdown is active

#### Scenario: Arm on a drawer stage change
- **WHEN** the user selects a permitted instructed destination from the drawer's stage control
- **THEN** the drawer presents the countdown notice for that entry
- **AND** the card exposes the countdown control for the same entry

#### Scenario: Arm after the first-execution preparation
- **WHEN** a task without a conversation is dropped on a permitted stage with an entry instruction and the worktree question has been answered
- **THEN** the countdown for that entry is armed only after that task's first conversation exists
- **AND** the target is the conversation created once the background worktree creation is ready
- **AND** the card presents a preparing state while the worktree and that conversation are pending

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
- **THEN** the stage's entry instruction and any pending scripted handoff are delivered to the conversation that owns the stage as a stage-instruction context message, followed by the transition briefing when the stage configures two or more targets
- **AND** the unresolved entry is resolved
- **AND** no conversation picker or confirmation is presented

#### Scenario: Include the briefing with the timed send
- **WHEN** the countdown ends for a stage that configures two or more transition targets
- **THEN** the delivered context message contains the instruction followed by the transition briefing
- **AND** the briefing is derived at the moment of sending

#### Scenario: Create a conversation when none is open
- **WHEN** the countdown ends and no conversation that owns the stage is open
- **THEN** the conversation that owns the stage is created and becomes the target
- **AND** the stage's entry instruction and any pending scripted handoff are delivered to that new conversation
- **AND** the task's stage and position are unchanged

#### Scenario: Hold an unavailable preset instead of starting an agent
- **WHEN** a move enters a stage that names an agent whose preset the running host does not offer
- **THEN** no conversation is created and no instruction is delivered
- **AND** the entry remains unresolved with its held status
- **AND** the card presents the held entry and its run action

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
- **THEN** the stage's entry instruction and any pending scripted handoff are delivered to the resolved target
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

- **WHEN** the host restarts while a scripted script was active and another task had an agent countdown
- **THEN** the script follows scripted recovery from the beginning of its captured program
- **AND** the agent countdown still sends nothing after restart and leaves its instruction entry unresolved

### Requirement: Automatic advance after a completed turn
When the conversation that owns the task's current stage — the declared agent's conversation when the stage names an agent, and the main conversation otherwise — of a task whose auto mode is enabled or whose ordinary reason-carrying recorded transition resolves, or whose eligible exceptional recorded transition belongs to that conversation and turn, ends a turn whose reason is `completed`, and no open conversation of the task is running a turn, and the task has no pending user work as defined by Pending user work, and the task does not carry the pause requested by the agent, the host SHALL admit exactly one automatic advance. The host SHALL perform the advance without requiring the board to be mounted, without a confirmation, without a conversation picker, and without arming the timed stage instruction. An admitted advance SHALL be durable: reloading the board SHALL NOT cancel it, and a host restart SHALL dispatch it when it had not been dispatched.

A completed turn of any other conversation of the task SHALL NOT arm an advance, while it still counts as a running or waiting conversation for the holds below. The host SHALL evaluate pending user work when the completed turn ends and SHALL re-evaluate it when the advance is admitted, and SHALL NOT admit the advance when pending user work exists at either evaluation. Consuming pending user work SHALL NOT itself move the task; only an observed completed turn triggers an advance. An ordinary blocked advance SHALL NOT record a pause and SHALL NOT be dropped silently: the task SHALL present the held state defined by Auto mode on a task card, and the next completed turn SHALL re-evaluate the task.

A turn ending for any other reason SHALL NOT advance the task. The host SHALL NOT admit an advance while the task has an unresolved context operation, an unresolved confirmed transition, or an unresolved entry for its current stage; those conditions SHALL NOT be recorded as a pause and the next completed turn SHALL re-evaluate them. The host SHALL NOT admit an advance while the task carries the agent-requested pause defined by Agent-requested task pause; that pause SHALL NOT be recorded again or cleared by the evaluation, and a later completed turn SHALL re-evaluate it without advancing.

For an exceptional recording, the host SHALL consume it only on the observed `completed` end of its exact originating open turn in its calling session and task entry. The host SHALL revalidate that identity, the recorded value, source entry, destination, and all admission guards in the serialized admission transaction. Invalidation or cleanup SHALL compare the exception identity with the current recorded declaration and SHALL NOT clear or alter a newer replacement recorded concurrently. If that turn fails, aborts, is interrupted, cannot be verified, or cannot be admitted because the task is held, paused, busy, or otherwise fails a guard, the unadmitted exception SHALL be discarded or invalidated and SHALL NOT be retried by a later turn or resurrected as an auto-mode destination. An already admitted advance SHALL remain durable under existing dispatch and recovery rules. Independently enabled auto mode SHALL continue its normal behavior after the exception is gone.

The host SHALL NOT replay a turn that ended while it was not observing the task's conversations. Only a turn end observed while the host is running SHALL trigger an advance.

This trigger SHALL NOT advance a task out of an entry owned by durable scripted activation or control state, including an entry waiting for trust, running, stopped, failed, or awaiting result delivery. That ownership SHALL NOT be recomputed from a later saved YAML mode: switching the saved stage to agent or manual mode SHALL NOT enable a conversation turn to bypass the captured run or its stopped state. A completed turn from one of its conversations SHALL NOT replace the named result of that entry or restart its program. The no-catch-up rule above SHALL remain a rule about unobserved conversation turns; automatic recovery of a previously active scripted run SHALL follow `scripted-steps` without replaying a conversation turn.

#### Scenario: Advance after a completed turn
- **WHEN** the conversation that owns the current stage of an armed task ends a completed turn and the task has no pending user work
- **THEN** one automatic advance is admitted

#### Scenario: Do not arm from a conversation that does not own the stage
- **WHEN** a conversation of the task other than the one that owns its current stage ends a completed turn
- **THEN** no advance is admitted
- **AND** the task remains in its current stage

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

#### Scenario: Ignore incidental turns in a scripted entry

- **WHEN** a task occupies a scripted entry and one of its conversations completes a turn with Auto mode enabled
- **THEN** that turn admits no advance out of the scripted entry
- **AND** its run, stopped state, captured configuration, and pending handoff are not changed

#### Scenario: Admit only the exceptional originating turn
- **WHEN** an eligible exceptional recording is made in a task conversation and that same observed turn ends as `completed` with every admission guard satisfied
- **THEN** exactly one advance to the exceptional destination is admitted regardless of auto mode
- **AND** the admitted advance remains durable across reload and restart

#### Scenario: Another conversation or turn cannot consume an exception
- **WHEN** a different conversation or a later turn completes while an exceptional recording is unadmitted
- **THEN** that completion cannot consume the exception
- **AND** the exception cannot be reused as an auto-mode destination

#### Scenario: Fail closed on a held or busy exceptional advance
- **WHEN** the originating turn completes but pending user work, a pause, another running turn, an unresolved operation, or another admission guard prevents admission
- **THEN** no exceptional advance is admitted and the exception is invalidated
- **AND** clearing the hold or a later completed turn cannot revive it

#### Scenario: Fail closed on an unverified exceptional turn
- **WHEN** the originating turn fails, aborts, is interrupted, is not verifiably observed, or the host restarts before admission and loses its identity
- **THEN** the unadmitted exception is invalidated and is not replayed
- **AND** any later ordinary auto-mode advance follows normal rules without using it

### Requirement: Automatic advance destination and dispatch

A completed turn SHALL advance the task when its auto mode is enabled or when a reason-carrying recorded transition for its current stage resolves, subject to the originating-turn restrictions and fail-closed admission of an exceptional recording. A recording stored without a reason arms nothing, as the recording requirement states. The advance SHALL NOT be admitted while the task owes the user anything as defined by Pending user work, while a context operation is pending, or while a confirmed transition is already recorded.

The destination SHALL be the stage of the task's ordinary recorded transition for its current stage while that transition resolves, or the eligible exceptional destination only for its matching originating completed turn. Otherwise, and only for a task whose auto mode is enabled, it SHALL be the first entry of the current stage's configured transitions, or the stage that follows the current stage in workflow order when the stage does not configure transitions. There SHALL be no default destination when the configured list is empty or the resolved stage is the current stage.

When the destination is the recorded transition, the advance SHALL move the task exactly to that stage and SHALL NOT continue resolution beyond it. While the default destination has neither an entry instruction nor scripted configuration, resolution SHALL continue from that destination. Resolution SHALL stop at the first stage that has an entry instruction or scripted configuration, or at the last reachable stage when no reachable stage has either. A stage already visited during the same resolution SHALL NOT be revisited. The resolved destination and its entry instruction SHALL be captured when the advance is admitted, so a workflow edit after admission SHALL NOT change that advance.

An ordinary recorded transition that no longer resolves SHALL NOT be replaced by the default destination. In that case the host SHALL NOT advance the task. When the task's auto mode is enabled, the host SHALL pause auto mode with the `transition-stale` reason defined by Auto mode on a task card; a task whose auto mode is disabled SHALL stay in its stage without recording a pause. An ineligible or invalidated exceptional recording SHALL NOT become a default destination, and normal auto-mode behavior remains independent after it is gone.

The task SHALL be placed at the top of the destination stage, before every card that stage already contains. When the destination has an entry instruction, that instruction SHALL be delivered to the conversation that owns the destination stage — the declared agent's conversation when that stage names an agent, and the task's main conversation otherwise — as the stage-instruction context message defined by Stage instruction delivery as context in `task-conversations`, followed by the reason the recorded transition carried and then by the transition briefing defined by Transition briefing for an instructed stage when that briefing applies; when no conversation that the destination stage owns is open, that conversation SHALL be created and used as the target. The delivered context message SHALL contain the stage instruction, the declared reason when one applies, and, when it applies, the briefing. An advance that consumed no recorded reason SHALL deliver no reason block. The advance SHALL NOT create more than one conversation beyond that target. The destination entry SHALL remain unresolved until a prompt or a stage instruction is delivered.

A scripted destination SHALL admit its own authorized execution rather than create a conversation or consume an agent instruction marker. A named scripted result SHALL resolve exactly through the captured exit mapping of its execution, SHALL NOT select the first exit as a default, and SHALL NOT cross an intermediate manual or scripted destination to reach a later instructed stage. Protected destinations SHALL remain protected: the script SHALL NOT supply a destination or use a human-only override, and a missing or invalid authorized destination SHALL produce a visible failure instead of a fallback. A valid destination agent instruction SHALL additionally carry the scripted handoff defined by `task-conversations`, without mislabeling it as a recorded agent reason. For a scripted result, route authority SHALL come from the approved mapping captured by that execution, not a later authored allowed-target set. Editing an active exit from one destination to another SHALL not change or invalidate the approved captured destination merely because the latest configuration differs. Routing SHALL resolve the captured destination to the same stable stage after an identifier rename and SHALL reject identifier reuse by a different stage. It SHALL still validate the current entry and run, destination existence and stable identity, task context, and pending user work; it SHALL not use a generic human transition override to bypass those checks.

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

- **WHEN** a completed turn ends for a task whose auto mode is disabled and whose ordinary reason-carrying recorded transition resolves, and the task has pending user work
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

- **WHEN** the next stage has neither an entry instruction nor scripted configuration and a later reachable stage has an entry instruction
- **THEN** the task moves to that later stage in one advance
- **AND** that stage's instruction is delivered

#### Scenario: Stop at the last reachable stage

- **WHEN** no reachable stage ahead has an entry instruction or scripted configuration
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

- **WHEN** an advance with an instructed destination that names no agent is dispatched and the task has open conversations
- **THEN** the main conversation receives the instruction
- **AND** no conversation picker is presented

#### Scenario: Target the agent conversation of the destination

- **WHEN** an advance is dispatched to an instructed destination that names an agent
- **THEN** that agent's conversation receives the instruction
- **AND** the main conversation receives nothing

#### Scenario: Create the target conversation

- **WHEN** an advance with an instructed destination is dispatched and the task owns no open conversation the destination stage needs
- **THEN** exactly the conversation the destination stage needs is created and receives the instruction
- **AND** no additional conversation is created

#### Scenario: Keep a failed destination entry unresolved

- **WHEN** the instruction cannot be delivered after the task moved
- **THEN** the task stays in the destination
- **AND** the destination entry remains unresolved
- **AND** the card exposes the stage run action for that entry

#### Scenario: Stop default resolution at a scripted stage

- **WHEN** a default turn-driven advance reaches a scripted stage before a later instructed stage
- **THEN** the task stops in the scripted stage and admits that entry subject to local authorization
- **AND** no later stage is crossed or agent conversation created for the script

#### Scenario: Stop a named output at its exact destination

- **WHEN** a scripted result maps to a manual stage with a later instructed stage reachable beyond it
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

#### Scenario: Stop at an exceptional destination

- **WHEN** a matching completed turn admits an exceptional recorded route to an existing stage without an entry instruction
- **THEN** the task moves exactly to that stage and does not cross it
- **AND** any scripted destination remains subject to its own authorization and entry rules

#### Scenario: Resume ordinary auto mode after invalidation

- **WHEN** an unadmitted exception is invalidated and auto mode is independently enabled
- **THEN** a subsequent completed turn evaluates the normal configured or default route
- **AND** it does not use the invalidated exceptional destination
