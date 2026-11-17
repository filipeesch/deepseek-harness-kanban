# Spec Delta

## ADDED Requirements

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
