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

When the user attached files to one or more question slides or to the round's Additional Notes, the submission SHALL deliver them as durable file attachments of that same reply, and the reply's text SHALL name, in the block of the question they answer or in the round's additional-context block, the attachment that belongs there. The files SHALL be delivered in one reply, in the order the user attached them, and SHALL NOT produce an additional conversational turn. A submission whose attached file cannot be delivered SHALL fail as a whole, SHALL report the failure, and SHALL keep the round's draft so the user can retry.

#### Scenario: Submit multiple answers together
- **WHEN** the user submits a question round containing multiple answered pages
- **THEN** the conversation receives one textual reply containing the round's question-and-answer content and applicable user notes
- **AND** the form does not submit each page as a separate conversational turn

#### Scenario: Submit an answer carrying a file
- **WHEN** the user attaches a file to a question slide and submits the round
- **THEN** the reply carries that file as a durable attachment
- **AND** the reply's text names the attachment inside that question's block
- **AND** the conversation receives one reply, not one per page or per file

#### Scenario: Submit a round-wide file
- **WHEN** the user attaches a file on the Additional Notes slide and submits the round
- **THEN** the reply carries that file as a durable attachment
- **AND** the reply's text names it in the round's additional-context block

#### Scenario: Keep the draft when a file cannot be delivered
- **WHEN** a submitted round carries a file that the host cannot store
- **THEN** the submission fails and reports the failure
- **AND** the round's draft and its attachments remain available for a retry
- **AND** no partial reply is delivered

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

Each active question round SHALL be presented in its own panel docked directly above the message composer, in the host input-dock strip, and that panel SHALL remain in place while the conversation transcript scrolls. The panel SHALL show a header bar with the round title, a progress indicator, and a collapse toggle, and SHALL follow the stack rule defined by Question rounds stack above the composer, which expands the oldest unresolved round and presents a round that arrives while another round is unresolved collapsed.

In its normal presentation the panel SHALL grow with its content up to the height its composer seat can spare inside the conversation's scrolling body, so the panel, the message composer, and every other entry waiting in the same seat fit inside that body together. The bound SHALL be measured from the conversation rather than from the browser window, so an embedded conversation and a growing draft both reduce it. The panel SHALL NOT grow past the conversation's chat scrollport, so the conversation header and its tab row stay uncovered, and it SHALL NOT reserve transcript height: it may cover the chat, and collapsing it from its header SHALL reveal the conversation again. While the bound can hold the panel's fixed controls, the header bar and the footer actions SHALL stay outside the panel's scrolling body, and the body's content SHALL scroll only when it exceeds the height the seat can spare. When several strips wait in the same seat, the available height SHALL be shared by need: each strip takes up to its own content, the leftover goes to the other strips, and a proportional split applies only when their needs together exceed the space. In the fallbacks below that guarantee is replaced by reachability. When the bound can hold the header bar but not every fixed control, the panel SHALL keep its header bar as its entry point and SHALL scroll as a whole, so its navigation, submit, and dismiss actions remain reachable. When the seat cannot hold even the header bars beside the composer, the panel SHALL be presented above the conversation, scrolling as a whole and leaving the composer reachable again once the panel is collapsed. When the visible conversation is too shallow to present two usable panels, each waiting panel SHALL be presented as a compact launcher in one bounded list above the conversation, and only one SHALL be open at a time, opening the launcher the person chooses. The list SHALL stay inside the visible conversation and SHALL scroll when the launchers are taller than it, opening with the open launcher's panel in view, so every launcher stays reachable in a stack of any size. A launcher's header SHALL report whether its body is visible, moving focus alone SHALL NOT open it, and activating a launcher SHALL select and open it in one action, even one the person had collapsed before, without changing the disclosure state the person chose outside the launcher presentation. Only the disclosure button SHALL be treated as an activation: every other control that stays visible on an inactive launcher, such as the countdown cancel action, SHALL keep working. Reopening the conversation SHALL open a visible launcher again instead of remembering a closed one, and leaving the launcher presentation SHALL restore that disclosure state. A short window SHALL therefore never hide a control permanently: it decides only whether that control is visible at once or reachable by scrolling the panel.

