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

The active question round SHALL be presented in a panel docked directly above the message composer, in the host input-dock strip, and that panel SHALL remain in place while the conversation transcript scrolls. The panel SHALL show a header bar with the round title, a progress indicator, and a collapse toggle, and SHALL be expanded by default.

In its normal presentation the panel's height SHALL be bounded by the height its composer seat can spare inside the conversation's scrolling body, so the panel, the message composer, and every other entry waiting in the same seat fit inside that body together. The bound SHALL be measured from the conversation rather than from the browser window, so an embedded conversation and a growing draft both reduce it. While the bound can hold the panel's fixed controls, the header bar and the footer actions SHALL stay outside the panel's scrolling body and only the body's content SHALL scroll. In the fallbacks below that guarantee is replaced by reachability. When the bound can hold the header bar but not every fixed control, the panel SHALL keep its header bar as its entry point and SHALL scroll as a whole, so its navigation, submit, and dismiss actions remain reachable. When the seat cannot hold even the header bars beside the composer, the panel SHALL be presented above the conversation, scrolling as a whole and leaving the composer reachable again once the panel is collapsed. When the visible conversation is too shallow to present two usable panels, each panel SHALL be presented as a compact launcher and only one SHALL be open at a time, opening the launcher the person chooses. A launcher's header SHALL report whether its body is visible, moving focus alone SHALL NOT open it, and activating a launcher SHALL select and open it in one action, even one the person had collapsed before. Only the disclosure button SHALL be treated as an activation: every other control that stays visible on an inactive launcher, such as the countdown cancel action, SHALL keep working. Reopening the conversation SHALL open a visible launcher again instead of remembering a closed one, and leaving the launcher presentation SHALL keep the panel's disclosure state. A short window SHALL therefore never hide a control permanently: it decides only whether that control is visible at once or reachable by scrolling the panel.

The answer-file controls SHALL stay reachable at every height. In the normal presentation the attach action and the footer actions stay outside the panel's scrolling body, and a list of attached files scrolls inside a bounded row of its own instead of growing the footer until the actions are clipped. In the fallbacks every action remains reachable: the head of the panel keeps the entry point, and the panel scrolls as a whole so the file row and the footer can be brought into view.

#### Scenario: Answer while the conversation scrolls

- **WHEN** an unanswered round is displayed and the user scrolls the transcript
- **THEN** the panel remains docked above the composer showing the active slide

#### Scenario: Collapse to the bar

- **WHEN** the user activates the collapse toggle
- **THEN** the panel body is hidden and only the header bar remains above the composer

#### Scenario: Expanded by default

- **WHEN** a new unanswered round appears
- **THEN** the panel body is shown without an additional action

#### Scenario: Bound the panel in a short window

- **WHEN** the viewport is shorter than the round's content
- **THEN** the panel's height stays within its bound
- **AND** the header bar, the progress indicator, and the collapse toggle remain visible
- **AND** the panel's actions remain reachable

#### Scenario: Scroll the body instead of growing the panel

- **WHEN** the round's content exceeds the panel's bound
- **THEN** the panel does not grow past the bound
- **AND** the body scrolls inside the panel

#### Scenario: Keep the actions reachable when the controls cannot fit

- **WHEN** the conversation can hold the header bars but not the panels' full fixed controls
- **THEN** each panel keeps its header bar above the composer
- **AND** the panel scrolls as a whole so its navigation, submit, and dismiss actions remain reachable

#### Scenario: Present the panel above the conversation when the seat cannot hold it

- **WHEN** the conversation cannot hold even the header bars beside the message composer
- **THEN** the panel is presented above the conversation
- **AND** the panel scrolls as a whole
- **AND** collapsing the panel leaves the composer reachable again

#### Scenario: Keep the footer actions reachable with many answer files

- **WHEN** the round carries more answer files than fit in one row at a short height
- **THEN** the list of files scrolls inside its own bounded region
- **AND** the attach, navigation, dismiss, and submit actions remain reachable outside it

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

### Requirement: An unanswered round is pending user work

A structured question round with no answer SHALL count as pending user work as defined by Pending user work in `kanban-board`, so a task with auto mode enabled does not advance while the round is open, including when the round belongs to a conversation whose tab is closed. Submitting the round, replying with an ordinary chat message, or dismissing the round SHALL consume that item. The pending state SHALL be presented by the auto-mode control and SHALL NOT add a question-panel, status-strip, or drawer-notice entry of its own.

#### Scenario: An open round holds auto mode
- **WHEN** a task with auto mode enabled has an unanswered round and a completed turn ends
- **THEN** the host admits no automatic advance
- **AND** the task remains in its current stage

#### Scenario: A closed tab still holds auto mode
- **WHEN** the conversation holding an unanswered round has its tab closed
- **THEN** the round still counts as pending user work for the task

#### Scenario: Submit consumes the pending state
- **WHEN** the user submits the round
- **THEN** the round no longer counts as pending user work
- **AND** the next completed turn re-evaluates the advance

#### Scenario: An ordinary reply consumes the pending state
- **WHEN** the user answers through the normal chat composer while the round is unresolved
- **THEN** the round no longer counts as pending user work
- **AND** the next completed turn re-evaluates the advance

#### Scenario: Dismissal consumes the pending state
- **WHEN** the user dismisses the unresolved round
- **THEN** the round no longer counts as pending user work
- **AND** no answer is submitted and no conversation message is sent

#### Scenario: The pending state does not add a question surface
- **WHEN** a round counts as pending user work for an auto-mode task
- **THEN** no additional question panel, status-region entry, or drawer notice is presented because of that
- **AND** the auto-mode control presents the held state

### Requirement: Durable question form drafts

The plugin SHALL persist the in-progress form state of every unresolved question round against the conversation that owns the round, and SHALL restore that state when the round is presented again. The persisted state SHALL comprise each received page's selected choices, Other text, and per-answer notes, the files attached to each page, the round's Additional Notes, the files attached to the round, and the question page the user was viewing. The persisted state SHALL NOT comprise the collapsed state of the panel: a restored round SHALL be presented expanded, like a newly arrived round. Draft state SHALL belong to the conversation and SHALL NOT be owned by a task or board record, and the same durability SHALL apply to ordinary DSH chats that have no task card. A persisted draft SHALL NOT be submitted, delivered as a conversation message, or otherwise settled automatically, and it SHALL NOT change the round's completion or answered state.

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

- **WHEN** a round with a persisted draft is presented again
- **THEN** its panel is expanded with the restored active page shown

### Requirement: Draft discarded when its round ends

The plugin SHALL discard a conversation's draft for a question round once that round is no longer answerable: when the round is submitted and admitted, when an ordinary chat reply retires the round, or when the round is dismissed. Discarding SHALL NOT send a conversation message, modify the native transcript, or affect another unresolved round's draft. An unresolved round presented after an earlier round was discarded SHALL start with empty answers.

#### Scenario: Submit discards the draft

- **WHEN** the user submits a valid round and the reply is admitted
- **THEN** the stored draft for that round is removed
- **AND** the removed round does not return later with its answers

#### Scenario: Ordinary reply discards the draft

- **WHEN** the user answers the round with an ordinary chat message
- **THEN** the stored draft for that round is removed
- **AND** the round no longer appears above the composer

#### Scenario: Dismissal discards the draft

- **WHEN** the user dismisses the unresolved rounds of a conversation
- **THEN** the stored drafts for those rounds are removed
- **AND** no conversation message is sent

#### Scenario: A newer round starts empty

- **WHEN** the agent presents a new unresolved round after an earlier round was submitted, answered, or dismissed
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
