# Spec Delta

## MODIFIED Requirements

### Requirement: Write validation report

Every tool that writes a board's workflow document SHALL compose the result, validate it with the same workflow semantics the board editor enforces, and persist only when validation succeeds. On refusal the tool SHALL persist nothing and return the complete report; on success it SHALL return the same report. The report SHALL carry: validation problems with the line and column of each when the composed document does not parse; a semantic per-stage difference naming changed transitions, named exits, entry instruction, placement, size, group membership, board name, initial stage, and connection layout; graph warnings covering an unreachable stage, a stage that is not a terminal one and authors no outgoing route, a connection layout entry naming a pair the workflow does not draw, a stage outside every group, and an instruction that names a stage the workflow does not define or that is not a permitted destination of that stage; for every deterministic stage the state of its stage-scoped reviewed authorization for the board, naming the executable version and the reason when it does not hold; and the affected cards by identifier and count.

The authorization state SHALL be reported once per deterministic stage for the board instead of once per project the board allows. It SHALL distinguish changed source, changed named exits or their destinations, changed environment names, a changed working-directory choice, changed declared parameter names, a version that was never approved, and a source whose primary bytes depend on the execution directory. When the primary source depends on the execution directory the report SHALL state that each resolved version needs its own approval instead of claiming a board-wide result, and it SHALL NOT report a per-card execution-directory verdict. The report SHALL NOT carry a card title, description, note, task message, or conversation content.

#### Scenario: Refuse an unparsable document and report where

- **WHEN** a write composes a document the parser refuses
- **THEN** nothing is persisted
- **AND** the report names each problem with its line and column

#### Scenario: Report a successful write

- **WHEN** a write composes a document that validates
- **THEN** the document is persisted
- **AND** the report carries the per-stage difference, the graph warnings, the authorization state, and the affected cards

#### Scenario: Report an authorization that no longer holds

- **WHEN** a write retargets a named exit of a deterministic stage the board had already approved
- **THEN** the report states, once for the board, that the stage's authorization no longer holds
- **AND** it names the changed exits and destinations as the reason

#### Scenario: Report a change of source

- **WHEN** a write changes a deterministic stage's source bytes
- **THEN** the report names the changed source as the reason its authorization no longer holds

#### Scenario: Report a version that was never approved

- **WHEN** a write introduces a deterministic stage the board never approved
- **THEN** the report states that the stage's executable version requires approval
- **AND** it does not present the version as approved because the write succeeded

#### Scenario: Report an execution directory that depends on the card

- **WHEN** a write introduces or changes a deterministic stage whose primary source resolves different bytes per execution directory
- **THEN** the report states that each resolved version needs its own approval
- **AND** it does not claim a board-wide authorization result

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