The answer-file controls SHALL stay reachable at every height. In the normal presentation the attach action and the footer actions stay outside the panel's scrolling body, and a list of attached files scrolls inside a bounded row of its own instead of growing the footer until the actions are clipped. In the fallbacks every action remains reachable: the head of the panel keeps the entry point, and the panel scrolls as a whole so the file row and the footer can be brought into view.

#### Scenario: Answer while the conversation scrolls

- **WHEN** an unanswered round is displayed and the user scrolls the transcript
- **THEN** the panel remains docked above the composer showing the active slide

#### Scenario: Collapse to the bar

- **WHEN** the user activates the collapse toggle
- **THEN** the panel body is hidden and only the header bar remains above the composer

#### Scenario: Expanded by default

- **WHEN** a new unanswered round appears while no other round is unresolved
- **THEN** the panel body is shown without an additional action

#### Scenario: Bound the panel in a short window

- **WHEN** the viewport is shorter than the round's content
- **THEN** the panel's height stays within the height the seat can spare
- **AND** the header bar, the progress indicator, and the collapse toggle remain visible
- **AND** the panel's actions remain reachable

#### Scenario: Scroll the body instead of growing the panel

- **WHEN** the round's content exceeds the height the seat can spare
- **THEN** the panel does not grow past that height
- **AND** the body scrolls inside the panel

#### Scenario: Keep the actions reachable when the controls cannot fit

- **WHEN** the conversation can hold the header bars but not the panels' full fixed controls
- **THEN** each panel keeps its header bar above the composer
- **AND** the panel scrolls as a whole so its navigation, submit, and dismiss actions remain reachable

#### Scenario: Grow with the content on a large conversation

- **WHEN** the round's content is taller than a fixed short cap but shorter than the height the seat can spare
- **THEN** the panel grows to the content
- **AND** the body does not scroll
- **AND** the conversation header and its tab row stay uncovered

#### Scenario: Never cover the header and the tab row

- **WHEN** the panel grows with its content
- **THEN** its top stays at or below the top of the conversation's chat scrollport
- **AND** the conversation header and its tab row remain visible and reachable

#### Scenario: Share the seat by need

- **WHEN** two panels wait in the same seat and one of them has shorter content
- **THEN** each panel receives up to what its content needs
- **AND** the leftover height goes to the other panel

#### Scenario: Present the panel above the conversation when the seat cannot hold it

- **WHEN** the conversation cannot hold even the header bars beside the message composer
- **THEN** the panel is presented above the conversation
- **AND** the panel scrolls as a whole
- **AND** collapsing the panel leaves the composer reachable again

#### Scenario: Keep the footer actions reachable with many answer files

- **WHEN** the round carries more answer files than fit in one row at a short height
- **THEN** the list of files scrolls inside its own bounded region
- **AND** the attach, navigation, dismiss, and submit actions remain reachable outside it

### Requirement: Question rounds stack above the composer

Every unresolved question round of a conversation SHALL be presented as its own block in the composer dock, in the order the rounds arrived, oldest first. A block SHALL carry its own header bar, progress indicator, collapse toggle, body, footer, and draft.

The oldest unresolved round SHALL be expanded. A round that arrives while another round is unresolved SHALL be presented collapsed below the existing blocks. More than one block MAY be expanded at the same time, and a collapsed block SHALL occupy only its header.

The oldest unresolved round SHALL be expanded even when the person had collapsed it while it was newer: when a round leaves the stack because it was answered or dismissed, the round that becomes the oldest SHALL be expanded, and every other remaining block SHALL keep its current disclosure state.

Answering or dismissing one block SHALL NOT remove, collapse, reset, or discard the draft of another block.

The stack SHALL NOT cap the number of blocks it presents. When the blocks and the composer cannot fit inside the conversation, the panel fallbacks of the fixed question panel apply, so every round keeps an entry point.

Pages produced while one round is still being generated SHALL join that round's block. Questions produced by a later turn SHALL form a new block even when an earlier round is still unresolved, so the stack grows instead of merging pages into one round.

#### Scenario: Stack a second round under the first

- **WHEN** the agent produces a second question round before the person answered the first
- **THEN** both rounds are presented above the composer
- **AND** the first round is expanded
- **AND** the second round is presented collapsed below the first

#### Scenario: Keep more than one block open

