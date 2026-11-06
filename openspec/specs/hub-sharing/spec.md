# hub-sharing Specification

## Purpose

Let a team keep a Hub's boards and workflows aligned through an optional, storage-agnostic publishing channel, while projects, tasks, notes, and Hub names stay local to each installation.

## Requirements

### Requirement: Optional publishing per Hub

Publishing SHALL be opt-in for each Hub. A Hub that has not been published SHALL have no publishing binding, managed clone, scheduled check, or publishing state, and every existing board, workflow, and task behavior SHALL remain unchanged. Enabling publishing SHALL require a repository address and SHALL create a plugin-managed local clone. Disabling publishing SHALL remove the binding and the managed clone and SHALL retain every local board, workflow, task, note, project, conversation, and worktree.

#### Scenario: Unpublished Hub keeps current behavior

- **WHEN** a Hub has never been published
- **THEN** its boards, workflows, and tasks behave exactly as they did before this capability existed
- **AND** no clone, scheduled check, or publishing state exists for that Hub

#### Scenario: Enable publishing

- **WHEN** the user enables publishing for a Hub with a valid repository address
- **THEN** the plugin creates a managed local clone of that repository
- **AND** the Publishing section presents the Hub as published

#### Scenario: Disable publishing

- **WHEN** the user disables publishing for a Hub
- **THEN** the binding and the managed clone are removed
- **AND** every local board, workflow, task, note, project, conversation, and worktree remains

### Requirement: Published document content

The published document SHALL contain a format version and one entry per board with a stable board key, the board name, the board order, and the board's workflow YAML exactly as authored. The document SHALL NOT contain projects, tasks, notes, conversations, worktrees, Hub names, worktree base paths, or any other local setting. A board key SHALL be assigned when the board is first published, SHALL remain stable across board renames, and SHALL be unique within the document.

#### Scenario: Publish the board list

- **WHEN** the user publishes a Hub with two boards
- **THEN** the published document contains exactly those two boards in their board order
- **AND** each entry carries its key, name, and authored workflow YAML

#### Scenario: Exclude local data

- **WHEN** a Hub with projects, tasks, notes, and conversations is published
- **THEN** none of those records or their identifiers appear in the published document

#### Scenario: A rename keeps the board key

- **WHEN** the user renames a published board and publishes the Hub
- **THEN** the published entry keeps its existing key
- **AND** only the displayed name changes

#### Scenario: Preserve authored workflow text

- **WHEN** the user publishes a workflow containing comments and custom formatting
- **THEN** the published workflow text matches the authored text without normalization

### Requirement: Drafts and explicit publishing

Saving a board, a board name, a board order, or a workflow SHALL change local state only and SHALL mark that board as a draft. Publishing SHALL send every draft of the Hub as one document. Publishing SHALL NOT be available while the Hub has unapplied team updates. When the published document changed since the last received document, a publish SHALL publish nothing, keep every local draft, and report the new team updates.

#### Scenario: Saving a workflow creates a draft

- **WHEN** the user saves a workflow
- **THEN** the local board uses the new workflow
- **AND** the board is presented as a draft
- **AND** nothing is published

#### Scenario: Save and share publishes

- **WHEN** the user saves a workflow through the share action
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

- **WHEN** the published document changed after the last check and the user publishes
- **THEN** nothing is published and every local draft is retained
- **AND** the Hub reports the new team updates

### Requirement: Team updates and three-way application

A check SHALL compare the published document with the last received document and the local Hub. Get updates SHALL apply boards that changed only in the published document, SHALL keep boards that changed only locally as drafts, and SHALL require an explicit per-board choice for a board that changed on both sides. Applying SHALL be all-or-nothing for the Hub: either every selected change is applied or none is. After a successful application the last received document SHALL record the applied content, keeping the previous content for any board that still needs a choice.

#### Scenario: Apply a team-only change

- **WHEN** the team changed one board and the local installation did not change it
- **THEN** Get updates applies that board's published workflow
- **AND** the board is presented as up to date

#### Scenario: Keep a local draft

- **WHEN** the local installation changed a board and the team did not
- **THEN** Get updates leaves that board unchanged and it remains a draft

#### Scenario: Both sides changed the same board

- **WHEN** the team and the local installation changed the same board
- **THEN** the review lists that board as needing a choice
- **AND** no part of that board is applied before the choice

#### Scenario: Choose the team version

- **WHEN** the user chooses the team version for a conflicting board
- **THEN** the board's published workflow is applied locally
- **AND** the local draft for that board is replaced

#### Scenario: Choose the local version

- **WHEN** the user chooses the local version for a conflicting board
- **THEN** the local workflow is retained as a draft
- **AND** the published workflow is not applied to that board

