# Workflow Authoring Specification

## Purpose

Lets an agent read one board's exact workflow document and the authored block of a single stage, author targeted workflow changes without matching whole-document text, and learn from one report what a write changed and what it requires.

## Requirements

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

`get_stage` SHALL return the authored block of one stage of a board's workflow exactly as written, covering its identifier, label, entry instruction, transition list, scripted configuration, placement, and size, together with the Hub revision the board reports. Script source SHALL be withheld by default and represented by its byte length and a stable digest of those bytes; an explicit request SHALL return the authored source instead. Everything outside the source SHALL stay character for character as authored. The tool SHALL reject a stage the workflow does not define, without changing the board.

#### Scenario: Withhold script source by default

- **WHEN** an agent reads a scripted stage without asking for its source
- **THEN** the returned block carries a byte length and a digest in place of the source
- **AND** it carries the authored exits, environment names, parameter declarations, and directory choice

#### Scenario: Return the authored source on request

- **WHEN** an agent reads a scripted stage and asks for its source
- **THEN** the returned block carries the authored source exactly as stored

#### Scenario: Preserve the authored block

- **WHEN** an agent reads a stage whose authored text uses comments, quoting, or a flow list
- **THEN** the returned block carries that text character for character

#### Scenario: Reject an unknown stage

- **WHEN** an agent reads a stage identifier the board's workflow does not define
- **THEN** the tool reports that the stage does not exist
- **AND** no stage text is returned

### Requirement: Structured stage writes

The plugin SHALL expose `set_stage_prompt`, `set_stage_routes`, `set_stage_script`, and `set_layout`. Each SHALL accept an optional expected Hub revision. A write that composes its document SHALL be reapplied to the current document when its anchors still match, and SHALL otherwise reject a stale revision without changing the board. Each SHALL rewrite only the fields it names and SHALL preserve every other authored character of the document, including comments, key order, quoting, blank lines, and the text of stages it does not name. `set_stage_prompt` SHALL set or clear one stage's entry instruction. `set_stage_routes` SHALL replace one stage's transition list, SHALL distinguish an empty list, which permits no destination, from an omitted list, which permits any other stage, and SHALL replace a scripted stage's named exits with their destinations without changing its source, environment names, parameter declarations, or directory choice. `set_layout` SHALL set stage placements, stage sizes, and connection layouts, including their anchors and segment displacements, and SHALL remove a placement, size, or connection entry that the call clears.

`set_stage_script` SHALL write one stage's scripted configuration in parts. It SHALL accept any of: the program language, the program source as inline code or as an external file reference, the directory choice, the authorized environment names, the declared parameter list, and the named exits. A part the call does not name SHALL keep its authored value, and the parts it names SHALL be written together in one write. It SHALL reject a configuration that authors both inline code and a file reference, a configuration that removes the only source, a program source that is not text, a directory choice outside the accepted set, a parameter declaration that repeats a name or exceeds the accepted bounds, and an exit whose destination the workflow does not define. It SHALL reject a stage that does not exist, and it SHALL reject a stage that is not a scripted stage only when the call would create a partial configuration; a call that supplies every required part MAY create the stage's scripted configuration.

A write SHALL author the current `scripted:` spelling for the program of every stage it names, SHALL accept a stored stage that authors the legacy `deterministic:` spelling, and SHALL leave the authored spelling of every stage it does not name exactly as its author wrote it. A document that authors both spellings on one stage SHALL be rejected. A field-scoped edit SHALL accept either spelling as the scope of a stage's program and SHALL keep every other field name exact.

#### Scenario: Write the current spelling for the named stage

- **WHEN** an agent writes a field of a stage whose program is authored under the legacy `deterministic:` spelling
- **THEN** that stage authors its program under `scripted:`
- **AND** every stage the write does not name keeps the spelling its author used

#### Scenario: Accept either spelling in a field-scoped edit

- **WHEN** an agent scopes an edit to the program field of a stage that authors the legacy spelling
- **THEN** the edit resolves that stage's program block
- **AND** an edit scoped to another field name does not fall back to the program block

#### Scenario: Reject both spellings on one stage

- **WHEN** a composed document authors `deterministic:` and `scripted:` on the same stage
- **THEN** the write is refused and the document is unchanged

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

- **WHEN** an agent replaces a scripted stage's named exits
- **THEN** each exit names its new destination
- **AND** the stage's source, environment names, parameter declarations, and directory choice are unchanged

#### Scenario: Replace only one stage's program source

- **WHEN** an agent sets a scripted stage's inline code and names no other part
- **THEN** the stage authors the new source
- **AND** its language, directory choice, environment names, declared parameters, named exits, and every comment beside them are unchanged

#### Scenario: Add a declared parameter without touching the source

