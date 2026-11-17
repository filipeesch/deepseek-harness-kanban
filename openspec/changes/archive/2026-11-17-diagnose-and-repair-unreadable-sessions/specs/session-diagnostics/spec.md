# Spec Delta

## Purpose

Diagnoses a task conversation whose durable Session log cannot be observed, presents that diagnosis wherever the conversation is rendered, and offers a bounded repair for the one corruption class the product can rewrite safely.

## ADDED Requirements

### Requirement: Classification of an unobservable Session

The plugin SHALL classify each failed Session observation into a diagnostic state instead of discarding the failure. It SHALL distinguish a durable log that cannot be read from a durable log that does not exist, and it SHALL distinguish both from a task that has no conversation. A failed observation SHALL NOT be presented as an idle conversation, and it SHALL NOT be counted as a successfully observed conversation by any feature that consumes conversation facts.

#### Scenario: Report an unreadable durable log

- **WHEN** observing a task conversation's Session fails because the stored log cannot be validated
- **THEN** the plugin classifies that conversation as unreadable
- **AND** it does not present the conversation as idle

#### Scenario: Report a missing durable log

- **WHEN** a task records a conversation whose durable log does not exist
- **THEN** the plugin classifies that conversation as missing
- **AND** it does not classify it as unreadable

#### Scenario: Report nothing for a task without a conversation

- **WHEN** a task has no conversation
- **THEN** the plugin presents no diagnostic for that task
- **AND** it does not conflate the absence of a conversation with an unobservable Session

#### Scenario: Report nothing for an observed conversation

- **WHEN** observing a task conversation's Session succeeds
- **THEN** the plugin presents no diagnostic for that conversation

### Requirement: Diagnostic content

A diagnosis SHALL name the classified state, the Session identity, and the cause the host reported. When the durable artifact exists, the diagnosis SHALL also present the artifact's location. The location SHALL be resolved from storage metadata without reading or modifying log contents. A diagnosis for a missing log SHALL NOT present a location.

#### Scenario: Present the cause and the location

- **WHEN** a conversation is classified as unreadable and its durable artifact exists
- **THEN** the diagnosis presents the host's cause, the Session identity, and the artifact location
- **AND** it resolves the location without reading the log contents

#### Scenario: Omit the location for a missing log

- **WHEN** a conversation is classified as missing
- **THEN** the diagnosis presents the Session identity and no artifact location

#### Scenario: Preserve the host's cause

- **WHEN** the host reports a readable cause for the failed observation
- **THEN** the diagnosis preserves that cause verbatim rather than replacing it with a generic failure message

### Requirement: Diagnosis on the task card

The board SHALL present the diagnosis in the task card's status region as a failure-toned status naming the state. A card carrying that status SHALL remain listable, movable, and editable. The status SHALL clear when a later observation of that conversation succeeds.

#### Scenario: Present the status on the card

- **WHEN** a card's conversation is classified as unreadable or missing
- **THEN** the card's status region presents a failure-toned status naming the state

#### Scenario: Keep the card usable

- **WHEN** a card presents the status
- **THEN** the card remains listable, movable, and editable

#### Scenario: Clear the status after a successful observation

- **WHEN** the conversation is observed successfully after the repair or an explicit recheck
- **THEN** the card no longer presents the status

### Requirement: Diagnosis in every native conversation

The plugin SHALL present the diagnosis inside every native conversation whose opening failed with a classified Session error, through a session-scoped contribution to the host conversation, so that one presentation serves the task drawer and ordinary DSH chats outside the board. The contribution SHALL NOT replace the native conversation shell, and it SHALL NOT add a second message about the same failure.

#### Scenario: Diagnose a task conversation in the drawer

- **WHEN** the drawer's native conversation fails to open with a classified Session error
- **THEN** the drawer presents the diagnosis in that conversation
- **AND** the conversation's close action remains available

#### Scenario: Diagnose an ordinary DSH chat

- **WHEN** an ordinary DSH conversation outside the board fails to open with a classified Session error
- **THEN** the same diagnosis is presented in that conversation

#### Scenario: Keep the native shell

- **WHEN** the diagnosis is presented
- **THEN** the native conversation window, its header, and its composer remain the host's own
- **AND** the plugin does not substitute a replacement conversation surface

#### Scenario: Present one message

- **WHEN** a conversation fails to open with a classified Session error
- **THEN** the plugin presents the diagnosis and no additional plugin-owned message about the same failure
- **AND** it does not instruct the person to close and reopen the conversation as a remedy

### Requirement: Read-only diagnosis

Classification, presentation, and recheck SHALL NOT write to Session storage. The only plugin-owned write to a Session artifact SHALL be the repair defined by this capability.