#### Scenario: Application is all-or-nothing

- **WHEN** applying an update set would be refused for any board
- **THEN** no board, workflow, or board order changes locally

### Requirement: Refusal of destructive application

Get updates SHALL refuse the entire application and apply nothing when a workflow in the published document would leave an existing task in a column that the workflow does not define, or when a published board would collide with a local board that has not been published. The refusal SHALL name the blocking board, the missing column, and the number of affected tasks, and SHALL NOT offer an override action.

#### Scenario: Refuse a workflow that orphans task columns

- **WHEN** the published workflow removes a column that still holds local tasks
- **THEN** no update is applied
- **AND** the interface names the board, the missing column, and how many tasks block it

#### Scenario: Apply after the tasks move

- **WHEN** the user moves the affected tasks to a column defined by the published workflow and retries
- **THEN** the update set is applied

#### Scenario: Refuse a name collision with an unpublished board

- **WHEN** a published board has the same name as a local board that has not been published
- **THEN** no update is applied
- **AND** the interface explains that the local board must be renamed or published first

### Requirement: Board removal and orphan handling

When the team removes a board, the plugin SHALL remove it locally only when the board has no tasks and no unpublished changes. When the board has tasks or unpublished changes, the plugin SHALL keep it as an orphan: unbound from the published document, retaining its tasks, workflow, and drafts, and identified on its board tab. An orphan SHALL offer publishing as a new board with a new key and local deletion under the existing task rule. An orphan SHALL reconnect automatically when the team publishes a board whose key matches the orphan's last key, or whose name matches the orphan's last published name, and the local installation SHALL keep a single board for it.

#### Scenario: Remove an empty board

- **WHEN** the team removes a board that has no local tasks and no unpublished changes
- **THEN** the board is removed from the local Hub

#### Scenario: Keep a board that has tasks

- **WHEN** the team removes a board that still has local tasks
- **THEN** the board remains locally as an orphan
- **AND** its tasks, workflow, and conversations are unchanged

#### Scenario: Keep a board that has unpublished changes

- **WHEN** the team removes a board that has local unpublished changes and no tasks
- **THEN** the board remains locally as an orphan
- **AND** its unpublished changes are retained

#### Scenario: Identify an orphan on its tab

- **WHEN** a board is an orphan
- **THEN** its board tab presents an orphan state with an accessible label
- **AND** the state remains visible on an inactive board

#### Scenario: Publish an orphan as a new board

- **WHEN** the user publishes an orphan as a new board
- **THEN** the published document gains a board with a new key
- **AND** the local board is bound to that key

#### Scenario: Reconnect by key

- **WHEN** the team publishes a board whose key matches an orphan's last key
- **THEN** the orphan is bound to that entry
- **AND** no additional board is created

#### Scenario: Reconnect by name

- **WHEN** the team publishes a board whose name matches an orphan's last published name and no entry matches its last key
- **THEN** the orphan is bound to that entry
- **AND** no additional board is created

#### Scenario: Keep a single board after reconnection

- **WHEN** an orphan reconnects
- **THEN** the local Hub has the same number of boards as before the reconnection

### Requirement: Locally removed boards

When the user removes a published board only from this installation, the plugin SHALL record that board as locally removed, SHALL NOT apply that board from later team updates, and SHALL offer restoring it while the published document still contains it. A team-wide removal SHALL be published with a later publish and SHALL NOT be recorded as locally removed.

#### Scenario: Remove a board only here

- **WHEN** the user removes a published board only from this installation
- **THEN** the board disappears locally
- **AND** the published document is unchanged
- **AND** later team updates do not recreate that board

#### Scenario: Restore a locally removed board

- **WHEN** the user restores a locally removed board that the published document still contains
- **THEN** the published workflow is applied locally again

#### Scenario: Publish a team-wide removal

- **WHEN** the user removes a published board for the team and later publishes
- **THEN** the board is absent from the published document

### Requirement: Automatic checks and published status

The host SHALL check each published Hub automatically at its configured interval. The default interval SHALL be five minutes, the minimum interval one minute, and a zero interval SHALL disable automatic checks. A check SHALL NOT start while a publish or an update application for the same Hub is in progress. A failed check SHALL NOT block local editing and SHALL be reported as unavailable together with the last successful check time. The host snapshot SHALL expose, per published Hub, the publication status, the configured interval, the last successful check time, the current failure, the draft count, the number of team changes that Get updates would apply (including board removals and boards that would become orphans), the conflict count, and the per-board publishing state.

#### Scenario: Default interval

- **WHEN** a Hub is published without a configured interval
- **THEN** the host checks it every five minutes

#### Scenario: Configured interval

