# Spec Delta

## ADDED Requirements

### Requirement: Agent selection in the stage editor

The Stage tab of the stage editor SHALL present the stage's agent: the board's agents with the main agent first, together with the option that keeps the main conversation. Choosing an agent SHALL bind the stage to that agent, and choosing the main conversation SHALL leave the stage with no agent. When the board declares no agent other than the main one, the surface SHALL present the main conversation only and SHALL state that agents are declared in the board's agent configuration. The editor SHALL NOT create, rename, or remove an agent.

The selection SHALL be part of the editor's draft: it SHALL NOT be stored before the save action, it SHALL be validated with the rest of the draft, and it SHALL be stored by the same guarded write. A rejected save SHALL keep the draft and present the problem inside the editor. A stage that names an agent SHALL keep its Execution tab and its own entry instruction; binding an agent SHALL NOT move or copy the instruction.

#### Scenario: Present the board's agents

- **WHEN** the user opens the Stage tab for a stage of a board that declares agents
- **THEN** the surface presents the board's agents with the main agent first
- **AND** it presents the option that keeps the main conversation

#### Scenario: Bind a stage to an agent

- **WHEN** the user chooses an agent for the stage and saves
- **THEN** the stored stage names that agent
- **AND** the rest of the authored workflow is unchanged

#### Scenario: Return a stage to the main conversation

- **WHEN** a stage that names an agent is set to the main conversation and saved
- **THEN** the stored stage names no agent

#### Scenario: Show the main conversation only when no other agent exists

- **WHEN** the board declares no agent other than the main one
- **THEN** the surface presents the main conversation only
- **AND** it states where agents are declared

#### Scenario: Keep the instruction with the stage

- **WHEN** the user binds an agent to a stage that already has an entry instruction
- **THEN** the stage keeps that instruction
- **AND** the draft stores the binding and the unchanged instruction together

#### Scenario: Save the binding only with the draft

- **WHEN** the user changes the agent and activates cancel
- **THEN** the editor closes and nothing is stored
- **AND** the board presents the stage's previous agent