- **WHEN** the person expands a collapsed block while another block is expanded
- **THEN** both blocks remain expanded
- **AND** they share the seat height by need

#### Scenario: A collapsed block costs only its header

- **WHEN** a round is presented collapsed
- **THEN** only its header bar occupies the dock
- **AND** its body and footer are hidden

#### Scenario: Promote the next round

- **WHEN** the expanded round is answered or dismissed
- **THEN** the oldest remaining unresolved round is expanded
- **AND** the other remaining blocks keep their disclosure state

#### Scenario: One round's answer leaves the others

- **WHEN** the person submits one block
- **THEN** every other block and its draft remain available
- **AND** no other round is retired or collapsed

#### Scenario: Keep the stack uncapped

- **WHEN** many rounds are unresolved in one conversation
- **THEN** every round keeps a block
- **AND** the panel fallbacks keep every round answerable while the composer stays reachable

#### Scenario: A later turn adds a block instead of pages

- **WHEN** the agent produces questions in a new turn while an earlier round is still unresolved
- **THEN** those questions form a new collapsed block
- **AND** the earlier round keeps its pages and draft unchanged

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

### Requirement: Model guidance directs the agent to end the turn after the last question page

The `decision_request` tool description SHALL state that the agent sends every page the round needs in the current turn and then ends its turn after the last page. It SHALL state that the user cannot submit the round until the turn ends and that continuing to write keeps Submit unavailable.

The description SHALL state that every page is a self-contained question the person can answer without the other pages: it SHALL NOT announce, preview, or summarize the pages that follow, and it SHALL NOT use a page to ask whether the agent may ask its questions. It SHALL state that the form already reports the round's progress.

The description SHALL state that the agent must not ask again a question the conversation already settled, unless the person asks to revisit it. The shipped workflow operator preset guidance SHALL carry the same self-contained-page rule, so the operator asks the same way outside the tool description.

The per-call tool result SHALL carry only the short rule that the agent always ends its turn after finishing all pages of the round.

The guidance SHALL NOT claim that the tool itself ends the turn: the tool still returns immediately, does not conclude the turn, and sends no conversational message.

#### Scenario: Description states the order and the Submit gate

- **WHEN** an agent receives the `decision_request` tool definition
- **THEN** its description directs the agent to send every page the round needs and then end the turn after the last page
- **AND** the description states that the user cannot submit until the turn ends and that continuing to write keeps Submit unavailable

#### Scenario: Description asks self-contained questions

- **WHEN** an agent receives the `decision_request` tool definition
- **THEN** its description states that each page stands on its own
- **AND** its description forbids announcing, previewing, or summarizing later pages
- **AND** its description forbids using a page to ask whether the agent may ask its questions

#### Scenario: Description forbids re-asking a settled question

- **WHEN** an agent receives the `decision_request` tool definition
- **THEN** its description states that the agent must not ask again a question the conversation already settled unless the person asks to revisit it

#### Scenario: Preset carries the same question rule

- **WHEN** the shipped workflow operator preset is read
- **THEN** its guidance asks self-contained question pages and forbids announcing later ones

#### Scenario: Result repeats the short rule

- **WHEN** an agent calls `decision_request`
- **THEN** the tool result states that the agent must always end its turn after finishing all pages of the round

#### Scenario: The tool does not end the turn itself

- **WHEN** an agent calls `decision_request`
- **THEN** the call returns immediately without concluding the turn or sending a conversational message

### Requirement: The agent is told which question rounds are open

Before an agent step in a conversation that has unresolved question rounds, the host SHALL present the agent a notice that names each open round and its questions, so the agent can avoid repeating them. The notice SHALL name at most five rounds and SHALL be bounded in characters.

The notice SHALL be informational: it SHALL NOT block a tool call, retire a round, change a round's answered or dismissed state, or count as the person's reply.

The notice SHALL be recorded in the conversation as a host context message with its own source, never as a message from the person, and it SHALL NOT create a question page. The notice SHALL NOT be presented for a conversation with no unresolved round.

#### Scenario: Name the open rounds

- **WHEN** the agent starts a step while two question rounds are unresolved
- **THEN** the notice names both rounds and their questions

#### Scenario: No notice without open rounds

