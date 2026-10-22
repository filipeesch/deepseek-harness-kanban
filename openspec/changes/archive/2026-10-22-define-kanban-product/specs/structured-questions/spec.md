## Purpose

Provide rich, paginated question forms as an alternative way to compose a normal textual reply in DSH conversations, without introducing a separate decision ledger, cancellation record, or approval workflow.

Reference note: Railyin's [question interface](<https://github.com/filipeesch/railyin/blob/a25520f4c5a91c24b359fce34ce9f553b9d6823c/src/mainview/components/DecisionRequest.vue#L7-L143>) supplies UX evidence. Its Record as decisions workflow is intentionally excluded from the target product.

## ADDED Requirements

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
The rich question experience SHALL support Markdown question context and question text, explanatory Markdown choice descriptions, an agent recommendation with its rationale, and question weight information when supplied. It SHALL allow the user to add notes and additional context to their answers.

#### Scenario: Review a richly explained choice
- **WHEN** a question includes explanatory choice descriptions, a recommendation, its rationale, and a weight
- **THEN** the interface presents those supplied details alongside the question and its choices

#### Scenario: Include user notes
- **WHEN** the user adds notes or additional context while answering a question round
- **THEN** that context is retained with the answers for the round's textual submission

### Requirement: Streaming paginated question rounds
Questions SHALL be presented as pages within a round, including when pages arrive incrementally from the agent. The user SHALL be able to begin answering received pages while additional questions are arriving and navigate between received pages without losing answers entered within that round.

#### Scenario: Answer before all pages have arrived
- **WHEN** the first question page has arrived and further question pages are still being produced
- **THEN** the user can begin answering the received page without waiting for all pages to be displayed

#### Scenario: Navigate within a round
- **WHEN** the user moves to another received question page and then returns to a previously answered page
- **THEN** the answer entered on that page remains available within the round

### Requirement: Submit a round as one textual reply
Submitting a completed question round SHALL aggregate its answers, including applicable selected choices, Other text, and user notes, into a normal textual reply in the originating DSH conversation. The reply SHALL associate each answer with its question rather than submit a separate conversational turn for each page.

#### Scenario: Submit multiple answers together
- **WHEN** the user submits a question round containing multiple answered pages
- **THEN** the conversation receives one textual reply containing the round's question-and-answer content and applicable user notes
- **AND** the form does not submit each page as a separate conversational turn

### Requirement: Optional form without a separate decision lifecycle
The user SHALL be able to close the question form without submitting it and reply through the normal chat composer. The plugin SHALL NOT infer an answer from closing the form, require a separate cancellation or approval record, or introduce a decision ledger or Record as decisions workflow. Ordinary conversation replies SHALL remain the means of responding to the agent.

#### Scenario: Close the form and reply normally
- **WHEN** the user closes a question form and sends a normal text message in the same conversation
- **THEN** that message is submitted through the normal conversation flow without requiring completion of the form
- **AND** closing the form does not itself submit an inferred answer

#### Scenario: Answer without creating a decision ledger
- **WHEN** the user submits a question round through the form
- **THEN** the result is a normal textual conversation reply without a separate decision-ledger record, cancellation record, or product approval lifecycle
