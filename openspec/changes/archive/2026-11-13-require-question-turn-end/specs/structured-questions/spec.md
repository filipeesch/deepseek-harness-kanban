# Spec Delta

## ADDED Requirements

### Requirement: Model guidance directs the agent to end the turn after the last question page

The `decision_request` tool description SHALL state that the agent sends every page the round needs in the current turn and then ends its turn after the last page. It SHALL state that the user cannot submit the round until the turn ends and that continuing to write keeps Submit unavailable.

The per-call tool result SHALL carry only the short rule that the agent always ends its turn after finishing all pages of the round.

The guidance SHALL NOT claim that the tool itself ends the turn: the tool still returns immediately, does not conclude the turn, and sends no conversational message.

#### Scenario: Description states the order and the Submit gate

- **WHEN** an agent receives the `decision_request` tool definition
- **THEN** its description directs the agent to send every page the round needs and then end the turn after the last page
- **AND** the description states that the user cannot submit until the turn ends and that continuing to write keeps Submit unavailable

#### Scenario: Result repeats the short rule

- **WHEN** an agent calls `decision_request`
- **THEN** the tool result states that the agent must always end its turn after finishing all pages of the round

#### Scenario: The tool does not end the turn itself

- **WHEN** an agent calls `decision_request`
- **THEN** the call returns immediately without concluding the turn or sending a conversational message
