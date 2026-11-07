# Spec Delta

## MODIFIED Requirements

### Requirement: Optional publishing per Hub

Publishing SHALL be opt-in for each Hub and SHALL bind that Hub to exactly one storage: a Git repository, a Google Drive Cloud folder, a Google Drive Local folder, or a local folder. A Hub that has not been published SHALL have no storage binding, managed local workspace, scheduled check, or publishing state, and every existing board, workflow, and task behavior SHALL remain unchanged. Enabling publishing SHALL require a valid binding for the chosen storage: a Git binding SHALL create a plugin-managed local clone of the repository, a Google Drive Cloud binding SHALL use the selected folder and its `kanban-hub.yaml` document, a Google Drive Local binding SHALL use the selected folder inside a discovered Google Drive location and its `kanban-hub.yaml` document, and a local folder binding SHALL use the selected directory and its `kanban-hub.yaml` document. Disabling publishing SHALL remove the binding and any plugin-managed local workspace, SHALL stop automatic checks, and SHALL retain every local board, workflow, task, note, project, conversation, and worktree. Disabling publishing SHALL NOT remove the team's shared document, the Google account authorization that other Hubs may use, the Google Drive for desktop installation or its local cache, or the bound folder and its document.

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

#### Scenario: Enable Google Drive Local publishing

- **WHEN** the user enables publishing for a Hub with a folder selected inside a discovered Google Drive location
- **THEN** the plugin creates or adopts the `kanban-hub.yaml` document in that folder
- **AND** Team Settings presents the Hub as connected
- **AND** no account authorization is requested

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

### Requirement: Automatic checks and published status

The host SHALL check each published Hub automatically at its configured interval. The default interval SHALL be five minutes for a Git binding and one minute for a Google Drive Cloud, Google Drive Local, or local folder binding, the minimum interval one minute, and a zero interval SHALL disable automatic checks while leaving manual refresh available. A check SHALL NOT start while a publish, synchronization, or update application for the same Hub is in progress. A check against Google Drive Cloud SHALL use the Drive change feed with a persisted cursor and SHALL read the document content only when the document revision changed; an expired or invalid cursor SHALL trigger a full document read. A check against a local folder or a Google Drive Local folder SHALL observe the document's last-modified time and size and SHALL read the document content only when either differs from the previous observation, when no previous observation exists, or when the observation cannot be read. A failed check SHALL NOT block local editing and SHALL be reported as unavailable together with the last successful check time. The host snapshot SHALL expose, per published Hub, the storage, the storage address, the synchronization mode, the publication status, the configured interval, the last successful check time, the current failure, the draft or pending count, the number of team changes a synchronization would apply, the conflict count, the per-board publishing state, and any review the storage itself requires.

#### Scenario: Default interval

- **WHEN** a Git-published Hub is configured without an interval
- **THEN** the host checks it every five minutes

#### Scenario: Default interval for Google Drive

- **WHEN** a Google Drive Cloud-published Hub is configured without an interval
- **THEN** the host checks it every minute

#### Scenario: Default interval for Google Drive Local

- **WHEN** a Google Drive Local-published Hub is configured without an interval
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

- **WHEN** a check fails because Google Drive Cloud, Google Drive Local, the repository, or the bound local folder is unreachable
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

- **WHEN** a Google Drive Cloud check finds no change to the document revision
- **THEN** the plugin does not read the document content

#### Scenario: Read the file only when its observation changed

- **WHEN** a local folder or Google Drive Local check finds that the document's last-modified time and size are unchanged
- **THEN** the plugin does not read the document content
- **AND** it does not reapply team updates

#### Scenario: Recover from an expired change cursor

- **WHEN** the stored Google Drive Cloud change cursor is rejected
- **THEN** the next check reads the document content in full
- **AND** the new cursor is stored after a successful read

### Requirement: Team Settings interface