#### Scenario: Diagnosis does not write

- **WHEN** a conversation is classified, diagnosed, and rechecked
- **THEN** no Session artifact is modified
- **AND** a test proves that the artifact's revision is unchanged across those actions

### Requirement: Sending blocked while the board stays usable

The plugin SHALL refuse its own send paths into a conversation classified as unobservable — the card run action and stage-instruction delivery — and SHALL present the diagnosis as the reason. The native composer is the host's own surface and SHALL NOT be gated by the plugin. Every other board action SHALL continue to work.

#### Scenario: Refuse a plugin send

- **WHEN** the card run action targets a conversation classified as unobservable
- **THEN** the action is refused with the diagnosis as the reason
- **AND** no Session artifact is modified

#### Scenario: Leave the native composer to the host

- **WHEN** the person sends through the host's own composer in a conversation classified as unobservable
- **THEN** the plugin does not intercept the send
- **AND** the diagnosis remains presented

#### Scenario: Keep the remaining actions

- **WHEN** a card's conversation is classified as unobservable
- **THEN** moving the card, editing its text, and deleting it remain available

### Requirement: Re-evaluation without a restart

The plugin SHALL record a failed observation on its first failure rather than after a retry allowance, and SHALL clear the record when a later observation of the same conversation succeeds. An explicit recheck SHALL re-observe the conversation without restarting the plugin, and no record SHALL survive a successful observation.

#### Scenario: Record the first failure

- **WHEN** observing a conversation fails once
- **THEN** the diagnosis is recorded immediately
- **AND** the conversation is not re-observed on a retry allowance before the diagnosis appears

#### Scenario: Clear after an explicit recheck

- **WHEN** the person activates the recheck action after the artifact was repaired
- **THEN** the conversation is observed successfully
- **AND** the diagnosis clears without restarting the plugin

#### Scenario: Clear after a Session event

- **WHEN** a later event or snapshot re-observes the conversation successfully
- **THEN** the diagnosis clears

### Requirement: Repair of a repeated PTC dispatch identifier

The repair SHALL rename only colliding PTC dispatch identifiers: the first recorded occurrence SHALL keep its identifier, each later colliding occurrence SHALL receive a new identifier continuing past the highest sequence already used for the same root call, and only records referencing a renamed identifier SHALL change. The repair SHALL preserve the number and order of records, so event sequence numbers, projections, and read watermarks remain valid. It SHALL NOT remove, reorder, or rewrite any other record.

#### Scenario: Rename the colliding occurrence only

- **WHEN** two started dispatches record the same PTC identifier
- **THEN** the first retains its identifier and the later receives a new one
- **AND** the new identifier continues the sequence for the same root call

#### Scenario: Preserve record count and order

- **WHEN** the repair rewrites an artifact
- **THEN** the number and order of records are unchanged
- **AND** event sequence numbers remain valid for projections and read state

#### Scenario: Leave unrelated records alone

- **WHEN** a record does not reference a renamed identifier
- **THEN** that record is unchanged

### Requirement: Repair confirmation and safety

The repair SHALL require an explicit confirmation before writing. It SHALL refuse when the artifact has a torn final frame, when the conversation is live in the running host, or when the artifact changed after it was read. It SHALL write the rewritten artifact to a temporary location, validate it before replacing the original, replace the original atomically, and retain a backup of the original. If the conversation still cannot be observed after the replacement, it SHALL restore the original and report the failure. The repair SHALL be offered only for the unreadable state, never for a missing log.

#### Scenario: Require confirmation

- **WHEN** the person activates the repair
- **THEN** the plugin asks for confirmation before writing anything
- **AND** declining writes nothing

#### Scenario: Refuse a damaged artifact

- **WHEN** the artifact ends in a torn frame
- **THEN** the repair is refused
- **AND** the artifact is unchanged

#### Scenario: Refuse a concurrent change

- **WHEN** the artifact changed after it was read for repair
- **THEN** the repair is refused
- **AND** the artifact is unchanged

#### Scenario: Refuse a live conversation

- **WHEN** the conversation is live in the running host
- **THEN** the repair is refused

#### Scenario: Replace atomically and keep a backup

- **WHEN** the repair succeeds
- **THEN** the validated artifact replaces the original atomically
- **AND** a backup of the original is retained

#### Scenario: Restore the original on failure

- **WHEN** the conversation still cannot be observed after the replacement
- **THEN** the original artifact is restored
- **AND** the failure reason is presented in the diagnosis

#### Scenario: Offer no repair for a missing log

- **WHEN** a conversation is classified as missing
- **THEN** no repair action is offered
