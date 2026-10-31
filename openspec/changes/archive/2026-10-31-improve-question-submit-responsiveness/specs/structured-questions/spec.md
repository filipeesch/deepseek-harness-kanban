# Spec Delta

## MODIFIED Requirements

### Requirement: Streaming paginated question rounds

Questions SHALL be presented as pages within a round, including when pages arrive incrementally from the agent. The user SHALL be able to begin answering received pages while additional questions are arriving and navigate between received pages without losing answers entered within that round. Receiving a new page SHALL preserve the current slide and every entered answer, Other text, notes, and Additional Notes draft. When the user is on the Additional Notes slide and a new question page arrives before it, the form SHALL present an explicit notice of the new question and an action that opens the first new page.

#### Scenario: Answer before all pages have arrived

- **WHEN** the first question page has arrived and further question pages are still being produced
- **THEN** the user can begin answering the received page without waiting for all pages to be displayed

#### Scenario: Navigate within a round

- **WHEN** the user moves to another received question page and then returns to a previously answered page
- **THEN** the answer entered on that page remains available within the round

#### Scenario: New page arrives on Additional Notes

- **WHEN** the user is on the Additional Notes slide with entered answers or notes and a new question page arrives
- **THEN** the form keeps the user's current slide and draft
- **AND** the form shows a notice that a new question arrived with an action that opens the first new page

#### Scenario: Use the new-question notice

- **WHEN** the user activates the new-question notice's action
- **THEN** the form shows the first page that arrived after the pages the user had already reached
- **AND** the previously entered answers and Additional Notes remain available

### Requirement: Additional Notes slide and submit placement

The round SHALL present one slide per question page and SHALL always end with an Additional Notes slide, including rounds with a single question. Each question slide SHALL show the question, its choices and explanations, per-answer notes, and a Next action. The Additional Notes slide SHALL show a free-text field, a Back action, and Submit. Submit SHALL exist only on the Additional Notes slide and SHALL remain disabled until the round is complete and every answer is valid. While the round is not complete, the form SHALL state that the agent is still finishing its turn instead of leaving the disabled Submit reason unexplained.

#### Scenario: Single-question round

- **WHEN** the round contains one question
- **THEN** the question slide offers Next and the Additional Notes slide offers Submit

#### Scenario: Return from Additional Notes

- **WHEN** the user goes Back from the Additional Notes slide
- **THEN** the last question slide is shown with its answers intact

#### Scenario: Submit unavailable before completion

- **WHEN** the round is still receiving pages or any answer is invalid
- **THEN** the Submit action remains disabled

#### Scenario: Explain the turn-completion gate

- **WHEN** every received answer is valid but the agent's turn has not ended
- **THEN** the form remains expandable and states that Submit is waiting for the agent to finish the turn

### Requirement: Question panel removed when the round is answered

The panel SHALL leave the composer dock immediately when the user submits a valid round, before the reply admission settles. If admission fails, the panel SHALL return with the entered answers, Other text, notes, and Additional Notes and SHALL show the admission error, with Submit available for a retry. The panel SHALL also leave when a round is answered by an ordinary chat reply. A panel removed by Submit SHALL NOT return because of a later question-state update that still reports the round unresolved; it returns only on admission failure or when a different unresolved round becomes the active round.

#### Scenario: Remove after Submit

- **WHEN** the user submits a valid round
- **THEN** the panel leaves the composer dock immediately
- **AND** the conversation receives the textual reply without waiting for the panel to be removed

#### Scenario: Restore a failed Submit

- **WHEN** the reply admission fails after the panel left the dock
- **THEN** the panel returns with the entered answers and an admission error
- **AND** Submit is available for a retry

#### Scenario: Remove after an ordinary reply

- **WHEN** the user replies with a normal chat message while a round is unanswered
- **THEN** the round is treated as answered and the panel leaves the composer dock

#### Scenario: Stay while unanswered

- **WHEN** a round is unanswered, including while the user replies on other topics without settling the round's answers
- **THEN** the panel remains available above the composer

#### Scenario: Submitted round does not resurrect

- **WHEN** a question-state update arrives after Submit but before the round is confirmed answered
- **THEN** the submitted round remains hidden from the composer dock

#### Scenario: A newer round still appears

- **WHEN** the agent presents a different unresolved round after the submitted round left the dock
- **THEN** the newer round is presented normally above the composer

## ADDED Requirements

### Requirement: Conversation-scoped question state updates

Question rounds SHALL update from conversation-scoped question state that does not wait for board or attention projection to complete. Submit becoming available when the agent's turn ends, retirement after an ordinary chat reply, and the removal of a submitted round SHALL NOT depend on the board snapshot or on conversation fact inspection.

#### Scenario: Turn completion unlocks Submit independently of board projection

- **WHEN** the agent's turn ends and the conversation-scoped question state reports the round complete while board projection is still delayed
- **THEN** Submit becomes available without waiting for the board projection to finish

#### Scenario: Ordinary reply retires the panel independently of board projection

- **WHEN** a normal chat reply is recorded for the conversation while board projection is still delayed
- **THEN** the panel leaves the composer dock without waiting for the board projection to finish

#### Scenario: Reload restores from conversation-scoped state

- **WHEN** the conversation is reloaded while a round is unanswered
- **THEN** the panel returns with the same pages and completion state from the conversation-scoped question state
- **AND** an answered round does not reappear
