# Workflow Transfer Specification

## Purpose

Move a chosen set of a Hub's boards to another Hub or installation as one compressed document, and apply such a document into a Hub while resolving name conflicts and preserving card placement.

## Requirements

### Requirement: Export a chosen set of boards as one document

Export SHALL be reachable from the Boards section of the configuration dialog for the active Hub. Export SHALL let the person choose any subset of that Hub's boards and SHALL export exactly the chosen subset. Export SHALL produce one document that compresses its JSON payload with gzip and SHALL offer it to the browser as a download; export SHALL NOT write a file anywhere on the host, SHALL NOT modify any board, task, note, project, or Hub revision, and SHALL NOT publish a board. Exporting an empty selection SHALL be refused with an actionable problem instead of producing a document.

The document SHALL carry a format version, the name of the Hub it came from, and one entry per exported board. Each board entry SHALL carry the board's name, its authored workflow YAML character for character, its recorded default-preset choice, its project scope, and its local stage identities. The document SHALL NOT carry tasks, notes, conversations, worktrees, project registrations, schedules, relations, or Hub settings.

The same selection exported from the same Hub state SHALL produce the same payload, so two exports of an unchanged Hub can be compared byte for byte.

A board whose workflow authors a scripted stage with an external file reference SHALL be exported and SHALL be reported as an advisory, because the exported document carries the reference and not the file's bytes.

#### Scenario: Export a subset of the Hub's boards

- **WHEN** the person chooses Export, selects two of the Hub's four boards, and confirms
- **THEN** one compressed document is downloaded containing exactly those two boards
- **AND** the other two boards are absent from the document

#### Scenario: Export changes nothing

- **WHEN** an export completes
- **THEN** every board's authored YAML, every task, and the Hub revision are unchanged
- **AND** no revision is recorded and no board is published

#### Scenario: Refuse an empty selection

- **WHEN** the person confirms an export with no board selected
- **THEN** no document is produced and the surface reports that at least one board is required

#### Scenario: Report an external script source

- **WHEN** an exported board authors a scripted stage whose program is an external file reference
- **THEN** the board is included in the document
- **AND** the export result names that board as carrying a reference the document cannot transport

#### Scenario: Reproduce the same document twice

- **WHEN** the same boards are exported twice from an unchanged Hub
- **THEN** both documents carry identical bytes

### Requirement: Read an import file and state what each board would do

Import SHALL be reachable from the Boards section of the configuration dialog for the active Hub. Reading an import file SHALL accept a gzip-compressed document and SHALL report, for each board it carries, the destination that board would take in the active Hub: a new board, a replacement of a named existing board, a copy under a proposed free name, a skipped entry, or a blocked entry with its reason.

Reading an import file SHALL NOT modify any board, task, or Hub revision. A document that cannot be read SHALL be refused with an actionable problem that distinguishes a document that is not gzip-compressed, a document that is not valid JSON, a document whose format version this installation does not understand, a document whose payload fails its schema, and a document that carries no board entry. A single unreadable board entry SHALL block that board and SHALL NOT fail the read of the boards that are readable.

A compressed document larger than 4 MB SHALL be refused before its content is read, and the problem SHALL state the accepted limit and the observed size.

#### Scenario: Report the plan for a readable file

- **WHEN** the person chooses Import and picks a document carrying three boards, one whose name is free and two whose names already exist in the Hub
- **THEN** the surface states one new board and two conflicts, together with the existing board each conflict would replace
- **AND** no board is created, replaced, or modified

#### Scenario: Refuse an oversized file

- **WHEN** the person picks a compressed document larger than 4 MB
- **THEN** the surface refuses it before reading its content
- **AND** the problem names the accepted limit and the observed size

#### Scenario: Refuse an unreadable file

- **WHEN** the person picks a file that is not gzip-compressed, not JSON, carries an unsupported format version, or fails its schema
- **THEN** the surface reports which of those conditions applies
- **AND** no board is created, replaced, or modified

#### Scenario: Block one board without failing the read

- **WHEN** a document carries one board entry whose workflow cannot be parsed and other readable entries
- **THEN** the unreadable entry is reported as blocked with its reason
- **AND** the readable entries still report their destinations

### Requirement: Settle each name conflict with one policy and a per-board override

A conflict SHALL exist when an imported board's name matches an existing board of the active Hub after trimming and compared case-insensitively. The import surface SHALL offer one policy applied to every conflict: **Replace**, which overwrites the existing board's workflow, **Create a copy**, which adds a board under a free name, or **Skip**, which leaves the existing board untouched. The surface SHALL further let the person override that policy for any individual conflict.

Choosing **Create a copy** SHALL propose a free name derived from the imported name, appending a suffix and then a number until no board of the Hub holds it, and SHALL let the person edit the proposed name. A name that matches an existing board, a name emptied after trimming, and two copies proposed under the same name SHALL each prevent applying until resolved, and the surface SHALL name the offending entry.

Each board the person marks as **Skip** SHALL be reported as skipped, and no board of the Hub SHALL change because of it.

#### Scenario: Replace every conflict with one choice