Configuration SHALL include a **Team Settings** section for the active Hub. That section SHALL present the team storages as selectable cards, each with an icon, a name, and a one-line description — Git, Google Drive Cloud, Google Drive Local, and Local folder — and SHALL render the selected storage's surface. For a Git binding the section SHALL present the repository address, the check interval, the Hub status, the per-board states, the locally removed boards, and the actions Connect, Publish, Get updates, Refresh, and Disconnect. For a Google Drive Cloud binding the section SHALL present the connected account, the Drive and folder location, the synchronization status, the pending and conflict counts, the last successful synchronization, the current failure, the per-board states, the locally removed boards, and the actions Connect, Sync now, Review, Disconnect, and Switch account. For a Google Drive Local binding the section SHALL present the Google account and the folder location, the check interval, a **Choose folder** or **Change folder** action, the synchronization status, the pending and conflict counts, the last successful synchronization, the current failure, any storage-level review together with the step that clears it, the per-board states, the locally removed boards, and the actions Sync now and Disconnect. The Google Drive Local folder browser SHALL present the discovered accounts and locations, a breadcrumb of the current location, the folders of that location, a filter for that location, and the host's native folder picker as an alternative. When no Google Drive for desktop location is detected, or the platform does not support it, the section SHALL explain that condition, SHALL offer a rescan action together with the native folder picker, and SHALL NOT create a binding. For a local folder binding the section SHALL present the folder path, a folder selection surface that accepts a typed path or the host's folder picker, the suggested default folder, the check interval, the synchronization status, the pending and conflict counts, the last successful synchronization, the current failure, any storage-level review together with the step that clears it, the per-board states, the locally removed boards, and the actions Connect, Sync now, and Disconnect. A refused connection SHALL name the specific condition that prevented it. The storage cards SHALL change the rendered surface while the Hub has no binding and SHALL show the bound storage without changing it while the Hub is published; changing storage SHALL require Disconnect. The board SHALL present a banner when team changes are available or a review is required. The Hub tab SHALL indicate available team changes, pending changes, and conflicts without opening Configuration, and SHALL show them simultaneously when more than one applies. Each board tab SHALL indicate its own publishing state. A refusal SHALL present the blocking boards, columns, and task counts and SHALL NOT offer an override. The interface SHALL NOT require knowledge of revision-control concepts: it SHALL NOT present commit, branch, remote, fetch, or push wording.

#### Scenario: Open the Publishing section

- **WHEN** the user opens Team Settings for a Git-published Hub
- **THEN** the section presents the repository address, interval, Hub status, per-board states, locally removed boards, and the Git actions

#### Scenario: Open Team Settings for Google Drive

- **WHEN** the user opens Team Settings for a Google Drive Cloud-published Hub
- **THEN** the section presents the account, Drive and folder location, synchronization status, pending and conflict counts, last successful synchronization, current failure, per-board states, locally removed boards, and the Drive actions

#### Scenario: Open Team Settings for Google Drive Local

- **WHEN** the user opens Team Settings for a Google Drive Local-published Hub
- **THEN** the section presents the account, folder location, interval, synchronization status, pending and conflict counts, last successful synchronization, current failure, any storage-level review, per-board states, locally removed boards, and the Drive Local actions

#### Scenario: Open Team Settings for a local folder

- **WHEN** the user opens Team Settings for a local-folder-published Hub
- **THEN** the section presents the folder path, synchronization status, pending and conflict counts, last successful synchronization, current failure, any storage-level review, per-board states, locally removed boards, and the local folder actions

#### Scenario: Storage cards identify the storage

- **WHEN** the user opens Team Settings
- **THEN** each storage card presents an icon, a storage name, and a one-line description
- **AND** the selected card is distinguishable without opening it

#### Scenario: Select a storage while unpublished

- **WHEN** the Hub has no binding and the user selects one of the storage cards
- **THEN** the section renders that storage's connection surface
- **AND** no binding is created before the user connects

#### Scenario: Choose a folder with the folder picker

- **WHEN** the host provides a folder picker for a local folder binding and the user selects a directory
- **THEN** the chosen path fills the path field
- **AND** connecting uses that path
- **AND** typing a path remains available when the host provides no picker

#### Scenario: Browse for a Google Drive Local folder

- **WHEN** the user opens the Google Drive Local folder browser and navigates into a discovered location
- **THEN** the browser presents the folders of the current location and a breadcrumb of the path
- **AND** the user can select the current folder without typing a path
- **AND** the browser reports whether `kanban-hub.yaml` is already present there

#### Scenario: Use the native picker for Google Drive Local

- **WHEN** the user chooses the native folder picker instead of the browser
- **THEN** the selected folder is validated against the discovered Google Drive locations
- **AND** connecting uses that folder when it is inside a discovered location

#### Scenario: Google Drive Local is not available

- **WHEN** the Drive for desktop application is not detected or the platform does not support it
- **THEN** the section explains the condition and offers a rescan action
- **AND** it does not create a binding
- **AND** the native folder picker remains reachable

#### Scenario: Name the refused condition

- **WHEN** a local folder connection is refused because the path is missing, is not a folder, is not writable, is already in use, or is reserved
- **THEN** the section reports that specific condition
- **AND** it does not create a binding

#### Scenario: Name the refused Google Drive Local condition

- **WHEN** a Google Drive Local connection is refused because the folder is not inside a discovered location, the application is not detected, the location is unavailable, or the operating system denies access
- **THEN** the section reports that specific condition
- **AND** it does not create a binding

#### Scenario: The bound storage is not changed by the selector

- **WHEN** the Hub is published and the user opens the storage cards
- **THEN** the cards show the bound storage
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

### Requirement: Storage-provider boundary

