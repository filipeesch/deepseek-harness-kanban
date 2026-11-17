# Spec Delta

## Purpose

Defines a workflow stage that stops deterministically for a person's explicit choice and routes the task to the chosen authored destination, without an agent turn or a program.

## ADDED Requirements

### Requirement: Decision stage configuration

A stage MAY author a `decision` configuration consisting of a required question, optional Markdown context, and one to twelve options. Each option SHALL carry a safe identifier that is unique within the stage, a required title, an optional Markdown description, and a destination that names another existing stage of the same workflow. The stage's option destinations SHALL be its authored destinations for graph presentation and route reporting. The configuration SHALL NOT provide a default destination: no option SHALL be chosen on the person's behalf, and the authored option order SHALL NOT imply a first-option default. A stage that authors a decision configuration SHALL NOT author a nonempty entry instruction, an allowed-transition list, or a scripted configuration, and a workflow that authors a combination SHALL be rejected. One option SHALL be valid and SHALL mean an explicit confirmation.

The stage description SHALL remain optional authored context and SHALL NOT be the question. The question, context, option title, option description, and the observation a person may add SHALL each be bounded by an accepted length; a value beyond its bound SHALL be rejected rather than truncated. An option identifier SHALL be the identity a recorded decision uses, so renaming an option's title SHALL NOT change the meaning of an existing record. A destination that is not another existing stage, a self destination, an option identifier that repeats within the stage, and an option count outside the accepted range SHALL each be rejected, leaving the last valid workflow in effect. A stage rename SHALL carry the renamed identifier into every option destination that named it, and a refusal to remove a stage SHALL account for option destinations that name it.

#### Scenario: Author an explicit confirmation

- **WHEN** a workflow authors a decision stage with one option and that option destinations another existing stage
- **THEN** the workflow is accepted
- **AND** the stage is valid without any entry instruction, allowed-transition list, or scripted configuration
- **AND** no destination is chosen until the person confirms the option

#### Scenario: Reject a combination with another stage mode

- **WHEN** a workflow authors a decision configuration together with a nonempty entry instruction, an allowed-transition list, or a scripted configuration on the same stage
- **THEN** the workflow is rejected and the last valid workflow remains in effect

#### Scenario: Reject an invalid option

- **WHEN** an option names the stage itself, names a stage the workflow does not define, repeats an identifier used by another option of the stage, or the stage authors more options than the accepted count
- **THEN** the workflow is rejected and the last valid workflow remains in effect

#### Scenario: Keep a recorded decision after an option rename

- **WHEN** an option's title is renamed after a task recorded a decision for that option
- **THEN** the recorded decision keeps its option identity
- **AND** the history presents the option the record names

#### Scenario: Reject an oversized question or observation

- **WHEN** a question, context, option description, or observation exceeds its accepted length
- **THEN** the value is rejected rather than truncated

### Requirement: Decision gate in the task drawer

A task whose current stage authors a decision configuration SHALL present the gate in the task drawer as a strip fixed above the drawer's sections, available in every section and without requiring a conversation of the task. The strip SHALL present the question and context as Markdown, each option with its title and description, the current selection, and one confirm action. It SHALL be expanded by default and SHALL be collapsible to a header that remains available while the gate is unanswered. The person SHALL select exactly one option and activate the confirm action; selecting an option SHALL NOT apply the route by itself, and the confirm action SHALL be unavailable while no option is selected. The strip SHALL offer an optional observation field whose text is plain text, is recorded with the choice, and is carried to the destination as part of the reason. The strip SHALL NOT present a free-text answer, per-answer notes, an Additional Notes slide, a page progression, or a dismiss action that resolves the gate.

The strip SHALL present its context, question, options, and option descriptions with the same presentation as the structured-question surface, so both surfaces render Markdown, option descriptions, the selection affordance, and the host's themed tokens in the same way. The strip SHALL follow the host's light and dark appearance, SHALL present the host focus indicator on every control, and SHALL NOT trap keyboard focus. The confirm action SHALL present its progress while the choice is being applied and SHALL present a refusal without discarding the selected option or the observation.

#### Scenario: Present the gate without a conversation

- **WHEN** a task in a decision stage has no conversation
- **THEN** the drawer presents the gate above its sections
- **AND** the person can choose an option without creating a conversation

#### Scenario: Choose and confirm in two steps

- **WHEN** the person selects an option
- **THEN** the route is not applied yet
- **AND** the confirm action becomes available
- **AND** activating it starts applying the choice

