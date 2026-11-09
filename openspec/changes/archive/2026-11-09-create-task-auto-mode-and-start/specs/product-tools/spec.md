# Spec Delta

## MODIFIED Requirements

### Requirement: Tool writes follow the same task behavior as the board
Task creation through tools SHALL use the target board's configured initial workflow stage and SHALL require a project owned by that board's Hub. Task creation SHALL accept an auto-mode option and SHALL persist the selected value. When that initial stage has an entry instruction, creation SHALL prepare the task's first execution immediately — the default worktree for a Git-backed project, the first conversation, and the dispatch of the stage instruction — without the cancelable countdown, because the agent surface has no cancelable window. The tool result SHALL report the start outcome, and a failed preparation or dispatch SHALL leave the task in its initial stage with the unresolved entry. When the initial stage has no entry instruction, creation SHALL NOT start an agent. Tool editing SHALL allow title and description changes at any stage, including for tasks with worktrees, without automatically messaging task conversations. Tool changes SHALL affect the same task data shown in the active board UI.

#### Scenario: Create in an instructed initial stage
- **WHEN** an authorized board tool creates a task on a board whose initial stage has an entry instruction
- **THEN** the task appears in that stage with the requested project and task text
- **AND** the first execution is prepared and the stage instruction is dispatched in the same call
- **AND** the tool result reports the start outcome

#### Scenario: Create without triggering task execution
- **WHEN** an authorized board tool creates a task on a board whose initial stage has no entry instruction
- **THEN** the task appears in that stage with the requested project and task text
- **AND** creation does not initiate an agent execution

#### Scenario: Create with auto mode
- **WHEN** an authorized board tool creates a task with auto mode enabled
- **THEN** the task is persisted with auto mode enabled
- **AND** the start rule applies independently of the auto-mode value

#### Scenario: Report a failed start
- **WHEN** the first-execution preparation or the stage-instruction dispatch fails during tool creation
- **THEN** the task remains in its initial stage with the unresolved entry
- **AND** the tool result reports the failure
- **AND** no automatic retry occurs

#### Scenario: Reject a project from another Hub
- **WHEN** a board tool receives a project identifier that is not owned by the board's Hub
- **THEN** the task is not created
- **AND** the tool reports the scope mismatch

#### Scenario: Edit an existing task outside Backlog
- **WHEN** an authorized board tool edits the title or description of a task outside Backlog that has a worktree
- **THEN** the updated text is reflected in that task's board data
- **AND** the edit does not automatically send a message to its conversations or initiate an execution
