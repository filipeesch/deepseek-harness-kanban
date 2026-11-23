# Spec Delta

## MODIFIED Requirements

### Requirement: Decision gate above the composer

A task whose current stage authors a decision configuration SHALL present the gate in the host input-dock strip directly above the message composer of every conversation the task owns, both in the task drawer and in the host's main chat. It SHALL NOT be presented in a drawer section that has no composer: a task with no open conversation presents no gate in the drawer, and its pending choice remains signalled on the task card. The gate SHALL be resolved from the conversation's Session, so a conversation that belongs to no task presents no gate.

The strip SHALL present the question and context as Markdown, each option with its title and description, the current selection, and one confirm action. It SHALL be expanded by default and SHALL be collapsible to a header that remains available above the composer while the gate is unanswered. The person SHALL select exactly one option and activate the confirm action; selecting an option SHALL NOT apply the route by itself, and the confirm action SHALL be unavailable while no option is selected. The strip SHALL offer an optional observation field whose text is plain text, is recorded with the choice, and is carried to the destination as part of the reason. The strip SHALL NOT present a free-text answer, per-answer notes, an Additional Notes slide, a page progression, or a dismiss action that resolves the gate. Every conversation of the task SHALL present the same answer being composed: the confirmed option and the observation SHALL be read from the one shared window, so two conversations never show different choices or different refusals, and a new stage entry SHALL start a new unanswered draft instead of carrying the previous entry's choice.

The strip SHALL present its context, question, options, and option descriptions with the same presentation as the structured-question surface, so both surfaces render Markdown, option descriptions, the selection affordance, and the host's themed tokens in the same way. It SHALL inherit the content-driven strip height that surface defines: the gate grows with its content up to the space the composer seat can spare inside the conversation's chat scrollport, never past it, and scrolls only when its content exceeds that space. The stack rule that surface defines SHALL NOT collapse the gate: the gate is expanded by default and the stacked question rounds are presented below it. In the normal presentation, while the bound can hold the gate's fixed controls, the gate's header and its confirm action stay outside the scrolling body and remain reachable; the seat-fit guarantee applies to that presentation only. When the bound cannot hold the fixed controls, the gate keeps its header as its entry point and scrolls as a whole. When the seat cannot hold even the header beside the composer, the gate is presented above the conversation in a panel outside the composer seat, where it stays answerable and the composer regains pointer access once the gate is collapsed. When the visible conversation is too shallow for two usable panels, the gate and the waiting question rounds are presented as compact launchers with one panel open at a time, opened by activation of the disclosure button rather than by focus — an activation selects and opens the panel in one action, even one collapsed earlier — with the header reporting whether its body is visible, a visible launcher opened again after the conversation is reopened, and the disclosure state kept when the ordinary layout returns. A countdown started before the gate became inactive SHALL still be cancellable from that launcher. The stack of strips a conversation presents SHALL fit inside the composer seat together with the composer: when the gate and one or more question rounds wait in the same conversation, the waiting strips SHALL share the available height by need: each strip takes up to its own content, the leftover goes to the others, and a proportional split applies only when their needs together exceed the space. The gate SHALL be presented above those rounds with all of them remaining answerable, and a collapsed question round SHALL cost only its header. The strip SHALL follow the host's light and dark appearance, SHALL present the host focus indicator on every control, and SHALL NOT trap keyboard focus. The confirm action SHALL present its progress while the choice is being applied and SHALL present a refusal without discarding the selected option or the observation; the refusal SHALL be presented outside the scrolling body, beside the confirm action, so a short conversation cannot hide it.

The gate SHALL NOT be presented as a structured question round, SHALL NOT create or extend a question round, and SHALL NOT modify the conversation transcript. Confirming a choice SHALL NOT send a chat message, SHALL NOT settle a native question or approval, and SHALL NOT create a decision or cancellation record beyond the recorded stage entry. The destination SHALL learn the choice through the transition reason of its stage instruction, and the task's history SHALL present the chosen option and the observation. Presenting or answering the gate SHALL NOT create, open, or extend a conversation of its own; a destination that authors an entry instruction keeps the conversation behavior that instruction already has, including when it has to open one.