- **WHEN** an agent sets a scripted stage's parameter declaration
- **THEN** the declaration is stored in authored order
- **AND** the program source, language, directory choice, environment names, and exits are unchanged

#### Scenario: Reject a configuration with two sources

- **WHEN** an agent sets both inline code and an external file reference for one stage
- **THEN** the write is refused and the document is unchanged

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

- **WHEN** an agent writes with a Hub revision the board no longer reports and the write cannot be reapplied to the current document
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

### Requirement: Descriptions carry the responsibility of the workflow and of each stage

Workflow and stage descriptions SHALL be optional author-supplied context, distinct from stage entry instructions, written for the agent that reads them. The workflow architect's guidance SHALL direct it to provide and maintain, when designing or editing a workflow within the scope of the user's explicit authorization, a description of at most 300 characters for the workflow and for every stage. A stage description SHALL state the stage's responsibility: the work that the stage owns. The exit condition of a stage SHALL be authored as the `when` of the transition that leaves it and not in the description; the named exits of a scripted stage have no condition field, so their meaning MAY be stated in that stage's description. The guidance SHALL NOT direct the architect to add to each stage a rule against doing other stages' work, which belongs to the operator's own guidance. The ceiling is an instruction to the architect and an observation in the write report, not a validation limit imposed on any author. Missing descriptions SHALL remain missing, and unrelated edits SHALL preserve existing descriptions and authored YAML. The architect SHALL retain access to the exact document and Hub revision through its existing gated read tools. The architect-only document read SHALL also identify the effective board default preset and the source of that choice, including a default held outside the authored YAML, without altering the exact document or its digest.

#### Scenario: Describe a workflow being designed

- **WHEN** the architect is authorized to design a workflow and its stages
- **THEN** its guidance directs it to write and maintain a description of at most 300 characters for the workflow and for each stage
- **AND** each stage description states the work that the stage owns
- **AND** the description is not treated as an entry instruction

#### Scenario: Place the exit condition in the transition

- **WHEN** the architect designs a stage that leaves toward more than one destination
- **THEN** its guidance directs it to write each exit condition as the condition of the transition
- **AND** not to state the condition in the stage description

#### Scenario: Describe the exits of a scripted stage

- **WHEN** the architect designs a scripted stage whose named exits have no condition field
- **THEN** its guidance permits stating the meaning of those exits in the stage description

#### Scenario: Leave other stages' work to the operator's rule

- **WHEN** the architect writes stage descriptions and entry instructions
- **THEN** its guidance does not direct it to add a prohibition against doing other stages' work to each stage

#### Scenario: Preserve an existing long description

- **WHEN** another author supplies a description longer than 300 characters or a legacy workflow already contains one
- **THEN** the length alone does not make the workflow invalid
- **AND** an unrelated edit does not silently truncate or rewrite it

#### Scenario: Leave an absent description truthful

- **WHEN** a legacy workflow or stage has no description
- **THEN** it remains valid and no description is invented on read

### Requirement: Decision stage authoring and write tools

The plugin SHALL expose `set_stage_decision` as a workflow-design tool. It SHALL write one stage's decision configuration in parts: the question, the context, and the ordered option list, with each option carrying its identifier, title, optional description, and destination. A part the call does not name SHALL keep its authored value only when the stage already authors a complete decision configuration; a call that would leave a partial configuration SHALL be refused. A call SHALL be accepted on a stage that authors no decision configuration only when it supplies the complete required configuration, and setting that configuration SHALL replace the stage's entry instruction, allowed-transition list, or scripted configuration in the same write. Clearing the decision configuration SHALL remove the stage's authored block and leave the remaining stage fields untouched. The write SHALL reject an option whose identifier is not unique within the stage, whose title is empty, whose destination is the stage itself or a stage the workflow does not define, an option count outside the accepted range, a question that is empty after trimming, and any value beyond its accepted length; nothing SHALL be stored on a refusal.

`set_stage_prompt`, `set_stage_routes`, and `set_stage_script` SHALL refuse a stage that authors a decision configuration with an actionable result instead of producing a conflicting stage, so the decision configuration is replaced or cleared through its own tool. Every write SHALL accept the structured stage-write controls (expected revision, digest expectation, dry review, and response mode) that the other stage writes accept, SHALL persist through the same validated workflow write path, and SHALL report the same write report. The report SHALL name a changed decision configuration by the fields it changed, including an option added, an option changed, and an option removed, and its summary mode SHALL name the changed fields without carrying their text.

Option destinations SHALL be authored stage references. A stage rename SHALL rewrite every option destination that named the renamed identifier in the same write. A stage removal SHALL remove each option whose destination names the removed stage, and SHALL refuse the removal when that would leave a decision stage without an option, naming the affected decision stage; a refusal SHALL store nothing. These references SHALL also participate in the exact document and stage reads, so a caller can read the authored decision block.

