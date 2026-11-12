# Spec Delta

## Purpose

Lets an agent read one board's exact workflow document and the authored block of a single stage, author targeted workflow changes without matching whole-document text, and learn from one report what a write changed and what it requires.

## ADDED Requirements

### Requirement: Exact workflow document read

`get_board_yaml` SHALL return a board's stored workflow document exactly as authored, character for character, including comments, key order, quoting, and blank lines, together with the Hub revision a later write must quote. It SHALL accept a line offset and a line limit, SHALL report the total line count, and SHALL report the offset that continues the read while lines remain. It SHALL report a filesystem path holding the exact document, so ordinary file reading and searching can reach the same text. The tool SHALL NOT parse, normalize, or re-serialize the document, SHALL NOT change the board, and SHALL reject a board it cannot find.

#### Scenario: Read the exact document

- **WHEN** an agent reads a board's workflow document
- **THEN** the returned text equals the stored text character for character, including comments and blank lines
- **AND** the result carries the Hub revision the board currently reports

#### Scenario: Continue a paged read

- **WHEN** an agent reads a range of lines short of the whole document
- **THEN** the result carries that range, the total line count, and the offset that continues the document
- **AND** reading from that offset returns the following lines without a gap or a repeat

#### Scenario: Reach the same text through file tooling

- **WHEN** an agent reads the reported path with the standard file tooling
- **THEN** its content is the same text the tool returned

#### Scenario: Reading changes nothing

- **WHEN** an agent reads a board's workflow document
- **THEN** the board's stored text and Hub revision are unchanged
- **AND** no revision is recorded for the read

#### Scenario: Reject an unknown board

- **WHEN** an agent reads the workflow document of a board that does not exist
- **THEN** the tool reports that the board does not exist
- **AND** no document text is returned

### Requirement: Single-stage read

`get_stage` SHALL return the authored block of one stage of a board's workflow exactly as written, covering its identifier, label, entry instruction, transition list, deterministic configuration, placement, and size, together with the Hub revision the board reports. Script source SHALL be withheld by default and represented by its byte length and a stable digest of those bytes; an explicit request SHALL return the authored source instead. Everything outside the source SHALL stay character for character as authored. The tool SHALL reject a stage the workflow does not define, without changing the board.

#### Scenario: Withhold script source by default

- **WHEN** an agent reads a deterministic stage without asking for its source
- **THEN** the returned block carries a byte length and a digest in place of the source
- **AND** it carries the authored exits, environment names, parameter declarations, and directory choice

#### Scenario: Return the authored source on request

- **WHEN** an agent reads a deterministic stage and asks for its source
- **THEN** the returned block carries the authored source exactly as stored

#### Scenario: Preserve the authored block

- **WHEN** an agent reads a stage whose authored text uses comments, quoting, or a flow list
- **THEN** the returned block carries that text character for character

#### Scenario: Reject an unknown stage

- **WHEN** an agent reads a stage identifier the board's workflow does not define
- **THEN** the tool reports that the stage does not exist
- **AND** no stage text is returned

### Requirement: Structured stage writes

The plugin SHALL expose `set_stage_prompt`, `set_stage_routes`, and `set_layout`. Each SHALL accept an optional expected Hub revision and SHALL reject a stale revision without changing the board. Each SHALL rewrite only the fields it names and SHALL preserve every other authored character of the document, including comments, key order, quoting, blank lines, and the text of stages it does not name. `set_stage_prompt` SHALL set or clear one stage's entry instruction. `set_stage_routes` SHALL replace one stage's transition list, SHALL distinguish an empty list, which permits no destination, from an omitted list, which permits any other stage, and SHALL replace a deterministic stage's named exits with their destinations without changing its source, environment names, parameter declarations, or directory choice. `set_layout` SHALL set stage placements, stage sizes, and connection layouts, including their anchors and segment displacements, and SHALL remove a placement, size, or connection entry that the call clears.

#### Scenario: Set a stage instruction

- **WHEN** an agent sets one stage's entry instruction
- **THEN** that stage authors the instruction and every other authored character is unchanged

#### Scenario: Clear a stage instruction

- **WHEN** an agent clears a stage's entry instruction
- **THEN** that stage authors no instruction and the rest of the document is unchanged

#### Scenario: Author a stage that permits no destination

- **WHEN** an agent replaces a stage's routes with an empty list
- **THEN** that stage authors an empty transition list

#### Scenario: Author a stage that permits any destination

- **WHEN** an agent removes a stage's transition list
- **THEN** that stage authors no transition list

#### Scenario: Retarget a named exit

- **WHEN** an agent replaces a deterministic stage's named exits
- **THEN** each exit names its new destination
- **AND** the stage's source, environment names, parameter declarations, and directory choice are unchanged

#### Scenario: Reject a destination that is not a stage

- **WHEN** an agent names a transition or exit destination the workflow does not define
- **THEN** the write is refused and the board is unchanged

#### Scenario: Set placements, sizes, and connection layouts

- **WHEN** an agent sets stage placements and sizes and connection anchors and segments
- **THEN** the document authors those values on the named stages and connections
- **AND** entries the call omits keep their authored values

#### Scenario: Clear a connection layout

- **WHEN** an agent clears a connection's layout
- **THEN** the workflow authors no layout entry for that pair

