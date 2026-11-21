## RENAMED Requirements

- FROM: `### Requirement: Workflow descriptions remain concise authored context`
- TO: `### Requirement: Descriptions carry the responsibility of the workflow and of each stage`

## MODIFIED Requirements

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

## ADDED Requirements

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
