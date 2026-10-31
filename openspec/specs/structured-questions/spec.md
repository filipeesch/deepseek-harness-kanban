# Structured Questions Specification

## Purpose

Provide rich, paginated question forms as an alternative way to compose a normal textual reply in DSH conversations, without introducing a separate decision ledger, cancellation record, or approval workflow.

Reference note: Railyin's [question interface](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/DecisionRequest.vue#L7-L143>) supplies UX evidence. Its Record as decisions workflow is intentionally excluded from the target product.

## Requirements

### Requirement: Rich questions in task and ordinary conversations
The plugin SHALL make its rich question experience available both in task conversations and in ordinary DSH chats. A task card association SHALL NOT be required to present or answer a question round.

#### Scenario: Present questions within a task conversation
- **WHEN** an agent presents a structured question round in a task conversation
- **THEN** the user can answer it through the rich question interface in that conversation

#### Scenario: Present questions in an ordinary DSH chat
- **WHEN** an agent presents a structured question round in an ordinary DSH chat
- **THEN** the same rich question experience is available without requiring a task card

### Requirement: Single-choice, multiple-choice, and text answers
The rich question experience SHALL support single-choice questions, multiple-choice questions, and free-text questions. Choice questions SHALL support an Other answer with user-entered text rather than restricting replies to the supplied alternatives.

#### Scenario: Answer a single-choice question
- **WHEN** the user answers a single-choice question through the form
- **THEN** the form captures the chosen alternative or the user's Other text as that question's answer

#### Scenario: Answer a multiple-choice question
- **WHEN** the user selects multiple alternatives for a multiple-choice question
- **THEN** the form retains those selections together as the answer and supports additional Other text when that choice is used

#### Scenario: Answer a free-text question
- **WHEN** the user answers a free-text question
- **THEN** the form captures the user's text without requiring a predefined choice

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

### Requirement: Submit a round as one textual reply
Submitting a completed question round SHALL aggregate its answers, including applicable selected choices, Other text, and user notes, into a normal textual reply in the originating DSH conversation. The reply SHALL associate each answer with its question rather than submit a separate conversational turn for each page.

#### Scenario: Submit multiple answers together
- **WHEN** the user submits a question round containing multiple answered pages
- **THEN** the conversation receives one textual reply containing the round's question-and-answer content and applicable user notes
- **AND** the form does not submit each page as a separate conversational turn

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

### Requirement: One question surface per conversation
The panel above the composer SHALL be the only interactive question surface. The plugin SHALL NOT render a second summary, the question text, the choices, or an open or review action for `decision_request` calls in the conversation transcript.

#### Scenario: No duplicate question in the transcript
- **WHEN** a `decision_request` call appears in the conversation transcript
- **THEN** that row does not repeat the question text, choices, or an open or review action

#### Scenario: One entry point for an unanswered round
- **WHEN** an unanswered round exists in a conversation
- **THEN** it is answered through the panel above the composer, or by an ordinary chat message

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

### Requirement: Dismiss an unresolved question round
While an unresolved question round is expanded, the question panel SHALL provide a Dismiss action in the leading position of its footer. Dismissing SHALL remove every unresolved round for that conversation from the panel, SHALL send no conversation message, and SHALL leave the normal composer available. When any answer, Other text, per-answer notes, or Additional Notes have been entered, dismissal SHALL first show an inline confirmation; canceling SHALL keep the draft and the panel, and confirming SHALL dismiss. The Dismiss action SHALL be unavailable while a submission is in progress.

#### Scenario: Dismiss an untouched round
- **WHEN** the user activates Dismiss while the current round has no entered answers or notes
- **THEN** the round is removed immediately without a confirmation
- **AND** no conversation message is sent
- **AND** the normal composer remains available

#### Scenario: Confirm before discarding a draft
- **WHEN** the user activates Dismiss after entering an answer, Other text, notes, or Additional Notes
- **THEN** an inline confirmation is shown
- **AND** canceling keeps the panel and the entered draft

#### Scenario: Dismiss removes older unresolved rounds too
- **WHEN** the conversation has more than one unresolved round and the user dismisses the displayed round
- **THEN** every unresolved round in that conversation is removed
- **AND** no older hidden round replaces the dismissed panel

#### Scenario: Future rounds still appear
- **WHEN** the agent presents a new question round after a dismissal
- **THEN** the new round is presented normally above the composer

### Requirement: Durable question dismissal
Dismissal SHALL be persisted per conversation. A dismissed round SHALL NOT reappear after reload, reconnect, or transcript replay, and late question pages for a dismissed turn SHALL NOT restore the panel. Persisted question page payloads for dismissed turns SHALL be pruned, while a compact dismissed-turn marker SHALL be retained for replay handling. Native transcript events SHALL NOT be modified.

#### Scenario: Reload does not restore a dismissed round
- **WHEN** the user reloads the conversation or reconnects the client after dismissing a round
- **THEN** the dismissed round's panel does not return

#### Scenario: Late pages do not restore a dismissed round
- **WHEN** additional question pages for a dismissed turn arrive after the dismissal
- **THEN** they do not recreate or expand a question panel for that turn

#### Scenario: Stored question payloads are removed
- **WHEN** a dismissed round is persisted
- **THEN** the persisted question projection no longer contains that round's question page payloads
- **AND** the dismissed-turn marker remains

#### Scenario: Native transcript is untouched
- **WHEN** a round is dismissed
- **THEN** the native conversation transcript and its recorded tool events remain unchanged

### Requirement: Question dismissal is not an answer or decision record
Dismissal SHALL be question-surface state only. It SHALL NOT submit an answer, settle a native approval or user question, create a decision or cancellation ledger entry, or replace the normal textual reply path. The awaiting-reply indication for the conversation SHALL stop treating the dismissed rounds as pending.

#### Scenario: Reply normally after dismissal
- **WHEN** the user dismisses a round and then sends a normal chat message
- **THEN** that message follows the ordinary conversation flow
- **AND** the plugin does not attach a decision or cancellation record

#### Scenario: Pending state clears
- **WHEN** a round is dismissed
- **THEN** the conversation is no longer shown as awaiting a question answer because of that round

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
