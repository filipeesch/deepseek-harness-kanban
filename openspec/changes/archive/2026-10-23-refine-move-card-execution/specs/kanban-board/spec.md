# Spec Delta

## MODIFIED Requirements

### Requirement: Top-level task creation
The board SHALL provide one New task action at the top of the workflow's configured initial column. It SHALL collect a title, description, and project. The project input SHALL start unselected and SHALL be required; the board SHALL NOT preselect a project, including when a project filter is active. Saving a new task SHALL place it in the configured initial stage without initiating an agent execution. The board header SHALL NOT provide a separate New task action.

#### Scenario: Open task creation from the board
- **WHEN** the user selects the New task action at the top of the configured initial column
- **THEN** the creation experience provides title, description, and project inputs without asking the user to choose a stage
- **AND** the project input is unselected

#### Scenario: Create into a customized initial stage
- **WHEN** the user saves a new task and the workflow has a configured initial stage
- **THEN** the task is created in that stage with the supplied title, description, and project
- **AND** task creation does not initiate an agent execution

#### Scenario: Require an explicit project choice
- **WHEN** the user opens New task with one or more registered projects and does not select a project
- **THEN** the task cannot be created
- **AND** no project is silently chosen from the project list or the active project filter

### Requirement: Direct stage manipulation on the board
The board SHALL move tasks between workflow stages only through drag and drop. A task card SHALL NOT provide an independent stage selector. A drag SHALL present a distinct dragged representation and a drop indicator. Dropping on a permitted stage SHALL move the task immediately, whether or not that stage has an entry instruction. An instructed stage SHALL expose the stage run action on its cards as defined by the Run a stage instruction from a card requirement. Dropping within the current stage SHALL reorder the task relative to its neighbors. A prohibited drop SHALL leave the task unchanged. The board SHALL NOT offer worktree creation as part of a drop.

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

#### Scenario: Prohibited drop
- **WHEN** the user drops a task on a stage that the workflow does not permit from its current stage
- **THEN** the task remains in its current stage and its position is unchanged

#### Scenario: Drop without a worktree
- **WHEN** the user drops a task that has no worktree on a permitted stage
- **THEN** the move completes without asking whether to create a worktree

## REMOVED Requirements

### Requirement: Explicit choices for instructed moves
**Reason**: The instructed-move confirmation is removed. A move is immediate, and execution is requested separately from the card or the conversation composer.
**Migration**: Use the card run action to run an instructed stage's instruction, or the drawer stage prefill to insert it into the composer. All moves are organization-only and never run an agent.

### Requirement: Choose the conversation for an entry instruction
**Reason**: The board no longer offers a conversation picker when entering an instructed stage. The execution target is deterministic.
**Migration**: The card run action uses the task's first open conversation and creates a new conversation when none is open. The drawer prefill uses the active conversation.

### Requirement: Movement without an entry instruction does not run an agent
**Reason**: The guarantee was scoped to stages without an entry instruction, but moves into instructed stages also must not execute. The broader requirement replaces it.
**Migration**: Use Movement never runs an agent.

## ADDED Requirements

### Requirement: Run a stage instruction from a card
When a task's current stage has an entry instruction, its card SHALL expose a run action. The action SHALL send the stage's entry instruction verbatim to the task's first open conversation in conversation order; when no conversation is open, it SHALL create a new conversation and use that conversation as the target. The action SHALL NOT move the task or change its position, SHALL NOT offer a conversation picker, and SHALL NOT be available in selection mode. It SHALL be unavailable while the task has an unresolved context operation or confirmed transition. It SHALL remain available after a successful admission and MAY be used again. The submitted message SHALL contain only the stage instruction; the conversation's first-turn task context supplies the task context. Admission failures SHALL be reported without changing the stage or position and without creating another conversation beyond the resolved target.

#### Scenario: Run an instruction from a card
- **WHEN** the user activates the run action on a card whose stage has an entry instruction and whose first conversation is open
- **THEN** the stage instruction is sent to that first open conversation
- **AND** the task's stage and position are unchanged
- **AND** no conversation picker is presented

#### Scenario: Run when every conversation is closed
- **WHEN** the user activates the run action and every task conversation is closed
- **THEN** a new conversation is created and becomes the target
- **AND** the stage instruction is sent to that new conversation
- **AND** the task's stage and position are unchanged

#### Scenario: Run the instruction again
- **WHEN** a stage instruction has already been admitted and the user activates the run action again
- **THEN** the action remains available
- **AND** the current stage instruction is sent again to the resolved target

#### Scenario: Reject a changed instruction
- **WHEN** the stage's entry instruction changes after the card action was displayed and the user activates the action
- **THEN** the run is rejected
- **AND** the task, its stage, and its conversations are unchanged
- **AND** the user can review and run the current instruction

#### Scenario: Report an admission failure
- **WHEN** the stage instruction cannot be admitted
- **THEN** the failure is reported on the board
- **AND** the task's stage and position are unchanged
- **AND** the failed request does not implicitly start another run

#### Scenario: Action unavailable while the task is busy
- **WHEN** the task has an unresolved context operation, a confirmed transition, or selection mode is active
- **THEN** the run action is unavailable
- **AND** no instruction is sent

#### Scenario: No action without an entry instruction
- **WHEN** a card's current stage has no entry instruction
- **THEN** the card does not expose the run action

### Requirement: Movement never runs an agent
Moving a task, including into a stage with an entry instruction, SHALL update its workflow stage and position without initiating an agent execution. Execution SHALL require a separate explicit card run action or a user-sent message from the conversation composer. Optional worktree creation and directory switching SHALL follow the separate worktree-management requirements.

#### Scenario: Move to a stage without an entry instruction
- **WHEN** the user completes an allowed move to a stage without an entry instruction
- **THEN** the task appears in that stage without an agent execution being initiated by the move

#### Scenario: Move to an instructed stage
- **WHEN** the user completes an allowed move to a stage with an entry instruction
- **THEN** the task appears in that stage without an agent execution being initiated by the move
- **AND** the stage run action is available on the card
