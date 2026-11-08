# Spec Delta

## MODIFIED Requirements

### Requirement: Team updates and three-way application

Applying team changes SHALL compare the published document with the last received document and the local Hub. Applying SHALL apply boards that changed only in the published document, SHALL keep boards that changed only locally as drafts or pending changes, and SHALL require an explicit per-board choice for a board that changed on both sides. A difference limited to stage placement SHALL NOT count as a change that requires a choice: applying SHALL merge the placement of both sides per stage, SHALL apply the resulting workflow locally, and SHALL leave that board as a draft or pending change until it is published. When both sides changed the placement of the same stage, the local placement SHALL take precedence. The merged workflow text SHALL preserve the authored text of the side that changed the workflow's meaning, and the local text when neither side did. A storage that requires an explicit operation (Git) SHALL apply the comparison when the user gets team updates. A storage that supports continuous synchronization (Google Drive or a local folder) SHALL apply the comparison automatically when it has no conflict, blocker, or local pending change on a board that also changed remotely, and SHALL require review otherwise. Applying SHALL be all-or-nothing for the Hub: either every selected change is applied or none is. After a successful application the last received document SHALL record the applied content, keeping the previous content for any board that still needs a choice.

#### Scenario: Apply a team-only change

- **WHEN** the team changed one board and the local installation did not change it
- **THEN** the board's published workflow is applied on the next get-updates or automatic synchronization
- **AND** the board is presented as up to date

#### Scenario: Apply a team-only change automatically

- **WHEN** a Google Drive or local folder check finds that only the team changed one board
- **THEN** that board's published workflow is applied during the check
- **AND** no user action is required

#### Scenario: Keep a local draft

- **WHEN** the local installation changed a board and the team did not
- **THEN** applying team updates leaves that board unchanged and it remains a draft or pending change

#### Scenario: Both sides changed the same board

- **WHEN** the team and the local installation both changed a board's workflow in ways that are not limited to stage placement
- **THEN** the review lists that board as needing a choice
- **AND** no part of that board is applied before the choice

#### Scenario: Choose the team version

- **WHEN** the user chooses the team version for a conflicting board
- **THEN** the board's published workflow is applied locally
- **AND** the local draft for that board is replaced

#### Scenario: Choose the local version

- **WHEN** the user chooses the local version for a conflicting board
- **THEN** the local workflow is retained as a draft or pending change
- **AND** the published workflow is not applied to that board

#### Scenario: Application is all-or-nothing

- **WHEN** applying an update set would be refused for any board
- **THEN** no board, workflow, or board order changes locally

#### Scenario: Apply a placement-only difference without a choice

- **WHEN** the team and the local installation changed only the placement of stages on the same board
- **THEN** applying merges the placements without listing that board as needing a choice
- **AND** the board becomes a draft or pending change until it is published

#### Scenario: Keep the local placement beside a team workflow change

- **WHEN** the team changed a board's workflow meaning and the local installation only moved stages
- **THEN** applying takes the team's workflow change
- **AND** the locally moved stages keep their placement
- **AND** the board is not listed as needing a choice

#### Scenario: Keep the local placement for the same stage

- **WHEN** the team and the local installation moved the same stage to different positions
- **THEN** applying keeps the local position for that stage
- **AND** every other stage takes the position of the side that moved it

#### Scenario: Preserve the authored workflow text

- **WHEN** applying merges an authored workflow with a placement-only difference
- **THEN** the merged workflow keeps the comments and formatting of the side that changed the workflow's meaning
- **AND** it keeps the local authored text when neither side changed the meaning
