# Spec Delta

## MODIFIED Requirements

### Requirement: Optional publishing per Hub

Publishing SHALL be opt-in for each Hub and SHALL bind that Hub to exactly one storage: a Git repository, a Google Drive Cloud folder, a Google Drive Local folder, or a local folder. A Hub that has not been published SHALL have no storage binding, managed local workspace, scheduled check, or publishing state, and every existing board, workflow, and task behavior SHALL remain unchanged. Enabling publishing SHALL require a valid binding for the chosen storage: a Git binding SHALL create a plugin-managed local clone of the repository, a Google Drive Cloud binding SHALL use the selected folder and its `kanban-hub.yaml` document, a Google Drive Local binding SHALL use the selected folder inside a discovered Google Drive location and its `kanban-hub.yaml` document, and a local folder binding SHALL use the selected directory and its `kanban-hub.yaml` document. Disabling publishing SHALL remove the binding and any plugin-managed local workspace, SHALL stop automatic checks, and SHALL retain every local board, workflow, task, note, project, conversation, and worktree. Disabling publishing SHALL NOT remove the team's shared document, the Google account authorization that other Hubs may use, the Google Drive for desktop installation or its local cache, or the bound folder, its document, or the `team-files` directory.

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

#### Scenario: Keep the team files directory on disable

- **WHEN** the user disables publishing for a Hub whose storage holds a team files directory
- **THEN** the binding and any plugin-managed local workspace are removed
- **AND** the team files directory and every file in it remain unchanged


### Requirement: Google Drive local storage location

**Google Drive Local** SHALL be available as a team storage only through the folders that Google Drive for desktop exposes on this computer, SHALL require no account authorization and no Google Drive API call, and SHALL synchronize continuously. A binding SHALL identify its storage by the resolved absolute path of the selected folder together with display-only account and drive labels, and the plugin SHALL accept the folder only when that resolved path lies inside a discovered Google Drive location. Connecting SHALL refuse a folder that does not exist, resolves to a file rather than a directory, is not writable by the plugin, is already bound to another Hub, lies inside the plugin's managed publishing workspace, or resolves outside every discovered location, and each refusal SHALL name its specific condition. The plugin SHALL own exactly two entries in the selected folder: the `kanban-hub.yaml` document and the `team-files` directory that holds the team's files. It SHALL create the document only when it is absent, SHALL create the team files directory only when the first team file is written, SHALL adopt a team files directory that already exists, and SHALL NOT read, create, modify, or delete any other entry. A folder SHALL bind at most one Hub and a Hub SHALL bind at most one folder, and two paths that resolve to the same directory SHALL be treated as the same folder. The user SHALL select the folder through the folder browser or the host's native folder picker; the connection surface SHALL NOT require a typed path, and both selection routes SHALL be validated by the same rules. The first-connection rules of this capability SHALL apply to the selected folder exactly as they apply to a local folder. A bound Hub SHALL offer a **Change folder** action while it is connected; after an explicit confirmation the action SHALL select another Google Drive Local folder, SHALL keep every local board, task, note, project, conversation, and worktree, SHALL discard the previous board keys, bindings, orphans, removals, and pending removals, and SHALL then follow the first-connection rules for the new folder. When the bound location or the folder is missing, unreadable, no longer discovered, or no longer provided by the application at check time, the Hub SHALL report an unavailable state with a typed failure, SHALL keep every local change pending, SHALL NOT delete the folder or the document, and SHALL resume normal operation without a new selection when the same resolved path becomes readable again. The plugin SHALL NOT relocate a binding to a different discovered path on its own. The conflict-copy, concurrent-write, draft and pending, team-update, board-removal, and locally-removed-board guarantees that this capability states for a local folder SHALL apply unchanged to a Google Drive Local folder. Disconnecting the Hub or deleting it SHALL remove the binding and SHALL NOT delete the folder, `kanban-hub.yaml`, the `team-files` directory, any other entry, or the Google Drive for desktop installation.

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

#### Scenario: Own the team files directory

- **WHEN** an agent creates the first team file for a Google Drive Local Hub
- **THEN** the `team-files` directory is created inside the bound folder
- **AND** every other entry in that folder is unchanged


### Requirement: Local folder storage location

A local folder binding SHALL identify the storage by an absolute directory path. The plugin SHALL accept an absolute path or a path beginning with `~`, SHALL resolve symbolic links, and SHALL store the resolved path. The selected directory SHALL already exist and SHALL be writable by the plugin; connecting SHALL refuse a path that does not exist, a path that resolves to a file rather than a directory, a directory the plugin cannot write, a directory already bound to another Hub, and a directory inside the plugin's managed publishing workspace. The plugin SHALL own exactly two entries in that directory: the `kanban-hub.yaml` document and the `team-files` directory that holds the team's files. It SHALL create the document only when it is absent, SHALL create the team files directory only when the first team file is written, SHALL adopt a team files directory that already exists, and SHALL NOT read, create, modify, or delete any other entry. A folder SHALL bind at most one Hub and a Hub SHALL bind at most one folder. Two paths that resolve to the same directory SHALL be treated as the same folder, compared case-insensitively on a case-insensitive filesystem. Team Settings SHALL suggest the default folder `~/.dsh-kanban/<Hub id>` and SHALL pre-fill it in the path field. Connecting to exactly the suggested path SHALL create that directory when it is absent; connecting to any other path SHALL NOT create a directory. Disconnecting a Hub, deleting a Hub, or replacing the binding SHALL NOT delete the folder, the document, the `team-files` directory, or any other entry. When the bound directory or the document is missing or unreadable at check time, the Hub SHALL report an unavailable state with a typed failure, SHALL keep every local change pending, and SHALL resume normal operation without a new binding when the directory and the document become readable again.

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

#### Scenario: Own the team files directory

- **WHEN** an agent creates the first team file for a local folder Hub
- **THEN** the `team-files` directory is created in the bound directory
- **AND** every other entry in that directory is unchanged


## ADDED Requirements

### Requirement: Team files presentation

When a Hub is bound to a storage that supports team files, the Team Settings section SHALL name the `team-files` directory of that binding and state that the team's documents in it are read and written by the agent tools. For a Hub bound to Google Drive Cloud, the section SHALL state that team files are unavailable with that storage and SHALL NOT offer a team file action. The section SHALL present no file browser, listing, or editor, SHALL NOT create or open the directory, and SHALL NOT add a client surface for team files.

#### Scenario: Name the team files directory

- **WHEN** the user opens Team Settings for a Hub bound to Git, a local folder, or a Google Drive Local folder
- **THEN** the section names the `team-files` directory and states that the agent tools read and write the team's documents there

#### Scenario: State unavailability for Google Drive Cloud

- **WHEN** the user opens Team Settings for a Hub bound to Google Drive Cloud
- **THEN** the section states that team files are unavailable with that storage
- **AND** no team file action is offered

#### Scenario: Do not add a file management surface

- **WHEN** the team files directory does not exist
- **THEN** Team Settings does not create it
- **AND** the section presents no file browser, listing, or editor