#### Scenario: Author a decision configuration by tool

- **WHEN** an agent writes the complete decision configuration of a stage that authors no other mode
- **THEN** the stage authors the question, context, and ordered options
- **AND** the rest of the document keeps its authored characters
- **AND** the write report names the changed decision fields

#### Scenario: Replace another mode

- **WHEN** an agent writes a complete decision configuration on a stage that authors an entry instruction, an allowed-transition list, or a scripted configuration
- **THEN** that configuration is replaced in the same write
- **AND** the stage authors no conflicting mode

#### Scenario: Refuse a partial configuration

- **WHEN** an agent sets only some parts of a decision configuration on a stage that authors none
- **THEN** the write is refused and nothing is stored

#### Scenario: Refuse a conflicting writer

- **WHEN** an agent calls `set_stage_prompt`, `set_stage_routes`, or `set_stage_script` on a stage that authors a decision configuration
- **THEN** the tool refuses with an actionable result
- **AND** the stored workflow is unchanged

#### Scenario: Refuse an invalid option

- **WHEN** an option repeats another option's identifier, names the stage itself, or names a stage the workflow does not define
- **THEN** the write is refused and nothing is stored

#### Scenario: Rewrite option destinations on a stage rename

- **WHEN** a stage identifier is renamed and a decision stage destinations it
- **THEN** the option destination follows the renamed identifier in the same write
- **AND** the decision stage keeps its question, options, and other fields

#### Scenario: Refuse a removal that empties a decision gate

- **WHEN** an agent removes a stage that is the only destination of a decision stage's options
- **THEN** the removal is refused and nothing is stored
- **AND** the refusal names the affected decision stage

### Requirement: The write report observes stage contracts

The write validation report SHALL also carry stage-contract observations: a workflow or stage description longer than 300 characters; a stage that authors two or more destinations of which at least one has no `when` condition; and a stage that is scripted or carries an entry instruction and has no description. Each observation SHALL name the stage, or the workflow for its own description, SHALL be grouped and bounded like the other warnings, SHALL NOT be a validation problem, SHALL NOT block a write, and SHALL NOT be counted as a routing defect. A decision stage, and a stage with neither a script nor an instruction, SHALL NOT be reported for a missing description, and the named exits of a scripted stage SHALL NOT be reported for lacking a condition.

#### Scenario: Observe a description over the ceiling

- **WHEN** a composed document carries a stage description of 301 characters
- **THEN** the report observes that description and names the stage
- **AND** the write still succeeds when nothing else is wrong

#### Scenario: Observe a destination without a condition

- **WHEN** a composed document has a stage with two destinations in which one transition has no `when`
- **THEN** the report observes the stage and names the destination without a condition

#### Scenario: Observe an executable stage without a description

- **WHEN** a composed document has a scripted stage or a stage with an entry instruction and no description
- **THEN** the report observes that stage

#### Scenario: Do not observe stages that cannot lack one

- **WHEN** a composed document has a decision stage without a description, or a stage with neither a script nor an instruction and no description
- **THEN** the report carries no missing-description observation for them

#### Scenario: Do not observe scripted exits for lacking a condition

- **WHEN** a composed document has a scripted stage with several named exits
- **THEN** the report carries no missing-condition observation for those exits

#### Scenario: Keep the observations out of the routing defects

- **WHEN** the report carries a stage-contract observation
- **THEN** it is distinguishable from a routing defect and from a validation problem

### Requirement: A stage-contract reference ships with the design skill

The design skill SHALL ship a stage-contract reference that the architect loads on demand when it authors or reviews stage text, and the skill SHALL link to it instead of copying it. The reference SHALL define the role of each authored text: the description states the responsibility, the condition of a transition states the exit condition, and the entry instruction states how the work is done and what is handed over. It SHALL state that a declared transition reason is short and carries a handoff, SHALL tell the architect not to restate what the host's orientation block already supplies, and SHALL use neutral examples that do not encode a particular workflow. The reference SHALL stay within the ceiling that the preset maintenance rules set for a skill or reference.

#### Scenario: Load the reference when authoring

- **WHEN** the architect authors or reviews stage descriptions, conditions, or instructions
- **THEN** the skill points it to the stage-contract reference

#### Scenario: Define the three texts

- **WHEN** the architect reads the reference
- **THEN** it learns that the description states responsibility, the condition states the exit, and the instruction states how and what to hand over

#### Scenario: Keep the reference within its ceiling

- **WHEN** the bundle is validated
- **THEN** the reference is within the character ceiling for a skill or reference
