# Spec Delta

## ADDED Requirements

### Requirement: Local folder storage location

A local folder binding SHALL identify the storage by an absolute directory path. The plugin SHALL accept an absolute path or a path beginning with `~`, SHALL resolve symbolic links, and SHALL store the resolved path. The selected directory SHALL already exist and SHALL be writable by the plugin; connecting SHALL refuse a path that does not exist, a path that resolves to a file rather than a directory, a directory the plugin cannot write, a directory already bound to another Hub, and a directory inside the plugin's managed publishing workspace. The plugin SHALL own exactly one file in that directory, `kanban-hub.yaml`, SHALL NOT read, create, modify, or delete any other entry, and SHALL create the document only when it is absent. A folder SHALL bind at most one Hub and a Hub SHALL bind at most one folder. Two paths that resolve to the same directory SHALL be treated as the same folder, compared case-insensitively on a case-insensitive filesystem. Team Settings SHALL suggest the default folder `~/.dsh-kanban/<Hub id>` and SHALL pre-fill it in the path field. Connecting to exactly the suggested path SHALL create that directory when it is absent; connecting to any other path SHALL NOT create a directory. Disconnecting a Hub, deleting a Hub, or replacing the binding SHALL NOT delete the folder, the document, or any other entry. When the bound directory or the document is missing or unreadable at check time, the Hub SHALL report an unavailable state with a typed failure, SHALL keep every local change pending, and SHALL resume normal operation without a new binding when the directory and the document become readable again.

#### Scenario: Connect an existing empty folder

- **WHEN** the user connects a Hub to an existing directory the plugin can write that contains no `kanban-hub.yaml`
- **THEN** the plugin creates `kanban-hub.yaml` in that directory
- **AND** Team Settings presents the Hub as connected

#### Scenario: Refuse a missing directory

- **WHEN** the user connects a Hub to a path that does not exist and the path is not the suggested default
- **THEN** no binding is created and the plugin reports that the folder does not exist
- **AND** no directory is created

#### Scenario: Refuse a path that is a file

- **WHEN** the user connects a Hub to a path that resolves to a file
- **THEN** no binding is created and the plugin reports that the path is not a folder

#### Scenario: Refuse an unwritable directory

- **WHEN** the user connects a Hub to an existing directory the plugin cannot write
- **THEN** no binding is created and the plugin reports that the folder cannot be written
- **AND** no document is created

#### Scenario: Refuse a folder already bound to another Hub

- **WHEN** the user connects a Hub to a directory that already belongs to another Hub's binding
- **THEN** no binding is created and the plugin reports that the folder is already in use

#### Scenario: Refuse a folder inside the managed publishing workspace

- **WHEN** the user connects a Hub to a directory inside the plugin's managed publishing workspace
- **THEN** no binding is created and the plugin reports that the location is reserved

#### Scenario: Suggest the default folder

- **WHEN** the user opens the connection surface for a Hub that has no binding
- **THEN** the path field is pre-filled with `~/.dsh-kanban/<Hub id>`

#### Scenario: Create only the suggested folder

- **WHEN** the user connects to the suggested default path and that directory does not exist
- **THEN** the plugin creates that directory and publishes the local configuration into it

#### Scenario: Two spellings of one folder are the same folder

- **WHEN** a second Hub is connected to a path that resolves to a directory already bound to a Hub
- **THEN** the connection is refused as an already used folder
- **AND** the comparison accounts for symbolic links and, on a case-insensitive filesystem, for letter case

#### Scenario: Leave other files untouched

- **WHEN** the bound directory contains files the plugin did not create
- **THEN** those files are never read, modified, or deleted by the plugin

#### Scenario: Lose access to the folder

- **WHEN** the bound directory becomes unreachable or unreadable
- **THEN** the Hub reports an unavailable state and keeps every local change pending
- **AND** local editing, saving, and task work remain available
- **AND** the Hub resumes normal operation when the directory becomes readable again

#### Scenario: The document is deleted

