# Spec Delta

## ADDED Requirements

### Requirement: Board default agent preset applies to every new conversation

The system SHALL start every new conversation created for a task on the default agent preset of that
task's board, as defined by Board default agent preset in `kanban-board`. This SHALL cover the first
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

### Requirement: Notice when the board default agent preset cannot be applied

When a new conversation of a board is created and the board's default agent preset cannot be applied
— because the host no longer offers that preset, the preset cannot compose a session, or the running
host cannot select a preset for one conversation — the conversation SHALL still be created and SHALL
run on the host default preset. The affected conversation SHALL present a notice that names the
preset the board asked for and states that the conversation started on the host default preset. The
notice SHALL be dismissible for that conversation, and the dismissal SHALL NOT be persisted: it SHALL
last only while that conversation remains open in the current session, and the notice SHALL appear
again while the condition holds. The notice SHALL NOT block the conversation, SHALL NOT prevent an
instruction from being sent, and SHALL NOT be presented for a conversation whose board names no
default agent preset or whose preset was applied.

When a card's explicit preset selection fails after the conversation was created, the drawer SHALL
report the failure in the conversation area as before, and the conversation SHALL remain on the
board's default agent preset when the board names one, otherwise on the host default preset.

#### Scenario: Fall back and announce it

- **WHEN** a conversation is created for a task whose board names a preset the host does not offer
- **THEN** the conversation is created and runs on the host default preset
- **AND** that conversation presents a notice naming the requested preset and the preset in use

#### Scenario: Dismiss the notice for the current session

- **WHEN** the user dismisses the notice
- **THEN** the notice is no longer shown on that conversation
- **AND** the dismissal is not recorded on the task, the board, or the conversation

#### Scenario: Announce again after reopening

- **WHEN** the conversation is closed and reopened, or its task drawer is closed and reopened, while the requested preset is still unavailable
- **THEN** the notice is presented again on that conversation

#### Scenario: Do not announce an applied preset

- **WHEN** a conversation is created for a task whose board names a preset the host offers
- **THEN** no notice is presented
- **AND** the conversation runs on the board's preset

#### Scenario: Do not announce without a board default

- **WHEN** a conversation is created for a task whose board names no default agent preset
- **THEN** no preset notice is presented
- **AND** the conversation runs on the host default preset

#### Scenario: Keep the board preset after a failed card selection

- **WHEN** the explicit card selection fails after the conversation was created and the board names a default agent preset
- **THEN** the drawer reports the failure in the conversation area
- **AND** the conversation remains on the board's default preset

## MODIFIED Requirements

### Requirement: Nested native conversation tabs

A task SHALL begin with no native DSH conversation in its Conversations section. The section SHALL
provide an explicit start action, presented as the agent-preset cards, that creates the first
distinct native DSH conversation as a tab within the same task, and a plus action that opens the same
preset choice to create another distinct native DSH conversation. The first conversation SHALL be
created only by that explicit choice, by the execution preparation that precedes a task's first
execution, including the automatic first-execution preparation on task creation, by a stage
instruction that needs a conversation and finds none open, including a stage instruction dispatched
from a card, a confirmed transition, or an automatic advance, or by a cross-card message delivery
that needs a conversation and finds none open. When an execution preparation creates the first
conversation, it SHALL do so after the worktree is ready and before the move or run action is
applied, and the conversation SHALL use that directory. For a Git-backed task without a worktree, the
explicit start action SHALL remain unavailable until the worktree choice is resolved as defined by
`worktree-management`. The first conversation SHALL use the task's current effective directory at
creation time. A conversation created from a card SHALL receive the card's preset; conversations
created by the execution preparation, including the automatic creation preparation, by a stage
instruction, or by a cross-card message delivery use the board's default model when the board names
one and the deployment default otherwise, and SHALL use the board's default agent preset when the
board names one and the host default preset otherwise.

A deterministic entry SHALL NOT create a conversation, select a preset or model, or start a model
turn solely to execute code. A task whose first execution is deterministic SHALL remain able to have
zero native conversations. When that execution later selects an agent destination whose instruction
needs a conversation, the host SHALL create or resolve only the conversation required by that
instruction using the normal directory and board-model and board-preset rules; the deterministic
handoff SHALL accompany the instruction. A script or manual destination SHALL receive or retain its
handoff without creating a conversation.

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

