# Spec Delta

## MODIFIED Requirements

### Requirement: YAML workflow configuration
Each board SHALL support its own workflow configuration in YAML, including the initial stage, grouped columns, allowed transitions, optional stage entry instructions, each stage's stored placement, and the board's default presentation. The active board's workflow SHALL be used for rendering, transitions, and task creation. The product SHALL honor configured transition restrictions by requiring explicit confirmation before a restricted transition can proceed, and it SHALL honor column grouping. This version SHALL NOT implement WIP limits and SHALL NOT introduce reusable workflow templates.

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

## ADDED Requirements

### Requirement: Board presentation selection

The board SHALL present the active board in one of two presentations: the column board and the workflow diagram. The presentation presented when a board opens SHALL be that board's configured default presentation, and a workflow without that setting SHALL open the column board. A view control in the board header SHALL switch the presentation. The chosen presentation SHALL last only for the session: it SHALL NOT be stored, and a reload SHALL present the configured default again, as SHALL selecting a different board. Switching the presentation SHALL NOT change board data, tasks, commands, task positions, or the workflow, and every existing board behavior — drag and drop, the task drawer, search, the project filter, notices, and selection — SHALL remain available in the column board presentation.

#### Scenario: Open the column board by default

- **WHEN** the user opens a board whose workflow does not configure a default presentation
- **THEN** the board presents the column board

#### Scenario: Open the configured presentation

- **WHEN** the user opens a board whose workflow configures the workflow diagram as its default presentation
- **THEN** the board presents the workflow diagram

#### Scenario: Switch the presentation

- **WHEN** the user activates the workflow diagram in the board header's view control
- **THEN** the board presents the workflow diagram for the active board

#### Scenario: Return to the configured default after a reload

- **WHEN** the user switches the presentation and then reloads the board
- **THEN** the board presents the configured default presentation again

#### Scenario: Use each board's own default

- **WHEN** the user switches from a board that opens the workflow diagram to a board that does not configure a default presentation
- **THEN** the second board presents the column board

#### Scenario: Switch without changing board data

- **WHEN** the user switches the presentation
- **THEN** no command is sent
- **AND** no task, stage, position, or workflow changes
