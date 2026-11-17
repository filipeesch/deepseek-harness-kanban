# Workflow Operator Preset

## Purpose

Provide a PTC-capable task operator that understands the surrounding workflow while carrying out only the current stage's work.

## Requirements

### Requirement: A workflow operator preset ships with PTC capabilities

The bundle SHALL offer a workflow operator preset that preserves the PTC execution model and its general-purpose coding, filesystem, shell, skill, delegation, planning, and safety capabilities under the host's ordinary permissions. Its concise guidance SHALL explain that an agentic stage provides instructions to an agent, a scripted stage executes a configured program with named exits, a decision stage stops for the person's explicit choice among authored options, and a stage with neither script nor instruction is not necessarily agentic. It SHALL treat the task's current stage as its scope, not automatically execute another stage's instructions, and SHALL follow the workflow and the user for how questions and decisions are presented. It SHALL NOT answer a decision gate, declare a route out of one, or claim that a choice was made; the person answers it through the task surface. It SHALL NOT require a startup call to the workflow summary tool when first-turn context is available. It SHALL NOT receive workflow-architect-only tools by virtue of this preset.

#### Scenario: Compose the operator as a PTC agent

- **WHEN** a new task conversation starts with the workflow operator preset
- **THEN** its PTC execution and ordinary coding tools remain available under the host's normal permissions
- **AND** workflow-architect-only tools are not declared for it

#### Scenario: Understand distinct stage types

- **WHEN** the operator reads its workflow guidance
- **THEN** it can distinguish an agent instruction from a configured script, a decision gate, and a stage with neither
- **AND** it is not instructed to run a later stage's work early

#### Scenario: Leave a decision gate to the person

- **WHEN** the task's current stage authors a decision configuration
- **THEN** the operator does not answer it and does not declare a route out of it
- **AND** it reports what the stage waits for without claiming a choice was made

### Requirement: An operator declares only a requested route

The operator's guidance SHALL direct it to read the current allowed transitions before deciding and declaring a route. It SHALL NOT declare a transition solely because it has finished work, the workflow has a next stage, or the generated briefing lists multiple destinations. It SHALL declare a route only when the current stage's instruction directs it or the user directly requests it. Without either request the agent SHALL finish its work and wait for the person to move the task manually. This rule SHALL NOT disable or redefine an independently enabled automatic mode. An unconfigured route additionally requires the user's explicit direct request and follows the exceptional transition contract.

#### Scenario: Wait after a stage that does not ask to transition

- **WHEN** the operator completes work, the user has not requested a transition, and the current stage's instruction does not direct one
- **THEN** it does not call the transition declaration tool on its own initiative
- **AND** it waits for a manual move, subject to the independent automatic-mode setting

#### Scenario: Follow an authored routing instruction

- **WHEN** the current stage's instruction directs the operator to choose a configured next stage
- **THEN** the operator first reads the current allowed transitions and their conditions
- **AND** it can declare the appropriate configured target with a reason

#### Scenario: Automatic mode remains independent

- **WHEN** the operator does not declare a transition and the task's automatic mode is enabled
- **THEN** the host may advance under the existing automatic-mode contract
- **AND** the preset itself does not change that setting