- **WHEN** the agent starts a step in a conversation whose rounds are all answered or dismissed
- **THEN** no open-round notice is presented

#### Scenario: The notice is not an answer

- **WHEN** the notice is delivered to the agent
- **THEN** the conversation records it as a host context message with the notice source
- **AND** the question projection does not count it as the person's reply
- **AND** no round is retired or dismissed because of it
- **AND** it creates no question page

### Requirement: One question surface per conversation
The panel above the composer SHALL be the only interactive question surface, and every unresolved round SHALL appear there exactly once as its own block in the stack. The plugin SHALL NOT render a second summary, the question text, the choices, or an open or review action for `decision_request` calls in the conversation transcript.

#### Scenario: No duplicate question in the transcript
- **WHEN** a `decision_request` call appears in the conversation transcript
- **THEN** that row does not repeat the question text, choices, or an open or review action

#### Scenario: One entry point for an unanswered round
- **WHEN** one or more rounds are unresolved in a conversation
- **THEN** each round is answered through its own block above the composer

### Requirement: Round retirement removes only the answered block

The submitted round's block SHALL leave the composer dock immediately when the user submits a valid round, before the reply admission settles. If admission fails, the block SHALL return with the entered answers, Other text, notes, and Additional Notes and SHALL show the admission error, with Submit available for a retry. A block removed by Submit SHALL NOT return because of a later question-state update that still reports the round unresolved; it returns only on admission failure.

A round SHALL be retired only when that round is answered by its own submission or dismissed. An ordinary chat message SHALL NOT retire a round, and submitting one round SHALL NOT remove, collapse, or reset another unresolved round's block or draft; every other block keeps its answers and its disclosure state.

A retired round SHALL NOT reappear after a reload.

#### Scenario: Remove after Submit

- **WHEN** the user submits a valid round
- **THEN** that round's block leaves the composer dock immediately
- **AND** the conversation receives the textual reply without waiting for the block to be removed
- **AND** the other blocks remain in the stack

#### Scenario: Restore a failed Submit

- **WHEN** the reply admission fails after the block left the dock
- **THEN** the block returns with the entered answers and an admission error
- **AND** Submit is available for a retry

#### Scenario: An ordinary reply leaves the stack in place

- **WHEN** the user sends a normal chat message while rounds are unresolved
- **THEN** no block leaves the stack because of that message
- **AND** no draft is discarded because of it

#### Scenario: Stay while unanswered

- **WHEN** a round is unanswered, including while the user replies on other topics
- **THEN** its block remains available above the composer

#### Scenario: Submitted round does not resurrect

- **WHEN** a question-state update arrives after Submit but before the round is confirmed retired
- **THEN** the submitted round remains hidden from the composer dock
- **AND** a reload does not present it again

#### Scenario: A newer round still appears

- **WHEN** the agent presents a different unresolved round after the submitted round left the dock
- **THEN** the newer round is presented as a new block in the stack

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

### Requirement: Dismiss one unresolved question round

While an unresolved question round is expanded, its block SHALL provide a Dismiss action in the leading position of its footer. Dismissing SHALL remove only that round's block, SHALL leave the other unresolved rounds in the stack with their drafts, SHALL send no conversation message, and SHALL leave the normal composer available. When any answer, Other text, per-answer notes, or Additional Notes have been entered, dismissal SHALL first show an inline confirmation about that round; canceling SHALL keep the draft and the block, and confirming SHALL dismiss. The Dismiss action SHALL be unavailable while a submission is in progress.

#### Scenario: Dismiss an untouched round

- **WHEN** the user activates Dismiss while the current round has no entered answers or notes
- **THEN** the round's block is removed immediately without a confirmation
- **AND** no conversation message is sent
- **AND** the normal composer remains available

#### Scenario: Confirm before discarding a draft

- **WHEN** the user activates Dismiss after entering an answer, Other text, notes, or Additional Notes
- **THEN** an inline confirmation about that round is shown
- **AND** canceling keeps the block and the entered draft

#### Scenario: Dismiss one round of many

- **WHEN** the conversation has more than one unresolved round and the user dismisses the displayed block
- **THEN** only that round's block is removed
- **AND** every other unresolved round stays in the stack with its draft
- **AND** the oldest remaining block is expanded when no other block is expanded

