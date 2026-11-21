## ADDED Requirements

### Requirement: Transition discovery reports what each stage is

`list_allowed_transitions` SHALL report, for the task's current stage and for every target that stage configures, the stage's kind, which is one of decision, scripted, agent-instruction, or no-instruction, and its responsibility, which is the stage's authored description and is absent when none is authored. For the current stage it SHALL also report the routing policy, which is one of unrestricted, empty, configured, scripted, or decision, and a stage that authors no transition restriction SHALL be reported with no target a declaration may name. It SHALL report the same fields for an explicitly requested destination without claiming that the destination is configured. It SHALL NOT report entry instructions, script code, or decision option descriptions. Task and board scope are unchanged.

#### Scenario: Describe the stage and its targets

- **WHEN** an agent calls `list_allowed_transitions` for a task whose stage configures targets
- **THEN** the result gives the kind and responsibility of the current stage and of each target

#### Scenario: Describe an explicitly requested destination

- **WHEN** an agent requests an existing destination that the stage does not configure
- **THEN** the result gives that destination's kind and responsibility
- **AND** it does not claim that the destination is configured

#### Scenario: Report the routing policy

- **WHEN** an agent calls `list_allowed_transitions` for a task in a stage of each routing policy
- **THEN** the result states that policy, and it matches the policy the workflow summary and the orientation report for the stage
- **AND** an unrestricted stage lists no target a declaration may name

#### Scenario: Leave an absent description absent

- **WHEN** a stage or target has no authored description
- **THEN** the result carries no responsibility for it

#### Scenario: Keep instructions out of discovery

- **WHEN** an agent calls `list_allowed_transitions`
- **THEN** the result contains no entry instruction, script code, or decision option description

### Requirement: The workflow summary marks the calling task's stage

When the requested board is the calling task's own board, `get_workflow_summary` SHALL mark the stage that holds the task as current within the stage records, in addition to the task record. It SHALL NOT mark any stage for a board that is not the calling task's own board or for a call made outside a task conversation.

#### Scenario: Mark the current stage

- **WHEN** a task conversation reads its own board's workflow summary
- **THEN** the stage record of the task's current stage is marked as current
- **AND** no other stage record is marked

#### Scenario: Mark nothing for another board

- **WHEN** a task conversation reads a different board, or an ordinary chat reads a board
- **THEN** no stage record is marked as current

### Requirement: Agent-declared transition reasons are short

A reason declared through `set_next_transition`, whether for a configured target or under the exception flag, SHALL be nonempty after trimming and SHALL be at most 200 characters. A longer reason SHALL be rejected with an error that states the limit and SHALL never be truncated. The tool's description and its reason parameter's description SHALL state the limit. A rejected declaration SHALL leave the task, its recorded transition, and its recorded parameters unchanged. The limit applies to the agent's declaration only: a reason the host composes itself, such as the one a decision gate carries to its destination, and a reason stored earlier SHALL remain valid and unchanged.

#### Scenario: Accept a reason at the limit

- **WHEN** an agent declares a configured target with a reason of exactly 200 characters
- **THEN** the declaration is recorded with that reason

#### Scenario: Reject a longer reason and state the limit

- **WHEN** an agent declares a target with a reason of 201 characters
- **THEN** the declaration is rejected with an error that states the 200-character limit
- **AND** nothing is truncated and the task's recorded transition is unchanged

#### Scenario: Apply the limit to an exceptional declaration

- **WHEN** an agent declares an unconfigured destination with the exception flag and a reason longer than 200 characters
- **THEN** the declaration is rejected with the same error

#### Scenario: State the limit in the tool contract

- **WHEN** the tool definitions are read
- **THEN** the description of `set_next_transition` and of its reason parameter state the 200-character limit

#### Scenario: Leave host-composed reasons unchanged

- **WHEN** a person answers a decision gate whose option title and observation compose a destination reason longer than 200 characters
- **THEN** the destination receives the composed reason unchanged
- **AND** a reason stored before this change remains valid