- **WHEN** the person chooses Replace and applies a document with two conflicts
- **THEN** both existing boards receive the imported workflow
- **AND** no board is created

#### Scenario: Create a copy for one conflict

- **WHEN** the person chooses Replace for the conflicts and overrides one conflict as Create a copy
- **THEN** the overridden conflict adds a board under its proposed free name
- **AND** the other conflict replaces its existing board

#### Scenario: Propose a free name

- **WHEN** a conflict is settled as Create a copy and a board already holds the proposed name
- **THEN** the surface proposes the next free name and presents it as editable

#### Scenario: Refuse a duplicate copy name

- **WHEN** two copies are configured under the same name, or a copy name is set to an existing board's name
- **THEN** applying is unavailable and the surface names the offending entry

#### Scenario: Skip a conflict

- **WHEN** the person settles a conflict as Skip and applies
- **THEN** the existing board is unchanged
- **AND** the result reports that board as skipped

### Requirement: Applying an import preserves card placement

Applying an import SHALL create every board whose name is free and whose entry is not skipped, replace the workflow and name of every board settled as Replace, and create every board settled as Create a copy under its chosen name. Each created board SHALL carry the imported authored workflow YAML, its recorded default-preset choice, and its project scope, and each replaced board SHALL take the imported authored workflow YAML and its recorded default-preset choice. Applying SHALL record a revision for every board whose workflow it writes, through the same revision log an ordinary board workflow write records into.

Replacing a board's workflow SHALL keep every card in the stage it already occupies. A stage identifier the incoming workflow does not define SHALL be resolved through the card's stage identity: when an incoming stage carries the identity the card's stage held, the card SHALL be moved to that stage and its recorded stage facts SHALL follow, so a renamed stage does not lose its cards. When no incoming stage carries that identity, the board SHALL be blocked and SHALL NOT be written, and the result SHALL name the stage, the number of cards it holds, and the reason.

The import SHALL NOT move a card out of a stage the incoming workflow still defines, SHALL NOT delete a card, SHALL NOT delete a board, and SHALL NOT create, replace, or modify any board settled as Skip.

#### Scenario: Create a board whose name is free

- **WHEN** an entry whose name is free is applied
- **THEN** a board with that name and the imported workflow exists in the Hub
- **AND** it carries the imported default-preset choice and project scope

#### Scenario: Replace a workflow and keep every card

- **WHEN** an entry settled as Replace carries a workflow that defines every stage the existing board's cards occupy
- **THEN** the board takes the imported workflow
- **AND** every card stays in its stage
- **AND** a revision is recorded for the write

#### Scenario: Realign a card whose stage was renamed

- **WHEN** an entry settled as Replace renames a stage while carrying the same stage identity
- **THEN** that board's cards move to the renamed stage
- **AND** the board is written

#### Scenario: Block a board whose stage would be lost

- **WHEN** an entry settled as Replace carries a workflow that no longer defines a stage holding cards and no incoming stage carries that stage's identity
- **THEN** that board is not written
- **AND** the result names the stage and the number of cards blocking it
- **AND** every other applicable board is still applied

#### Scenario: Leave a skipped entry alone

- **WHEN** an entry settled as Skip is applied
- **THEN** no board is created, replaced, or modified for that entry

### Requirement: Apply what can be applied and report the rest

Applying an import SHALL NOT be atomic across the document. Each board SHALL be applied independently, a board that fails SHALL NOT prevent another board from being applied, and the result SHALL report every entry as created, replaced, skipped, or failed, naming the reason for each failure. A Hub can therefore hold part of a document after an import, and the result SHALL be the statement of what landed.

Applying SHALL require a confirmation initiated by the person in the import surface; no automatic action, agent tool, or scheduled check SHALL apply an import.

#### Scenario: Apply the boards that pass

- **WHEN** a document carries three entries and one is blocked by a lost stage
- **THEN** the other two are applied
- **AND** the result reports one failure naming the blocked board and its reason

#### Scenario: Report every outcome

- **WHEN** an import finishes
- **THEN** the result lists each entry as created, replaced, skipped, or failed
- **AND** the Boards section list reflects the boards that were created or replaced

### Requirement: Align an imported project scope with the destination Hub

An imported board's project scope SHALL be aligned with the active Hub. A scope entry naming a project key the destination Hub does not hold SHALL be dropped, and the result SHALL name the dropped entries. A scope left with no entries after dropping SHALL accept every project of the destination Hub, and that SHALL be reported. A board entry with no recorded scope SHALL continue to accept every project of the destination Hub.

#### Scenario: Drop an unknown project key

- **WHEN** an imported board's scope names one key the destination Hub holds and one it does not
- **THEN** the board keeps only the known key
- **AND** the result names the dropped key

#### Scenario: Open a scope emptied by filtering

- **WHEN** every entry of an imported board's scope is dropped
- **THEN** the board accepts every project of the destination Hub
- **AND** the result states that its scope was opened

#### Scenario: Import a board with no recorded scope

- **WHEN** an imported board carries no project scope
- **THEN** the board accepts every project of the destination Hub
