# Spec Delta

## ADDED Requirements

### Requirement: Agent conversations of a task

A task SHALL record, for a conversation created for a stage that names an agent, the agent that conversation belongs to. A conversation with no such record is the main conversation. The main conversation SHALL be the first open conversation that carries no agent record; when no such conversation is open, one SHALL be created for the board's main agent when a stage that names no agent, a cross-card message, or the person needs it. The task SHALL NOT record a separate primary-conversation pointer beside its conversation list, so the main conversation is always derived from the conversations the task actually owns. An agent conversation that the workflow stops declaring SHALL become an ordinary conversation of the task, keeping its history and its native identity, instead of impersonating the removed agent.

An agent conversation SHALL be an ordinary conversation of the task: it appears as a tab in the Conversations section, it carries the native session title the host sets to the agent's name at creation, it can be renamed like any tab, it is closed and reopened through the existing conversation actions, and closing it SHALL NOT remove its agent record. The section SHALL NOT present a separate agent list, an agent picker, or a badge that replaces the native conversation presentation.

#### Scenario: Derive the main conversation from the records

- **WHEN** a task owns one conversation for an agent and one conversation with no agent record
- **THEN** the conversation with no agent record is the main conversation
- **AND** the agent conversation is not treated as the main one

#### Scenario: Create the main conversation when only an agent conversation exists

- **WHEN** a stage that names no agent needs the main conversation and the task owns only agent conversations
- **THEN** the main conversation is created for the board's main agent
- **AND** the agent conversation is left unchanged

#### Scenario: Title the agent conversation with the agent name

- **WHEN** an agent conversation is created
- **THEN** its native session title is the agent's name
- **AND** the tab presents that title

#### Scenario: Close and reopen an agent conversation

- **WHEN** the person closes an agent conversation and later the task needs it again
- **THEN** the same conversation is reopened with its history
- **AND** its agent record is unchanged

#### Scenario: Present no separate agent surface

- **WHEN** the Conversations section presents a task that owns agent conversations
- **THEN** they are presented as ordinary conversation tabs
- **AND** no agent picker or separate agent list is presented

## MODIFIED Requirements

### Requirement: Nested native conversation tabs

A task SHALL begin with no native DSH conversation in its Conversations section. The section SHALL provide an explicit start action, presented as the agent-preset cards, that creates the first distinct native DSH conversation as a tab within the same task, and a plus action that opens the same preset choice to create another distinct native DSH conversation. The first conversation SHALL be created only by that explicit choice, by the execution preparation that follows a first-execution move or run action and its worktree question, including the automatic first-execution preparation on task creation, by a stage instruction that needs a conversation and finds none open, including a stage instruction dispatched from a card, a confirmed transition, or an automatic advance, or by a cross-card message delivery that needs a conversation and finds none open. When an execution preparation creates the first conversation, it SHALL do so after the worktree is ready and after the move or run action is applied, and the conversation SHALL use that directory. For a Git-backed task without a worktree, the explicit start action SHALL remain unavailable until the worktree choice is resolved as defined by `worktree-management`. The first conversation SHALL use the task's current effective directory at creation time. A conversation created from a card SHALL receive the card's preset. A conversation created for a stage that names an agent SHALL use that agent's preset and model, and SHALL be created only when the host offers that preset. The remaining conversations — created by the execution preparation for a stage that names no agent, by a stage instruction that names no agent, or by a cross-card message delivery — use the board's default model when the board names one and the deployment default otherwise, and SHALL use the board's default agent preset when the board names one and the host default preset otherwise.

A scripted entry SHALL NOT create a conversation, select a preset or model, or start a model turn solely to execute code. A task whose first execution is scripted SHALL remain able to have zero native conversations. When that execution later selects an agent destination whose instruction needs a conversation, the host SHALL create or resolve only the conversation required by that instruction using the normal directory and board-model and board-preset rules; the scripted handoff SHALL accompany the instruction. A script or manual destination SHALL receive or retain its handoff without creating a conversation.

#### Scenario: Open a newly created task

- **WHEN** a user opens a newly created task's Conversations section and its creation did not start the first execution
- **THEN** no native conversation tab exists
- **AND** the agent-preset cards and the plus action are available, subject to the worktree choice

#### Scenario: Open a created task that started

- **WHEN** a user opens a newly created task whose creation started the agent first-execution preparation
- **THEN** the first native DSH conversation created by the preparation is present as a tab once its worktree is ready
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

- **WHEN** an execution preparation runs for a task that has no conversation and its worktree question is answered
- **THEN** the first native DSH conversation is created after the worktree is ready
- **AND** it is created after the move or run action is applied
- **AND** it uses the task's current effective directory

#### Scenario: Prepare the first conversation on task creation

- **WHEN** the automatic first execution on task creation prepares a task with no conversation
- **THEN** the first native DSH conversation is created after the default worktree is ready
- **AND** it uses the worktree directory, or the project directory for a folder project
- **AND** no preset selector and no model selector are presented
- **AND** the conversation uses the board's default agent preset when the board names one and the host default preset otherwise

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
- **AND** it uses the board's default agent preset when the board names one and the host default preset otherwise