- **WHEN** `kanban-hub.yaml` disappears from a bound folder that was previously read
- **THEN** the Hub reports a typed missing-document failure
- **AND** the plugin does not recreate it without an explicit user action

#### Scenario: Disconnect keeps the folder and the document

- **WHEN** the user disconnects a Hub or deletes a Hub published to a local folder
- **THEN** the binding is removed and automatic checks stop
- **AND** the folder, `kanban-hub.yaml`, and every other entry remain unchanged


### Requirement: Conflict copies in a local folder

A local-folder check SHALL inspect the bound directory for entries whose name begins with the published document's base name and is not the published document itself, including the copies a synchronization client creates when two machines change the same document. When such an entry exists, the Hub SHALL present a review that names the entries found, SHALL NOT apply team updates automatically, SHALL NOT publish automatically, and SHALL NOT choose, rename, merge, or delete any of them. The review SHALL clear on the next successful check after those entries are no longer present. The plugin's own temporary files SHALL be excluded from that detection.

#### Scenario: A conflict copy is present

- **WHEN** a check finds an entry next to `kanban-hub.yaml` whose name begins with `kanban-hub`
- **THEN** the Hub is presented as requiring review
- **AND** the review names the entries found

#### Scenario: Automatic synchronization is suspended

- **WHEN** a conflict copy exists in the bound folder and the Hub has local changes or team updates
- **THEN** no board is applied automatically and nothing is published automatically
- **AND** the Hub keeps the review presented

#### Scenario: The plugin never chooses a version

- **WHEN** a conflict copy is present
- **THEN** the plugin does not merge, rename, delete, or prefer either version
- **AND** the user decides which content becomes the shared document

#### Scenario: The review clears after the copies are removed

- **WHEN** the conflict copies are no longer present at a later check
- **THEN** the review clears
- **AND** automatic synchronization resumes

#### Scenario: The plugin's temporary files are not reported

- **WHEN** a check finds a temporary file written by the plugin itself
- **THEN** it is not reported as a conflict copy


### Requirement: Concurrent writes on a local folder

A local-folder write SHALL compare the document token read before the write, SHALL replace the document through a temporary sibling file and a rename within the same directory, and SHALL verify the written document after the write, reporting a concurrent change when either check differs. A reader SHALL observe either the previous complete document or the new complete document, never a partially written file. The plugin SHALL NOT promise an atomic conditional write on a local folder, because the synchronization client may introduce a change between the read and the replacement. A detected concurrent change SHALL keep the local changes pending and SHALL require review; it SHALL NOT be presented as a successful synchronization and SHALL NOT silently discard the local or the team version. A successful write SHALL leave no temporary sibling behind.

#### Scenario: Detect a concurrent write before writing

- **WHEN** the document changed after it was read and before the write
- **THEN** the plugin refuses the write
- **AND** the local changes remain pending

#### Scenario: Detect a concurrent write after writing

- **WHEN** the document is changed by another writer after this installation wrote it
- **THEN** the plugin reports the concurrent change
- **AND** the local changes remain pending

#### Scenario: Never expose a partial document

- **WHEN** a check reads the document while a write is in progress
- **THEN** it reads either the previous complete document or the new complete document

#### Scenario: An interrupted write leaves the previous document readable

- **WHEN** a write is interrupted before its replacement completes
- **THEN** the previous document remains the readable document
- **AND** the next successful write leaves no temporary sibling behind


## MODIFIED Requirements

### Requirement: Optional publishing per Hub

Publishing SHALL be opt-in for each Hub and SHALL bind that Hub to exactly one storage: a Git repository, a Google Drive folder, or a local folder. A Hub that has not been published SHALL have no storage binding, managed local workspace, scheduled check, or publishing state, and every existing board, workflow, and task behavior SHALL remain unchanged. Enabling publishing SHALL require a valid binding for the chosen storage: a Git binding SHALL create a plugin-managed local clone of the repository, a Google Drive binding SHALL use the selected folder and its `kanban-hub.yaml` document, and a local folder binding SHALL use the selected directory and its `kanban-hub.yaml` document. Disabling publishing SHALL remove the binding and any plugin-managed local workspace, SHALL stop automatic checks, and SHALL retain every local board, workflow, task, note, project, conversation, and worktree. Disabling publishing SHALL NOT remove the team's shared document, the Google account authorization that other Hubs may use, or the bound folder and its document.

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

