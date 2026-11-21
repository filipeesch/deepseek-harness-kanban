## MODIFIED Requirements

### Requirement: Transition briefing for an instructed stage

When a stage configures two or more transition targets and the host delivers that stage's entry instruction, the delivery SHALL include a host-generated briefing after the instruction and, when the delivery carries a declared transition's reason, after that reason. The briefing SHALL NOT list the configured targets, which the delivery's orientation block carries with their conditions. It SHALL name the recorded transition when the task already recorded one for that stage, SHALL name the target that applies when nothing is recorded, and SHALL name the tool that records the choice together with its required reason and the maximum length of that reason. The briefing SHALL describe conditionally that an eligible declared transition is followed at the end of the completed turn. It SHALL NOT direct the agent to record a transition solely because the stage has multiple targets; an authored instruction or direct user request MAY direct a declaration. The briefing SHALL be derived from the active workflow at the moment of delivery and SHALL appear on every delivery path: the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, and the first execution of a task created by an agent. A stage that configures fewer than two targets SHALL produce no briefing, and its context message SHALL contain the orientation block, the entry instruction and, when one applies, the declared transition's reason.

When instruction delivery carries a scripted handoff, the handoff SHALL be a separate identified block after any declared agent reason and before this briefing. It SHALL NOT change the briefing's documentary conditions, configured destinations, or end-of-turn declaration guidance. A stage with fewer than two targets SHALL still receive its pending handoff even though it produces no briefing. The handoff SHALL NOT be presented as a reason the agent declared.

#### Scenario: Include the briefing with two or more targets

- **WHEN** the host delivers the entry instruction of a stage that configures two or more targets
- **THEN** the delivered context message contains the orientation block, the instruction, and then the transition briefing

#### Scenario: Place the briefing after the declared reason

- **WHEN** the delivery carries both a declared transition's reason and a briefing
- **THEN** the message orders the orientation block, the instruction, then the reason, then the briefing

#### Scenario: Omit the briefing with one target

- **WHEN** the host delivers the entry instruction of a stage that configures exactly one target
- **THEN** the delivered context message contains the orientation block, the entry instruction and, when one applies, the declared transition's reason
- **AND** it contains no briefing

#### Scenario: Omit the briefing without configured transitions

- **WHEN** the host delivers the entry instruction of a stage that does not configure transitions
- **THEN** the delivered context message contains the orientation block, the entry instruction and, when one applies, the declared transition's reason
- **AND** it contains no briefing

#### Scenario: State the required reason and the end-of-turn timing

- **WHEN** the briefing names the tool that records the choice
- **THEN** it states that recording a destination requires a reason and the maximum length of that reason
- **AND** it states conditionally that an eligible declared transition is followed at the end of the completed turn

#### Scenario: List each target with its condition

- **WHEN** the briefing is generated for a stage whose targets carry authored conditions
- **THEN** the delivery's orientation block lists every target with its stage name and its condition
- **AND** a target without a condition is listed without one
- **AND** the briefing itself does not repeat the target list

#### Scenario: Name the target that applies without a recording

- **WHEN** the briefing is generated and the task has no recorded transition for that stage
- **THEN** the briefing names the target the host uses when nothing is recorded

#### Scenario: Name the recorded transition

- **WHEN** the briefing is generated and the task already recorded a transition for that stage
- **THEN** the briefing names the recorded transition

#### Scenario: Derive the briefing at send time

- **WHEN** the workflow changes between the admission of an instruction and its delivery
- **THEN** the briefing reflects the targets the stage configures at the moment of delivery

#### Scenario: Include the briefing on every send path

- **WHEN** a stage instruction is delivered by the card run action, the timed stage instruction after a move, a confirmed transition, the automatic advance, or the first execution of a task created by an agent
- **THEN** the delivered context message includes the briefing whenever the stage configures two or more targets

#### Scenario: Keep scripted handoff when no briefing applies

