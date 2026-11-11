# Spec Delta

## ADDED Requirements

### Requirement: Board default model applies to every new conversation

The system SHALL start every new conversation created for a task on the default model of that
task's board, as defined by Board default model in `kanban-board`. This SHALL cover the first
conversation created by the execution preparation, a later conversation added to a task that
already has one, the conversation created by the automatic first-execution preparation on task
creation, and a conversation created through an agent tool. A board that names no default model
SHALL leave those conversations starting on the deployment default. Applying a board's default
model SHALL select the model for that conversation only: the plugin SHALL NOT write the
installation's default model, and it SHALL NOT use an entry point that persists a default beyond
the conversation. A model or reasoning effort chosen inside a conversation SHALL apply to that
conversation and SHALL NOT be written back to the board's workflow. A schedule occurrence SHALL
NOT inherit a board's default model: a schedule targets a project rather than a board and carries
its own optional selection, and an occurrence without one keeps the deployment default.

#### Scenario: Start the first conversation on the board's model

- **WHEN** the execution preparation creates the first conversation of a task whose board names an available default model
- **THEN** that conversation runs on the board's model and reasoning effort
- **AND** the installation's default model is unchanged

#### Scenario: Start a later conversation on the board's model

- **WHEN** a task that already has a conversation is given another one and its board names a default model
- **THEN** the new conversation runs on the board's model
- **AND** the conversation created earlier keeps its own selection

#### Scenario: Use the board model without presenting a selector

- **WHEN** the automatic first execution on task creation creates the first conversation of a task whose board names a default model
- **THEN** no native model selector is presented
- **AND** the created conversation runs on the board's model

#### Scenario: Apply the board model to a tool-created conversation

- **WHEN** an agent tool creates a conversation for a task whose board names a default model
- **THEN** the created conversation runs on the board's model

#### Scenario: Keep an in-conversation change out of the board

- **WHEN** the user changes the model or reasoning effort inside a conversation of a board that names a default model
- **THEN** that conversation uses the chosen selection
- **AND** the board's workflow still names its own default model
- **AND** a conversation created afterwards uses the board's default model again

#### Scenario: Leave the installation default untouched

- **WHEN** a conversation is started on a board's default model
- **THEN** the model the installation offers by default is unchanged
- **AND** a conversation created outside that board still uses it

#### Scenario: Do not inherit a board model into a schedule occurrence

- **WHEN** a schedule without its own model selection runs while its project also hosts a board that names a default model
- **THEN** the occurrence runs on the deployment default
- **AND** the board's default model is not applied to it

### Requirement: Notice when the board default model cannot be applied

When a new conversation of a board is created and the board's default model cannot be applied —
because the host no longer offers that model or the running host cannot accept a per-conversation
selection — the conversation SHALL still be created and SHALL run on the deployment default. The
affected conversation SHALL present a notice that names the model the board asked for and the
model in use. The notice SHALL be dismissible for that conversation, and the dismissal SHALL NOT
be persisted: it SHALL last only while that conversation remains open in the current session, and
the notice SHALL appear again while the condition holds. The notice SHALL NOT block the
conversation, SHALL NOT prevent an instruction from being sent, and SHALL NOT be presented for a
conversation whose board names no default model or whose default model was applied.

#### Scenario: Fall back and announce it

- **WHEN** a conversation is created for a task whose board names a model the host does not offer
- **THEN** the conversation is created and runs on the deployment default
- **AND** that conversation presents a notice naming the requested model and the model in use

#### Scenario: Dismiss the notice for the current session

- **WHEN** the user dismisses the notice
- **THEN** the notice is no longer shown on that conversation
- **AND** the dismissal is not recorded on the task, the board, or the conversation

#### Scenario: Announce again after reopening

- **WHEN** the conversation is closed and reopened, or its task drawer is closed and reopened, while the requested model is still unavailable
- **THEN** the notice is presented again on that conversation

#### Scenario: Do not announce a model that applied

- **WHEN** a conversation is created for a task whose board names a model the host offers
- **THEN** no notice is presented
- **AND** the conversation runs on the board's model

#### Scenario: Do not announce when the board names no model

- **WHEN** a conversation is created for a task whose board configures no default model
- **THEN** no notice is presented
- **AND** the conversation runs on the deployment default

#### Scenario: Keep the conversation usable during a fallback

- **WHEN** the notice is presented on a conversation created by the automatic first-execution preparation
- **THEN** the stage instruction is still armed and can be sent
- **AND** the preparation is not reported as failed

## MODIFIED Requirements

### Requirement: Model selection for the first conversation

When the execution preparation defined by Execution preparation before a task's first execution in
`kanban-board` creates a task's first conversation and DSH's native model selector is available
and the board's default model rules in `kanban-board` make the model step apply, the preparation
SHALL present that native model selector for the created conversation before the first execution
is admitted. The selector SHALL show the deployment default selection while the task's board names
no default model and the conversation has no recorded selection, and presenting it SHALL NOT submit
a selection. When the user chooses a different model or reasoning effort, the selection SHALL apply
to that conversation and SHALL follow DSH's native behavior for the deployment default. When DSH's
native model selector is not available, the preparation SHALL omit the model step and the
conversation SHALL use the deployment default unless the board names an available default model.
The automatic first-execution preparation on task creation SHALL NOT present the native model
selector and SHALL NOT submit a selection; its first conversation SHALL use the board's default
model when the board names one and the deployment default otherwise. The selection SHALL NOT be
persisted on the task, SHALL NOT be presented for later conversations, and SHALL NOT be presented
when the task already has a conversation.

#### Scenario: Show the default without submitting

- **WHEN** the preparation presents the native model selector for a conversation with no recorded selection on a board that names no default model
- **THEN** the selector shows the deployment default model
- **AND** no model selection is submitted to the host
- **AND** the conversation will use the deployment default

#### Scenario: Choose another model

- **WHEN** the user chooses a different model or reasoning effort in the native selector
- **THEN** that selection applies to the created conversation
- **AND** the deployment default follows DSH's native behavior

#### Scenario: Omit the model step when the selector is unavailable

- **WHEN** DSH's native model selector is not composed in the running host
- **THEN** the preparation omits the model step
- **AND** the first conversation uses the deployment default, or the board's default model when the board names one that is available
- **AND** the rest of the preparation and the execution proceed

#### Scenario: No model step for the creation preparation

- **WHEN** the automatic first execution on task creation creates the first conversation
- **THEN** the native model selector is not presented
- **AND** no model selection is submitted
- **AND** the conversation uses the board's default model when the board names one and the deployment default otherwise

#### Scenario: Model step without a worktree question

- **WHEN** the task already has a ready worktree, is a folder project, or has a recorded base-project choice, the task has no conversation, and the board names no available default model
- **THEN** the preparation presents the model step only
- **AND** the first conversation is created in the task's current effective directory

#### Scenario: Do not offer a model for later conversations

- **WHEN** a task already has a conversation
- **THEN** no preparation and no model step is presented
- **AND** a later conversation of that task starts on the board's default model when the board names one and on the deployment default otherwise