#### Scenario: Future rounds still appear

- **WHEN** the agent presents a new question round after a dismissal
- **THEN** the new round is presented as a new block above the composer

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
Dismissal SHALL be question-surface state only. It SHALL NOT submit an answer, settle a native approval or user question, create a decision or cancellation ledger entry, or replace the normal textual reply path. The awaiting-reply indication for the conversation SHALL stop treating the dismissed round as pending, while every other unresolved round keeps its own hold.

#### Scenario: Reply normally after dismissal
- **WHEN** the user dismisses a round and then sends a normal chat message
- **THEN** that message follows the ordinary conversation flow
- **AND** the plugin does not attach a decision or cancellation record

#### Scenario: Pending state clears
- **WHEN** a round is dismissed
- **THEN** the conversation is no longer shown as awaiting a question answer because of that round
- **AND** another unresolved round keeps the conversation awaiting an answer

### Requirement: Each unanswered round is pending user work

A structured question round with no answer SHALL count as pending user work as defined by Pending user work in `kanban-board`, so a task with auto mode enabled does not advance while the round is open, including when the round belongs to a conversation whose tab is closed. Submitting or dismissing that round SHALL consume that round's item, and another unresolved round SHALL keep holding on its own. The pending state SHALL be presented by the auto-mode control and SHALL NOT add a question-panel, status-strip, or drawer-notice entry of its own.

#### Scenario: An open round holds auto mode

- **WHEN** a task with auto mode enabled has an unanswered round and a completed turn ends
- **THEN** the host admits no automatic advance
- **AND** the task remains in its current stage

#### Scenario: A closed tab still holds auto mode

- **WHEN** the conversation holding an unanswered round has its tab closed
- **THEN** the round still counts as pending user work for the task

#### Scenario: Submit consumes the pending state

- **WHEN** the user submits a round
- **THEN** that round no longer counts as pending user work
- **AND** the next completed turn re-evaluates the advance

#### Scenario: One round's answer leaves the other holding

- **WHEN** the user submits one of two unresolved rounds
- **THEN** the other round still counts as pending user work
- **AND** the next completed turn still admits no automatic advance

#### Scenario: Dismissal consumes the pending state

- **WHEN** the user dismisses an unresolved round
- **THEN** that round no longer counts as pending user work
- **AND** no answer is submitted and no conversation message is sent

#### Scenario: The pending state does not add a question surface

- **WHEN** a round counts as pending user work for an auto-mode task
- **THEN** no additional question panel, status-region entry, or drawer notice is presented because of that
- **AND** the auto-mode control presents the held state

### Requirement: Question state updates independently of board projection

Question rounds SHALL update from conversation-scoped question state that does not wait for board or attention projection to complete. Submit becoming available when the agent's turn ends, the retirement of a submitted round, and the removal of a submitted block SHALL NOT depend on the board snapshot or on conversation fact inspection.

#### Scenario: Turn completion unlocks Submit independently of board projection

- **WHEN** the agent's turn ends and the conversation-scoped question state reports the round complete while board projection is still delayed
- **THEN** Submit becomes available without waiting for the board projection to finish

#### Scenario: Submit retires the block independently of board projection

- **WHEN** a round is submitted while board projection is still delayed
- **THEN** the block leaves the composer dock without waiting for the board projection to finish

#### Scenario: Reload restores from conversation-scoped state

- **WHEN** the conversation is reloaded while a round is unanswered
- **THEN** the panel returns with the same pages and completion state from the conversation-scoped question state
- **AND** a retired round does not reappear

### Requirement: Durable question form drafts

The plugin SHALL persist the in-progress form state of every unresolved question round against the conversation that owns the round, and SHALL restore that state when the round is presented again. The persisted state SHALL comprise each received page's selected choices, Other text, and per-answer notes, the files attached to each page, the round's Additional Notes, the files attached to the round, and the question page the user was viewing. The persisted state SHALL NOT comprise the collapsed state of a block: a restored stack SHALL apply the stack's expansion rule, so the oldest unresolved round is expanded and every other restored round is collapsed. Draft state SHALL belong to the conversation and SHALL NOT be owned by a task or board record, and the same durability SHALL apply to ordinary DSH chats that have no task card. A persisted draft SHALL NOT be submitted, delivered as a conversation message, or otherwise settled automatically, and it SHALL NOT change the round's completion or retired state.

