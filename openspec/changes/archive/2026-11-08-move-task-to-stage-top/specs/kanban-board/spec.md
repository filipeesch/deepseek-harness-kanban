# Spec Delta

## MODIFIED Requirements

### Requirement: Direct stage manipulation on the board

The task card SHALL NOT provide an independent stage selector. A user SHALL change a task's stage through board drag and drop or through the stage control in the open task drawer. A stage change that requests no position, including a drawer stage change and a confirmed restricted drawer change, SHALL place the task at the top of the destination stage. A drag SHALL present a distinct dragged representation and a drop indicator, and a drop SHALL place the task at the dropped position, including before a chosen card and after the last card of the destination stage. Dropping on a permitted stage SHALL move the task immediately, whether or not that stage has an entry instruction, except when the drop would start the task's first execution: that drop SHALL present the execution preparation defined by Execution preparation before a task's first execution, and the move SHALL follow the preparation. Hovering a restricted stage during a drag SHALL present a distinct warning affordance. Dropping on a restricted stage SHALL require explicit confirmation before moving the task; canceling SHALL leave the task's stage and position unchanged. An instructed destination SHALL arm the timed stage instruction defined by the Timed stage instruction after a move requirement; neither the drop, the drawer stage change, nor a restricted-move confirmation SHALL initiate an execution. Dropping within the current stage SHALL reorder the task relative to its neighbors without arming a new timed instruction. A prohibited or canceled change SHALL leave the task unchanged. The board SHALL offer worktree creation during a drop only through that execution preparation. The host's automatic advance, defined by Automatic advance after a completed turn, SHALL NOT be presented as board stage manipulation, SHALL NOT add a card stage selector, and SHALL NOT require a confirmation.

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

### Requirement: Automatic advance destination and dispatch

The automatic advance destination SHALL be the first entry of the current stage's configured `allowed_transitions` when that list is configured, otherwise the stage that follows the current stage in workflow order. There SHALL be no destination when the configured list is empty or the resolved stage is the current stage.

While the resolved destination has no entry instruction, resolution SHALL continue from that destination. Resolution SHALL stop at the first stage that has an entry instruction, or at the last reachable stage when no reachable stage has one. A stage already visited during the same resolution SHALL NOT be revisited. The resolved destination and its entry instruction SHALL be captured when the advance is admitted, so a workflow edit after admission SHALL NOT change that advance.

The task SHALL be placed at the top of the destination stage, before every card that stage already contains. When the destination has an entry instruction, that instruction SHALL be sent verbatim to the task's first open conversation; when no conversation is open, a new conversation SHALL be created and used as the target. The submitted message SHALL contain only the stage instruction. The advance SHALL NOT create more than one conversation beyond that target. The destination entry SHALL remain unresolved until a prompt is sent.

#### Scenario: Use the first configured transition

- **WHEN** the current stage configures multiple permitted transitions and a completed turn advances the task
- **THEN** the task moves to the first configured transition's stage

#### Scenario: Fall back to workflow order

- **WHEN** the current stage does not configure transitions and a completed turn advances the task
- **THEN** the task moves to the next stage in workflow order

#### Scenario: Cross a stage without an instruction

- **WHEN** the next stage has no entry instruction and a later reachable stage has one
- **THEN** the task moves to that later stage in one advance
- **AND** that stage's instruction is sent

#### Scenario: Stop at the last reachable stage

- **WHEN** no reachable stage ahead has an entry instruction
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

- **WHEN** the instruction cannot be sent after the task moved
- **THEN** the task stays in the destination
- **AND** the destination entry remains unresolved
- **AND** the card exposes the stage run action for that entry