Access to the shared document SHALL go through a storage-provider boundary that reads a whole document with a version token and writes a whole document while the expected token matches. A provider that supports an atomic conditional write (Git) SHALL refuse a stale write without modifying the document. A provider that does not support an atomic conditional write (Google Drive Cloud, Google Drive Local, and a local folder) SHALL compare the token before writing, verify the written content after writing, and report a concurrent change without claiming an atomic guarantee; the previous content SHALL remain recoverable from the storage's own history or conflict copies. The supported storages SHALL be Git, Google Drive Cloud, Google Drive Local, and a local folder; any other storage SHALL be rejected with an explicit error. The document format, the merge rules, and the interface states SHALL NOT depend on the storage. Provider-specific connection, location, and synchronization state SHALL be exposed through the storage's own surface, and provider-specific connection rules SHALL be applied through the storage descriptor rather than by branching on the storage inside the publishing service.

#### Scenario: Read and write a document with its token

- **WHEN** the plugin reads or writes the published document
- **THEN** the provider returns or requires the document's version token

#### Scenario: Refuse a stale write

- **WHEN** a Git write supplies a token that no longer matches the published document
- **THEN** the write is refused and the published document is unchanged

#### Scenario: Detect a stale write on Google Drive

- **WHEN** a Google Drive Cloud write supplies a token that no longer matches the document
- **THEN** the write is not presented as a success
- **AND** the local changes remain pending for review

#### Scenario: Detect a stale write on Google Drive Local

- **WHEN** a Google Drive Local write supplies a token that no longer matches the document on disk
- **THEN** the write is refused without replacing the document
- **AND** the local changes remain pending for review

#### Scenario: Detect a stale write on a local folder

- **WHEN** a local folder write supplies a token that no longer matches the document on disk
- **THEN** the write is refused without replacing the document
- **AND** the local changes remain pending for review

#### Scenario: Reject an unsupported provider

- **WHEN** a Hub is configured with a storage other than Git, Google Drive Cloud, Google Drive Local, or a local folder
- **THEN** the plugin reports an explicit unsupported-storage error
- **AND** no publishing operation starts

#### Scenario: Keep the document and merge rules storage-independent

- **WHEN** a Hub is published with a different storage
- **THEN** the document format, merge rules, board keys, and interface states remain the same

### Requirement: Continuous synchronization

For a storage that supports continuous synchronization (Google Drive Cloud, Google Drive Local, or a local folder), saving a board, a board name, a board order, or a workflow SHALL mark the Hub as pending and SHALL synchronize automatically after a short debounce without a Publish action. A synchronization SHALL apply team changes that only the team made in one Hub transaction. A board changed on both sides, a blocker, a concurrent write, or a storage-level review SHALL require explicit review and SHALL NOT be applied or published automatically. A local change SHALL NOT overwrite a team change that arrived since the last received document; the plugin SHALL keep the local change pending and require review. Offline or transient failures SHALL keep every local change pending and SHALL retry on later checks without losing edits; the interface SHALL show the pending state and the failure. Synchronization SHALL be serialized per Hub and SHALL survive a plugin restart; a pending change SHALL synchronize after the restart or after the connection returns. A Git binding SHALL keep explicit publishing and SHALL NOT synchronize automatically.

#### Scenario: Save a workflow and synchronize

- **WHEN** the user saves a workflow on a Google Drive Cloud binding
- **THEN** the local save completes first
- **AND** the pending change synchronizes automatically
- **AND** the board stops being pending after a successful synchronization

#### Scenario: Save a workflow and synchronize through Google Drive Local

- **WHEN** the user saves a workflow on a Google Drive Local binding
- **THEN** the local save completes first
- **AND** the pending change synchronizes automatically into `kanban-hub.yaml`
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

- **WHEN** a local change is saved while Google Drive Cloud is unreachable, or while the bound Google Drive Local or local folder is unavailable
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

## ADDED Requirements

### Requirement: Google Drive local storage location

