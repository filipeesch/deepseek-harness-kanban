# Spec Delta

## MODIFIED Requirements

### Requirement: Nested native conversation tabs

A task SHALL begin with no native DSH conversation in its Conversations section. The section SHALL provide an explicit start action, presented as the agent-preset cards, that creates the first distinct native DSH conversation as a tab within the same task, and a plus action that opens the same preset choice to create another distinct native DSH conversation. The first conversation SHALL be created only by that explicit choice, by the execution preparation that precedes a task's first execution, including the automatic first-execution preparation on task creation, by a stage instruction that needs a conversation and finds none open, including a stage instruction dispatched from a card, a confirmed transition, or an automatic advance, or by a cross-card message delivery that needs a conversation and finds none open. When an execution preparation creates the first conversation, it SHALL do so after the worktree is ready and before the move or run action is applied, and the conversation SHALL use that directory. For a Git-backed task without a worktree, the explicit start action SHALL remain unavailable until the worktree choice is resolved as defined by `worktree-management`. The first conversation SHALL use the task's current effective directory at creation time. A conversation created from a card SHALL receive the card's preset; conversations created by the execution preparation, including the automatic creation preparation, by a stage instruction, or by a cross-card message delivery use the host default.

#### Scenario: Open a newly created task

- **WHEN** a user opens a newly created task's Conversations section and its creation did not start the first execution
- **THEN** no native conversation tab exists
- **AND** the agent-preset cards and the plus action are available, subject to the worktree choice

#### Scenario: Open a created task that started

- **WHEN** a user opens a newly created task whose creation started the first execution
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
- **AND** the conversation uses the host default rather than a card preset

#### Scenario: Withhold the explicit start until the worktree choice

- **WHEN** the user requests the explicit first start for a Git-backed task with no worktree, no recorded base-project choice, and no conversation
- **THEN** no conversation is created
- **AND** the Conversations section presents the pending worktree choice

#### Scenario: Start the first conversation after a worktree choice

- **WHEN** the task has a ready worktree, an attached worktree, or a recorded base-project choice
- **THEN** the card start creates the first conversation at the task's current effective directory

### Requirement: Model selection for the first conversation

When the execution preparation defined by Execution preparation before a task's first execution in `kanban-board` creates a task's first conversation and DSH's native model selector is available, the preparation SHALL present that native model selector for the created conversation before the first execution is admitted. The selector SHALL show the deployment default selection while the conversation has no recorded selection, and presenting it SHALL NOT submit a selection. When the user chooses a different model or reasoning effort, the selection SHALL apply to that conversation and SHALL follow DSH's native behavior for the deployment default. When DSH's native model selector is not available, the preparation SHALL omit the model step and the conversation SHALL use the deployment default. The automatic first-execution preparation on task creation SHALL NOT present the native model selector and SHALL NOT submit a selection; its first conversation SHALL use the deployment default. The cross-card message delivery that creates a task's first conversation SHALL NOT present the native model selector and SHALL NOT submit a selection; its first conversation SHALL use the deployment default. The selection SHALL NOT be persisted on the task, SHALL NOT be presented for later conversations, and SHALL NOT be presented when the task already has a conversation.

#### Scenario: Show the default without submitting

- **WHEN** the preparation presents the native model selector for a conversation with no recorded selection
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
- **AND** the first conversation uses the deployment default
- **AND** the rest of the preparation and the execution proceed

#### Scenario: No model step for the creation preparation

- **WHEN** the automatic first execution on task creation creates the first conversation
- **THEN** the native model selector is not presented
- **AND** no model selection is submitted
- **AND** the conversation uses the deployment default

#### Scenario: No model step for a cross-card message

- **WHEN** a cross-card message delivery creates the target task's first conversation
- **THEN** the native model selector is not presented
- **AND** no model selection is submitted
- **AND** the conversation uses the deployment default

#### Scenario: Model step without a worktree question

- **WHEN** the task already has a ready worktree, is a folder project, or has a recorded base-project choice, and the task has no conversation
- **THEN** the preparation presents the model step only
- **AND** the first conversation is created in the task's current effective directory

#### Scenario: Do not offer a model for later conversations

- **WHEN** a task already has a conversation
- **THEN** no preparation and no model step is presented
- **AND** later conversations are not changed
