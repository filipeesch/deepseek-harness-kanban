# Spec Delta

## MODIFIED Requirements

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
