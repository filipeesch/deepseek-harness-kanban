# Spec Delta

## MODIFIED Requirements

### Requirement: Advance a task from its card

A task card SHALL expose an advance action that moves the task to the next stage in workflow order. The action SHALL present the drawer's next-stage affordance — the same icon, the same accessible name, and the same indication when the next stage requires confirmation — and SHALL use the board's move pipeline, so a restricted next stage requires explicit confirmation, a first execution presents Execution preparation before a task's first execution, and a move into an instructed stage arms the timed stage instruction. The action SHALL be presented only while a next stage exists and the task's current stage authors no decision configuration, because a stage that authors a decision configuration has no next-stage destination and presents the decision gate defined by `decision-steps` instead. It SHALL be hidden while the task's agent execution is running and SHALL be unavailable while the task has an unresolved context operation or a confirmed transition, while selection mode is active, or while a move from the card is in flight. Activating it SHALL NOT open the task drawer, SHALL NOT begin a drag, and SHALL NOT change the task's diagram size or placement.

#### Scenario: Advance to the next stage

- **WHEN** the user activates the card's advance action on a task whose next stage is permitted
- **THEN** the task moves to that stage
- **AND** the task drawer does not open

#### Scenario: Hide while the task is running

- **WHEN** the task's agent execution is running
- **THEN** the card does not present the advance action
- **AND** the action returns when the execution settles

#### Scenario: Confirm a restricted next stage

- **WHEN** the next stage is not permitted from the task's current stage
- **THEN** the board asks for explicit confirmation before moving
- **AND** the accessible name of the action states that the move requires confirmation
- **AND** the task remains in its stage until the user confirms

#### Scenario: Prepare a first execution

- **WHEN** the user activates the advance action on a task that has no conversation
- **THEN** the execution preparation is presented before the task moves
- **AND** canceling the preparation leaves the task in its stage

#### Scenario: Arm the timed instruction

- **WHEN** the user activates the advance action and the destination stage has an entry instruction
- **THEN** the timed stage instruction is armed exactly as after a board drag
- **AND** the task moves to the destination

#### Scenario: No action without a next stage

- **WHEN** the task is in the last stage of the workflow
- **THEN** the card does not present the advance action

#### Scenario: No action in a decision stage

- **WHEN** the task sits in a stage that authors a decision configuration
- **THEN** the card presents no advance action
- **AND** the decision gate is the authored way to leave the stage

#### Scenario: Unavailable while busy

- **WHEN** the task has an unresolved context operation or a confirmed transition, or selection mode is active
- **THEN** the advance action is unavailable or not presented
- **AND** no move is sent

#### Scenario: Action does not disturb the diagram

- **WHEN** the user advances a task from its card in the workflow diagram
- **THEN** the task moves to the next stage
- **AND** no stage changes size or placement

### Requirement: Card attention surface

The board SHALL present a task's dominant attention state as a tint of the card surface. The dominant state SHALL be selected from the task's attention facts by a fixed priority: a failure, then a pending executable approval, then an unanswered decision gate, then an awaiting reply, then agent execution, then unread messages. The tint SHALL be the state's attention color mixed into the host surface at a low share, so that the card stays legible as text while its surface reads as area. The tint SHALL NOT be the only presentation of the state: the attention marks defined by Coexisting attention indicators across task conversations SHALL remain presented, including for every state that does not win the surface. The pending executable approval SHALL present the attention mark with the accessible name for awaiting approval, and it SHALL present the status line defined by Task card status strip. An unanswered decision gate SHALL present the awaiting-input tint, the decision mark and status line defined by `decision-steps`, and it SHALL NOT be attributed to a conversation. The surface SHALL present no tint when none of those states applies. The tint SHALL NOT change the card's height, SHALL NOT add, remove, or reorder a region of the card, and SHALL NOT affect the task's workflow stage, its position, or its drag behavior. Task-level context-operation, confirmed-transition, and automatic-advance state SHALL NOT tint the card; those remain in the status region as defined by Task card status strip.

#### Scenario: Paint the dominant state

- **WHEN** a task has a failure and also has unread messages
- **THEN** the card surface is tinted with the failure color
- **AND** the unread mark is still presented in the context region

#### Scenario: Keep the card text legible

- **WHEN** a card presents a tint in either the host's light or dark appearance
- **THEN** the title, the project name, and the status-region text keep at least 4.5:1 contrast against the painted surface

#### Scenario: Present no tint without attention

- **WHEN** a task has no failure, no pending approval, no unanswered decision gate, no awaiting reply, no running agent, and no unread messages
- **THEN** the card surface presents no tint

#### Scenario: Keep the card height stable

- **WHEN** a card gains or loses a tint
- **THEN** its height and the positions of its regions do not change

#### Scenario: Keep status state out of the surface

- **WHEN** a task has a failed context operation and no failure, pending approval, unanswered decision gate, awaiting reply, running agent, or unread message
- **THEN** the card surface presents no tint
- **AND** the status region reports the failed operation

#### Scenario: Keep the tint in selection mode

- **WHEN** the board is in card-selection mode and a card has an attention state
- **THEN** the card still presents its tint
- **AND** the selection control and the selection accent remain presented

#### Scenario: Paint a pending executable approval

- **WHEN** a task's current entry awaits approval and the task has no failure
- **THEN** the card surface is tinted with the attention color
- **AND** the approval mark is presented in the context region
- **AND** the status region names the pending approval

#### Scenario: Paint an unanswered decision gate

- **WHEN** a task sits in a decision stage with an unanswered gate and has no failure, pending approval, or awaiting reply
- **THEN** the card surface is tinted with the attention color
- **AND** the decision mark is presented in the context region
- **AND** the status region names the needed decision

#### Scenario: A failure outranks a pending approval

- **WHEN** a task has a failure and also waits for executable approval
- **THEN** the card surface is tinted with the failure color
- **AND** the approval mark and status line remain presented

#### Scenario: A failure outranks a decision gate

- **WHEN** a task has a failure and also sits in a decision stage with an unanswered gate
- **THEN** the card surface is tinted with the failure color
- **AND** the decision mark and status line remain presented
