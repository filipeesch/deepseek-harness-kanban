# Spec Delta

## ADDED Requirements

### Requirement: Google Drive connection

Google Drive SHALL be available as a team storage only after the user authorizes a Google account through an installed-application OAuth flow that uses the system browser, a loopback redirect, and PKCE. The consent request SHALL ask only for the Drive access required to list the selected location, read and write the Hub document, and observe changes. The authorization SHALL persist on this machine and SHALL refresh without another sign-in while it remains valid. The interface SHALL support connecting the account, disconnecting the account, and switching the account. Authorization tokens SHALL NOT appear in the snapshot, logs, the published document, or any board or task content. Losing authorization SHALL present a reconnect state and SHALL NOT discard local boards, workflows, or pending changes. When the Google Cloud project, a Workspace policy, or the account blocks the authorization, the plugin SHALL report the block and SHALL NOT start a Drive operation.

#### Scenario: Connect a Google account

- **WHEN** the user chooses Google Drive and starts the connection
- **THEN** the system browser opens the Google consent page
- **AND** after consent the plugin stores the authorization and presents the account as connected in Team Settings

#### Scenario: Refresh without a new sign-in

- **WHEN** the stored access token expires while the authorization remains valid
- **THEN** the plugin obtains a new access token without asking the user to sign in again

#### Scenario: Reconnect after authorization is lost

- **WHEN** the Google authorization is revoked or expires
- **THEN** the Hub presents a reconnect state
- **AND** local boards, workflows, pending changes, and the team document remain unchanged

#### Scenario: Switch the Google account

- **WHEN** the user switches the Google account
- **THEN** the plugin obtains consent for the new account before using it
- **AND** bindings that the new account cannot access are reported as requiring attention

#### Scenario: Disconnect the Google account

- **WHEN** the user disconnects the Google account
- **THEN** the stored authorization is removed
- **AND** every Drive binding presents a reconnect state without losing local data
- **AND** the team documents are unchanged

#### Scenario: Authorization blocked by policy

- **WHEN** the Google Cloud project, a Workspace policy, or the account blocks the authorization
- **THEN** the plugin reports the block and starts no Drive operation

#### Scenario: Tokens are never exposed

- **WHEN** the plugin reports status or a failure
- **THEN** no access token, refresh token, or authorization code appears in the snapshot, logs, or the published document

### Requirement: Google Drive storage location

A Google Drive binding SHALL identify its location by the Drive, folder, and document file IDs and SHALL NOT depend on names after the connection. The user SHALL select a folder in My Drive or a Shared Drive. When the selected folder has no `kanban-hub.yaml`, the plugin SHALL create it; when the folder already contains one, the plugin SHALL adopt it by file ID. The plugin SHALL NOT modify other files in the selected folder and SHALL NOT delete the team document on disconnect or Hub deletion. A folder already bound to another Hub SHALL be refused with an explicit error. Losing access to the folder or document SHALL present an explicit unavailable state and SHALL NOT delete local boards, workflows, or pending changes.

#### Scenario: Select a Drive folder

- **WHEN** the user selects a folder in My Drive or a Shared Drive
- **THEN** the binding records the Drive, folder, and document file IDs
- **AND** the interface presents the selected location

#### Scenario: Create the document in an empty folder

- **WHEN** the selected folder contains no `kanban-hub.yaml`
- **THEN** the plugin creates the document from the local Hub
- **AND** the Hub becomes connected

#### Scenario: Adopt an existing document

- **WHEN** the selected folder already contains `kanban-hub.yaml`
- **THEN** the plugin adopts that file by its file ID
- **AND** first connection applies the connection choice rules

#### Scenario: Leave other files untouched

- **WHEN** the selected folder contains files that are not `kanban-hub.yaml`
- **THEN** the plugin does not read, modify, or delete them

#### Scenario: Lose access to the folder or document

- **WHEN** the account loses permission to the folder or document
- **THEN** the Hub presents an unavailable state with the permission failure
- **AND** local boards, workflows, and pending changes remain

#### Scenario: The document is deleted or trashed

- **WHEN** the team document is deleted or trashed outside the plugin
- **THEN** the Hub reports the document as missing
- **AND** no local board, workflow, or task is deleted

#### Scenario: Disconnect keeps the team document

