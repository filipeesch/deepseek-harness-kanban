# Spec Delta

## MODIFIED Requirements

### Requirement: Drafts and explicit publishing

Saving a board, a board name, a board order, a project scope, or a workflow SHALL change local state only, whichever surface performs the save. A board SHALL be presented as a draft when its local workflow, name, project scope, or position differs from the version this installation last applied for that board. Publishing SHALL be manual and SHALL be scoped to one board: publishing a board SHALL derive the events that carry its workflow, name, project scope, and position, and SHALL append them to that board's own log. Publishing SHALL NOT write any entry that names other boards, and SHALL NOT send another board's drafts. There SHALL be no separate publish of a board list. A Hub-level publish action SHALL publish every board of the Hub that has local changes, appending each board's events to its own log, and SHALL report a failure for each board that could not be published without stopping the others.

Publishing SHALL be an operator action. A board administration tool SHALL NOT publish, SHALL NOT schedule a publish, and SHALL NOT report a publishing outcome beyond stating that the change is local: board creation, board rename, workflow replacement, workflow edit, and project scope change performed through a tool SHALL leave a team-bound board as a draft, and only the operator's publish action SHALL carry it to the team. A tool SHALL refuse to remove a team-bound board, because a removal's local or team scope is itself a publishing decision the operator makes in the interface; an unshared board removal SHALL stay local and report that no publishing was attempted.

Publishing SHALL NOT be available for a board that has unapplied team events in its log; the supported next action SHALL be to apply that board's team updates. When a board's log changed since this installation last read it, a publish for that board SHALL append nothing, SHALL keep every local draft, and SHALL report the new team events.

#### Scenario: Saving a workflow creates a draft

- **WHEN** the user saves a workflow on a published board
- **THEN** the local board uses the new workflow
- **AND** the board is presented as a draft
- **AND** nothing is published

#### Scenario: Save and share publishes

- **WHEN** the user saves a workflow through the share action on a published board
- **THEN** the local save completes before the publish starts
- **AND** that board's log carries the saved workflow
- **AND** the board is no longer a draft

#### Scenario: Saving a board name creates a draft

- **WHEN** the user renames a published board
- **THEN** the board is presented as that board's draft
- **AND** the rename is published by that board's publish action
- **AND** no other board is written

#### Scenario: Saving a project scope creates a draft

- **WHEN** the user changes a published board's project scope
- **THEN** the board is presented as that board's draft
- **AND** the board's publish appends the scope change to that board's log

#### Scenario: Reordering boards creates drafts

- **WHEN** the user changes the order of published boards
- **THEN** each board whose position changed is presented as a draft
- **AND** publishing that board appends only its own position change

#### Scenario: A board publish leaves other drafts alone

- **WHEN** the user publishes one board while another board of the same Hub is a draft
- **THEN** only the published board's log changes
- **AND** the other board remains a draft

#### Scenario: Publish every pending board

- **WHEN** the user publishes all changes of a Hub with two draft boards
- **THEN** both boards' logs are appended
- **AND** no entry that lists the boards is written
- **AND** each board is presented as up to date

#### Scenario: A publish-all failure is scoped to its board

- **WHEN** publishing all changes fails for one board and succeeds for another
- **THEN** the successful board is up to date
- **AND** the failed board keeps its draft and the failure names that board

#### Scenario: A failed share keeps the local save

- **WHEN** the local save succeeds and the publish fails
- **THEN** the local workflow remains saved
- **AND** the board remains a draft
- **AND** the failure is reported without discarding editing state

#### Scenario: Publishing is blocked by team updates

- **WHEN** a board has team events that have not been applied
- **THEN** publishing that board is unavailable
- **AND** the interface presents the update action for that board as the required next step
- **AND** publishing another board that has no unapplied events remains available

#### Scenario: A lost publish race changes nothing

- **WHEN** a board's log changed since this installation last read it and the user publishes that board
- **THEN** nothing is appended and every local draft of that board is retained
- **AND** the Hub reports the board's new team events

#### Scenario: A board created through a tool stays a draft