- **WHEN** an instructed destination receives a scripted handoff and configures fewer than two transition targets
- **THEN** its context message includes the orientation block, the instruction, and the separate scripted handoff block
- **AND** no transition briefing is generated
- **AND** no agent-declared reason is fabricated

#### Scenario: Describe choices without commanding a route

- **WHEN** the host sends a briefing for a stage with multiple targets and neither the authored instruction nor the user requests a transition
- **THEN** the briefing describes the targets and declaration mechanism without directing the agent to declare one
- **AND** automatic mode remains a separate control

### Requirement: YAML workflow configuration

Each board SHALL support its own workflow configuration in YAML, including optional root workflow and stage descriptions, the initial stage, grouped columns, allowed transitions with an optional condition for each target, optional stage entry instructions, each stage's stored placement, each stage's stored size, the board's default presentation, and an optional stable stage identity for each stage. A transition entry SHALL be authored either as a bare target identifier or as a mapping that carries the target identifier and an optional condition. Both forms SHALL be accepted, neither form SHALL be deprecated, both forms SHALL describe the same transition, and a single list MAY mix them. The condition SHALL describe when that transition is followed; it SHALL NOT change which transitions the workflow permits. The active board's workflow SHALL be used for rendering, transitions, and task creation. For manual moves, the product SHALL honor configured transition restrictions by requiring explicit confirmation before a restricted transition can proceed, and it SHALL honor column grouping.

A stage's stable identity SHALL be a value distinct from the stage identifier, SHALL be unique within the board, SHALL be preserved when the identifier or any other stage field is edited, and SHALL be preserved by every edit that does not present it. A workflow whose stages carry no stable identity SHALL be accepted: the configuration is valid without one, and an identity SHALL be assigned before the stage is published to a team. An authored field the editor does not present SHALL survive an edit unchanged.

This version SHALL NOT implement WIP limits and SHALL NOT introduce reusable workflow templates.

A stage SHALL additionally support the scripted configuration defined by `scripted-steps`. A scripted stage SHALL NOT author a nonempty entry instruction or an allowed transitions list. Its named exit mappings SHALL be its configured destinations for workflow access and graph presentation; several exits MAY resolve to the same destination, which SHALL be presented as one connection to that destination. The exit names SHALL NOT be presented on the diagram's connections; each exit name and the destination it resolves to SHALL remain presented and editable in the stage editor. A scripted stage SHALL NOT obtain a default route from the first exit or from workflow order. Exit names SHALL NOT be executable interpretations of a legacy transition condition, and legacy conditions SHALL retain their documentary meaning. A script SHALL NOT supply or override a destination stage identifier.

Optional root and stage descriptions SHALL retain authored content in YAML and the normalized workflow; a missing or blank description SHALL be represented as absent without inventing text. No description length limit SHALL be imposed by the schema on any author; the workflow architect's 300-character ceiling is guidance and a write-report observation. Unrelated edits SHALL preserve authored descriptions and exact YAML text. Legacy workflows, including those whose stored normalized state omitted an authored stage description, SHALL be read using a versioned migration or equivalent compatibility projection before strict consistency checks without rewriting YAML or hashes. Description changes SHALL participate in semantic comparisons, revision and diff, creation and incremental events, replay, restore, and merge/conflict detection. Team publication and synchronization SHALL preserve them, and incompatible peers SHALL report incompatibility rather than silently discard them.

#### Scenario: Render a configured column group

- **WHEN** the active board's workflow groups multiple stages together
- **THEN** the board presents those stages as a group while retaining each stage as a distinct task destination

#### Scenario: Reject a prohibited transition

- **WHEN** a user requests a move that the active board's workflow does not permit from its current stage and does not confirm the override
- **THEN** the task remains in its current stage
- **AND** the prohibited move does not initiate an agent execution

#### Scenario: Restricted transition requires confirmation

- **WHEN** a user requests a move that the active board's workflow does not permit
- **THEN** the board asks for explicit confirmation before moving the task
- **AND** the task remains in its current stage until the user confirms
- **AND** the request does not initiate an agent execution