#### Scenario: Enable local folder publishing

- **WHEN** the user enables publishing for a Hub with an existing writable directory
- **THEN** the plugin creates or adopts the `kanban-hub.yaml` document in that directory
- **AND** Team Settings presents the Hub as connected
- **AND** no managed local workspace is created

#### Scenario: Disable publishing

- **WHEN** the user disables publishing for a Hub
- **THEN** the binding and any plugin-managed local workspace are removed
- **AND** every local board, workflow, task, note, project, conversation, and worktree remains
- **AND** the team's shared document is unchanged


### Requirement: Drafts and explicit publishing

Saving a board, a board name, a board order, or a workflow SHALL change local state only and SHALL mark that board as a draft or pending change. A storage that requires explicit publishing (Git) SHALL send every draft of the Hub as one document only when the user publishes. Publishing SHALL NOT be available while the Hub has unapplied team updates for that storage. When the published document changed since the last received document, a publish SHALL publish nothing, keep every local draft, and report the new team updates. A storage that supports continuous synchronization (Google Drive or a local folder) SHALL follow the Continuous synchronization requirement instead of an explicit publish action.

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

Applying team changes SHALL compare the published document with the last received document and the local Hub. Applying SHALL apply boards that changed only in the published document, SHALL keep boards that changed only locally as drafts or pending changes, and SHALL require an explicit per-board choice for a board that changed on both sides. A storage that requires an explicit operation (Git) SHALL apply the comparison when the user gets team updates. A storage that supports continuous synchronization (Google Drive or a local folder) SHALL apply the comparison automatically when it has no conflict, blocker, or local pending change on a board that also changed remotely, and SHALL require review otherwise. Applying SHALL be all-or-nothing for the Hub: either every selected change is applied or none is. After a successful application the last received document SHALL record the applied content, keeping the previous content for any board that still needs a choice.

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


### Requirement: Automatic checks and published status

The host SHALL check each published Hub automatically at its configured interval. The default interval SHALL be five minutes for a Git binding and one minute for a Google Drive or local folder binding, the minimum interval one minute, and a zero interval SHALL disable automatic checks while leaving manual refresh available. A check SHALL NOT start while a publish, synchronization, or update application for the same Hub is in progress. A check against Google Drive SHALL use the Drive change feed with a persisted cursor and SHALL read the document content only when the document revision changed; an expired or invalid cursor SHALL trigger a full document read. A check against a local folder SHALL observe the document's last-modified time and size and SHALL read the document content only when either differs from the previous observation, when no previous observation exists, or when the observation cannot be read. A failed check SHALL NOT block local editing and SHALL be reported as unavailable together with the last successful check time. The host snapshot SHALL expose, per published Hub, the storage, the storage address, the synchronization mode, the publication status, the configured interval, the last successful check time, the current failure, the draft or pending count, the number of team changes a synchronization would apply, the conflict count, the per-board publishing state, and any review the storage itself requires.

#### Scenario: Default interval

- **WHEN** a Git-published Hub is configured without an interval
- **THEN** the host checks it every five minutes

#### Scenario: Default interval for Google Drive

- **WHEN** a Google Drive-published Hub is configured without an interval
- **THEN** the host checks it every minute

#### Scenario: Default interval for a local folder

- **WHEN** a local-folder-published Hub is configured without an interval
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

- **WHEN** a check fails because Google Drive, the repository, or the bound local folder is unreachable
- **THEN** local editing, saving, and task work remain available
- **AND** the Hub reports the failure and the last successful check time

#### Scenario: Status arrives with the snapshot

