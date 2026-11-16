# Spec Delta

## ADDED Requirements

### Requirement: Product tools are declared per role

The plugin SHALL declare a product tool for an agent only when that agent's preset allows it. A preset
that names a role allowlist SHALL receive exactly the product tools in that allowlist: a product tool
outside it SHALL be absent from the declared tool set and SHALL NOT be dispatchable, rather than
declared and refused at call time. An agent whose preset is not a project role, including an agent on
the host default preset and the workflow architect, SHALL keep the product tool surface it has today,
and the workflow-architect-only declaration stated in the product tool surface requirement SHALL
remain unchanged. The allowlist SHALL be read from the preset's own composition, so two boards that
select different role presets get different surfaces without a board setting. This restriction SHALL
NOT bypass native DSH permission behavior or any authorization the tool already enforces, and it SHALL
NOT change what a product tool does when it is declared.

#### Scenario: Select the planner's surface

- **WHEN** an agent runs on a preset that allows board reading, card creation and editing, relations, notes, messages, transitions, pause and resume, team files, and the structured-question tool
- **THEN** those product tools are declared for it
- **AND** the workflow-authoring and board-administration tools are not

#### Scenario: Select the manager's surface

- **WHEN** an agent runs on a preset that allows board reading, notes, messages, transitions, pause and resume, and the structured-question tool
- **THEN** exactly those product tools are declared for it
- **AND** no card creation or card editing tool is declared

#### Scenario: Absence rather than refusal

- **WHEN** an agent on a role preset is asked about a product tool outside its allowlist
- **THEN** the tool does not appear in its declared tool set
- **AND** a call to it is reported as an unknown tool rather than as a permission refusal

#### Scenario: Leave other presets alone

- **WHEN** an agent runs on the host default preset or on the workflow architect preset
- **THEN** it keeps the product tool surface it has today
- **AND** the workflow-architect-only declaration is unchanged