A restored draft SHALL present each restored attachment with its display name and byte length, and SHALL be able to deliver it when the user submits. The plugin SHALL be able to read a stored draft attachment's bytes back, so that a reload or a conversation switch restores a usable attachment rather than only its name.

#### Scenario: Reopen after closing the drawer

- **WHEN** the user answers part of an unresolved round and closes the task drawer
- **THEN** reopening the task restores the selected choices, Other text, per-answer notes, Additional Notes, attached files, and the page the user was viewing

#### Scenario: Return to another conversation

- **WHEN** the user answers part of a round in one conversation, switches to another conversation tab, and returns
- **THEN** the round returns with the answers, the attached files, and the page the user had reached

#### Scenario: Reload the application

- **WHEN** the application is reloaded while an unresolved round has a draft carrying attached files
- **THEN** the round returns above the composer with the persisted draft, its attached files, and the same active page
- **AND** the restored files remain deliverable when the user submits

#### Scenario: Closed conversation keeps its draft

- **WHEN** the user closes the conversation tab while it holds an unresolved round with a draft
- **THEN** reopening that conversation restores the draft

#### Scenario: Ordinary chat without a task

- **WHEN** an unresolved round with a draft belongs to an ordinary DSH chat that has no task card
- **THEN** the same restore behavior applies without a task record

#### Scenario: Pages arrive after a restore

- **WHEN** the agent produces additional question pages after a persisted draft was restored
- **THEN** the restored choices, Other text, notes, Additional Notes, and attached files remain available
- **AND** the panel announces the newly received page without discarding the draft

#### Scenario: Restored round is never auto-submitted

- **WHEN** a persisted draft is restored with every received answer valid and the agent's turn has ended
- **THEN** Submit remains an explicit user action and no conversation message is produced until the user submits

#### Scenario: Restored round is expanded

- **WHEN** the oldest unresolved round with a persisted draft is presented again
- **THEN** its panel is expanded with the restored active page shown

#### Scenario: Restored stack keeps newer rounds collapsed

- **WHEN** a conversation with two unresolved rounds is restored
- **THEN** the newer round is presented collapsed with its own restored draft

### Requirement: Draft discarded when its round is submitted or dismissed

The plugin SHALL discard a conversation's draft for a question round once that round is no longer answerable: when the round is submitted and admitted, or when the round is dismissed. Discarding SHALL NOT send a conversation message, modify the native transcript, or affect another unresolved round's draft. An unresolved round presented after an earlier round was discarded SHALL start with empty answers.

#### Scenario: Submit discards the draft

- **WHEN** the user submits a valid round and the reply is admitted
- **THEN** the stored draft for that round is removed
- **AND** the removed round does not return later with its answers

#### Scenario: Dismissal discards the draft

- **WHEN** the user dismisses a round
- **THEN** the stored draft for that round is removed
- **AND** no conversation message is sent
- **AND** the drafts of the other unresolved rounds remain

#### Scenario: A newer round starts empty

- **WHEN** the agent presents a new unresolved round after an earlier round was submitted or dismissed
- **THEN** the newer round starts with empty answers and no inherited draft

### Requirement: Bounded draft retention

The plugin SHALL retain at most the 100 most recently updated conversation draft records. When that bound is exceeded, the records of the least recently updated conversations SHALL be discarded. Draft retention SHALL NOT depend on draft age, and dropping a draft record SHALL NOT remove or alter that conversation's question rounds, their completion, their dismissal state, or their answered state.

#### Scenario: Exceeding the bound

- **WHEN** more than 100 conversation draft records exist
- **THEN** only the 100 most recently updated records are retained

#### Scenario: Recently updated record is retained

- **WHEN** a conversation's draft is updated while the bound is at capacity
- **THEN** that conversation's draft is retained ahead of older records

#### Scenario: Retention does not remove rounds

- **WHEN** a conversation's draft record is dropped by the retention bound
- **THEN** an unresolved round in that conversation is still presented, without a restored draft

### Requirement: Task deletion removes conversation question state

Deleting a task SHALL remove the durable question projection and the question drafts belonging to that task's conversations. Deleting a task SHALL NOT remove question state belonging to another task's conversations or to an ordinary chat, and SHALL NOT modify the native transcripts of the archived conversations.

