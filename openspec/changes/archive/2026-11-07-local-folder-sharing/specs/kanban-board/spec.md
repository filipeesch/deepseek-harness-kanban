# Spec Delta

## MODIFIED Requirements

### Requirement: Board creation and lifecycle

Creating a board SHALL require a name and SHALL initialize it with the default workflow. Renaming a board SHALL NOT change its tasks, workflow, conversations, or worktrees. A board SHALL be deletable only when it contains no tasks. Deleting a board that is bound to the team's shared configuration SHALL require choosing whether the removal applies only to this installation or to the team. A local-only removal SHALL remove the board locally and SHALL keep it out of later team updates. A team-wide removal SHALL remove the board locally and SHALL be included in the team's shared configuration on the next synchronization: the next explicit publish for Git, or the next automatic synchronization for Google Drive or a local folder. Deleting the last board SHALL leave the Hub with no boards and SHALL present the Hub's create-board empty state. Deleting a board SHALL NOT delete its projects, project directories, worktrees, branches, native conversations, or native workspaces.

#### Scenario: Create a board with the default workflow

- **WHEN** the user creates a board with a valid name
- **THEN** the board appears in the Hub's board tabs
- **AND** it uses the default workflow stages

#### Scenario: Rename a board

- **WHEN** the user saves a valid new name for a board
- **THEN** the board tab and board header show the new name
- **AND** the board's tasks and workflow are unchanged

#### Scenario: Block deletion when the board has tasks

- **WHEN** the user attempts to delete a board that contains a task
- **THEN** the board is not deleted and the plugin reports how many tasks block it

#### Scenario: Choose the scope of a board removal

- **WHEN** the user deletes a board that is bound to the team's shared configuration and the board has no tasks
- **THEN** the confirmation offers removing it only from this installation or for the team
- **AND** no deletion happens before one of those choices

#### Scenario: Remove a board only from this installation

- **WHEN** the user confirms removing a published board only from this installation
- **THEN** the board disappears from this installation
- **AND** the shared document is unchanged
- **AND** later team updates do not recreate the board here

#### Scenario: Remove a board for the team

- **WHEN** the user confirms removing a published board for the team on a Git binding
- **THEN** the board disappears from this installation
- **AND** the removal is included in the next publish of that Hub

#### Scenario: Remove a board for the team on Google Drive

- **WHEN** the user confirms removing a published board for the team on a Google Drive binding
- **THEN** the board disappears from this installation
- **AND** the removal is included in the team's shared configuration on the next automatic synchronization

#### Scenario: Remove a board for the team on a local folder

- **WHEN** the user confirms removing a published board for the team on a local folder binding
- **THEN** the board disappears from this installation
- **AND** the removal is written into `kanban-hub.yaml` on the next automatic synchronization

#### Scenario: Delete the last board

- **WHEN** the user confirms deletion of the only board in a Hub and that board has no tasks
- **THEN** the board is removed and the Hub presents its create-board empty state
