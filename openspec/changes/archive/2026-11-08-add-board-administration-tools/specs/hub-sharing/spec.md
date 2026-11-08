# Spec Delta

## MODIFIED Requirements

### Requirement: Drafts and explicit publishing

Saving a board, a board name, a board order, or a workflow SHALL change local state only and SHALL mark that board as a draft or pending change. A storage that requires explicit publishing (Git) SHALL send every draft of the Hub as one document only when the user publishes. Publishing SHALL NOT be available while the Hub has unapplied team updates for that storage. When the published document changed since the last received document, a publish SHALL publish nothing, keep every local draft, and report the new team updates. A storage that supports continuous synchronization (Google Drive or a local folder) SHALL follow the Continuous synchronization requirement instead of an explicit publish action.

A board administration tool invoked at the user's explicit request SHALL publish the local board change when the Hub is bound and the comparison permits publishing, without a separate publish action. A storage that requires explicit publishing SHALL publish immediately after the local change, and a storage that supports continuous synchronization SHALL follow the Continuous synchronization requirement. This automatic publishing SHALL apply to board creation, board rename, workflow replacement, workflow edit, and team-scoped board removal, and SHALL NOT apply to a local-only board removal. A publishing failure or blocker SHALL keep the local change, keep the board as a draft or pending change, and report the failure.

#### Scenario: Saving a workflow creates a draft

- **WHEN** the user saves a workflow on a Git binding
- **THEN** the local board uses the new workflow
- **AND** the board is presented as a draft
- **AND** nothing is published

#### Scenario: Save and share publishes

- **WHEN** the user saves a workflow through the share action on a Git binding
- **THEN** the local save completes before the publish starts
- **AND** the published document contains the saved workflow
- **AND** the board is no longer a draft

#### Scenario: A failed share keeps the local save

- **WHEN** the local save succeeds and the publish fails
- **THEN** the local workflow remains saved
- **AND** the board remains a draft
- **AND** the failure is reported without discarding editing state

#### Scenario: Publishing is blocked by team updates

- **WHEN** the Hub has team updates that have not been applied
- **THEN** the Publish action is unavailable
- **AND** the interface presents Get updates as the required next action

#### Scenario: A lost publish race changes nothing

- **WHEN** the published document changed since the last check and the user publishes
- **THEN** nothing is published and every local draft is retained
- **AND** the Hub reports the new team updates

#### Scenario: Publish a board created through a tool

- **WHEN** an agent creates a board through a board administration tool on a Git binding and publishing is permitted
- **THEN** the board is saved locally before publishing starts
- **AND** the published document contains the new board
- **AND** the board is no longer presented as a draft

#### Scenario: Publish a tool workflow edit

- **WHEN** an agent replaces or edits a board workflow through a board administration tool on a Git binding and publishing is permitted
- **THEN** the local workflow is saved before publishing starts
- **AND** the published document contains the saved workflow

#### Scenario: Tool writes on continuous storage synchronize

- **WHEN** an agent changes a board through a board administration tool on a storage that synchronizes continuously
- **THEN** the local change is saved
- **AND** the change is left to the continuous synchronization rather than an explicit publish action

#### Scenario: A failed tool publish keeps the local change

- **WHEN** a board administration tool saves a local board change and the subsequent publish fails or is blocked
- **THEN** the local change remains saved
- **AND** the board remains a draft or pending change
- **AND** the failure is reported without discarding the local change

#### Scenario: Do not publish a local-only board removal

- **WHEN** an agent removes a team-bound board with the local-only scope
- **THEN** the board disappears locally
- **AND** no publish is started for that removal
- **AND** the team's document is unchanged
