# Spec Delta

## MODIFIED Requirements

### Requirement: Card drag between stages in the diagram

A card SHALL be draggable from one stage region to another, and the resulting stage change SHALL follow the same rules as a card move on the board: a permitted transition moves the card, a restricted transition asks for explicit confirmation before moving, a first execution presents its worktree question before the move and continues the remaining preparation in the background after it, and a move into a stage with an entry instruction arms the same timed instruction. A drop inside the destination stage SHALL place the card at the requested position in that stage. A same-stage drop SHALL reorder the card inside its stage. Canceling a confirmation or the worktree question SHALL leave the card in its stage. The diagram SHALL present the card in the destination before the move is confirmed by the host, and SHALL return it to its source when the move fails.

#### Scenario: Drop a card on a permitted stage

- **WHEN** the user drags a card from one stage region and drops it on a permitted stage region
- **THEN** the task moves to that stage
- **AND** the card is presented at the dropped position in that stage

#### Scenario: Drop a card on a restricted stage

- **WHEN** the user drops a card on a stage that the workflow does not permit from its current stage
- **THEN** the board asks for explicit confirmation
- **AND** the card remains in its stage until the user confirms

#### Scenario: Drop a card that has no conversation

- **WHEN** the user drops a card on a stage and the task has no conversation
- **THEN** the worktree question is presented before the move is dispatched
- **AND** canceling it leaves the card in its stage
- **AND** answering it dispatches the move and continues the preparation in the background

#### Scenario: Drop a card on an instructed stage

- **WHEN** the user drops a card on a stage with an entry instruction
- **THEN** the timed instruction is armed exactly as after a board drop

#### Scenario: Reorder inside a stage

- **WHEN** the user drops a card at a new position inside its current stage
- **THEN** the card is placed at that position
- **AND** no stage change is requested

#### Scenario: Present the optimistic result

- **WHEN** the user drops a card on a destination stage
- **THEN** the diagram presents the card in the destination before the command completes

#### Scenario: Revert a failed move

- **WHEN** the requested stage change fails
- **THEN** the card returns to its source stage
- **AND** the failure is reported
