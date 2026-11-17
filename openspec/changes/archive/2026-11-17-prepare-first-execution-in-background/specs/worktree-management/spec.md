# Spec Delta

## MODIFIED Requirements

### Requirement: Worktree choice before a card's first execution

When a Git-backed task has no conversation, no worktree, no recorded base-project choice, and its project's worktree policy is Ask, the execution preparation SHALL ask whether to create a worktree before the task's first execution starts, SHALL ask it before the move or run action is applied, and SHALL close that question as soon as it is answered. The answer SHALL decide the directory of the first execution: creating a worktree SHALL admit the task's title-derived default worktree as a background context operation after the move, and continuing SHALL record and persist the base-project choice. When that policy is Always create, the preparation SHALL NOT ask, SHALL NOT record a base-project choice, and SHALL admit the task's default worktree as a background context operation after the move; a choice the task already recorded for itself SHALL stand. An explicit first conversation for such a task SHALL create that default worktree before the conversation exists, so the policy cannot be bypassed, and SHALL fail with the derivation problem when its destination cannot be derived. When that policy is Never, the preparation SHALL NOT be presented, SHALL NOT create a worktree, SHALL NOT record a per-task choice, and the first conversation SHALL be created in the base project directory before the countdown is armed. When a default worktree destination cannot be derived, the creation SHALL fail with the derivation problem and that failure SHALL be reported in the card status region, and in the drawer operation status and the Git section when the host recorded it, instead of presenting a question; the execution SHALL NOT start until the destination is resolved. That question, when it applies, SHALL offer creating a worktree from the task's title-derived defaults or continuing in the base project, and it SHALL use the same derived branch, destination, and source defaults as the missing-worktree notice and the Git section. A Git-backed project SHALL always have a valid default destination, with or without a configured worktree base path, as defined by Title-derived worktree defaults. Declining SHALL record and persist the base-project choice and SHALL NOT create a branch or worktree. A created worktree SHALL be ready before the first conversation is created for the execution, so that conversation uses the worktree directory. A failed background creation SHALL keep the task's stage and position, SHALL keep the unresolved entry, SHALL create no first conversation, and SHALL be reported in the card status region; a failure the host recorded SHALL also be reported in the drawer operation status and the Git section, with the recovery actions defined by Visible operation status and recovery in `task-conversations`. The automatic first execution on task creation SHALL NOT present this choice; for a Git-backed project it SHALL admit the default worktree unless that project's policy is Never, in which case it SHALL use the project directory, and for a folder project it SHALL use the project directory. A cross-card message delivery that needs the target task's first conversation SHALL NOT present this choice; for a Git-backed task it SHALL create the default worktree before creating the conversation unless that project's policy is Never, in which case it SHALL use the current effective directory, and for a folder project or a task with a recorded base-project choice it SHALL use the current effective directory. A worktree binding in the preparing or error state SHALL block that delivery with an actionable error and SHALL NOT create a worktree or a conversation. A worktree binding in the preparing or error state SHALL block the task's first execution: the preparation SHALL explain that the binding must be resolved in the Git section, SHALL NOT offer creating a worktree or continuing in the base project, and the move or run action SHALL NOT proceed. That block SHALL apply only to the task's first execution; a task that already has a conversation SHALL keep executing while its binding is in that state.

#### Scenario: Ask before the first drop

- **WHEN** the user drops a task with no conversation and no worktree on a permitted instructed stage
- **THEN** the execution preparation asks whether to create a worktree
- **AND** the task does not move while that question is open
- **AND** the task moves once the question is answered, and the creation follows in the background

#### Scenario: Create from derived defaults

- **WHEN** the user chooses to create a worktree and a valid destination can be derived
- **THEN** a worktree is created in the background with the derived branch, destination, and source
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

- **WHEN** worktree creation fails after the task moved
- **THEN** the failure is reported in the card status region
- **AND** a failure the host recorded is also reported in the drawer operation status and the Git section
- **AND** no first conversation is created
- **AND** the task keeps the stage it moved to and its unresolved entry

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
- **THEN** no execution preparation is presented
- **AND** the first conversation uses the project directory before the countdown is armed

#### Scenario: No worktree question after a recorded base choice

- **WHEN** the task has a recorded base-project choice
- **THEN** no execution preparation is presented
- **AND** the first conversation is created in the base project directory when the instruction is dispatched

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

#### Scenario: No question under the Always create policy

- **WHEN** the user drops a task with no conversation and no worktree whose project worktree policy is Always create
- **THEN** the execution preparation asks no worktree question
- **AND** it admits the default worktree in the background after the task moves
- **AND** no base-project choice is recorded

#### Scenario: No question and no worktree under the Never policy

- **WHEN** the user drops a task with no conversation and no worktree whose project worktree policy is Never
- **THEN** no execution preparation is presented
- **AND** no worktree and no branch are created
- **AND** the first conversation is created in the base project directory before the countdown is armed
- **AND** no per-task choice is recorded

#### Scenario: Fall back to the question without a derivable destination

- **WHEN** the project worktree policy is Always create and no valid worktree destination can be derived
- **THEN** the preparation does not fall back to the question
- **AND** the creation fails with the derivation problem
- **AND** the failure is reported in the card status region
- **AND** the execution does not start until the destination is resolved

#### Scenario: Automatic start respects the Never policy

- **WHEN** the automatic first execution on task creation runs for a Git-backed task whose project worktree policy is Never
- **THEN** the execution preparation creates no worktree
- **AND** the first conversation uses the project directory