- **WHEN** the user disconnects a Drive binding
- **THEN** the binding is removed locally
- **AND** the team document and every other file in the folder remain

#### Scenario: Refuse a folder already bound to another Hub

- **WHEN** the user selects a folder already bound to a different Hub
- **THEN** the connection is refused with an explicit error
- **AND** no document is created or modified

### Requirement: Continuous synchronization

For a storage that supports continuous synchronization (Google Drive), saving a board, a board name, a board order, or a workflow SHALL mark the Hub as pending and SHALL synchronize automatically after a short debounce without a Publish action. A synchronization SHALL apply team changes that only the team made in one Hub transaction. A board changed on both sides, a blocker, or a concurrent write SHALL require explicit review and SHALL NOT be applied or published automatically. A local change SHALL NOT overwrite a team change that arrived since the last received document; the plugin SHALL keep the local change pending and require review. Offline or transient failures SHALL keep every local change pending and SHALL retry on later checks without losing edits; the interface SHALL show the pending state and the failure. Synchronization SHALL be serialized per Hub and SHALL survive a plugin restart; a pending change SHALL synchronize after the restart or after the connection returns. A Git binding SHALL keep explicit publishing and SHALL NOT synchronize automatically.

#### Scenario: Save a workflow and synchronize

- **WHEN** the user saves a workflow on a Google Drive binding
- **THEN** the local save completes first
- **AND** the pending change synchronizes automatically
- **AND** the board stops being pending after a successful synchronization

#### Scenario: Apply a team-only change automatically

- **WHEN** a check finds that only the team changed a board and the local installation did not change it
- **THEN** the team workflow is applied in one Hub transaction
- **AND** the board becomes up to date

#### Scenario: Require review for a board changed on both sides

- **WHEN** both the team and the local installation changed the same board
- **THEN** the board is presented for review
- **AND** neither version is applied automatically

#### Scenario: Keep a local change pending when the team changed the document

- **WHEN** a local change is pending and the team document changed since the last received document
- **THEN** the local change is not published automatically
- **AND** the Hub reports the new team changes

#### Scenario: Offline changes stay pending and retry

- **WHEN** a local change is saved while Google Drive is unreachable
- **THEN** the local change is retained as pending
- **AND** the interface reports the unavailable state
- **AND** the change synchronizes after the connection returns

#### Scenario: Pending changes survive a restart

- **WHEN** the plugin restarts while a local change is pending
- **THEN** the change is still pending after the restart
- **AND** it synchronizes without user action when the connection is available

#### Scenario: Git keeps explicit publishing

- **WHEN** the user saves a board or workflow on a Git binding
- **THEN** nothing is published until the user publishes
- **AND** no automatic synchronization runs

#### Scenario: A blocker stops automatic application

- **WHEN** a team workflow would leave an existing task in a column it does not define
- **THEN** no board is applied automatically
- **AND** the Hub presents the refusal for review

### Requirement: Concurrent writes on Google Drive

A Google Drive write SHALL compare the document token read before the write, SHALL verify the written document after the write, and SHALL report a concurrent change when either check differs. A detected concurrent change SHALL keep the local changes pending and SHALL require review; it SHALL NOT be presented as a successful synchronization and SHALL NOT silently discard the local or the team version. The plugin SHALL NOT promise an atomic conditional write on Google Drive, and the previous document content SHALL remain recoverable from the Drive revision history.

#### Scenario: Detect a concurrent write before writing

- **WHEN** the document changed after it was read and before the write
- **THEN** the plugin refuses the write
- **AND** the local changes remain pending

#### Scenario: Detect a concurrent write after writing

- **WHEN** the document is changed by another writer after this installation wrote it
- **THEN** the plugin reports the concurrent change
- **AND** the local changes remain pending

#### Scenario: Keep both versions recoverable

- **WHEN** a concurrent write is reported
- **THEN** the local version is retained
- **AND** the previous document content remains available in the Drive revision history

## MODIFIED Requirements

### Requirement: Optional publishing per Hub