#### Scenario: Collapse and restore the strip

- **WHEN** the person collapses the gate's header
- **THEN** only the header remains above the drawer's sections
- **AND** every entered selection and observation is preserved
- **AND** the gate remains unanswered

#### Scenario: Present the same presentation as a question

- **WHEN** the person compares a decision gate with an unanswered structured question in the same host appearance
- **THEN** context, question, options, and option descriptions are presented in the same way
- **AND** both use the host's themed colors, borders, and focus indicator

#### Scenario: Keep the entered choice after a refusal

- **WHEN** applying the choice is refused
- **THEN** the gate presents the refusal
- **AND** the selected option and the observation remain available

### Requirement: Decision attention on the task card

A task whose current stage authors a decision configuration SHALL present a task-level attention fact while the gate is unanswered. The card SHALL present the attention tint used for awaiting input, an attention mark whose accessible name states that a decision is needed, and a pending-toned status line that states the same. The fact SHALL NOT be attributed to a conversation, SHALL NOT mark any conversation as unread, awaiting reply, or failed, and SHALL NOT pause or disable the automatic-mode setting. The fact SHALL coexist with the card's other attention facts and status entries, and a failure SHALL keep the failure tint while the decision mark and status line remain presented. The card SHALL NOT present an advance action for a stage that authors a decision configuration.

#### Scenario: Present the decision attention

- **WHEN** a task with no other attention state sits in a decision stage
- **THEN** the card presents the awaiting-input tint
- **AND** it presents a mark naming the needed decision
- **AND** its status region states that a decision is needed

#### Scenario: Do not attribute the gate to a conversation

- **WHEN** a task in a decision stage has a conversation
- **THEN** the gate marks that task and its card, not the conversation
- **AND** the conversation is not marked unread, awaiting reply, or failed because of the gate

#### Scenario: Keep a failure ahead of the gate

- **WHEN** a task in a decision stage also has a failure
- **THEN** the card presents the failure tint
- **AND** the decision mark and status line remain presented

#### Scenario: Do not present an advance action

- **WHEN** a card sits in a stage that authors a decision configuration
- **THEN** the card presents no advance action
- **AND** the gate is the only authored way out

#### Scenario: Do not pause automatic mode

- **WHEN** the task's automatic mode is enabled and it sits in a decision stage
- **THEN** the control keeps the enabled setting
- **AND** no automatic-mode pause is recorded for the gate

### Requirement: Five-second decision window

After the person confirms, the client SHALL hold the choice for a fixed five-second window before anything is applied. During the window the card and the gate strip SHALL present a countdown that names the destination and a cancel action. Canceling the window SHALL apply nothing, SHALL leave the task in its stage, SHALL record nothing, and SHALL return the gate to an unanswered state. When the window closes, the client SHALL submit the choice. Reloading the interface, closing the application, or losing the client during the window SHALL apply nothing, SHALL record nothing, and SHALL present the gate unanswered when the task is next opened. Only one window SHALL be held per task; confirming a different option, moving the task, or replacing its stage entry SHALL discard the previous window.

#### Scenario: Present and cancel the countdown

- **WHEN** the person confirms an option and the window is counting
- **THEN** the card and the gate present the destination and a cancel action
- **AND** canceling leaves the task in its stage and records nothing
- **AND** the gate returns to an unanswered state

#### Scenario: Reload during the window

- **WHEN** the interface is reloaded while the window is counting
- **THEN** nothing is applied and nothing is recorded
- **AND** reopening the task presents the gate unanswered

#### Scenario: Apply when the window closes

- **WHEN** the window reaches its end without canceling
- **THEN** the client submits the choice for the host to apply

#### Scenario: Replace a counting window

- **WHEN** the person confirms another option while a window is counting
- **THEN** the earlier choice is discarded and is never applied

### Requirement: Durable decision routing

When the window closes, the host SHALL apply the choice in one durable transition bound to the exact stage entry that presented the gate. The host SHALL refuse the choice when the task is no longer in that entry, when the task has an unresolved context operation or confirmed transition, when the option no longer exists, or when its destination no longer resolves to the same stable stage; a refusal SHALL change nothing, SHALL record nothing, and SHALL present the refusal so the gate can be answered again. An accepted choice SHALL place the task at the top of the option's destination stage, record a stage entry whose origin names the chosen option, record the observation with it, and, when the destination authors an entry instruction, dispatch that instruction with the choice as its transition reason as a host transition does. A scripted destination SHALL admit its own authorized execution instead of creating a conversation, and a destination with neither an instruction nor a program SHALL only move. The reason SHALL carry the option title and the observation, SHALL be bounded by the accepted transition-reason length, and SHALL NOT truncate the option title or the observation. A retry of the same choice SHALL NOT duplicate the stage entry, the history record, or the destination instruction. The host SHALL NOT keep the unanswered question on the task record: the gate is derived from the current stage and its entry.