#### Scenario: Present the gate in a conversation of the task

- **WHEN** a task in a decision stage has an open conversation
- **THEN** that conversation presents the gate above its composer
- **AND** every other open conversation of the same task presents the gate as well
- **AND** the gate is presented the same way when the conversation is opened in the host's main chat

#### Scenario: Present no gate without a conversation

- **WHEN** a task in a decision stage has no open conversation
- **THEN** the drawer presents no gate in any section
- **AND** the task card still presents the decision attention

#### Scenario: Present no gate for a conversation of no task

- **WHEN** a conversation that belongs to no task is presented
- **THEN** no decision gate is presented above its composer

#### Scenario: Create no question round

- **WHEN** a task enters a decision stage
- **THEN** no structured question round is created or extended
- **AND** the conversation transcript is unchanged

#### Scenario: Send no chat message

- **WHEN** the person confirms a choice
- **THEN** no chat message is sent in any conversation of the task
- **AND** no native question or approval is settled

#### Scenario: Reach the destination through the reason

- **WHEN** an instructed destination receives the choice
- **THEN** the option title and the observation arrive as the transition reason
- **AND** the task's history keeps the chosen option and the observation

#### Scenario: Answer through an existing conversation

- **WHEN** the person answers the gate above a conversation of the task
- **THEN** the gate itself opens no conversation to present or answer it
- **AND** an instructed destination keeps the conversation behavior its own instruction defines

#### Scenario: Choose and confirm in two steps

- **WHEN** the person selects an option
- **THEN** the route is not applied yet
- **AND** the confirm action becomes available
- **AND** activating it starts applying the choice

#### Scenario: Collapse and restore the strip

- **WHEN** the person collapses the gate's header
- **THEN** only the header remains above the composer
- **AND** every entered selection and observation is preserved
- **AND** the gate remains unanswered

#### Scenario: Present the same presentation as a question

- **WHEN** the person compares a decision gate with an unanswered structured question in the same host appearance
- **THEN** context, question, options, and option descriptions are presented in the same way
- **AND** both use the host's themed colors, borders, and focus indicator

#### Scenario: Stack above a waiting question round

- **WHEN** a decision gate and one or more unanswered question rounds are waiting in the same conversation
- **THEN** the gate is presented above every question round
- **AND** every surface remains answerable
- **AND** the waiting strips and the composer fit inside the conversation together
- **AND** a collapsed question round costs only its header

#### Scenario: Grow the gate with its content on a large conversation

- **WHEN** the gate's content is shorter than the conversation's chat area but taller than a fixed short cap
- **THEN** the gate grows to its content
- **AND** its body does not scroll
- **AND** the conversation header and its tab row stay uncovered

#### Scenario: Keep the header and the confirm action reachable in a short window

- **WHEN** the conversation is shorter than the gate's content
- **THEN** the gate's header, the collapse toggle, and the confirm action remain visible
- **AND** the gate's content scrolls inside the strip

#### Scenario: Keep the confirm action reachable when the fixed controls cannot fit

- **WHEN** the conversation can hold the gate's header but not its full fixed controls beside the composer
- **THEN** the gate keeps its header above the composer
- **AND** the gate scrolls as a whole so the confirm action and the countdown cancel remain reachable

#### Scenario: Present the gate above the conversation when the seat cannot hold it

- **WHEN** the conversation cannot hold even the gate's header beside the message composer
- **THEN** the gate is presented above the conversation
- **AND** the gate scrolls as a whole and stays answerable
- **AND** collapsing the gate leaves the composer reachable again

#### Scenario: Keep the entered choice after a refusal

- **WHEN** applying the choice is refused
- **THEN** the refusal is presented beside the confirm action, outside the scrolling body
- **AND** the selected option and the observation remain available

#### Scenario: Share one answer across the task's conversations

- **WHEN** the person confirms a choice in one conversation of the task
- **THEN** every other conversation of the task presents the confirmed option and observation while the window counts
- **AND** a refusal is presented in every one of them

#### Scenario: Start a new draft for a new stage entry

- **WHEN** a task moves to another decision stage whose options reuse the previous option identities
- **THEN** the gate starts unanswered instead of carrying the previous stage entry's choice