- **WHEN** an agent creates a board through a board administration tool on a bound Hub
- **THEN** the board is saved locally
- **AND** that board's log is created
- **AND** nothing is published
- **AND** the board is presented as a draft until the operator publishes it

#### Scenario: A tool workflow edit stays a draft

- **WHEN** an agent replaces or edits a board workflow through a board administration tool on a published board
- **THEN** the local workflow is saved
- **AND** that board's log carries the saved workflow
- **AND** the team's published document is unchanged

#### Scenario: A tool write on continuous storage stays a draft

- **WHEN** an agent changes a board through a board administration tool on a published Hub whose checks run automatically
- **THEN** the local change is saved
- **AND** it remains a draft for that board until the operator publishes it

#### Scenario: A tool write reports no publishing outcome

- **WHEN** an agent writes a board through a board administration tool while the Hub is bound, unbound, awaiting review, blocked by team updates, or unavailable
- **THEN** the result states that the change is local in every case
- **AND** it reports no published state, no publishing blocker, and no publishing failure

#### Scenario: Publish a board created through a tool

- **WHEN** an agent creates a board through a board administration tool and the operator later publishes that board
- **THEN** the local board and its log were saved before the operator published
- **AND** the operator's publish carries that board to the team
- **AND** the board is no longer presented as a draft

#### Scenario: Publish a tool workflow edit

- **WHEN** an agent replaces or edits a board workflow through a board administration tool and the operator later publishes that board
- **THEN** the team's published document carries the workflow the tool saved
- **AND** no tool call publishes by itself

#### Scenario: A failed tool publish keeps the local change

- **WHEN** a tool write saved a local board change and the operator's later publish of that board fails or is blocked
- **THEN** the local change remains saved
- **AND** the board remains a draft
- **AND** the failure is reported without discarding the local change

#### Scenario: Do not publish a local-only board removal

- **WHEN** an agent removes a team-bound board with the local-only scope
- **THEN** the board disappears locally
- **AND** no publish is started for that removal
- **AND** the team's published layout is unchanged

#### Scenario: Tool writes on continuous storage synchronize

- **WHEN** an agent changes a board through a board administration tool on a published Hub whose checks run automatically
- **THEN** the local change is saved
- **AND** it remains a draft for that board until the operator publishes it

#### Scenario: A tool removal does not publish

- **WHEN** an agent attempts to remove a team-bound board
- **THEN** the tool refuses and points the operator at the interface
- **AND** the team's published layout is unchanged

#### Scenario: An unshared tool removal stays local

- **WHEN** an agent removes a board that is not part of the team's shared configuration
- **THEN** the board disappears locally
- **AND** no publish is started for that removal

## ADDED Requirements

### Requirement: Local and published comparison

The plugin SHALL expose `diff_published_board`, a read-only comparison between one board's local document and the version of that board this installation last applied from the team. It SHALL accept one board identifier and SHALL change nothing: no board document, no revision, no team storage, and no publishing.

For a board that is a draft, it SHALL report the semantic difference between the local document and the last applied team version in the same per-stage shape the write report uses, covering added and removed stages, changed transitions, changed named exits, a changed entry instruction, changed placement and size, changed group membership, and a changed connection layout. For a board with no unapplied local difference it SHALL report that the board matches the published version. For a Hub that is not bound to a team storage it SHALL report that there is no published version to compare with. The comparison SHALL NOT carry a card title, description, note, task message, or conversation content.

#### Scenario: Compare a draft board with its published version

- **WHEN** an agent asks for the comparison of a board that has local changes and is published to a team
- **THEN** the result reports the per-stage difference between the local document and the last applied team version
- **AND** it carries no card text

#### Scenario: Report a board that matches the team

- **WHEN** an agent asks for the comparison of a board with no local difference from the published version
- **THEN** the result reports that the board matches the published version

#### Scenario: Report a Hub with nothing published

- **WHEN** an agent asks for the comparison of a board whose Hub is not bound to a team storage
- **THEN** the result reports that there is no published version to compare with

#### Scenario: Compare without publishing

- **WHEN** an agent asks for the comparison
- **THEN** no board, revision, or team document changes
- **AND** no publishing is attempted
