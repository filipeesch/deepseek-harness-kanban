# Workflow Revisions Specification

## Purpose

Keeps a bounded, local history of each board's workflow, so an agent can see what changed between revisions, attribute a change, and restore an earlier document without reconstructing its text by hand.

## Requirements

### Requirement: Local board change log

Every write to a board's workflow document SHALL append exactly one revision to that board's local change log. A revision SHALL carry the moment it was recorded, the author, the origin, and a summary of the change, distinguishing an operator, an agent session, and the GUI from a product tool and from applying a team revision. The log SHALL be stored locally, SHALL NOT be included in anything the plugin publishes to team storage, and SHALL retain a bounded number of revisions, folding the oldest into a stored snapshot so that the most recent document is always recoverable. A refused write SHALL append nothing. Deleting a board SHALL remove its log.

The log SHALL be self-describing about its own origin and format, so that a board that never had history is distinguishable from a board whose history was lost. A log SHALL be created with a creation baseline naming the moment the board was created and the document it started from, and it SHALL carry the format version it was written in together with the format versions this installation can read. A stored record whose format version this installation cannot read SHALL be reported as unreadable and SHALL NOT be treated as an absent log.

A write that finds no log for a board that already holds a workflow document SHALL create the log with an explicit recovered-history baseline instead of recording the write as the board's first revision; the baseline SHALL name the moment it was recovered and the document history starts from. On startup the installation SHALL compare each board's log head with the stored workflow document and, when they differ, append a recovery revision that names its origin, so a log never continues from a document it no longer describes. A recording failure SHALL be reported and SHALL NOT roll back the write it describes.

A revision's sequence SHALL be a monotonically increasing number that is never reused and never renumbered. Folding the oldest revisions into the stored snapshot SHALL NOT change the sequence of a retained revision, and the snapshot SHALL NOT become a revision a caller may list, compare, or restore.

#### Scenario: Record a write made by a tool

- **WHEN** a product tool writes a board's workflow
- **THEN** the board's log gains one revision
- **AND** it names the moment, the calling session as author, the tool as origin, and a summary of the change

#### Scenario: Record a write made in the GUI

- **WHEN** the board editor saves a workflow change
- **THEN** the log gains one revision naming the operator as author and the editor as origin

#### Scenario: Record a write that applied a team revision

- **WHEN** the board applies a workflow it received from team storage
- **THEN** the log gains one revision naming that origin

#### Scenario: Record no revision for a refused write

- **WHEN** a board write is refused
- **THEN** the log gains no revision
- **AND** the stored workflow is unchanged

#### Scenario: Distinguish a new board from a lost history

- **WHEN** a board's log is absent and the board already holds a workflow document
- **THEN** the log is created with a recovered-history baseline
- **AND** the baseline states that history starts at that recovery and not at the board's creation

#### Scenario: Reconcile a log that no longer describes the board

- **WHEN** the installation starts and a board's log head differs from the stored workflow document
- **THEN** a recovery revision naming that origin is appended
- **AND** reading the log afterwards reproduces the stored document

#### Scenario: Report an unreadable log instead of an absent one

- **WHEN** a stored revision record was written in a format version this installation cannot read
- **THEN** the result reports the record as unreadable
- **AND** the installation does not present the board as having no history

#### Scenario: Keep the history bounded

- **WHEN** a board exceeds the retained number of revisions
- **THEN** the oldest revisions leave the list and their changes are folded into the stored snapshot
- **AND** the most recent documents remain recoverable

#### Scenario: Keep revision identity across folding

- **WHEN** a board exceeds the retained number of revisions
- **THEN** the oldest revisions leave the list and their changes are folded into the stored snapshot
- **AND** every retained revision keeps the sequence it was listed with
- **AND** the most recent documents remain recoverable

#### Scenario: Keep the history local

- **WHEN** the board is published to a team storage
- **THEN** the published content carries no revision log, author, or change summary

#### Scenario: Remove the log with the board

- **WHEN** a board is deleted
- **THEN** its revision log is removed with it

### Requirement: Revision listing

`list_board_revisions` SHALL return a board's revisions newest first, accepting a number of revisions to return and a continuation for older ones. Each revision SHALL name its sequence, its moment, its author, its origin, and a summary of the change, and the result SHALL state how many older revisions are no longer retained. The result SHALL state whether the board's history starts at its creation or at a recovery, together with the moment history starts. The result SHALL NOT carry the workflow document.

#### Scenario: List the most recent revisions

- **WHEN** an agent asks for the most recent revisions of a board
- **THEN** the result names them newest first with their moment, author, origin, and summary
- **AND** it carries no workflow document

#### Scenario: Continue with older revisions

- **WHEN** an agent asks for more revisions than the first result returned
- **THEN** the continuation returns the next older revisions without a gap or a repeat

#### Scenario: Report a board that was never edited

- **WHEN** an agent asks for revisions of a board with no recorded change
- **THEN** the result reports that no revision was recorded

#### Scenario: Report the retained boundary

- **WHEN** older revisions were folded out of the log
- **THEN** the result states how many older revisions it no longer holds

#### Scenario: Report where history starts

- **WHEN** an agent lists revisions of a board whose log was recovered after its creation
- **THEN** the result states that history starts at that recovery and names its moment
- **AND** it does not present the earliest listed revision as the board's creation

### Requirement: Revision comparison

`diff_board_revisions` SHALL compare two revisions the board still retains and report the semantic difference in the same shape the write report uses, covering added and removed stages, changed transitions, changed named exits, a changed entry instruction, changed placement and size, changed group membership, a changed connection layout, a changed board name, and a changed initial stage. It SHALL reject a revision the board no longer retains without changing the board.

#### Scenario: Compare two revisions

- **WHEN** an agent compares two retained revisions
- **THEN** the result names each stage whose fields changed and what changed
- **AND** it names the stages added and removed between them

#### Scenario: Compare a revision with itself

- **WHEN** an agent compares a revision with the same revision
- **THEN** the result reports no difference

#### Scenario: Reject a revision that is not retained

- **WHEN** an agent compares a revision the board no longer holds
- **THEN** the tool reports that the revision is not retained
- **AND** the board is unchanged

### Requirement: Revert a board to a revision

`revert_board` SHALL restore the workflow document of a retained revision by saving it as a new revision through the validated write path, and SHALL return that path's report. It SHALL require explicit confirmation and the Hub revision the caller observed, and SHALL refuse without changing the document when confirmation is absent, when the observed Hub revision is stale, or when the restored document would leave cards in a stage it removes. The restored revision SHALL be recorded as a new revision naming the caller as author, and the revision it restored SHALL remain listed.

#### Scenario: Restore an earlier document

- **WHEN** an agent reverts a board to a retained revision with confirmation
- **THEN** the board's stored document equals that revision's document
- **AND** the log gains a new revision naming the caller as author
- **AND** the restored revision remains listed

#### Scenario: Refuse a revert that would strand cards

- **WHEN** the restored document removes a stage that holds cards
- **THEN** the revert is refused and the document is unchanged
- **AND** the refusal names the affected cards by identifier and count
- **AND** it carries no card title or description

#### Scenario: Require confirmation

- **WHEN** an agent reverts a board without confirming
- **THEN** the revert is refused and the document is unchanged

#### Scenario: Reject a stale Hub revision

- **WHEN** an agent reverts a board with a Hub revision the board no longer reports
- **THEN** the revert is refused and the document is unchanged

#### Scenario: Report the same impact as any other write

- **WHEN** a revert succeeds
- **THEN** its result carries the per-stage difference, the graph warnings, the authorization state, and the affected cards
