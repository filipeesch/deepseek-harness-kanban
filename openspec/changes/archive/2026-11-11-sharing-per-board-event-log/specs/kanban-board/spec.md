# Spec Delta

## MODIFIED Requirements

### Requirement: YAML workflow configuration

Each board SHALL support its own workflow configuration in YAML, including the initial stage, grouped columns, allowed transitions with an optional condition for each target, optional stage entry instructions, each stage's stored placement, each stage's stored size, the board's default presentation, and an optional stable stage identity for each stage. A transition entry SHALL be authored either as a bare target identifier or as a mapping that carries the target identifier and an optional condition. Both forms SHALL be accepted, neither form SHALL be deprecated, both forms SHALL describe the same transition, and a single list MAY mix them. The condition SHALL describe when that transition is followed; it SHALL NOT change which transitions the workflow permits. The active board's workflow SHALL be used for rendering, transitions, and task creation. The product SHALL honor configured transition restrictions by requiring explicit confirmation before a restricted transition can proceed, and it SHALL honor column grouping.

A stage's stable identity SHALL be a value distinct from the stage identifier, SHALL be unique within the board, SHALL be preserved when the identifier or any other stage field is edited, and SHALL be preserved by every edit that does not present it. A workflow whose stages carry no stable identity SHALL be accepted: the configuration is valid without one, and an identity SHALL be assigned before the stage is published to a team. An authored field the editor does not present SHALL survive an edit unchanged.

This version SHALL NOT implement WIP limits and SHALL NOT introduce reusable workflow templates.

#### Scenario: Render a configured column group

- **WHEN** the active board's workflow groups multiple stages together
- **THEN** the board presents those stages as a group while retaining each stage as a distinct task destination

#### Scenario: Reject a prohibited transition

- **WHEN** a user requests a move that the active board's workflow does not permit from its current stage and does not confirm the override
- **THEN** the task remains in its current stage
- **AND** the prohibited move does not initiate an agent execution

#### Scenario: Restricted transition requires confirmation

- **WHEN** a user requests a move that the active board's workflow does not permit
- **THEN** the board asks for explicit confirmation before moving the task
- **AND** the task remains in its current stage until the user confirms
- **AND** the request does not initiate an agent execution

#### Scenario: Read a stage's stored size

- **WHEN** the active board's workflow stores a size for a stage
- **THEN** the board presents that stage at that size, bounded by the minimum size

#### Scenario: Reject an invalid stage size

- **WHEN** a workflow configuration stores a stage size that is not a finite number, is below the minimum, or lies outside the accepted range
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Do not enforce a WIP capacity

- **WHEN** a user makes an otherwise permitted move into a stage that already contains tasks
- **THEN** the board does not reject the move because of a WIP capacity limit

#### Scenario: Validate against the active board's workflow

- **WHEN** the user edits the workflow of the active board
- **THEN** the editor validates that board's YAML
- **AND** no other board's workflow is read or replaced

#### Scenario: Reject an unsupported default presentation

- **WHEN** a workflow configuration sets a default presentation other than the column board or the workflow diagram
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Accept a bare transition identifier

- **WHEN** a stage configures a transition as a bare target identifier
- **THEN** the workflow is accepted and the transition is drawn and followed as before

#### Scenario: Accept a transition with a condition

- **WHEN** a stage configures a transition as a mapping with a target identifier and a condition
- **THEN** the workflow is accepted and the condition is kept with that transition

#### Scenario: Accept a mixed transition list

- **WHEN** one stage mixes bare target identifiers and conditioned transitions in the same list
- **THEN** the workflow is accepted and every entry describes one transition

#### Scenario: Reject a transition to an unknown stage

- **WHEN** a stage configures a transition whose target stage does not exist
- **THEN** the configuration is rejected as invalid
- **AND** the last valid workflow remains in effect

#### Scenario: Keep the permitted set unchanged by a condition

- **WHEN** a stage configures the same targets with and without conditions
- **THEN** the same requests are permitted and the same requests require confirmation

#### Scenario: Keep a stage identity across an identifier rename

- **WHEN** a workflow configuration carries a stable identity for a stage and that stage's identifier is edited
- **THEN** the stage keeps its stable identity
- **AND** the resulting workflow is accepted

#### Scenario: Accept a workflow without stage identities

- **WHEN** a board whose stages carry no stable identity is opened
- **THEN** the configuration is accepted and the board renders normally
- **AND** no identity is fabricated while the board stays unpublished

#### Scenario: Preserve an authored identity the editor does not present

- **WHEN** the user edits one stage of a workflow whose stages carry stable identities
- **THEN** every stage keeps its authored identity
- **AND** no identity is moved to another stage

### Requirement: Board creation and lifecycle

Creating a board SHALL require a name and SHALL initialize it with the default workflow. Renaming a board SHALL NOT change its tasks, workflow, conversations, or worktrees. A board SHALL be deletable only when it contains no tasks. Deleting a board that is bound to the team's published configuration SHALL require choosing whether the removal applies only to this installation or to the team. A local-only removal SHALL remove the board locally and SHALL keep it out of later team updates. A team-wide removal SHALL remove the board locally and SHALL be included in the team's published configuration when the user next publishes the Hub manifest; a team-wide removal SHALL NOT be sent by any automatic action. Deleting the last board SHALL leave the Hub with no boards and SHALL present the Hub's create-board empty state. Deleting a board SHALL NOT delete its projects, project directories, worktrees, branches, native conversations, or native workspaces.

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
- **WHEN** the user deletes a board that is bound to the team's published configuration and the board has no tasks
- **THEN** the confirmation offers removing it only from this installation or for the team
- **AND** no deletion happens before one of those choices

#### Scenario: Remove a board only from this installation
- **WHEN** the user confirms removing a published board only from this installation
- **THEN** the board disappears from this installation
- **AND** the published configuration is unchanged
- **AND** later team updates do not recreate the board here

#### Scenario: Remove a board for the team
- **WHEN** the user confirms removing a published board for the team
- **THEN** the board disappears from this installation
- **AND** the removal is included in the next publish of the Hub manifest

#### Scenario: Remove a board for the team on Google Drive
- **WHEN** the user confirms removing a published board for the team on a Google Drive binding
- **THEN** the board disappears from this installation
- **AND** the removal is included in the team's published configuration when the Hub manifest is published
- **AND** nothing is sent by an automatic check

#### Scenario: Remove a board for the team on a local folder
- **WHEN** the user confirms removing a published board for the team on a local folder binding
- **THEN** the board disappears from this installation
- **AND** the removal is written into the `kanban-hub.yaml` manifest when the user publishes the manifest
- **AND** nothing is sent by an automatic check

#### Scenario: Delete the last board
- **WHEN** the user confirms deletion of the only board in a Hub and that board has no tasks
- **THEN** the board is removed and the Hub presents its create-board empty state
