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

### Requirement: An operator declares a route only when directed or when stage ownership requires it

The operator's guidance SHALL direct it to read the current allowed transitions before deciding and declaring a route. It SHALL NOT declare a transition solely because it has finished work, the workflow has a next stage, or the generated orientation or briefing lists multiple destinations. It SHALL declare a route only when the current stage's instruction directs it, the user directly requests it, or stage ownership requires it as defined by the requirement that moves a task to a directly configured stage that owns the work. Without any of these the agent SHALL finish its work and wait for the person to move the task manually. A request from another task alone SHALL NOT qualify. This rule SHALL NOT disable or redefine an independently enabled automatic mode. An unconfigured route additionally requires the user's explicit direct request and follows the exceptional transition contract.

#### Scenario: Wait after a stage that does not ask to transition

- **WHEN** the operator completes the work its stage owns, the user has not requested a transition, and the current stage's instruction does not direct one
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

#### Scenario: Do not treat a peer request as ownership

- **WHEN** a message from another task asks the operator to move its task and no stage owns work that requires the move
- **THEN** the operator does not declare a route solely because of that message

### Requirement: An operator treats stage responsibility as the ownership of work

The operator's standing rule SHALL be that it does not perform, in the current stage, work that another stage is responsible for. The rule SHALL be stated in the operator's persona so that it applies before any skill is loaded, and the operator skill SHALL carry the protocol that applies it. The operator SHALL determine which stage owns a piece of work from the responsibilities that the workflow's stages state in their descriptions and from the current stage's instruction. It SHALL know its live stage from the latest orientation block, stage notice, or workflow summary rather than from an earlier first-contact snapshot, and it SHALL read the current workflow summary when it is unsure which stage is current, and every page of it before it concludes that no stage owns a piece of work. It SHALL perform the work of the current stage. When no stage's stated responsibility covers a piece of work, any stage is a valid place for it and the operator SHALL perform it in the current stage. When ownership is ambiguous it SHALL ask the person instead of guessing. A stage instruction that names or limits what the stage does SHALL take precedence over this rule. The guidance SHALL use neutral examples and SHALL NOT encode any particular workflow.

#### Scenario: Keep work in the stage that owns it

- **WHEN** the operator is asked to do work that another stage's stated responsibility covers
- **THEN** it does not perform that work in the current stage
- **AND** it follows the requirement that moves a task to the stage that owns the work

#### Scenario: Execute when no stage owns the work

- **WHEN** no stage's stated responsibility covers the requested work
- **THEN** the operator performs it in the current stage
- **AND** it does not ask for a move

#### Scenario: Ask when ownership is ambiguous

- **WHEN** the stated responsibilities of two or more stages could cover the work
- **THEN** the operator asks the person which stage owns it before acting

#### Scenario: Use the live stage

- **WHEN** the task has moved since the first-contact snapshot and a later orientation block or stage notice names another stage
- **THEN** the operator treats that stage as current

#### Scenario: Read the summary when unsure

- **WHEN** the operator cannot tell which stage is current
- **THEN** it reads the current workflow summary before acting
- **AND** a live read supersedes what the transcript said before

#### Scenario: Read every summary page before concluding there is no owner

- **WHEN** the workflow summary spans several pages and the operator is deciding whether any stage owns the work
- **THEN** it reads every page before it concludes that none does

#### Scenario: Let the stage instruction decide

- **WHEN** the current stage's instruction names or limits the work the stage does
- **THEN** the instruction takes precedence over the ownership rule

#### Scenario: Apply the rule without the skill

- **WHEN** a conversation starts and the operator has not loaded its skill
- **THEN** its persona already states that it does not perform another stage's work in the current stage

### Requirement: An operator moves a task to a directly configured stage that owns the work

When the work the operator needs to do, whether the user asked for it or the operator discovers it, belongs to a stage that the current stage configures as a direct destination, the operator SHALL, on its own initiative, finish what belongs to the current stage, declare the route to that stage with a reason, and end its turn without performing the owning stage's work. The reason SHALL fit the transition tool's declared-reason limit and SHALL hand off what was done, what remains, and where the task should return when that is known. Declaring such a route SHALL NOT require a further confirmation from the person. A direct destination is a stage the current stage configures as a target. A stage that authors no transition restriction configures none, so every other stage is reached through the path or the forced jump. A decision gate SHALL never be routed by the operator, a scripted stage keeps its own routing, and a stage instruction that forbids or conditions a declaration SHALL take precedence. Completing the current stage's own work, without other work that another stage owns, SHALL NOT move the task.

#### Scenario: Move to the owning stage

- **WHEN** the work belongs to a stage that the current stage configures as a direct destination
- **THEN** the operator reads the allowed transitions and declares that stage with a reason
- **AND** it does not perform the owning stage's work in the current turn

#### Scenario: Hand off in a short reason

- **WHEN** the operator declares a route because another stage owns the work
- **THEN** the reason states what was done, what remains, and where to return when known
- **AND** it fits within the declared-reason limit

#### Scenario: Move by the operator's own discovery

- **WHEN** the operator discovers during its work that part of the task belongs to a directly configured stage
- **THEN** it declares the route without waiting to be asked

#### Scenario: Do not move on completion alone

- **WHEN** the operator completes the work its stage owns and no other stage owns work that remains
- **THEN** it declares no route and waits for a manual move

#### Scenario: Let an instruction that forbids declaring prevail

- **WHEN** the current stage's instruction forbids or conditions a declaration
- **THEN** the operator follows the instruction before applying this requirement

#### Scenario: Never route a decision gate

- **WHEN** the current stage is a decision gate
- **THEN** the operator declares no route and reports what the stage waits for

### Requirement: An operator presents the configured path and the forced jump when the owner is not a direct destination

When the stage that owns the work is not a direct destination of the current stage, the operator SHALL NOT perform the work in the current stage and SHALL NOT move the task without the person's choice. It SHALL present the path through configured routes, naming each intermediate stage and what that stage does on entry according to its stated responsibility, and the forced jump directly to the owner, and SHALL wait for the person's choice. After the person chooses, it SHALL declare the chosen route without asking again: the first configured hop as an ordinary declaration, or the forced jump as an exceptional declaration under the exceptional transition contract, supplying the exception flag only after the person's explicit confirmation of the jump. When no configured path exists it SHALL offer the forced jump alone. It SHALL ask in the way the stage instruction and the person direct. A decision gate SHALL never be routed by the operator.

#### Scenario: Offer the path and the jump

- **WHEN** the owning stage is reachable only through intermediate stages
- **THEN** the operator presents the configured path with what each intermediate stage does on entry
- **AND** it presents the forced jump
- **AND** it waits for the person's choice without performing the work or moving the task

#### Scenario: Follow a chosen configured path

- **WHEN** the person chooses the configured path
- **THEN** the operator declares the first hop as an ordinary declaration without asking again

#### Scenario: Follow a confirmed forced jump

- **WHEN** the person explicitly confirms the forced jump
- **THEN** the operator declares the owner with the exception flag, a reason, and any required parameters, without asking again

#### Scenario: Offer the jump from an unrestricted stage

- **WHEN** the current stage authors no transition restriction and another stage owns the work
- **THEN** the operator does not treat that stage as a direct destination
- **AND** it presents the forced jump, and any configured path, and waits for the person's choice

#### Scenario: Offer only the jump when no path exists

- **WHEN** no configured path reaches the owning stage
- **THEN** the operator offers the forced jump alone and waits for confirmation

#### Scenario: Wait without a choice

- **WHEN** the person has not answered the offer
- **THEN** the operator declares nothing and does not perform the owning stage's work