#### Scenario: Deletion removes the task's question state

- **WHEN** a task with conversations holding question state is deleted
- **THEN** the question projection and drafts for its conversations are removed from durable storage

#### Scenario: Another task is unaffected

- **WHEN** one task is deleted
- **THEN** the question state of every other task's conversations remains available

#### Scenario: Ordinary chat is unaffected

- **WHEN** a task is deleted
- **THEN** question state belonging to an ordinary DSH chat remains available

#### Scenario: Transcript untouched

- **WHEN** a task is deleted
- **THEN** no archived conversation transcript is modified

### Requirement: The question dock reports only question state

The composer question dock SHALL present every unresolved round as a block in the stack and the question feed's own failure with its retry action. It SHALL NOT present the board-update status or any other surface's failure. The dock SHALL remain available in every native conversation, including an ordinary DSH chat that has no task card, independently of the board feed's availability and of the board snapshot.

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

### Requirement: File answers on a question round

A question slide SHALL accept files attached to that question, and the round's Additional Notes slide
SHALL accept files attached to the round as a whole. Files SHALL be accepted through the browser's
file input and by pasting a file from the clipboard.

Every attached file SHALL be stored as a generic file attachment. The plugin SHALL NOT decode an
image's dimensions, SHALL NOT produce a thumbnail, and SHALL NOT send an attached image as an image
part.

The round's attach control SHALL be one compact icon action in the question panel's footer, beside the
round's navigation actions. The action SHALL attach to the slide currently shown: a question slide
attaches to that question, and the Additional Notes slide attaches to the round. The footer SHALL list
the active slide's files as compact tokens, each carrying its display name and byte length, and each
token SHALL be removable before submission. The files of another slide SHALL NOT be listed while a
different slide is shown.

An attached file SHALL NOT by itself satisfy or invalidate that question's answer, and a round SHALL
remain submittable on the same conditions it had before files could be attached. A selection that
failed SHALL keep the round unsubmittable until it is retried or discarded, and the failure SHALL be
reported with a retry action and a discard action.

The attach action SHALL be reachable in every conversation that presents the round, including an
ordinary DSH chat whose conversation has no task card. Attaching a file SHALL NOT require a task.

#### Scenario: Attach a file to one question

- **WHEN** the user attaches a file through the footer action while a question slide is shown
- **THEN** that question owns the file, presented as a token in the footer with its display name and byte length
- **AND** the other question slides are unaffected

#### Scenario: Attach a file to the round

- **WHEN** the user attaches a file while the Additional Notes slide is shown
- **THEN** the file is attached to the round as a whole
- **AND** it is listed in the footer on that slide

#### Scenario: The action follows the active slide

- **WHEN** the user attaches a file on one question slide, moves to another question slide, and attaches another file
- **THEN** each file belongs to the question that was shown when it was attached
- **AND** each slide's footer lists only its own files

#### Scenario: Paste a file into a question

- **WHEN** the user pastes a file from the clipboard while a question slide is active
- **THEN** the file is attached to that question
- **AND** pasted text is not treated as a file

#### Scenario: Remove an attachment before submitting

- **WHEN** the user removes a token from the footer
- **THEN** the file no longer belongs to that slide
- **AND** the round's submittability is unchanged

#### Scenario: Files do not change answer validity

- **WHEN** the user attaches files to a question without answering it
- **THEN** that question remains unanswered
- **AND** Submit remains unavailable on the same condition as before

#### Scenario: A failed selection keeps the round unsubmittable

- **WHEN** a selected file cannot be attached
- **THEN** the panel reports the failure with a retry action and a discard action
- **AND** Submit stays unavailable until the selection is retried or discarded
- **AND** discarding the selection lets the round be submitted without that file

#### Scenario: Attach a file in a chat without a task

- **WHEN** the user attaches a file to a question round presented in an ordinary DSH chat
- **THEN** the file can be attached through the browser and the clipboard
- **AND** no task card is required

#### Scenario: Store an attached image as a generic file

- **WHEN** the user attaches a file whose content is an image
- **THEN** it is delivered as a generic file attachment
- **AND** no thumbnail is produced for it
