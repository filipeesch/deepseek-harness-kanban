# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: YAML workflow configuration

Each board SHALL support its own workflow configuration in YAML, including the initial stage,
grouped columns, allowed transitions with an optional condition for each target, optional stage
entry instructions, each stage's stored placement, each stage's stored size, the board's default
presentation, and the board's default model. A transition entry SHALL be authored either as a
bare target identifier or as a mapping that carries the target identifier and an optional
condition. Both forms SHALL be accepted, neither form SHALL be deprecated, both forms SHALL
describe the same transition, and a single list MAY mix them. The condition SHALL describe when
that transition is followed; it SHALL NOT change which transitions the workflow permits. The
active board's workflow SHALL be used for rendering, transitions, and task creation. The product
SHALL honor configured transition restrictions by requiring explicit confirmation before a
restricted transition can proceed, and it SHALL honor column grouping. This version SHALL NOT
implement WIP limits and SHALL NOT introduce reusable workflow templates.

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