#### Scenario: Preserve comments around a field

- **WHEN** an agent rewrites one field of a document that carries a comment beside it
- **THEN** the comment and every other unrelated character remain

#### Scenario: Reject a stale revision

- **WHEN** an agent writes with a Hub revision the board no longer reports
- **THEN** the write is refused and the document is unchanged

### Requirement: Add and remove a stage

`add_stage` SHALL insert one stage into the authored document after a named stage or at the end of the stage sequence, preserving the rest of the document, and SHALL reject a block the parser refuses, an identifier the workflow already defines, and a neighbour that does not exist. `remove_stage` SHALL remove one stage together with every authored reference to it in the same write, including transition targets authored by other stages, membership in groups, and connection layout entries that name it, and SHALL refuse without changing the document when the stage still holds cards, when the stage is the workflow's initial stage and no replacement is named, or when confirmation is absent. A refusal SHALL name what blocked it, using stage identifiers, card identifiers, and counts, and SHALL NOT include a card title, description, note, task message, or conversation content.

#### Scenario: Insert a stage after a named stage

- **WHEN** an agent adds a stage after another stage
- **THEN** the new stage appears after it in the authored stage sequence
- **AND** every other authored character is unchanged

#### Scenario: Append a stage at the end

- **WHEN** an agent adds a stage without naming a neighbour
- **THEN** the new stage appears at the end of the authored stage sequence

#### Scenario: Reject a duplicate identifier

- **WHEN** an agent adds a stage whose identifier the workflow already defines
- **THEN** the write is refused and the board is unchanged

#### Scenario: Remove a stage and its references

- **WHEN** an agent removes a stage that other stages name as a destination and that a group and a connection layout entry name
- **THEN** the stage is gone, each transition that named it is gone, and the group and connection layout entry no longer name it
- **AND** the rest of the document is unchanged

#### Scenario: Refuse to remove a stage holding cards

- **WHEN** an agent removes a stage that holds cards
- **THEN** the write is refused and the board is unchanged
- **AND** the refusal names the number of cards and their identifiers
- **AND** it carries no card title or description

#### Scenario: Refuse to remove the initial stage without a replacement

- **WHEN** an agent removes the workflow's initial stage without naming a replacement initial stage
- **THEN** the write is refused and the board is unchanged

#### Scenario: Require confirmation

- **WHEN** an agent removes a stage without confirming the removal
- **THEN** the write is refused and the board is unchanged

### Requirement: Write validation report

Every tool that writes a board's workflow document SHALL compose the result, validate it with the same workflow semantics the board editor enforces, and persist only when validation succeeds. On refusal the tool SHALL persist nothing and return the complete report; on success it SHALL return the same report. The report SHALL carry: validation problems with the line and column of each when the composed document does not parse; a semantic per-stage difference naming changed transitions, named exits, entry instruction, placement, size, group membership, board name, initial stage, and connection layout; graph warnings covering an unreachable stage, a stage that is not a terminal one and authors no outgoing route, a connection layout entry naming a pair the workflow does not draw, a stage outside every group, and an instruction that names a stage the workflow does not define or that is not a permitted destination of that stage; for every deterministic stage the state of its reviewed authorization in each project the board allows, naming the reason when it no longer holds; and the affected cards by identifier and count.

The authorization state SHALL distinguish changed source, changed named exits or their destinations, changed environment names, a changed working-directory choice, and a changed execution directory. For a stage scoped to the task directory it SHALL report that the execution directory depends on the card's worktree instead of claiming a project-wide result. The report SHALL NOT carry a card title, description, note, task message, or conversation content.

#### Scenario: Refuse an unparsable document and report where

- **WHEN** a write composes a document the parser refuses
- **THEN** nothing is persisted
- **AND** the report names each problem with its line and column

#### Scenario: Report a successful write

- **WHEN** a write composes a document that validates
- **THEN** the document is persisted
- **AND** the report carries the per-stage difference, the graph warnings, the authorization state, and the affected cards

#### Scenario: Report an authorization that no longer holds

- **WHEN** a write retargets a named exit of a deterministic stage the board had already authorized
- **THEN** the report states, for each project the board allows, that the authorization no longer holds for that stage
- **AND** it names the changed exits and destinations as the reason

#### Scenario: Report a change of source

- **WHEN** a write changes a deterministic stage's source bytes
- **THEN** the report names the changed source as the reason its authorization no longer holds

#### Scenario: Report an execution directory that depends on the card

- **WHEN** a write changes a deterministic stage scoped to the task directory
- **THEN** the report states that the execution directory depends on the card's worktree
- **AND** it does not claim a project-wide result

#### Scenario: Report a connection layout the diagram ignores

- **WHEN** a composed document authors a connection layout whose pair the workflow does not draw
- **THEN** the report warns that the entry is not drawn
- **AND** the write still succeeds when nothing else is wrong

#### Scenario: Report an instruction that names an unreachable stage

- **WHEN** a composed document's stage instruction names a stage that is not a permitted destination of that stage
- **THEN** the report warns about that instruction
- **AND** it names the stage that authors it

#### Scenario: Report affected cards without their text

- **WHEN** a write removes a stage or a route that cards depend on
- **THEN** the report names those cards by identifier and count
- **AND** it carries no card title, description, note, task message, or conversation content
