# Spec Delta

## MODIFIED Requirements

### Requirement: Nested native conversation tabs
A task SHALL begin with no native DSH conversation in its Conversations section. The section SHALL provide an explicit start action that creates the first distinct native DSH conversation as a tab within the same task, and a plus action that creates another distinct native DSH conversation. The first conversation SHALL be created only by that explicit start action or by a stage instruction that needs a conversation and finds none open. For a Git-backed task without a worktree, the explicit start action SHALL remain unavailable until the worktree choice is resolved as defined by `worktree-management`. The first conversation SHALL use the task's current effective directory at creation time.

#### Scenario: Open a newly created task
- **WHEN** a user opens a newly created task's Conversations section
- **THEN** no native conversation tab exists
- **AND** an explicit start action and a plus action are available, subject to the worktree choice

#### Scenario: Start the first conversation
- **WHEN** the user starts the first conversation
- **THEN** a native DSH conversation tab is added
- **AND** its native session uses the task's current effective directory

#### Scenario: Add another continuous conversation
- **WHEN** the user selects the plus action in a task that already has a conversation
- **THEN** a new native DSH conversation is added as another tab associated with that same task

#### Scenario: A stage instruction creates the first conversation
- **WHEN** a stage instruction needs a conversation and the task has no open conversation
- **THEN** the first native DSH conversation is created in the task's current effective directory
- **AND** the stage instruction is sent to it

#### Scenario: Withhold the explicit start until the worktree choice
- **WHEN** the user requests the explicit first start for a Git-backed task with no worktree, no recorded base-project choice, and no conversation
- **THEN** no conversation is created
- **AND** the Conversations section presents the pending worktree choice

#### Scenario: Start the first conversation after a worktree choice
- **WHEN** the task has a ready worktree, an attached worktree, or a recorded base-project choice
- **THEN** the explicit start creates the first conversation at the task's current effective directory