- **WHEN** a published Hub has available team updates, pending changes, or a storage-level review
- **THEN** the host snapshot reports the storage, synchronization mode, update count, pending count, review, and the per-board states
- **AND** the interface updates without an additional channel

#### Scenario: Checks do not overlap with changes in flight

- **WHEN** a check is due while a publish, synchronization, or update application for the same Hub is running
- **THEN** the check starts after that operation finishes

#### Scenario: Read content only when the document changed

- **WHEN** a Google Drive check finds no change to the document revision
- **THEN** the plugin does not read the document content

#### Scenario: Read the file only when its observation changed

- **WHEN** a local folder check finds that the document's last-modified time and size are unchanged
- **THEN** the plugin does not read the document content
- **AND** it does not reapply team updates

#### Scenario: Recover from an expired change cursor

- **WHEN** the stored Google Drive change cursor is rejected
- **THEN** the next check reads the document content in full
- **AND** the new cursor is stored after a successful read


### Requirement: Team Settings interface

Configuration SHALL include a **Team Settings** section for the active Hub. That section SHALL present a storage selector with Git, Google Drive, and Local folder and SHALL render the selected storage's surface. For a Git binding the section SHALL present the repository address, the check interval, the Hub status, the per-board states, the locally removed boards, and the actions Connect, Publish, Get updates, Refresh, and Disconnect. For a Google Drive binding the section SHALL present the connected account, the Drive and folder location, the synchronization status, the pending and conflict counts, the last successful synchronization, the current failure, the per-board states, the locally removed boards, and the actions Connect, Sync now, Review, Disconnect, and Switch account. For a local folder binding the section SHALL present the folder path, a folder selection surface that accepts a typed path or the host's folder picker, the suggested default folder, the check interval, the synchronization status, the pending and conflict counts, the last successful synchronization, the current failure, any storage-level review together with the step that clears it, the per-board states, the locally removed boards, and the actions Connect, Sync now, and Disconnect. A refused connection SHALL name the specific condition that prevented it. The storage selector SHALL change the rendered surface while the Hub has no binding and SHALL show the bound storage without changing it while the Hub is published; changing storage SHALL require Disconnect. The board SHALL present a banner when team changes are available or a review is required. The Hub tab SHALL indicate available team changes, pending changes, and conflicts without opening Configuration, and SHALL show them simultaneously when more than one applies. Each board tab SHALL indicate its own publishing state. A refusal SHALL present the blocking boards, columns, and task counts and SHALL NOT offer an override. The interface SHALL NOT require knowledge of revision-control concepts: it SHALL NOT present commit, branch, remote, fetch, or push wording.

#### Scenario: Open the Publishing section

- **WHEN** the user opens Team Settings for a Git-published Hub
- **THEN** the section presents the repository address, interval, Hub status, per-board states, locally removed boards, and the Git actions

#### Scenario: Open Team Settings for Google Drive

- **WHEN** the user opens Team Settings for a Google Drive-published Hub
- **THEN** the section presents the account, Drive and folder location, synchronization status, pending and conflict counts, last successful synchronization, current failure, per-board states, locally removed boards, and the Drive actions

#### Scenario: Open Team Settings for a local folder

- **WHEN** the user opens Team Settings for a local-folder-published Hub
- **THEN** the section presents the folder path, synchronization status, pending and conflict counts, last successful synchronization, current failure, any storage-level review, per-board states, locally removed boards, and the local folder actions

#### Scenario: Select a storage while unpublished

- **WHEN** the Hub has no binding and the user selects Git, Google Drive, or Local folder in the storage selector
- **THEN** the section renders that storage's connection surface
- **AND** no binding is created before the user connects

#### Scenario: Choose a folder with the folder picker

- **WHEN** the host provides a folder picker and the user selects a directory
- **THEN** the chosen path fills the path field
- **AND** connecting uses that path
- **AND** typing a path remains available when the host provides no picker

#### Scenario: Name the refused condition

