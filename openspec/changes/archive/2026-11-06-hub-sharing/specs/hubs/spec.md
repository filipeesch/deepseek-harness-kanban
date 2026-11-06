# Spec Delta

## MODIFIED Requirements

### Requirement: Hub deletion

The plugin SHALL allow deleting a Hub only when none of its boards contains a task. The last remaining Hub SHALL NOT be deleted. Deleting an eligible Hub SHALL remove the Hub, its empty boards, and its task-free project registrations, and SHALL retain project directories, worktrees, Git branches, native conversations, and native workspaces. The confirmation SHALL identify the Hub, its board count, and its project count before the user confirms. When the Hub is published, deletion SHALL also remove its publishing binding and managed clone and SHALL stop its automatic checks, and SHALL leave the published document untouched; the confirmation SHALL state that the team's published configuration is not removed.

#### Scenario: Delete an empty Hub

- **WHEN** another Hub exists and no board in the target Hub has a task
- **THEN** the Hub, its empty boards, and its task-free project registrations are removed after confirmation
- **AND** directories, worktrees, branches, native conversations, and native workspaces are retained

#### Scenario: Block deletion when a board has tasks

- **WHEN** any board in the target Hub contains a task
- **THEN** the Hub is not deleted and the plugin reports how many tasks block it

#### Scenario: Protect the last Hub

- **WHEN** the user attempts to delete the last remaining Hub
- **THEN** the delete action is unavailable and the plugin explains that at least one Hub must exist

#### Scenario: Delete the active Hub

- **WHEN** the active Hub is deleted and another Hub exists
- **THEN** the plugin selects the first remaining Hub and presents it without leaving a stale Hub tab

#### Scenario: Delete a published Hub

- **WHEN** the user deletes a published Hub
- **THEN** the Hub, its publishing binding, and its managed clone are removed locally
- **AND** its automatic checks stop
- **AND** the published document and the team's configuration are unchanged
- **AND** the confirmation states that the team's published configuration is not removed
