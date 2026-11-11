# Spec Delta

## MODIFIED Requirements

### Requirement: Worktree choice before a card's first execution

When a Git-backed task has no conversation, no worktree, and no recorded base-project choice, the execution preparation that precedes the task's first execution SHALL ask whether to create a worktree before that execution starts. The choice SHALL offer creating a worktree from the task's title-derived defaults or continuing in the base project, and it SHALL use the same derived branch, destination, and source defaults as the missing-worktree notice and the Git section. A Git-backed project SHALL always have a valid default destination, with or without a configured worktree base path, as defined by Title-derived worktree defaults. Declining SHALL record and persist the base-project choice and SHALL NOT create a branch or worktree. A created worktree SHALL be ready before the first conversation is created for the execution, so that conversation uses the worktree directory. A failed creation SHALL be reported in the preparation, SHALL keep the task's stage and position unchanged, and SHALL NOT start the execution. The automatic first execution on task creation SHALL NOT present this choice; for a Git-backed project it SHALL create the default worktree, and for a folder project it SHALL use the project directory. A cross-card message delivery that needs the target task's first conversation SHALL NOT present this choice; for a Git-backed task it SHALL create the default worktree before creating the conversation, and for a folder project or a task with a recorded base-project choice it SHALL use the current effective directory. A worktree binding in the preparing or error state SHALL block that delivery with an actionable error and SHALL NOT create a worktree or a conversation. A worktree binding in the preparing or error state SHALL block the task's first execution: the preparation SHALL explain that the binding must be resolved in the Git section, SHALL NOT offer creating a worktree or continuing in the base project, and the move or run action SHALL NOT proceed. That block SHALL apply only to the task's first execution; a task that already has a conversation SHALL keep executing while its binding is in that state.

#### Scenario: Ask before the first drop

- **WHEN** the user drops a task with no conversation and no worktree on a permitted instructed stage
- **THEN** the execution preparation asks whether to create a worktree
- **AND** the task does not move until the choice is answered and the preparation completes

#### Scenario: Create from derived defaults

- **WHEN** the user chooses to create a worktree and a valid destination can be derived
- **THEN** a worktree is created with the derived branch, destination, and source
- **AND** the first conversation is created after the worktree is ready
- **AND** the first conversation uses the worktree directory

#### Scenario: Continue in the base project

- **WHEN** the user chooses to continue in the base project
- **THEN** no branch or worktree is created
- **AND** the base-project choice is recorded and persisted
- **AND** the first conversation is created in the base project directory

#### Scenario: No derivable destination

- **WHEN** no worktree base path is configured and the user chooses to create a worktree
- **THEN** the worktree is created at the repository-sibling destination defined by Title-derived worktree defaults
- **AND** the first conversation is created after the worktree is ready
- **AND** the first conversation uses the worktree directory

#### Scenario: Creation fails

- **WHEN** worktree creation fails during the preparation
- **THEN** the preparation reports the failure
- **AND** no first conversation is created
- **AND** the task's stage and position are unchanged

#### Scenario: Blocked by an errored binding

- **WHEN** a task with no conversation has a worktree binding in the preparing or error state
- **THEN** the execution preparation explains that the binding must be resolved in the Git section
- **AND** it does not offer creating a worktree or continuing in the base project
- **AND** the card does not move and no instruction is sent

#### Scenario: Blocked binding does not affect later executions

- **WHEN** a task that already has a conversation has a worktree binding in the preparing or error state
- **THEN** its moves and stage instructions proceed as before
- **AND** no worktree block is presented

#### Scenario: No worktree question for a folder project

- **WHEN** the task belongs to a folder project
- **THEN** the execution preparation asks no worktree question
- **AND** only the model step applies

#### Scenario: No worktree question after a recorded base choice

- **WHEN** the task has a recorded base-project choice
- **THEN** the execution preparation asks no worktree question
- **AND** the first conversation is created in the base project directory

#### Scenario: No question for the automatic creation start

- **WHEN** the automatic first execution on task creation runs for a Git-backed task
- **THEN** the execution preparation does not ask the worktree choice
- **AND** the default worktree is created
- **AND** the first conversation uses its directory

#### Scenario: No worktree question for a cross-card message

- **WHEN** a cross-card message delivery needs the first conversation of a Git-backed task with no worktree and no recorded base-project choice
- **THEN** the delivery does not ask the worktree choice
- **AND** the default worktree is created
- **AND** the first conversation uses its directory

#### Scenario: Block a cross-card message on an errored binding

- **WHEN** a cross-card message delivery needs the first conversation of a task whose worktree binding is preparing or in error
- **THEN** the delivery fails with an actionable error
- **AND** no worktree and no conversation are created
- **AND** nothing is delivered