#### Scenario: Run a deterministic first stage without creating a chat

- **WHEN** a newly created task enters a deterministic initial stage
- **THEN** its script-only execution has no native conversation tab
- **AND** the normal explicit native conversation actions remain available under their existing preconditions

#### Scenario: Create a conversation only for a downstream agent instruction

- **WHEN** a deterministic output enters an agent stage and the task has no open conversation
- **THEN** one conversation is created in the task's effective directory for that agent instruction
- **AND** the instruction includes the identified deterministic handoff
- **AND** no conversation was required for the source script

### Requirement: Agent-preset cards start task conversations

In the Conversations section, when the task has no open conversation, or when the user requests a new
conversation with the plus action, the drawer SHALL present the host's native agent-preset roster as
selectable cards in the conversation area. The cards SHALL replace the standalone start-conversation
button. Activating a card SHALL create a native conversation for the task, select that preset on the
created session through the host's native preset selection, and open that conversation.

When the task's board names a default agent preset and the roster offers it, the drawer SHALL mark
that card as the board default and SHALL give it initial focus. Activating a card SHALL remain
required, and no conversation SHALL be created without an activation. When the roster does not offer
the board's default preset, no card SHALL be marked.

The roster SHALL use the host's native preset list and selection behavior, excluding presets the
native picker would hide: broken presets, and coding-tools-gated presets while developer tools are
disabled. The plugin SHALL NOT store a task-level default mode and SHALL NOT own or define a preset;
the board's default agent preset is a board configuration, and the host roster remains the only
source of available presets.

When the preset selection fails after the conversation was created, the conversation SHALL remain
open with the board's default agent preset when the board names one and the host default preset
otherwise, the drawer SHALL report the failure in the conversation area, and the card choice SHALL
remain available to retry the selection on that same conversation. A failed roster load SHALL be
reported with a retry action. Canceling the plus action's choice SHALL create no conversation;
selecting another conversation tab SHALL discard the choice. The drawer SHALL NOT depend on the
host's own blank-conversation preset seat or read-only mode label, which remain host-owned and may be
absent outside the main panel.

#### Scenario: Show the preset cards for a task without conversations

- **WHEN** the user opens the Conversations section for a task with no open conversation
- **THEN** the drawer shows the host's agent-preset roster as selectable cards in the conversation area
- **AND** it does not show a standalone start-conversation button

#### Scenario: Mark and focus the board default preset

- **WHEN** the task's board names a default agent preset that the roster offers
- **THEN** that card is marked as the board default
- **AND** it receives initial focus
- **AND** no conversation is created until a card is activated

#### Scenario: Do not mark a preset the roster lacks

- **WHEN** the task's board names a default agent preset that the roster does not offer
- **THEN** no card is marked as the board default

#### Scenario: Start a conversation from a card

- **WHEN** the user activates a preset card for a task with no open conversation
- **THEN** a native conversation is created for the task
- **AND** the chosen preset is selected on that conversation through the host's preset selection
- **AND** the drawer opens that conversation's window

#### Scenario: Open the preset choice from the plus action

- **WHEN** the task already has an open conversation and the user activates the plus action
- **THEN** the drawer presents the preset cards in the conversation area
- **AND** activating a card creates another native conversation with that preset and opens it

#### Scenario: Keep the conversation after a preset selection failure

- **WHEN** the preset selection fails after the conversation was created from a card
- **THEN** the conversation remains open with the board's default agent preset when the board names one and the host default preset otherwise
- **AND** the drawer reports the failure in the conversation area
- **AND** the card choice remains available to retry the selection on that same conversation

#### Scenario: Cancel the plus action's choice

- **WHEN** the user cancels the preset choice opened from the plus action
- **THEN** no conversation is created
- **AND** the previously active conversation remains displayed

#### Scenario: Report a roster failure with retry

- **WHEN** the host's agent-preset roster cannot be loaded
- **THEN** the drawer reports the failure in the conversation area
- **AND** it offers a retry action

#### Scenario: Do not persist a task default

- **WHEN** the user starts conversations with different card choices
- **THEN** each conversation uses the preset selected for it
- **AND** the plugin has not written a task-level mode field
