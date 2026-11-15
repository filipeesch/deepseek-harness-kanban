# Spec Delta

## ADDED Requirements

### Requirement: The question dock reports only question state

The composer question dock SHALL present the active question round and the question feed's own failure with its retry action. It SHALL NOT present the board-update status or any other surface's failure. The dock SHALL remain available in every native conversation, including an ordinary DSH chat that has no task card, independently of the board feed's availability and of the board snapshot.

#### Scenario: A board-update failure adds nothing to the dock

- **WHEN** the live board feed fails while a conversation is displayed
- **THEN** the question dock presents no board-update message and no board retry action

#### Scenario: A question feed failure reports its own retry

- **WHEN** the conversation's question feed fails
- **THEN** the dock states that question rounds are unavailable and offers its own retry action
- **AND** no board-update status is presented

#### Scenario: Questions keep working without the board feed

- **WHEN** the live board feed is unavailable and the agent presents a structured question round in an ordinary DSH chat
- **THEN** the round is presented and answered in the dock as it is with the feed available
