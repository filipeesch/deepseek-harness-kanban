# Spec Delta

## MODIFIED Requirements

### Requirement: Optional worktrees and compact creation notice

A worktree SHALL remain optional for a task whose project is Git-backed. When the project's worktree policy is Ask and such a task has no associated worktree and its missing-worktree notice has not been dismissed, its conversation area SHALL show a compact notice line above the chat with a base-project choice. When that policy is Always create, the notice of such a task SHALL offer creating the worktree without offering a base-project choice. When that policy is Never, the notice SHALL NOT be shown. The notice SHALL present the derived branch and destination in a compact line with its actions, wrapping the actions below the summary only when the drawer is too narrow to keep them inline, and SHALL NOT occupy a card-like block above the conversation. The notice SHALL offer Create and Review in Git; a Git-backed project SHALL always have a derivable destination, with or without a configured worktree base path. Dismissing the notice SHALL record and persist the task's choice to continue in the base project; it SHALL NOT create a branch or worktree or change any conversation's effective directory. For such a task under the Ask policy that also has no conversation, the conversation area SHALL withhold the explicit first-conversation start action, including the plus action, until the notice is dismissed or a created or attached worktree is ready. Under the Never policy the conversation area SHALL NOT withhold that action for the worktree choice. A worktree that is preparing or in error SHALL NOT satisfy that choice. A stage instruction that would create the task's first conversation SHALL NOT create it while the choice is pending; the execution preparation defined by Worktree choice before a card's first execution SHALL ask for that choice first. A task whose project is a folder project SHALL NOT show the notice and SHALL NOT offer any worktree action.

#### Scenario: Open a task without a worktree

- **WHEN** a user opens the conversation area of a Git-backed task that has no worktree and whose missing-worktree notice has not been dismissed
- **THEN** a compact notice line above the chat offers a base-project choice
- **AND** the notice line shows the derived branch and destination
- **AND** the notice also offers Create and Review in Git
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

#### Scenario: No notice under the Never policy

- **WHEN** a user opens the conversation area of a Git-backed task whose project worktree policy is Never and which has no worktree
- **THEN** no missing-worktree notice is shown
- **AND** the explicit first-conversation start action is available when the task has no conversation

#### Scenario: Notice offers only creation under the Always create policy

- **WHEN** a user opens the conversation area of a Git-backed task whose project worktree policy is Always create and which has no worktree
- **THEN** the notice offers creating the worktree
- **AND** the notice does not offer continuing in the base project

### Requirement: Worktree choice before a card's first execution

When a Git-backed task has no conversation, no worktree, no recorded base-project choice, and its project's worktree policy is Ask, the execution preparation that precedes the task's first execution SHALL ask whether to create a worktree before that execution starts. When that policy is Always create, the preparation SHALL NOT ask, SHALL create the task's default worktree, and SHALL NOT record a base-project choice; a choice the task already recorded for itself SHALL stand. An explicit first conversation for such a task SHALL create that default worktree before the conversation exists, so the policy cannot be bypassed, and SHALL fail with the derivation problem when its destination cannot be derived. When that policy is Never, the preparation SHALL NOT ask, SHALL NOT create a worktree, SHALL NOT record a per-task choice, and SHALL create the first conversation in the base project directory. When the policy is Always create and no valid destination can be derived, the preparation SHALL present the question defined for the Ask policy together with the failure, and SHALL NOT start the execution without an answer. That question SHALL offer creating a worktree from the task's title-derived defaults or continuing in the base project, and it SHALL use the same derived branch, destination, and source defaults as the missing-worktree notice and the Git section. A Git-backed project SHALL always have a valid default destination, with or without a configured worktree base path, as defined by Title-derived worktree defaults. Declining SHALL record and persist the base-project choice and SHALL NOT create a branch or worktree. A created worktree SHALL be ready before the first conversation is created for the execution, so that conversation uses the worktree directory. A failed creation SHALL be reported in the preparation, SHALL keep the task's stage and position unchanged, and SHALL NOT start the execution. The automatic first execution on task creation SHALL NOT present this choice; for a Git-backed project it SHALL create the default worktree unless that project's policy is Never, in which case it SHALL use the project directory, and for a folder project it SHALL use the project directory. A cross-card message delivery that needs the target task's first conversation SHALL NOT present this choice; for a Git-backed task it SHALL create the default worktree before creating the conversation unless that project's policy is Never, in which case it SHALL use the current effective directory, and for a folder project or a task with a recorded base-project choice it SHALL use the current effective directory. A worktree binding in the preparing or error state SHALL block that delivery with an actionable error and SHALL NOT create a worktree or a conversation. A worktree binding in the preparing or error state SHALL block the task's first execution: the preparation SHALL explain that the binding must be resolved in the Git section, SHALL NOT offer creating a worktree or continuing in the base project, and the move or run action SHALL NOT proceed. That block SHALL apply only to the task's first execution; a task that already has a conversation SHALL keep executing while its binding is in that state.

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

#### Scenario: No question under the Always create policy

- **WHEN** the user drops a task with no conversation and no worktree whose project worktree policy is Always create
- **THEN** the execution preparation asks no worktree question
- **AND** it creates the default worktree before the first conversation
- **AND** no base-project choice is recorded

#### Scenario: No question and no worktree under the Never policy

- **WHEN** the user drops a task with no conversation and no worktree whose project worktree policy is Never
- **THEN** the execution preparation asks no worktree question
- **AND** no worktree and no branch are created
- **AND** the first conversation is created in the base project directory
- **AND** no per-task choice is recorded

#### Scenario: Fall back to the question without a derivable destination

- **WHEN** the project worktree policy is Always create and no valid worktree destination can be derived
- **THEN** the execution preparation presents the worktree question with the failure
- **AND** the task does not move until the choice is answered and the preparation completes

#### Scenario: Automatic start respects the Never policy

- **WHEN** the automatic first execution on task creation runs for a Git-backed task whose project worktree policy is Never
- **THEN** the execution preparation creates no worktree
- **AND** the first conversation uses the project directory