#### Scenario: Read a stage's stored size

- **WHEN** the active board's workflow stores a size for a stage
- **THEN** the board presents that stage at that size, bounded by the minimum size

#### Scenario: Reject an invalid stage size

- **WHEN** a workflow configuration stores a stage size that is not a finite number, is below the minimum, or lies outside the accepted range
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Do not enforce a WIP capacity

- **WHEN** a user makes an otherwise permitted move into a stage that already contains tasks
- **THEN** the board does not reject the move because of a WIP capacity limit

#### Scenario: Validate against the active board's workflow

- **WHEN** the user edits the workflow of the active board
- **THEN** the editor validates that board's YAML
- **AND** no other board's workflow is read or replaced

#### Scenario: Reject an unsupported default presentation

- **WHEN** a workflow configuration sets a default presentation other than the column board or the workflow diagram
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Accept a bare transition identifier

- **WHEN** a stage configures a transition as a bare target identifier
- **THEN** the workflow is accepted and the transition is drawn and followed as before

#### Scenario: Accept a transition with a condition

- **WHEN** a stage configures a transition as a mapping with a target identifier and a condition
- **THEN** the workflow is accepted and the condition is kept with that transition

#### Scenario: Accept a mixed transition list

- **WHEN** one stage mixes bare target identifiers and conditioned transitions in the same list
- **THEN** the workflow is accepted and every entry describes one transition

#### Scenario: Reject a transition to an unknown stage

- **WHEN** a stage configures a transition whose target stage does not exist
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Keep the permitted set unchanged by a condition

- **WHEN** a stage configures the same targets with and without conditions
- **THEN** the same requests are permitted and the same requests require confirmation

#### Scenario: Keep a stage identity across an identifier rename

- **WHEN** a workflow configuration carries a stable identity for a stage and that stage's identifier is edited
- **THEN** the stage keeps its stable identity
- **AND** the resulting workflow is accepted

#### Scenario: Accept a workflow without stage identities

- **WHEN** a board whose stages carry no stable identity is opened
- **THEN** the configuration is accepted and the board renders normally
- **AND** no identity is fabricated while the board stays unpublished

#### Scenario: Preserve an authored identity the editor does not present

- **WHEN** the user edits one stage of a workflow whose stages carry stable identities
- **THEN** every stage keeps its authored identity
- **AND** no identity is moved to another stage

#### Scenario: Accept a scripted stage without changing legacy conditions

- **WHEN** a workflow configures a scripted stage with named exits and another stage with documentary transition conditions
- **THEN** the scripted configuration is validated by the same workflow semantics as the host
- **AND** its exits determine its configured destinations without selecting a default exit
- **AND** the other stage retains its conditions and permitted targets unchanged

#### Scenario: Draw one connection for several exits without naming it on the path

- **WHEN** a scripted stage maps two exit names to the same other stage
- **THEN** the diagram draws one connection to that destination
- **AND** that connection presents no exit name
- **AND** the stage editor presents both exit names and the destination they share

#### Scenario: Accept and preserve optional descriptions

- **WHEN** a workflow authors root and stage descriptions and an unrelated field is edited
- **THEN** both descriptions and their authored text remain unchanged
- **AND** missing or blank descriptions are treated as absent without generating text
- **AND** a description longer than 300 characters is not rejected for its length alone

#### Scenario: Read a legacy omitted stage description

- **WHEN** a legacy workflow's YAML contains a stage description omitted from its stored normalized state
- **THEN** the board loads the description through a compatible projection before consistency validation
- **AND** neither the authored YAML nor its digest is rewritten merely by loading

#### Scenario: Preserve descriptions across history and sharing

- **WHEN** a description is changed, published, synchronized, replayed, or restored
- **THEN** the changed description participates in semantic history and conflict detection
- **AND** a peer unable to preserve it reports incompatibility rather than silently discarding it
