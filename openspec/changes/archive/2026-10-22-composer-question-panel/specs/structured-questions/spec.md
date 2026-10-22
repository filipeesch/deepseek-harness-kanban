# Spec Delta

## ADDED Requirements

### Requirement: Fixed question panel above the composer
The active question round SHALL be presented in a panel docked directly above the message composer, in the host input-dock strip, and that panel SHALL remain in place while the conversation transcript scrolls. The panel SHALL show a header bar with the round title, a progress indicator, and a collapse toggle, and SHALL be expanded by default.

#### Scenario: Answer while the conversation scrolls
- **WHEN** an unanswered round is displayed and the user scrolls the transcript
- **THEN** the panel remains docked above the composer showing the active slide

#### Scenario: Collapse to the bar
- **WHEN** the user activates the collapse toggle
- **THEN** the panel body is hidden and only the header bar remains above the composer

#### Scenario: Expanded by default
- **WHEN** a new unanswered round appears
- **THEN** the panel body is shown without an additional action

### Requirement: Additional Notes slide and submit placement
The round SHALL present one slide per question page and SHALL always end with an Additional Notes slide, including rounds with a single question. Each question slide SHALL show the question, its choices and explanations, per-answer notes, and a Next action. The Additional Notes slide SHALL show a free-text field, a Back action, and Submit. Submit SHALL exist only on the Additional Notes slide and SHALL remain disabled until the round is complete and every answer is valid.

#### Scenario: Single-question round
- **WHEN** the round contains one question
- **THEN** the question slide offers Next and the Additional Notes slide offers Submit

#### Scenario: Return from Additional Notes
- **WHEN** the user goes Back from the Additional Notes slide
- **THEN** the last question slide is shown with its answers intact

#### Scenario: Submit unavailable before completion
- **WHEN** the round is still receiving pages or any answer is invalid
- **THEN** the Submit action remains disabled

### Requirement: One question surface per conversation
The panel above the composer SHALL be the only interactive question surface. The plugin SHALL NOT render a second summary, the question text, the choices, or an open or review action for `decision_request` calls in the conversation transcript.

#### Scenario: No duplicate question in the transcript
- **WHEN** a `decision_request` call appears in the conversation transcript
- **THEN** that row does not repeat the question text, choices, or an open or review action

#### Scenario: One entry point for an unanswered round
- **WHEN** an unanswered round exists in a conversation
- **THEN** it is answered through the panel above the composer, or by an ordinary chat message

### Requirement: Question panel removed when the round is answered
The panel SHALL leave the composer dock when its round is answered, whether the answer arrives by Submit or as an ordinary chat reply.

#### Scenario: Remove after Submit
- **WHEN** the user submits a valid round
- **THEN** the panel leaves the composer dock and the conversation receives the textual reply

#### Scenario: Remove after an ordinary reply
- **WHEN** the user replies with a normal chat message while a round is unanswered
- **THEN** the round is treated as answered and the panel leaves the composer dock

#### Scenario: Stay while unanswered
- **WHEN** a round is unanswered, including while the user replies on other topics without settling the round's answers
- **THEN** the panel remains available above the composer

### Requirement: Durable conversation-scoped question state
Question rounds SHALL be persisted per conversation and SHALL NOT be owned by a task or board record. Reloading a conversation SHALL restore an unanswered round with its pages and completion state, without depending on history replay alone. An answered round SHALL NOT reappear in the panel after reload.

#### Scenario: Reload restores an unanswered round
- **WHEN** the user reloads a conversation that has an unanswered round
- **THEN** the panel returns above the composer with the same pages and completion state

#### Scenario: Reload does not resurrect an answered round
- **WHEN** the user reloads a conversation after answering a round
- **THEN** that round's panel does not reappear

#### Scenario: Ordinary chat outside a task
- **WHEN** a round is answered or reloaded in an ordinary DSH chat that has no task card
- **THEN** the same persistence behavior applies without a task record

### Requirement: Host-themed question panel
The question panel SHALL follow the host application's light and dark appearance, using host theme colors for its surface, text, borders, controls, and focus indicator. It SHALL NOT use a fixed light-only surface.

#### Scenario: Dark appearance
- **WHEN** the host application uses its dark appearance
- **THEN** the panel surface, text, borders, and controls use the host dark theme colors

#### Scenario: Keyboard focus indicator
- **WHEN** a keyboard user moves focus to a panel control
- **THEN** a visible focus indicator using the host focus color is shown

## MODIFIED Requirements

### Requirement: Explanatory content and answer notes
The rich question experience SHALL support Markdown question context and question text, explanatory Markdown choice descriptions, an agent recommendation with its rationale, and question weight information when supplied. Each question SHALL allow the user to add per-answer notes, and the round SHALL provide an Additional Notes field on its final slide for round-wide context.

#### Scenario: Review a richly explained choice
- **WHEN** a question includes explanatory choice descriptions, a recommendation, its rationale, and a weight
- **THEN** the interface presents those supplied details alongside the question and its choices

#### Scenario: Include user notes
- **WHEN** the user adds notes while answering a question
- **THEN** that context is retained with that question's answer for the round's textual submission

#### Scenario: Include Additional Notes
- **WHEN** the user enters text in Additional Notes on the final slide and submits the round
- **THEN** that text is retained with the round's textual submission

### Requirement: Optional form without a separate decision lifecycle
The user SHALL be able to collapse the question panel without submitting it and reply through the normal chat composer. A collapsed panel SHALL remain available above the composer while its round is unanswered. The plugin SHALL NOT infer an answer from collapsing the panel, require a separate cancellation or approval record, or introduce a decision ledger or Record as decisions workflow. Ordinary conversation replies SHALL remain the means of responding to the agent.

#### Scenario: Close the form and reply normally
- **WHEN** the user collapses the question panel and sends a normal text message in the same conversation
- **THEN** that message is submitted through the normal conversation flow without requiring completion of the form
- **AND** collapsing the panel does not itself submit an inferred answer

#### Scenario: Collapsed panel remains reachable
- **WHEN** an unanswered round's panel is collapsed
- **THEN** its header bar remains above the composer with its progress and can be expanded again

#### Scenario: Answer without creating a decision ledger
- **WHEN** the user submits a question round through the form
- **THEN** the result is a normal textual conversation reply without a separate decision-ledger record, cancellation record, or product approval lifecycle
