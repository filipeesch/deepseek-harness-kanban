# Spec Delta

## MODIFIED Requirements

### Requirement: Write validation report

Every tool that writes a board's workflow document SHALL compose the result, validate it with the same workflow semantics the board editor enforces, and persist only when validation succeeds. On refusal the tool SHALL persist nothing and return the complete report; on success it SHALL return the same report. The report SHALL carry: validation problems with the line and column of each when the composed document does not parse; a semantic per-stage difference naming changed transitions, named exits, entry instruction, placement, size, group membership, board name, initial stage, and connection layout; graph warnings; for every scripted stage the state of its stage-scoped reviewed authorization for the board, naming the executable version and the reason when it does not hold; the affected cards by identifier and count; and the instruction size of every stage whose instruction changed.

The graph warnings SHALL cover an unreachable stage, a stage that is not a terminal one and authors no outgoing route, a connection layout entry naming a pair the workflow does not draw, a stage outside every group, an instruction that cites a stage the workflow does not define, an instruction that cites a stage the stage does not permit, and an instruction that mentions a stage identifier only in prose. A citation SHALL be an identifier written between backticks, or an identifier the workflow defines that follows one of the authored citation phrases. A bare word after a citing phrase that the workflow does not define, and any plain prose token that happens to equal a stage identifier, SHALL be reported as an informational observation, distinguishable from a citation problem, and SHALL NOT be counted as a routing defect.

The report SHALL also carry cross-stage observations: a destination stage that declares a parameter its origin stage's instruction never names, naming the origin stage, the destination stage, and each unnamed parameter; and a card parked in a stage that declares parameters for which that card holds no value, naming the cards by identifier and the missing parameter names; and a TypeScript scripted stage whose program reads a parameter its declaration never names, naming the stage and each undeclared name without reporting a routing defect. A parameter value SHALL NOT appear in the report.

A composition that refuses its own edit SHALL contribute the failing edit index, the occurrence lines and stages, and the closest authored line to the report's problems, so a caller that reads only the report still sees where it failed. The report SHALL group and de-duplicate its warnings so a repeated fact about the same stage and the same reference appears once, and SHALL bound every listed group and count what it left out.

The authorization state SHALL be reported once per scripted stage for the board instead of once per project the board allows. It SHALL distinguish changed source, changed named exits or their destinations, changed environment names, a changed working-directory choice, changed declared parameter names, a version that was never approved, and a source whose primary bytes depend on the execution directory. When the primary source depends on the execution directory the report SHALL state that each resolved version needs its own approval instead of claiming a board-wide result, and it SHALL NOT report a per-card execution-directory verdict. The report SHALL NOT carry a card title, description, note, task message, or conversation content.

#### Scenario: Refuse an unparsable document and report where

- **WHEN** a write composes a document the parser refuses
- **THEN** nothing is persisted
- **AND** the report names each problem with its line and column

#### Scenario: Report a successful write

- **WHEN** a write composes a document that validates
- **THEN** the document is persisted
- **AND** the report carries the per-stage difference, the graph warnings, the authorization state, and the affected cards

#### Scenario: Report an authorization that no longer holds

- **WHEN** a write retargets a named exit of a scripted stage the board had already authorized
- **THEN** the report states, once for the board, that the authorization no longer holds for that stage
- **AND** it names the changed exits and destinations as the reason
- **AND** it does not repeat that statement for each project the board allows

#### Scenario: Report a change of source

- **WHEN** a write changes a scripted stage's source bytes
- **THEN** the report names the changed source as the reason its authorization no longer holds

#### Scenario: Report a version that was never approved

- **WHEN** a write adds or changes a scripted stage whose executable version the board never approved
- **THEN** the report states, once for the board and stage, that the version was never approved
- **AND** the write still succeeds when nothing else is wrong

#### Scenario: Report an execution directory that depends on the card

- **WHEN** a write changes a scripted stage scoped to the task directory
- **THEN** the report states that the execution directory depends on the card's worktree
- **AND** it does not claim a project-wide result

#### Scenario: Report a connection layout the diagram ignores

- **WHEN** a composed document authors a connection layout whose pair the workflow does not draw
- **THEN** the report warns that the entry is not drawn
- **AND** the write still succeeds when nothing else is wrong

#### Scenario: Report an instruction that names an unreachable stage

- **WHEN** a composed document's stage instruction cites a stage that is not a permitted destination of that stage
- **THEN** the report warns about that instruction
- **AND** it names the stage that authors it

#### Scenario: Report an instruction that cites an unknown stage

- **WHEN** a composed document's instruction writes an identifier between backticks that the workflow does not define
- **THEN** the report warns that the instruction cites an unknown stage
- **AND** it names the stage that authors it

#### Scenario: Report a prose mention separately from a citation

- **WHEN** a composed document's instruction contains an ordinary word that equals an identifier of a stage the stage does not permit, without citing it
- **THEN** the report records an informational observation naming the word and the stage
- **AND** it does not report that observation as a routing defect

#### Scenario: Report one grouped warning per repeated fact

- **WHEN** the same stage and the same reference produce the same warning several times in one composed document
- **THEN** the report lists that warning once
- **AND** it counts how many occurrences the group covers

#### Scenario: Report a destination parameter the origin never names

- **WHEN** a stage's instruction permits a transition to a destination stage that declares a parameter the instruction never names
- **THEN** the report flags that transition
- **AND** it names the origin stage, the destination stage, and the unnamed parameter

#### Scenario: Report where a failed edit landed

- **WHEN** an edit cannot be applied because its anchor is missing or repeated
- **THEN** the report's problems name the failing edit index
- **AND** they name the occurrence lines or the closest authored line

#### Scenario: Report a card without the values its stage declares

- **WHEN** a composed document makes a stage declare parameters and a card is parked in that stage without a value for one of them
- **THEN** the report names that card by identifier and the missing parameter names
- **AND** it carries no parameter value

#### Scenario: Report the size of a changed instruction

- **WHEN** a write changes a stage's entry instruction
- **THEN** the report states that instruction's character count, byte length, and an estimated token count
- **AND** the write still succeeds when the size is large

#### Scenario: Report affected cards without their text

- **WHEN** a write removes a stage or a route that cards depend on
- **THEN** the report names those cards by identifier and count
- **AND** it carries no card title, description, note, task message, or conversation content

#### Scenario: Report a parameter the program reads but the stage never declares

- **WHEN** a composed document keeps a TypeScript scripted stage whose captured program reads a parameter name its declaration does not list
- **THEN** the report observes that undeclared name for that stage
- **AND** the write still succeeds when nothing else is wrong
- **AND** the observation is not reported as a routing defect
