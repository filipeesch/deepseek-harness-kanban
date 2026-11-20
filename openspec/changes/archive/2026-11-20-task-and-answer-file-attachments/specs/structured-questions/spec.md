# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: File answers on a question round

A question slide SHALL accept files attached to that question, and the round's Additional Notes slide SHALL accept files attached to the round as a whole. Files SHALL be accepted through the browser's file input and by pasting a file from the clipboard.

Every attached file SHALL be stored as a generic file attachment. The plugin SHALL NOT decode an image's dimensions, SHALL NOT produce a thumbnail, and SHALL NOT send an attached image as an image part.

A file attached to a question slide SHALL be listed on that slide with its display name and byte length, SHALL be removable before submission, and SHALL NOT by itself satisfy or invalidate that question's answer. A round SHALL remain submittable on the same conditions it had before files could be attached.

Where the round presents an attachment control, the plugin SHALL make that control reachable in every conversation that presents the round, including an ordinary DSH chat whose conversation has no task card. Attaching a file SHALL NOT require a task, and a chat without a task SHALL offer only the browser and clipboard sources.

#### Scenario: Attach a file to one question

- **WHEN** the user attaches a file to a question slide
- **THEN** that question slide lists the file with its display name and byte length
- **AND** the other question slides are unaffected

#### Scenario: Attach a file to the round

- **WHEN** the user attaches a file on the Additional Notes slide
- **THEN** the file is attached to the round as a whole
- **AND** it is listed on that slide

#### Scenario: Paste a file into a question

- **WHEN** the user pastes a file from the clipboard while a question slide is active
- **THEN** the file is attached to that question
- **AND** pasted text is not treated as a file

#### Scenario: Remove an attachment before submitting

- **WHEN** the user removes a file they attached to a question
- **THEN** the file no longer appears on that slide
- **AND** the round's submittability is unchanged

#### Scenario: Files do not change answer validity

- **WHEN** the user attaches files to a question without answering it
- **THEN** that question remains unanswered
- **AND** Submit remains unavailable on the same condition as before

#### Scenario: Attach a file in a chat without a task

- **WHEN** the user attaches a file to a question round presented in an ordinary DSH chat
- **THEN** the file can be attached through the browser and the clipboard
- **AND** no task card is required

#### Scenario: Store an attached image as a generic file

- **WHEN** the user attaches a file whose content is an image
- **THEN** it is delivered as a generic file attachment
- **AND** no thumbnail is produced for it