#### Scenario: Withhold the explicit start until the worktree choice

- **WHEN** the user requests the explicit first start for a Git-backed task with no worktree, no recorded base-project choice, and no conversation
- **THEN** no conversation is created
- **AND** the Conversations section presents the pending worktree choice

#### Scenario: Start the first conversation after a worktree choice

- **WHEN** the task has a ready worktree, an attached worktree, or a recorded base-project choice
- **THEN** the card start creates the first conversation at the task's current effective directory

#### Scenario: Run a scripted first stage without creating a chat

- **WHEN** a newly created task enters a scripted initial stage
- **THEN** its script-only execution has no native conversation tab
- **AND** the normal explicit native conversation actions remain available under their existing preconditions

#### Scenario: Create the agent conversation of an instructed stage

- **WHEN** a stage instruction names an agent and the task has no conversation for that agent
- **THEN** one native DSH conversation is created in the task's current effective directory
- **AND** it runs that agent's preset and model
- **AND** the stage instruction is sent to it

#### Scenario: Create a conversation only for a downstream agent instruction

- **WHEN** a scripted output enters an agent stage and the task has no open conversation
- **THEN** one conversation is created in the task's effective directory for that agent instruction
- **AND** the instruction includes the identified scripted handoff
- **AND** no conversation was required for the source script

### Requirement: Board default agent preset applies to every new conversation

The system SHALL start every new conversation created for a task on the default agent preset of that
task's board, as defined by Board default agent preset in `kanban-board`. A conversation created for a
stage that names an agent SHALL start on that agent's preset and model instead. This SHALL cover the first
conversation created by the execution preparation, a later conversation added to a task that already
has one, the conversation created by the automatic first-execution preparation on task creation, a
conversation created through an agent tool, and a conversation created by a cross-card message
delivery that needs one. A board that names no default agent preset SHALL leave those conversations
on the host default preset. Applying a board's default preset SHALL select the preset for that
conversation only, before its first turn, and SHALL NOT change the installation's default preset. A
conversation started from a preset card SHALL receive the card's preset instead of the board's
default, applied after the conversation is created. A board default preset the host cannot apply
SHALL leave that conversation on the host default preset and SHALL NOT block its creation. A preset
chosen inside a conversation SHALL apply to that conversation and SHALL NOT be written back to the
board. A schedule occurrence SHALL NOT inherit a board's default agent preset, because a schedule
targets a project rather than a board. A conversation that already exists SHALL keep its preset.

#### Scenario: Start an agent conversation on its agent's preset

- **WHEN** a conversation is created for a stage that names an agent with a preset and a model
- **THEN** that conversation runs that agent's preset and model
- **AND** the installation's default preset is unchanged
- **AND** a conversation created afterwards for a stage that names no agent uses the board's default preset again

#### Scenario: Start the first conversation on the board's preset

- **WHEN** the execution preparation creates the first conversation of a task whose board names an available default agent preset
- **THEN** that conversation runs that preset
- **AND** the installation's default preset is unchanged

#### Scenario: Start a later conversation on the board's preset

- **WHEN** a task that already has a conversation is given another one and its board names a default agent preset
- **THEN** the new conversation runs the board's preset
- **AND** the conversation created earlier keeps its own preset

#### Scenario: Use the board preset for automatic creation

- **WHEN** the automatic first execution on task creation creates the first conversation of a task whose board names a default agent preset
- **THEN** the created conversation runs the board's preset
- **AND** no preset selector is presented

#### Scenario: Apply the board preset to a tool-created conversation

- **WHEN** an agent tool creates a conversation for a task whose board names a default agent preset
- **THEN** the created conversation runs the board's preset

#### Scenario: Apply the board preset to a cross-card conversation

- **WHEN** a cross-card message delivery creates the target task's first conversation and its board names a default agent preset
- **THEN** the created conversation runs the board's preset
- **AND** the message is delivered to it

#### Scenario: Let an explicit card choice override the board preset

- **WHEN** the user starts a conversation from a preset card whose preset differs from the board's default
- **THEN** the conversation runs the card's preset

#### Scenario: Keep an in-conversation preset change out of the board

- **WHEN** the user changes the preset inside a conversation of a board that names a default agent preset
- **THEN** that conversation uses the chosen preset
- **AND** the board's workflow still names its own default agent preset
- **AND** a conversation created afterwards uses the board's default preset again

#### Scenario: Leave the installation default untouched

- **WHEN** a conversation is started on a board's default agent preset
- **THEN** the preset the installation uses by default is unchanged
- **AND** a conversation created outside that board still uses it

#### Scenario: Do not inherit a board preset into a schedule occurrence

- **WHEN** a schedule runs while its project also hosts a board that names a default agent preset
- **THEN** the occurrence uses the host default preset
- **AND** the board's default preset is not applied to it