**Google Drive Local** SHALL be available as a team storage only through the folders that Google Drive for desktop exposes on this computer, SHALL require no account authorization and no Google Drive API call, and SHALL synchronize continuously. A binding SHALL identify its storage by the resolved absolute path of the selected folder together with display-only account and drive labels, and the plugin SHALL accept the folder only when that resolved path lies inside a discovered Google Drive location. Connecting SHALL refuse a folder that does not exist, resolves to a file rather than a directory, is not writable by the plugin, is already bound to another Hub, lies inside the plugin's managed publishing workspace, or resolves outside every discovered location, and each refusal SHALL name its specific condition. The plugin SHALL own exactly one file in the selected folder, `kanban-hub.yaml`, SHALL NOT read, create, modify, or delete any other entry, and SHALL create the document only when it is absent. A folder SHALL bind at most one Hub and a Hub SHALL bind at most one folder, and two paths that resolve to the same directory SHALL be treated as the same folder. The user SHALL select the folder through the folder browser or the host's native folder picker; the connection surface SHALL NOT require a typed path, and both selection routes SHALL be validated by the same rules. The first-connection rules of this capability SHALL apply to the selected folder exactly as they apply to a local folder. A bound Hub SHALL offer a **Change folder** action while it is connected; after an explicit confirmation the action SHALL select another Google Drive Local folder, SHALL keep every local board, task, note, project, conversation, and worktree, SHALL discard the previous board keys, bindings, orphans, removals, and pending removals, and SHALL then follow the first-connection rules for the new folder. When the bound location or the folder is missing, unreadable, no longer discovered, or no longer provided by the application at check time, the Hub SHALL report an unavailable state with a typed failure, SHALL keep every local change pending, SHALL NOT delete the folder or the document, and SHALL resume normal operation without a new selection when the same resolved path becomes readable again. The plugin SHALL NOT relocate a binding to a different discovered path on its own. The conflict-copy, concurrent-write, draft and pending, team-update, board-removal, and locally-removed-board guarantees that this capability states for a local folder SHALL apply unchanged to a Google Drive Local folder. Disconnecting the Hub or deleting it SHALL remove the binding and SHALL NOT delete the folder, `kanban-hub.yaml`, any other entry, or the Google Drive for desktop installation.

#### Scenario: Connect a discovered empty folder

- **WHEN** the user selects a folder inside a discovered location that contains no `kanban-hub.yaml`
- **THEN** the plugin creates the document from the local Hub
- **AND** the Hub becomes connected
- **AND** no account authorization is requested

#### Scenario: Adopt an existing document

- **WHEN** the selected folder already contains `kanban-hub.yaml`
- **THEN** the plugin presents the first-connection choice before connecting
- **AND** the Hub stays unpublished until the user chooses

#### Scenario: Refuse a folder outside the discovered locations

- **WHEN** the user selects a folder that resolves outside every discovered Google Drive location
- **THEN** no binding is created and the section reports that the folder is not inside a Google Drive location

#### Scenario: Refuse an unavailable mount

- **WHEN** the user selects a folder whose discovered location is currently unavailable
- **THEN** no binding is created and the section reports that the Drive location is unavailable

#### Scenario: Refuse a folder already bound to another Hub

- **WHEN** the user selects a folder that already belongs to another Hub's binding
- **THEN** no binding is created and the section reports that the folder is already in use

#### Scenario: Leave other files untouched

- **WHEN** the selected folder contains files that are not `kanban-hub.yaml`
- **THEN** the plugin does not read, modify, or delete them

#### Scenario: Change the folder keeps local work

- **WHEN** a connected Google Drive Local Hub changes its folder and the new folder contains a published document
- **THEN** the user confirms the change before it starts
- **AND** every local board, task, note, project, conversation, and worktree remains
- **AND** the first-connection choice is presented for the new document

#### Scenario: Change the folder to an empty folder

- **WHEN** a connected Google Drive Local Hub changes to a folder with no `kanban-hub.yaml`
- **THEN** the previous publishing keys, bindings, orphans, removals, and pending removals are discarded
- **AND** the local configuration is published into the new folder
- **AND** the local boards, tasks, and notes remain

#### Scenario: The mount disappears

- **WHEN** the bound Google Drive location becomes unreachable or is no longer discovered
- **THEN** the Hub reports an unavailable state with a typed failure
- **AND** every local change remains pending
- **AND** no local board, workflow, or task is deleted

#### Scenario: The mount returns

- **WHEN** the same resolved path becomes readable and discovered again
- **THEN** the Hub resumes synchronization without a new folder selection

#### Scenario: The application is removed after connecting

- **WHEN** Google Drive for desktop is uninstalled or stops mounting the bound folder
- **THEN** the Hub reports the location as unavailable
- **AND** the plugin does not move the binding to another folder

#### Scenario: Disconnect keeps the folder and the document

- **WHEN** the user disconnects or deletes a Google Drive Local Hub
- **THEN** the binding is removed and automatic checks stop
- **AND** the folder, `kanban-hub.yaml`, every other entry, and the installed application remain unchanged

#### Scenario: Unsupported platform cannot connect

- **WHEN** the host runs on a platform where Google Drive for desktop does not exist
- **THEN** no Google Drive Local binding can be created
- **AND** the local Hub state is unchanged

#### Scenario: A conflict copy blocks automatic synchronization

- **WHEN** a Google Drive Local check finds a conflict copy next to `kanban-hub.yaml`
- **THEN** the Hub presents the review and applies and publishes nothing automatically
- **AND** the plugin does not choose, rename, merge, or delete either version
