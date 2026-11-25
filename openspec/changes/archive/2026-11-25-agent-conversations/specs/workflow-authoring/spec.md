# Spec Delta

## ADDED Requirements

### Requirement: Board agents in the workflow document

The workflow document SHALL accept an optional root `agents` list. Each entry SHALL carry a nonempty `id` and `name`, MAY carry a `preset` and a `model` mapping with the same accepted shape as the board default model, and a `preset` it carries SHALL be nonempty. Agent identifiers SHALL be unique within the document, SHALL follow the workflow identifier rules, and SHALL NOT be reserved words. A stage SHALL reference an agent with an optional `agent` key holding an agent identifier; a stage that names no agent keeps the board's main conversation. An agent identifier that a stage names but the document does not declare SHALL be rejected as invalid and SHALL NOT replace the last valid workflow.

The document SHALL always define a `main` agent. A document that authors no `agents.main` SHALL resolve the main agent from the legacy root `agent_preset` scalar and root `model` mapping, then from the board's default-preset metadata, then from the host default, so a document without the `agents` section keeps its current behavior. An authored `agents.main` without a `preset` SHALL be an explicit host default; an authored `agents.main` with a `preset` SHALL name that preset, and its declared name and model SHALL apply to the main conversation. `main` SHALL NOT be removable, and a document that declares other agents while omitting `main` SHALL keep the legacy resolution for the main conversation.

Agents SHALL be part of the workflow's meaning and SHALL NOT be part of its layout. Unrelated edits SHALL preserve the authored `agents` section and every authored `agent` reference character for character. The stored parsed workflow and the authored YAML SHALL agree on the agents and on each stage's reference. A document whose agent entry has an empty identifier, name, or preset, or whose agent model mapping the board default model rejects, SHALL be rejected as invalid without replacing the last valid workflow.

#### Scenario: Accept an agents list and a stage reference

- **WHEN** a workflow declares an agent with an identifier, a name, a preset, and a model and a stage names that agent
- **THEN** the configuration is accepted
- **AND** the stored parsed workflow and the authored YAML agree on the agent and on the stage reference

#### Scenario: Keep the legacy main resolution without an agents section

- **WHEN** a workflow authors no `agents` section and authors a root `agent_preset` scalar
- **THEN** the configuration is accepted
- **AND** the main conversation resolves that scalar as its agent preset

#### Scenario: Treat main without a preset as the host default

- **WHEN** a workflow declares `main` with a name and no preset
- **THEN** the main conversation starts on the host default preset
- **AND** the declared name applies to the main conversation

#### Scenario: Keep the legacy main resolution while declaring other agents

- **WHEN** a workflow declares an agent other than `main` and authors no `agents.main`
- **THEN** the main conversation keeps the resolution the legacy fields and board metadata define

#### Scenario: Reject an unknown agent reference

- **WHEN** a stage names an agent identifier the document does not declare
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Reject a repeated agent identifier

- **WHEN** a workflow declares the same agent identifier twice
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Count an agent change as a workflow change

- **WHEN** a board's workflow differs from another version of that workflow only in an agent or in a stage's agent reference
- **THEN** that difference is a change to the workflow's meaning and not a layout difference

#### Scenario: Preserve the agents section through an unrelated edit

- **WHEN** a workflow that authors agents and comments inside that section is edited in another field
- **THEN** the authored agents section and every stage reference remain character for character

### Requirement: Agent authoring writes

The workflow architect SHALL author the board's agents through `set_agent`, `remove_agent`, and `set_stage_agent`, gated like the other workflow-design tools. `set_agent` SHALL create or replace one agent with its identifier, name, preset, and optional model. `remove_agent` SHALL remove one agent that no stage names and SHALL refuse `main` and an agent a stage references. `set_stage_agent` SHALL set or clear one stage's agent reference and SHALL refuse an identifier the document does not declare. Each tool SHALL accept an optional expected Hub revision and SHALL reject a stale revision the current document cannot reapply. Each SHALL compose one document, SHALL validate it with the same workflow semantics the board editor enforces, SHALL preserve every authored character outside the `agents` section and the stage field it writes, and SHALL persist nothing on refusal.

The write report SHALL name a changed agent declaration and a changed stage agent binding among the workflow-meaning differences. It SHALL observe a stage that names an agent and authors no entry instruction, and it SHALL observe a preset or a model the running host does not report as available without refusing the write, so a board stays portable between installations with different preset rosters.

A document without an `agents` section SHALL receive one at the document root in authored key order when an agent is first written, and the write SHALL keep the legacy root fields it does not replace.

#### Scenario: Create an agent

- **WHEN** an agent calls `set_agent` with an identifier, a name, and a preset
- **THEN** the document declares that agent
- **AND** every other authored character is unchanged

#### Scenario: Replace one agent and keep the others

- **WHEN** an agent calls `set_agent` for an existing identifier with a new preset
- **THEN** that entry carries the new preset
- **AND** every other agent keeps its authored values

#### Scenario: Refuse to remove main

- **WHEN** an agent calls `remove_agent` naming `main`
- **THEN** the write is refused and the document is unchanged

#### Scenario: Refuse to remove an agent a stage names

- **WHEN** an agent calls `remove_agent` for an agent some stage references
- **THEN** the write is refused and the document is unchanged

#### Scenario: Bind a stage to an agent

- **WHEN** an agent calls `set_stage_agent` for a stage and a declared identifier
- **THEN** that stage authors the reference
- **AND** the rest of the document is unchanged

#### Scenario: Clear a stage's agent

- **WHEN** an agent calls `set_stage_agent` for a stage and no identifier
- **THEN** that stage authors no agent reference
- **AND** the stage returns to the main conversation

#### Scenario: Refuse an undeclared agent

- **WHEN** an agent calls `set_stage_agent` with an identifier the document does not declare
- **THEN** the write is refused and the document is unchanged

#### Scenario: Insert the section into a legacy document

- **WHEN** an agent calls `set_agent` on a document that authors no `agents` section
- **THEN** the document gains that section at the root
- **AND** the legacy root fields the call does not replace and every other authored character are unchanged

#### Scenario: Observe an unavailable preset without refusing

- **WHEN** an agent calls `set_agent` with a preset the running host does not report
- **THEN** the write succeeds when nothing else is wrong
- **AND** the report observes that the preset is unavailable

#### Scenario: Reject a stale revision

- **WHEN** an agent writes an agent with a Hub revision the board no longer reports and the write cannot be reapplied
- **THEN** the write is refused and the document is unchanged

## MODIFIED Requirements

### Requirement: Single-stage read

`get_stage` SHALL return the authored block of one stage of a board's workflow exactly as written, covering its identifier, label, entry instruction, transition list, scripted configuration, placement, size, and the agent it names when it names one, together with the Hub revision the board reports. Script source SHALL be withheld by default and represented by its byte length and a stable digest of those bytes; an explicit request SHALL return the authored source instead. Everything outside the source SHALL stay character for character as authored. The tool SHALL reject a stage the workflow does not define, without changing the board.

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