- **WHEN** a local folder connection is refused because the path is missing, is not a folder, is not writable, is already in use, or is reserved
- **THEN** the section reports that specific condition
- **AND** it does not create a binding

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

Connecting a storage that already contains a published document while the Hub has no received document SHALL present the differences and SHALL require choosing either to receive the published configuration or to publish the local one. Connecting a storage with no published document SHALL publish the local configuration without requiring that choice. A Git repository with no commits or no published document, a Google Drive folder with no `kanban-hub.yaml`, and a local folder with no `kanban-hub.yaml` SHALL all count as having no published document. A Google Drive document SHALL be adopted by its file ID when the selected folder already contains `kanban-hub.yaml`; a local folder document SHALL be adopted in place when the selected directory already contains it.

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

#### Scenario: Connect an empty local folder

- **WHEN** the user connects a local folder that contains no `kanban-hub.yaml`
- **THEN** the local configuration is published to a new document
- **AND** no choice is requested

#### Scenario: Connect a local folder that already has a document

- **WHEN** the user connects a local folder that already contains `kanban-hub.yaml`
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

Access to the shared document SHALL go through a storage-provider boundary that reads a whole document with a version token and writes a whole document while the expected token matches. A provider that supports an atomic conditional write (Git) SHALL refuse a stale write without modifying the document. A provider that does not support an atomic conditional write (Google Drive and a local folder) SHALL compare the token before writing, verify the written content after writing, and report a concurrent change without claiming an atomic guarantee; the previous content SHALL remain recoverable from the storage's own history or conflict copies. The supported storages SHALL be Git, Google Drive, and a local folder; any other storage SHALL be rejected with an explicit error. The document format, the merge rules, and the interface states SHALL NOT depend on the storage. Provider-specific connection, location, and synchronization state SHALL be exposed through the storage's own surface, and provider-specific connection rules SHALL be applied through the storage descriptor rather than by branching on the storage inside the publishing service.

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

#### Scenario: Detect a stale write on a local folder

- **WHEN** a local folder write supplies a token that no longer matches the document on disk
- **THEN** the write is refused without replacing the document
- **AND** the local changes remain pending for review

#### Scenario: Reject an unsupported provider

- **WHEN** a Hub is configured with a storage other than Git, Google Drive, or a local folder
- **THEN** the plugin reports an explicit unsupported-storage error
- **AND** no publishing operation starts

#### Scenario: Keep the document and merge rules storage-independent

- **WHEN** a Hub is published with a different storage
- **THEN** the document format, merge rules, board keys, and interface states remain the same


### Requirement: Continuous synchronization

For a storage that supports continuous synchronization (Google Drive or a local folder), saving a board, a board name, a board order, or a workflow SHALL mark the Hub as pending and SHALL synchronize automatically after a short debounce without a Publish action. A synchronization SHALL apply team changes that only the team made in one Hub transaction. A board changed on both sides, a blocker, a concurrent write, or a storage-level review SHALL require explicit review and SHALL NOT be applied or published automatically. A local change SHALL NOT overwrite a team change that arrived since the last received document; the plugin SHALL keep the local change pending and require review. Offline or transient failures SHALL keep every local change pending and SHALL retry on later checks without losing edits; the interface SHALL show the pending state and the failure. Synchronization SHALL be serialized per Hub and SHALL survive a plugin restart; a pending change SHALL synchronize after the restart or after the connection returns. A Git binding SHALL keep explicit publishing and SHALL NOT synchronize automatically.

#### Scenario: Save a workflow and synchronize

- **WHEN** the user saves a workflow on a Google Drive binding
- **THEN** the local save completes first
- **AND** the pending change synchronizes automatically
- **AND** the board stops being pending after a successful synchronization

#### Scenario: Save a workflow and synchronize through a local folder

- **WHEN** the user saves a workflow on a local folder binding
- **THEN** the local save completes first
- **AND** the pending change synchronizes automatically into `kanban-hub.yaml`
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

- **WHEN** a local change is saved while Google Drive is unreachable or the bound local folder is unavailable
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
