# Spec Delta

## MODIFIED Requirements

### Requirement: Preserve workflow descriptions and new-board defaults in team synchronization

Publishing, incremental changes, conflict detection, replay, restore, revisions, and team synchronization SHALL carry the workflow description, each stage description, a decision stage's authored configuration, and a newly created board's effective default preset choice in the board's own published log, and SHALL preserve them without silently discarding them. A description-only or default-only edit SHALL be treated as a publishable change, never as an unchanged version. Existing boards, historical revisions, and stored logs that predate these fields SHALL remain readable and retain their existing semantics, and their logs SHALL remain readable by installations that predate them. An installation that meets an event carrying one of these fields with a format version it does not support SHALL report that board as requiring a plugin update, SHALL neither apply nor publish over that board, and SHALL report no incompatibility for the other boards of the same Hub, rather than discarding the field. Publishing remains an explicit user action.

#### Scenario: Publish only a description change

- **WHEN** a person publishes a workflow whose only semantic edit is a workflow or stage description
- **THEN** the team update preserves and delivers that edit
- **AND** a receiver does not treat the version as unchanged

#### Scenario: Publish only a default preset change

- **WHEN** a person publishes a board whose only local difference is its default preset choice
- **THEN** the board's log carries the event that names that choice
- **AND** the board is no longer presented as a draft

#### Scenario: Avoid overwriting a local description

- **WHEN** a board has a local description change and a team update changes the same workflow
- **THEN** synchronization accounts for that local change under the existing conflict rules
- **AND** does not silently replace it as though the local board were clean

#### Scenario: Receive a board with an operator default

- **WHEN** a shared board created with the workflow operator default is received by an installation that understands the board's event formats
- **THEN** its effective default choice is preserved
- **AND** its authored YAML remains exact

#### Scenario: Reject unsafe older peers

- **WHEN** an installation meets an event that carries a description, a decision configuration, or a default preset choice with a format version newer than it supports
- **THEN** it reports that board as requiring a plugin update rather than silently discarding that data
- **AND** it neither applies nor publishes over that board
- **AND** another board of the same Hub remains applicable and publishable

## ADDED Requirements

### Requirement: Local change detection for published boards

A board's local change SHALL be decided by one comparison between the local board and the version this installation last applied for that board, covering the board's display name, its project scope, its position in the Hub's board order, its canonical workflow meaning, its workflow description, each stage description, each decision configuration, and its default preset choice. Board-owned metadata SHALL NOT by itself constitute a local change: a board whose local values equal the applied values SHALL be presented as up to date with no pending publication, whatever default preset choice or descriptions it holds. A board that differs in any of those values SHALL be presented as a draft. Publishing SHALL derive exactly those differences, and when there are none it SHALL append no event, SHALL re-read the board's log, and SHALL report success rather than a refusal, a review, or an empty change.

#### Scenario: A board used without editing is up to date

- **WHEN** a person only moves tasks on a published board and changes none of its workflow, name, project scope, position, or defaults
- **THEN** the board is presented as up to date
- **AND** the Hub reports no pending publication for that account

#### Scenario: A settings-only difference is a draft

- **WHEN** a published board's only local difference is its workflow, stage, or default preset values
- **THEN** the board is presented as a draft
- **AND** publishing it appends only the events that carry that difference

#### Scenario: A matching board publishes nothing

- **WHEN** the user publishes a board that matches the version this installation applied
- **THEN** no event is appended to any log
- **AND** the board remains up to date
- **AND** the result is not reported as a failure

#### Scenario: One comparison decides state, change list, and publish

- **WHEN** the interface reports a board's pending changes or a publish derives what to append
- **THEN** both use the same comparison of the local board with the applied version
- **AND** a board presented as up to date appends nothing when it is published

### Requirement: Board default choice in the published board content

For each published board, the published layout SHALL carry the board's default preset choice as an event in that board's own log when the board records one, using an event format version that distinguishes it from events that carry no board metadata of that kind. The event SHALL address the board rather than a stage, and recovery SHALL obtain the choice by reading the board's own metadata events independently of any whole-workflow checkpoint, so a checkpoint SHALL NOT drop it. Publishing, incremental changes, conflict detection, replay, restore, revisions, and team synchronization SHALL preserve the choice, and a receiving installation SHALL apply it to the board it creates or updates instead of substituting its own default. Publishing SHALL NOT rewrite the board's authored YAML to carry the choice. A board that records no choice SHALL publish no such event and SHALL retain the legacy host-default meaning, and a received board SHALL NOT be reclassified as newly created merely because it carries a choice. The published choice SHALL carry no conversation, session, task, or other local record.

#### Scenario: Publish a board default

- **WHEN** the user publishes a board whose default preset choice this installation records
- **THEN** that board's log carries one event naming the choice
- **AND** the board's authored YAML stays exact

#### Scenario: Apply a team board default

- **WHEN** an installation applies a board that carries a default preset choice
- **THEN** the local board uses the team's choice
- **AND** the receiving installation's own default does not replace it

#### Scenario: Keep legacy absence

- **WHEN** a published board carries no default preset event
- **THEN** the receiving installation keeps the host-default meaning for that board
- **AND** it does not classify the board as newly created

#### Scenario: Recover the choice beside a checkpoint

- **WHEN** a board's log carries a default preset event and later gains a whole-workflow checkpoint
- **THEN** recovery still yields that choice
- **AND** the retained event keeps its own format version

#### Scenario: Isolate an unknown board-metadata event

- **WHEN** a peer that understands only an earlier event format meets a default preset event
- **THEN** it reports that board as requiring a plugin update
- **AND** it neither applies nor publishes over that board
- **AND** another board of the same Hub remains applicable and publishable

### Requirement: Pending-work reporting names whose change it is

The team-changes banner SHALL report the active board's own pending work, and SHALL NOT present another board's pending work as the active board's. When the active board has no pending work while another board of the Hub has, the banner SHALL state that another board of the Hub has changes to publish or team changes to get without attributing them to the active board, and SHALL offer no publish action for the active board. When a board cannot be published, the surface that offers the publish action SHALL present that reason where the action is offered instead of accepting the action and reporting the failure afterwards. When no board of the Hub has pending work, no pending-work banner SHALL be presented.

#### Scenario: Name the active board

- **WHEN** the active board has local changes to publish
- **THEN** the banner names that board
- **AND** the publish action belongs to that board

#### Scenario: Do not attribute another board's work

- **WHEN** the active board has no pending work and another board of the Hub has local changes
- **THEN** the banner states that another board of the Hub has changes
- **AND** it presents no publish action for the active board

#### Scenario: Explain the block before the action

- **WHEN** a board cannot be published for a reported reason
- **THEN** the surface offering the publish action presents that reason
- **AND** activating that action is not the first time the person learns of the block

#### Scenario: Nothing pending means no banner

- **WHEN** no board of the Hub has pending work, team changes to get, a conflict, or a storage block
- **THEN** no pending-work banner is presented