Publishing SHALL be opt-in for each Hub and SHALL bind that Hub to exactly one storage: a Git repository or a Google Drive folder. A Hub that has not been published SHALL have no storage binding, managed local workspace, scheduled check, or publishing state, and every existing board, workflow, and task behavior SHALL remain unchanged. Enabling publishing SHALL require a valid binding for the chosen storage: a Git binding SHALL create a plugin-managed local clone of the repository, and a Google Drive binding SHALL use the selected folder and its `kanban-hub.yaml` document. Disabling publishing SHALL remove the binding and any plugin-managed local workspace, SHALL stop automatic checks, and SHALL retain every local board, workflow, task, note, project, conversation, and worktree. Disabling publishing SHALL NOT remove the team's shared document or the Google account authorization that other Hubs may use.

#### Scenario: Unpublished Hub keeps current behavior

- **WHEN** a Hub has never been published
- **THEN** its boards, workflows, and tasks behave exactly as they did before this capability existed
- **AND** no binding, managed local workspace, scheduled check, or publishing state exists for that Hub

#### Scenario: Enable publishing

- **WHEN** the user enables publishing for a Hub with a valid repository address
- **THEN** the plugin creates a managed local clone of that repository
- **AND** Team Settings presents the Hub as connected

#### Scenario: Enable Google Drive publishing

- **WHEN** the user enables publishing for a Hub with a connected Google account and a selected folder
- **THEN** the plugin creates or adopts the `kanban-hub.yaml` document in that folder
- **AND** Team Settings presents the Hub as connected

#### Scenario: Disable publishing

- **WHEN** the user disables publishing for a Hub
- **THEN** the binding and any plugin-managed local workspace are removed
- **AND** every local board, workflow, task, note, project, conversation, and worktree remains
- **AND** the team's shared document is unchanged

### Requirement: Drafts and explicit publishing

Saving a board, a board name, a board order, or a workflow SHALL change local state only and SHALL mark that board as a draft or pending change. A storage that requires explicit publishing (Git) SHALL send every draft of the Hub as one document only when the user publishes. Publishing SHALL NOT be available while the Hub has unapplied team updates for that storage. When the published document changed since the last received document, a publish SHALL publish nothing, keep every local draft, and report the new team updates. A storage that supports continuous synchronization (Google Drive) SHALL follow the Continuous synchronization requirement instead of an explicit publish action.

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

- **WHEN** the published document changed after the last check and the user publishes
- **THEN** nothing is published and every local draft is retained
- **AND** the Hub reports the new team updates

### Requirement: Team updates and three-way application

Applying team changes SHALL compare the published document with the last received document and the local Hub. Applying SHALL apply boards that changed only in the published document, SHALL keep boards that changed only locally as drafts or pending changes, and SHALL require an explicit per-board choice for a board that changed on both sides. A storage that requires an explicit operation (Git) SHALL apply the comparison when the user gets team updates. A storage that supports continuous synchronization (Google Drive) SHALL apply the comparison automatically when it has no conflict, blocker, or local pending change on a board that also changed remotely, and SHALL require review otherwise. Applying SHALL be all-or-nothing for the Hub: either every selected change is applied or none is. After a successful application the last received document SHALL record the applied content, keeping the previous content for any board that still needs a choice.

#### Scenario: Apply a team-only change

- **WHEN** the team changed one board and the local installation did not change it
- **THEN** the board's published workflow is applied on the next get-updates or automatic synchronization
- **AND** the board is presented as up to date

#### Scenario: Apply a team-only change automatically

- **WHEN** a Google Drive check finds that only the team changed one board
- **THEN** that board's published workflow is applied during the check
- **AND** no user action is required

#### Scenario: Keep a local draft

- **WHEN** the local installation changed a board and the team did not
- **THEN** applying team updates leaves that board unchanged and it remains a draft or pending change

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
- **THEN** the local workflow is retained as a draft or pending change
- **AND** the published workflow is not applied to that board

#### Scenario: Application is all-or-nothing

- **WHEN** applying an update set would be refused for any board
- **THEN** no board, workflow, or board order changes locally

### Requirement: Locally removed boards

When the user removes a published board only from this installation, the plugin SHALL record that board as locally removed, SHALL NOT apply that board from later team updates, and SHALL offer restoring it while the stored team document still contains it. A team-wide removal SHALL remove the board from the team document on the next synchronization: the next explicit publish for Git, or the next automatic synchronization for Google Drive. A team-wide removal SHALL NOT be recorded as locally removed.

#### Scenario: Remove a board only here

- **WHEN** the user removes a published board only from this installation
- **THEN** the board disappears locally
- **AND** the team document is unchanged
- **AND** later team updates do not recreate that board