- **WHEN** the user sets a fifteen-minute interval for a published Hub
- **THEN** the host checks that Hub every fifteen minutes
- **AND** other published Hubs keep their own intervals

#### Scenario: Disable automatic checks

- **WHEN** the user sets the interval to zero
- **THEN** the host performs no automatic check for that Hub
- **AND** Refresh remains available

#### Scenario: A failed check does not block work

- **WHEN** a check fails because the repository is unreachable
- **THEN** local editing, saving, and task work remain available
- **AND** the Hub reports the failure and the last successful check time

#### Scenario: Status arrives with the snapshot

- **WHEN** a published Hub has available team updates
- **THEN** the host snapshot reports the update count and the per-board states
- **AND** the interface updates without an additional channel

#### Scenario: Checks do not overlap with changes in flight

- **WHEN** a check is due while a publish or an update application for the same Hub is running
- **THEN** the check starts after that operation finishes

### Requirement: Publishing interface

Configuration SHALL include a Publishing section for the active Hub. That section SHALL present the storage provider, the repository address, the check interval, the Hub status, the per-board states, the locally removed boards, and the actions Connect, Publish, Get updates, Refresh, and Disconnect. The board SHALL present a banner when team updates are available or a review is required. The Hub tab SHALL indicate available team updates, drafts, and conflicts without opening Configuration, and SHALL show them simultaneously when more than one applies. Each board tab SHALL indicate its own publishing state. A refusal SHALL present the blocking boards, columns, and task counts and SHALL NOT offer an override. The interface SHALL NOT require knowledge of revision-control concepts: it SHALL NOT present commit, branch, remote, fetch, or push wording.

#### Scenario: Open the Publishing section

- **WHEN** the user opens Configuration for a published Hub
- **THEN** the Publishing section presents the provider, repository address, interval, Hub status, per-board states, and the available actions

#### Scenario: Show a board banner

- **WHEN** the active board has team updates available
- **THEN** the board presents a banner that leads to the review

#### Scenario: Indicate Hub publishing state on the Hub tab

- **WHEN** a published Hub has drafts, team updates, or conflicts
- **THEN** its Hub tab indicates that state
- **AND** the indication is present while the Hub is not active

#### Scenario: Indicate board publishing state on the board tab

- **WHEN** a board is a draft, has team updates, needs a choice, or is an orphan
- **THEN** its board tab indicates that state with an accessible label

#### Scenario: Explain a refusal without an override

- **WHEN** an update application is refused
- **THEN** the interface names the blocking boards, columns, and task counts
- **AND** no override control is offered

#### Scenario: Avoid revision-control vocabulary

- **WHEN** the Publishing section, banner, or indicators describe state and actions
- **THEN** they use publishing vocabulary rather than commit, branch, remote, fetch, or push wording

### Requirement: First connection

Connecting a repository that already contains a published document while the Hub has no received document SHALL present the differences and SHALL require choosing either to receive the published configuration or to publish the local one. Connecting an empty repository SHALL publish the local configuration without requiring that choice.

#### Scenario: Connect an empty repository

- **WHEN** the user connects a repository that contains no published document
- **THEN** the local configuration is published
- **AND** no choice is requested

#### Scenario: Connect a repository that already has content

- **WHEN** the user connects a repository that already contains a published document
- **THEN** the interface presents what differs between the published configuration and the local Hub
- **AND** the Hub stays unpublished until the user chooses

#### Scenario: Receive the published configuration on connection

- **WHEN** the user chooses to receive the published configuration
- **THEN** a local board with the same name as a published board is adopted as that published board instead of being rejected as a name collision
- **AND** the application rules for team updates apply to every other board
- **AND** the Hub becomes published

#### Scenario: Publish the local configuration on connection

- **WHEN** the user chooses to publish the local configuration over existing published content
- **THEN** the published document is replaced after explicit confirmation
- **AND** the Hub becomes published

### Requirement: Storage-provider boundary

Access to the published document SHALL go through a storage-provider boundary that reads a whole document with a version token and writes a whole document only while the expected token still matches. A write with a stale token SHALL be refused without modifying the published document. The Git provider SHALL be the only supported provider in this version, and any other provider SHALL be rejected with an explicit error. The document format, the merge rules, and the interface states SHALL NOT depend on the provider.

#### Scenario: Read and write a document with its token

- **WHEN** the plugin reads or writes the published document
- **THEN** the provider returns or requires the document's version token

#### Scenario: Refuse a stale write

- **WHEN** a write supplies a token that no longer matches the published document
- **THEN** the write is refused and the published document is unchanged

#### Scenario: Reject an unsupported provider

- **WHEN** a Hub is configured with a provider other than Git
- **THEN** the plugin reports an explicit unsupported-provider error
- **AND** no publishing operation starts