#### Scenario: Apply an accepted choice

- **WHEN** the window closes and the task is still in the entry that presented the gate
- **THEN** the task moves to the option's destination stage and is placed at its top
- **AND** the history records the chosen option and the observation
- **AND** the gate no longer presents because the task left the stage

#### Scenario: Deliver the choice to an instructed destination

- **WHEN** the destination authors an entry instruction
- **THEN** that instruction is dispatched with the option title and the observation as its transition reason
- **AND** the destination's agent receives the reason beside its own instruction

#### Scenario: Start a scripted destination

- **WHEN** the destination authors a scripted configuration
- **THEN** its authorized execution is admitted
- **AND** no conversation is created for the choice

#### Scenario: Refuse a stale entry

- **WHEN** the task left the entry, has an unresolved context operation or confirmed transition, or the option or its captured destination no longer resolves
- **THEN** nothing is applied and nothing is recorded
- **AND** the gate presents the refusal so the choice can be answered again

#### Scenario: Refuse a retargeted destination

- **WHEN** the option points to a different stage, or its destination stage was recreated with a new stable identity, after the person saw it
- **THEN** the host refuses the choice, changes nothing, and presents the refusal so the gate can be answered again

#### Scenario: Retry without duplicating the route

- **WHEN** the same choice is submitted again after an interrupted response
- **THEN** the stage entry, the history record, and the destination instruction are not duplicated

### Requirement: The decision stage owns its routing

A stage that authors a decision configuration SHALL be the only owner of its routing. A completed turn SHALL NOT advance a task out of the stage, whether or not automatic mode is enabled, and the host SHALL NOT record an automatic-mode pause for that hold. Arriving into the stage SHALL be an ordinary placement: an automatic advance, a declared transition, a scripted result, or a manual move MAY place a task there, and the gate SHALL apply immediately, including to a card already parked in the stage when the configuration is saved. No agent SHALL declare the task's route out of the stage: an ordinary declaration and an exceptional declaration SHALL both be refused with an actionable result. A manual move out of the stage SHALL be a restricted transition: every other stage SHALL require the explicit restricted-transition confirmation before the task leaves, including a stage one of the options names. Moving a task into the stage SHALL follow the ordinary move rules.

#### Scenario: Do not advance out of the gate

- **WHEN** a conversation of a task in a decision stage completes a turn, with or without automatic mode
- **THEN** no advance is admitted
- **AND** no automatic-mode pause is recorded

#### Scenario: Stop on arrival

- **WHEN** an automatic advance, a declared transition, a scripted result, or a manual move places a task in a decision stage
- **THEN** the task stops there and the gate applies
- **AND** no entry instruction or program starts

#### Scenario: Apply to a card already parked

- **WHEN** a stage gains a decision configuration while a card sits in it
- **THEN** the gate applies to that card immediately
- **AND** the card presents the decision attention

#### Scenario: Refuse an agent declaration

- **WHEN** an agent declares the task's route out of a decision stage, with or without the exceptional flag
- **THEN** the declaration is refused with an actionable result
- **AND** the task's stage and recorded route are unchanged

#### Scenario: Confirm every manual move out

- **WHEN** a user moves a task out of a decision stage to any other stage, including one an option names
- **THEN** the board asks for the restricted-transition confirmation before moving
- **AND** the task remains in the stage until the user confirms

### Requirement: A decision is a task surface, not a conversation question

The gate SHALL NOT be presented as a structured question round, SHALL NOT create or extend a question round, and SHALL NOT modify the conversation transcript. Confirming a choice SHALL NOT send a chat message, SHALL NOT settle a native question or approval, and SHALL NOT create a decision or cancellation record beyond the recorded stage entry. The destination SHALL learn the choice through the transition reason of its stage instruction, and the task's history SHALL present the chosen option and the observation. The gate SHALL be available when the task has no conversation, and no conversation SHALL be created merely to present or answer it.

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

#### Scenario: Answer without a conversation

- **WHEN** the person answers the gate for a task with no conversation
- **THEN** the choice is applied without creating a conversation
- **AND** the destination instruction creates a conversation only if that destination authors one