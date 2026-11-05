# Spec Delta

## ADDED Requirements

### Requirement: Worktree choice before a card's first execution

When a Git-backed task has no conversation, no worktree, and no recorded base-project choice, the execution preparation that precedes the task's first execution SHALL ask whether to create a worktree before that execution starts. The choice SHALL offer creating a worktree from the task's title-derived defaults or continuing in the base project, and it SHALL use the same derived branch, destination, and source defaults as the missing-worktree notice and the Git section. Declining SHALL record and persist the base-project choice and SHALL NOT create a branch or worktree. When no valid destination can be derived, the create choice SHALL be unavailable and the preparation SHALL explain that a destination must be configured; it SHALL NOT navigate away from the board. A created worktree SHALL be ready before the first conversation is created for the execution, so that conversation uses the worktree directory. A failed creation SHALL be reported in the preparation, SHALL keep the task's stage and position unchanged, and SHALL NOT start the execution. A worktree binding in the preparing or error state SHALL block the task's first execution: the preparation SHALL explain that the binding must be resolved in the Git section, SHALL NOT offer creating a worktree or continuing in the base project, and the move or run action SHALL NOT proceed. That block SHALL apply only to the task's first execution; a task that already has a conversation SHALL keep executing while its binding is in that state.

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

- **WHEN** no worktree base path is configured and the task has no worktree
- **THEN** the create choice is unavailable in the preparation
- **AND** the preparation explains that a destination must be configured
- **AND** the dialog does not navigate away from the board
- **AND** the task's stage and position are unchanged

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

## MODIFIED Requirements

### Requirement: Optional worktrees and prominent creation notice

A worktree SHALL remain optional for a task whose project is Git-backed. When such a task has no associated worktree and its missing-worktree notice has not been dismissed, its conversation area SHALL show a prominent notice above the chat with a base-project choice. When a destination is configured, the notice SHALL offer Create and Review in Git; without a configured destination it SHALL route the user to the Git section to set one. Dismissing the notice SHALL record and persist the task's choice to continue in the base project; it SHALL NOT create a branch or worktree or change any conversation's effective directory. For such a task that also has no conversation, the conversation area SHALL withhold the explicit first-conversation start action, including the plus action, until the notice is dismissed or a created or attached worktree is ready. A worktree that is preparing or in error SHALL NOT satisfy that choice. A stage instruction that would create the task's first conversation SHALL NOT create it while the choice is pending; the execution preparation defined by Worktree choice before a card's first execution SHALL ask for that choice first. A task whose project is a folder project SHALL NOT show the notice and SHALL NOT offer any worktree action.

#### Scenario: Open a task without a worktree

- **WHEN** a user opens the conversation area of a Git-backed task that has no worktree and whose missing-worktree notice has not been dismissed
- **THEN** a prominent notice above the chat offers a base-project choice
- **AND** when a destination is configured, the notice also offers Create and Review in Git
- **AND** when no destination is configured, the notice offers a path to the Git section
- **AND** if the task has no conversation, the explicit first-conversation start action is withheld

#### Scenario: Dismiss the missing-worktree notice

- **WHEN** the user chooses to continue in the base project for a task that has no worktree
- **THEN** the notice is hidden and the choice is persisted
- **AND** no Git resources are created and no conversation's effective directory changes
- **AND** the explicit first-conversation start action becomes available when the task has no conversation

#### Scenario: No notice for a folder project

- **WHEN** a task belongs to a folder project
- **THEN** no missing-worktree notice is shown
- **AND** no worktree action is offered in its conversation area or drawer

#### Scenario: Create a worktree before the first conversation

- **WHEN** a Git-backed task has no conversation and the user creates or attaches a worktree
- **THEN** the explicit first-conversation start action becomes available when the worktree is ready
- **AND** the first conversation uses the worktree's effective directory

#### Scenario: Worktree still preparing or in error

- **WHEN** a worktree is preparing or is in error
- **THEN** the explicit first-conversation start action remains withheld
- **AND** the Git and operation surfaces expose the next step

#### Scenario: Stage instruction before the worktree choice

- **WHEN** a stage instruction would need a conversation while the worktree choice is pending
- **THEN** the execution preparation asks for the worktree choice first
- **AND** no first conversation is created before that choice is resolved
- **AND** the first conversation uses the resolved directory

#### Scenario: Existing conversation before the worktree

- **WHEN** a Git-backed task already has a conversation and the user creates a worktree later
- **THEN** the existing conversation is migrated as before
- **AND** the explicit first-conversation start gate does not apply
