# Spec Delta

## MODIFIED Requirements

### Requirement: YAML workflow configuration
The board SHALL support workflow configuration in YAML, including the initial stage, grouped columns, allowed transitions, and optional stage entry instructions. It SHALL honor configured transition restrictions by requiring explicit confirmation before a restricted transition can proceed, and it SHALL honor column grouping. This version SHALL NOT implement WIP limits.

#### Scenario: Render a configured column group
- **WHEN** the workflow configuration groups multiple stages together
- **THEN** the board presents those stages as a group while retaining each stage as a distinct task destination

#### Scenario: Reject a prohibited transition
- **WHEN** a user requests a move that the workflow's allowed transitions do not permit and does not confirm the override
- **THEN** the task remains in its current stage
- **AND** the prohibited move does not initiate an agent execution

#### Scenario: Restricted transition requires confirmation
- **WHEN** a user requests a move that the workflow's allowed transitions do not permit
- **THEN** the board asks for explicit confirmation before moving the task
- **AND** the task remains in its current stage until the user confirms
- **AND** the request does not initiate an agent execution

#### Scenario: Do not enforce a WIP capacity
- **WHEN** a user makes an otherwise permitted move into a stage that already contains tasks
- **THEN** the board does not reject the move because of a WIP capacity limit

### Requirement: Direct stage manipulation on the board
The board SHALL move tasks between workflow stages only through drag and drop. A task card SHALL NOT provide an independent stage selector. A drag SHALL present a distinct dragged representation and a drop indicator. Dropping on a permitted stage SHALL move the task immediately, whether or not that stage has an entry instruction. Hovering a restricted stage during a drag SHALL present a distinct warning affordance. Dropping on a restricted stage SHALL require explicit confirmation before moving the task; canceling SHALL leave the task's stage and position unchanged. An instructed stage SHALL expose the stage run action on its cards as defined by the Run a stage instruction from a card requirement. Dropping within the current stage SHALL reorder the task relative to its neighbors. The board SHALL NOT offer worktree creation as part of a drop.

#### Scenario: Move to an uninstructed stage by drag and drop
- **WHEN** the user drops a task on a permitted stage that has no entry instruction
- **THEN** the task appears in that stage immediately
- **AND** the move does not initiate an agent execution

#### Scenario: Reorder within the current stage
- **WHEN** the user drops a task at a new position within its current stage
- **THEN** the task is placed at that position and the new order is retained

#### Scenario: Drop on an instructed stage
- **WHEN** the user drops a task on a permitted stage that has an entry instruction
- **THEN** the task moves to that stage immediately
- **AND** the drop does not initiate an agent execution
- **AND** the card exposes the stage run action

#### Scenario: Warn while hovering a restricted stage
- **WHEN** the user drags a task over a stage that the workflow does not permit from its current stage
- **THEN** the board presents a distinct warning affordance before the drop
- **AND** the task remains in its current stage until a drop is confirmed

#### Scenario: Restricted drop asks for confirmation
- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage
- **THEN** the board asks for explicit confirmation before moving the task
- **AND** the task remains in its current stage until the user confirms

#### Scenario: Confirm a restricted drop
- **WHEN** the user confirms the restricted-drop confirmation
- **THEN** the task appears in the destination stage at the dropped position
- **AND** the move does not initiate an agent execution

#### Scenario: Prohibited drop
- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage and cancels the confirmation
- **THEN** the task remains in its current stage and its position is unchanged

#### Scenario: Drop without a worktree
- **WHEN** the user drops a task that has no worktree on a permitted stage
- **THEN** the move completes without asking whether to create a worktree

## ADDED Requirements

### Requirement: Explicit confirmation for a restricted transition
When a user requests a transition that the workflow does not permit, the system SHALL require explicit confirmation before moving the task. The confirmation SHALL identify the task, the source stage, and the destination stage, and SHALL state that the override affects only that card and does not change the workflow configuration. Cancel SHALL receive the initial action focus. Canceling SHALL leave the task's stage and position unchanged and SHALL NOT send an agent instruction. Confirming SHALL move the task and SHALL NOT modify the workflow configuration or initiate an agent execution. If the confirmed move fails, the confirmation SHALL remain the active context, present the failure, and offer a retry that revalidates the task and workflow; it SHALL NOT present the task as moved. When the task or destination no longer matches the confirmed context, the system SHALL report the failure without offering a retry that cannot succeed.

#### Scenario: Confirm a restricted transition
- **WHEN** the user confirms a restricted transition
- **THEN** the task moves to the destination stage
- **AND** the workflow configuration is unchanged
- **AND** the move does not initiate an agent execution

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