#### Scenario: Restore a locally removed board

- **WHEN** the user restores a locally removed board that the team document still contains
- **THEN** the published workflow is applied locally again

#### Scenario: Publish a team-wide removal

- **WHEN** the user removes a published board for the team on a Git binding and later publishes
- **THEN** the board is absent from the published document

#### Scenario: Synchronize a team-wide removal

- **WHEN** the user removes a published board for the team on a Google Drive binding
- **THEN** the board is absent from the team document after the next successful synchronization

### Requirement: Automatic checks and published status

The host SHALL check each published Hub automatically at its configured interval. The default interval SHALL be five minutes for a Git binding and one minute for a Google Drive binding, the minimum interval one minute, and a zero interval SHALL disable automatic checks while leaving manual refresh available. A check SHALL NOT start while a publish, synchronization, or update application for the same Hub is in progress. A check against Google Drive SHALL use the Drive change feed with a persisted cursor and SHALL read the document content only when the document revision changed; an expired or invalid cursor SHALL trigger a full document read. A failed check SHALL NOT block local editing and SHALL be reported as unavailable together with the last successful check time. The host snapshot SHALL expose, per published Hub, the storage, the storage address, the synchronization mode, the publication status, the configured interval, the last successful check time, the current failure, the draft or pending count, the number of team changes a synchronization would apply, the conflict count, and the per-board publishing state.

#### Scenario: Default interval

- **WHEN** a Git-published Hub is configured without an interval
- **THEN** the host checks it every five minutes

#### Scenario: Default interval for Google Drive

- **WHEN** a Google Drive-published Hub is configured without an interval
- **THEN** the host checks it every minute

#### Scenario: Configured interval

- **WHEN** the user sets a fifteen-minute interval for a published Hub
- **THEN** the host checks that Hub every fifteen minutes
- **AND** other published Hubs keep their own intervals

#### Scenario: Disable automatic checks

- **WHEN** the user sets the interval to zero
- **THEN** the host performs no automatic check for that Hub
- **AND** manual refresh remains available

#### Scenario: A failed check does not block work

- **WHEN** a check fails because Google Drive or the repository is unreachable
- **THEN** local editing, saving, and task work remain available
- **AND** the Hub reports the failure and the last successful check time

#### Scenario: Status arrives with the snapshot

- **WHEN** a published Hub has available team updates or pending changes
- **THEN** the host snapshot reports the storage, synchronization mode, update count, pending count, and the per-board states
- **AND** the interface updates without an additional channel

#### Scenario: Checks do not overlap with changes in flight

- **WHEN** a check is due while a publish, synchronization, or update application for the same Hub is running
- **THEN** the check starts after that operation finishes

#### Scenario: Read content only when the document changed

- **WHEN** a Google Drive check finds no change to the document revision
- **THEN** the plugin does not read the document content

#### Scenario: Recover from an expired change cursor

- **WHEN** the stored Google Drive change cursor is rejected
- **THEN** the next check reads the document content in full
- **AND** the new cursor is stored after a successful read

### Requirement: Team Settings interface

Configuration SHALL include a **Team Settings** section for the active Hub. That section SHALL present a storage selector with Git and Google Drive and SHALL render the selected storage's surface. For a Git binding the section SHALL present the repository address, the check interval, the Hub status, the per-board states, the locally removed boards, and the actions Connect, Publish, Get updates, Refresh, and Disconnect. For a Google Drive binding the section SHALL present the connected account, the Drive and folder location, the synchronization status, the pending and conflict counts, the last successful synchronization, the current failure, the per-board states, the locally removed boards, and the actions Connect, Sync now, Review, Disconnect, and Switch account. The storage selector SHALL change the rendered surface while the Hub has no binding and SHALL show the bound storage without changing it while the Hub is published; changing storage SHALL require Disconnect. The board SHALL present a banner when team changes are available or a review is required. The Hub tab SHALL indicate available team changes, pending changes, and conflicts without opening Configuration, and SHALL show them simultaneously when more than one applies. Each board tab SHALL indicate its own publishing state. A refusal SHALL present the blocking boards, columns, and task counts and SHALL NOT offer an override. The interface SHALL NOT require knowledge of revision-control concepts: it SHALL NOT present commit, branch, remote, fetch, or push wording.

#### Scenario: Open the Publishing section

