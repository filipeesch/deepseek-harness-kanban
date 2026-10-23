# Spec Delta

## ADDED Requirements

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