- **WHEN** the user opens Team Settings for a Git-published Hub
- **THEN** the section presents the repository address, interval, Hub status, per-board states, locally removed boards, and the Git actions

#### Scenario: Open Team Settings for Google Drive

- **WHEN** the user opens Team Settings for a Google Drive-published Hub
- **THEN** the section presents the account, Drive and folder location, synchronization status, pending and conflict counts, last successful synchronization, current failure, per-board states, locally removed boards, and the Drive actions

#### Scenario: Select a storage while unpublished

- **WHEN** the Hub has no binding and the user selects Git or Google Drive in the storage selector
- **THEN** the section renders that storage's connection surface
- **AND** no binding is created before the user connects

#### Scenario: The bound storage is not changed by the selector

- **WHEN** the Hub is published and the user opens the storage selector
- **THEN** the selector shows the bound storage
- **AND** changing storage requires Disconnect

#### Scenario: Show a board banner

- **WHEN** the active board has team updates available or needs review
- **THEN** the board presents a banner that leads to Team Settings

#### Scenario: Indicate Hub publishing state on the Hub tab

- **WHEN** a published Hub has pending changes, team updates, or conflicts
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

- **WHEN** Team Settings, the banner, or the indicators describe state and actions
- **THEN** they use storage or synchronization vocabulary rather than commit, branch, remote, fetch, or push wording

### Requirement: First connection

Connecting a storage that already contains a published document while the Hub has no received document SHALL present the differences and SHALL require choosing either to receive the published configuration or to publish the local one. Connecting a storage with no published document SHALL publish the local configuration without requiring that choice. A Git repository with no commits or no published document and a Google Drive folder with no `kanban-hub.yaml` SHALL both count as having no published document. A Google Drive document SHALL be adopted by its file ID when the selected folder already contains `kanban-hub.yaml`.

#### Scenario: Connect an empty repository

- **WHEN** the user connects a Git repository that contains no published document
- **THEN** the local configuration is published
- **AND** no choice is requested

#### Scenario: Connect a repository that already has content

- **WHEN** the user connects a Git repository that already contains a published document
- **THEN** the interface presents what differs between the published configuration and the local Hub
- **AND** the Hub stays unpublished until the user chooses

#### Scenario: Connect an empty Drive folder

- **WHEN** the user connects a Google Drive folder that contains no `kanban-hub.yaml`
- **THEN** the local configuration is published to a new document
- **AND** no choice is requested

#### Scenario: Connect a Drive folder that already has a document

- **WHEN** the user connects a Google Drive folder that already contains `kanban-hub.yaml`
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

Access to the shared document SHALL go through a storage-provider boundary that reads a whole document with a version token and writes a whole document while the expected token matches. A provider that supports an atomic conditional write (Git) SHALL refuse a stale write without modifying the document. A provider that does not support an atomic conditional write (Google Drive) SHALL compare the token before writing, verify the written content after writing, and report a concurrent change without claiming an atomic guarantee; the previous content SHALL remain recoverable from the provider's revision history. The supported storages SHALL be Git and Google Drive; any other storage SHALL be rejected with an explicit error. The document format, the merge rules, and the interface states SHALL NOT depend on the storage. Provider-specific connection, location, and synchronization state SHALL be exposed through the storage's own surface.

#### Scenario: Read and write a document with its token

- **WHEN** the plugin reads or writes the published document
- **THEN** the provider returns or requires the document's version token

#### Scenario: Refuse a stale write

- **WHEN** a Git write supplies a token that no longer matches the published document
- **THEN** the write is refused and the published document is unchanged

#### Scenario: Detect a stale write on Google Drive

- **WHEN** a Google Drive write supplies a token that no longer matches the document
- **THEN** the write is not presented as a success
- **AND** the local changes remain pending for review

#### Scenario: Reject an unsupported provider

- **WHEN** a Hub is configured with a storage other than Git or Google Drive
- **THEN** the plugin reports an explicit unsupported-storage error
- **AND** no publishing operation starts

#### Scenario: Keep the document and merge rules storage-independent

- **WHEN** a Hub is published with a different storage
- **THEN** the document format, merge rules, board keys, and interface states remain the same

## RENAMED Requirements

- FROM: `### Requirement: Publishing interface`
- TO: `### Requirement: Team Settings interface`
