# Spec Delta

## REMOVED Requirements

### Requirement: Continuous synchronization

**Reason**: Publishing is manual and per board in this capability. A board is published only when the user asks for it, and receiving a team change is a separate explicit action for that board, so there is no Hub-wide automatic synchronization left to specify. The durability guarantees it carried are restated by Drafts and explicit publishing and by Board publication isolation.

**Migration**: A local change stays a draft for its board until that board is published. Losing the connection leaves every draft and every board cursor untouched, and they resume on a later check or publish. Nothing pending at upgrade time is discarded: each pending change remains a draft on the board it belongs to.

### Requirement: Team updates and three-way application

**Reason**: Applying team changes no longer compares three whole documents board by board. Each published board carries its own event log, so an update is the set of events after that board's cursor, and a field-level divergence is decided by the order the events were appended rather than by a three-way comparison. Layout is no longer a special case that merges beside a meaning winner: a layout change is an ordinary event.

**Migration**: A board that has unapplied team events is updated by applying those events. Where the previous behaviour offered a per-board choice for a meaning change, the choice remains only for identity and lifecycle divergence; a field-level divergence is resolved by the later append and the replaced value is presented as superseded. No local workflow, task, or project scope is lost by the change, because a board's authored workflow is carried in its own log.

## MODIFIED Requirements

### Requirement: Optional publishing per Hub

Publishing SHALL be opt-in for each Hub and SHALL bind that Hub to exactly one storage: a Git repository, a Google Drive Cloud folder, a Google Drive Local folder, or a local folder. A Hub that has not been published SHALL have no storage binding, managed local workspace, scheduled check, or publishing state, and every existing board, workflow, and task behavior SHALL remain unchanged. Enabling publishing SHALL require a valid binding for the chosen storage: a Git binding SHALL create a plugin-managed local clone of the repository, and a Google Drive Cloud binding, a Google Drive Local binding, and a local folder binding SHALL each use the selected location and its published layout. The published layout SHALL consist of a `kanban-hub.yaml` manifest, which names the Hub's published boards and their order, and one log per published board. A storage with directories SHALL hold the logs in a `kanban-boards` directory; a storage without them SHALL hold each log as a file named `kanban-board-<key>.yaml` beside the manifest. Disabling publishing SHALL remove the binding and any plugin-managed local workspace, SHALL stop automatic checks, and SHALL retain every local board, workflow, task, note, project, conversation, and worktree. Disabling publishing SHALL NOT remove the team's published layout, the Google account authorization that other Hubs may use, the Google Drive for desktop installation or its local cache, or the bound folder, its layout, or the `team-files` directory.

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
- **THEN** the plugin creates or adopts the published layout in that folder
- **AND** Team Settings presents the Hub as connected

#### Scenario: Enable Google Drive Local publishing

- **WHEN** the user enables publishing for a Hub with a folder selected inside a discovered Google Drive location
- **THEN** the plugin creates or adopts the published layout in that folder
- **AND** Team Settings presents the Hub as connected
- **AND** no account authorization is requested

#### Scenario: Enable local folder publishing

- **WHEN** the user enables publishing for a Hub with an existing writable directory
- **THEN** the plugin creates or adopts the published layout in that directory
- **AND** Team Settings presents the Hub as connected
- **AND** no managed local workspace is created

#### Scenario: Disable publishing

- **WHEN** the user disables publishing for a Hub
- **THEN** the binding and any plugin-managed local workspace are removed
- **AND** every local board, workflow, task, note, project, conversation, and worktree remains
- **AND** the team's published layout is unchanged

#### Scenario: Keep the team files directory on disable

- **WHEN** the user disables publishing for a Hub whose storage holds a team files directory
- **THEN** the binding and any plugin-managed local workspace are removed
- **AND** the team files directory and every file in it remain unchanged

### Requirement: Published document content

The published layout SHALL consist of a hub manifest and one log per published board. The manifest SHALL carry a format version and one entry per board with a stable board key, the board name, the board order, and the board's project keys when the board allows only some projects. The order of the entries SHALL be the board order. A whole board workflow SHALL NOT appear in the manifest: each board's authored workflow text and its authored layout SHALL be carried only by that board's own log. A board that allows every project of its Hub SHALL publish no project keys for that board. A board that allows some projects SHALL publish exactly those project keys and SHALL be able to publish an empty set, which states that the board accepts no new task. Project keys in the published layout are identifiers only. The published layout SHALL NOT contain project records, project paths, Git roots, default branches, tasks, notes, conversations, worktrees, worktree base paths, or any other local setting. A board key SHALL be assigned when the board is first published, SHALL remain stable across board renames, and SHALL be unique within the manifest. A project key SHALL NOT be generated by publishing: a board SHALL publish the keys its projects already carry.

#### Scenario: Publish the board list

- **WHEN** the user publishes a Hub with two boards
- **THEN** the manifest contains exactly those two boards in their board order
- **AND** each manifest entry carries its key, name, and project scope
- **AND** each board's own log carries that board's authored workflow

#### Scenario: Exclude local data

- **WHEN** a Hub with projects, tasks, notes, and conversations is published
- **THEN** none of those records or their identifiers appear in the published layout, except project keys named by a board's project keys

#### Scenario: A rename keeps the board key

- **WHEN** the user renames a published board and publishes the Hub manifest
- **THEN** the manifest entry keeps its existing key
- **AND** only the displayed name changes

#### Scenario: Preserve authored workflow text

- **WHEN** the user publishes a workflow containing comments and custom formatting
- **THEN** the published workflow text inside that board's log matches the authored text without normalization

#### Scenario: Publish a board that allows some projects

- **WHEN** the user publishes a board restricted to two projects
- **THEN** that board's manifest entry carries the two project keys
- **AND** no project path or project record appears in the published layout

#### Scenario: Publish a board that allows every project

- **WHEN** the user publishes a board with no project restriction
- **THEN** that board's manifest entry carries no project keys

#### Scenario: Publish a closed board

- **WHEN** the user publishes a board restricted to no project
- **THEN** that board's manifest entry states an empty project key set
- **AND** a receiving installation presents that board as closed for creation

### Requirement: Drafts and explicit publishing

Saving a board, a board name, a board order, or a workflow SHALL change local state only and SHALL mark the affected board as a draft, or the Hub as having a pending manifest change. Publishing SHALL be manual and SHALL be available in two scopes: publishing one board, which appends that board's pending events to its own log, and publishing the Hub manifest, which sends the Hub's board names and board order. A board publish SHALL NOT send another board's drafts and a manifest publish SHALL NOT send any board's workflow. Publishing a board that the manifest does not yet name SHALL also write that board's manifest entry. Publishing SHALL NOT be available for a board that has unapplied team events in its log; the supported next action SHALL be to apply that board's team updates. When a board's log changed since this installation last read it, a publish for that board SHALL append nothing, SHALL keep every local draft, and SHALL report the new team events.

A board administration tool invoked at the user's explicit request SHALL publish the local board change when the Hub is bound and that board permits publishing, without a separate publish action. This automatic publishing SHALL apply to board creation, board rename, workflow replacement, workflow edit, and team-scoped board removal, and SHALL NOT apply to a local-only board removal. A publishing failure or blocker SHALL keep the local change, keep the board as a draft or pending change, and report the failure.

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

#### Scenario: A board publish leaves other drafts alone

- **WHEN** the user publishes one board while another board of the same Hub is a draft
- **THEN** only the published board's log changes
- **AND** the other board remains a draft

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

#### Scenario: Publish a board created through a tool

- **WHEN** an agent creates a board through a board administration tool and publishing is permitted
- **THEN** the board is saved locally before publishing starts
- **AND** the manifest names the new board
- **AND** the board is no longer presented as a draft

#### Scenario: Publish a tool workflow edit

- **WHEN** an agent replaces or edits a board workflow through a board administration tool and publishing is permitted
- **THEN** the local workflow is saved before publishing starts
- **AND** that board's log carries the saved workflow

#### Scenario: A failed tool publish keeps the local change

- **WHEN** a board administration tool saves a local board change and the subsequent publish fails or is blocked
- **THEN** the local change remains saved
- **AND** the board remains a draft or pending change
- **AND** the failure is reported without discarding the local change

#### Scenario: Do not publish a local-only board removal

- **WHEN** an agent removes a team-bound board with the local-only scope
- **THEN** the board disappears locally
- **AND** no publish is started for that removal
- **AND** the team's published layout is unchanged

#### Scenario: Tool writes on continuous storage synchronize

- **WHEN** an agent changes a board through a board administration tool on a published Hub whose checks run automatically
- **THEN** the local change is saved
- **AND** it remains a draft for that board until the board is published
### Requirement: Refusal of destructive application

Applying a board SHALL refuse that board and apply nothing for it when an event would leave an existing local task in a stage that the resulting workflow does not define and no event of the same batch renames that stage. The refusal SHALL name the board, the stage identity, the stage identifier, and the number of affected tasks, and SHALL NOT offer an override action. A refusal SHALL be scoped to the refused board: every other board SHALL remain applicable. A published board whose name collides with a local board that has not been published SHALL still be refused, because applying it would produce two boards with the same name in one Hub.

#### Scenario: Refuse a workflow that orphans task columns

- **WHEN** the team removed a stage that still holds local tasks and no event renames that stage
- **THEN** no event is applied to that board
- **AND** the interface names the board, the stage, and how many tasks block it
- **AND** every other board remains applicable

#### Scenario: Apply after the tasks move

- **WHEN** the user moves the affected tasks to a stage the team workflow defines and retries
- **THEN** that board's team events are applied

#### Scenario: A rename is not a removal

- **WHEN** the team renamed a stage that still holds local tasks
- **THEN** the board is applied without a refusal

#### Scenario: Refuse a name collision with an unpublished board

- **WHEN** a published board has the same name as a local board that has not been published
- **THEN** no change is applied to that board
- **AND** the interface explains that the local board must be renamed or published first

### Requirement: Board removal and orphan handling

When the team removes a board, the manifest no longer names that board's key. The plugin SHALL remove the board locally only when the board has no tasks and no unpublished changes. When the board has tasks or unpublished changes, the plugin SHALL keep it as an orphan: unbound from the manifest, retaining its tasks, workflow, and drafts, and identified on its board tab. An orphan SHALL offer publishing as a new board with a new key and local deletion under the existing task rule. An orphan SHALL reconnect automatically when the manifest names a board whose key matches the orphan's last key, or whose name matches the orphan's last published name, and the local installation SHALL keep a single board for it. Publishing a team-wide removal SHALL write the manifest without that board's entry; the removed board's log MAY remain in the storage and SHALL NOT be read for a board the manifest does not name.

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
- **THEN** the manifest gains a board with a new key
- **AND** a board log is created for it
- **AND** the local board is bound to that key

#### Scenario: Reconnect by key

- **WHEN** the manifest names a board whose key matches an orphan's last key
- **THEN** the orphan is bound to that entry
- **AND** no additional board is created

#### Scenario: Reconnect by name

- **WHEN** the manifest names a board whose name matches an orphan's last published name and no entry matches its last key
- **THEN** the orphan is bound to that entry
- **AND** no additional board is created

#### Scenario: Keep a single board after reconnection

- **WHEN** an orphan reconnects
- **THEN** the local Hub has the same number of boards as before the reconnection

#### Scenario: Publish a team-wide removal

- **WHEN** the user removes a published board for the team and publishes the manifest
- **THEN** the manifest no longer names that board
- **AND** the other boards, their logs, and the team files remain unchanged

### Requirement: Locally removed boards

When the user removes a published board only from this installation, the plugin SHALL record that board as locally removed, SHALL NOT apply that board's events from later team updates, and SHALL offer restoring it while the manifest still names it. A team-wide removal SHALL remove the board's entry from the manifest when the user publishes the manifest, and the board's key SHALL NOT be recorded as locally removed.

#### Scenario: Remove a board only here

- **WHEN** the user removes a published board only from this installation
- **THEN** the board disappears locally
- **AND** the manifest is unchanged
- **AND** later team updates do not recreate that board

#### Scenario: Restore a locally removed board

- **WHEN** the user restores a locally removed board that the manifest still names
- **THEN** that board's log is applied locally again

#### Scenario: Publish a team-wide removal

- **WHEN** the user removes a published board for the team and publishes the manifest
- **THEN** the board is absent from the manifest
- **AND** the removal is not recorded as a local-only removal

#### Scenario: Synchronize a team-wide removal

- **WHEN** the user removes a published board for the team and later publishes the manifest
- **THEN** the board is absent from the manifest
- **AND** every other board, its log, and the team files are unchanged
### Requirement: Automatic checks and published status

The host SHALL check each published Hub automatically at its configured interval. The default interval SHALL be five minutes for a Git binding and one minute for a Google Drive Cloud, Google Drive Local, or local folder binding, the minimum interval one minute, and a zero interval SHALL disable automatic checks while leaving manual refresh available. A check SHALL NOT start while a publish or an update application for the same Hub is in progress. A check SHALL read the manifest and SHALL determine which board logs changed since this installation last read them using the storage's own change detection; a check SHALL read a board log only when that board changed or when this installation has no cursor for it. A check SHALL NOT apply a team change: applying stays an explicit action for the affected board. A failed check SHALL NOT block local editing and SHALL be reported as unavailable together with the last successful check time. The host snapshot SHALL expose, per published Hub, the storage, the storage address, the publication status, the configured interval, the last successful check time, the current failure, the per-board publishing state, the per-board count of unapplied team events, the per-board draft state, the pending manifest change, and any review the storage itself requires.

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

- **WHEN** a published Hub has a board with unapplied team events, a board draft, or a storage-level review
- **THEN** the host snapshot reports the storage, update counts per board, draft state, review, and the per-board states
- **AND** the interface updates without an additional channel

#### Scenario: Checks do not overlap with changes in flight

- **WHEN** a check is due while a publish or an update application for the same Hub is running
- **THEN** the check starts after that operation finishes

#### Scenario: Read a board log only when it changed

- **WHEN** a check finds that a board log did not change since this installation last read it
- **THEN** the plugin does not read that board's log
- **AND** it does not reapply that board's events

#### Scenario: A check does not apply team changes

- **WHEN** a check finds that a board's log gained events
- **THEN** the Hub reports that board as having team updates
- **AND** nothing is applied until the user acts on that board

#### Scenario: Recover from an expired change cursor

- **WHEN** the storage's stored change marker for a Hub is rejected or no longer valid
- **THEN** the next check re-examines the whole published layout
- **AND** the new marker is stored after a successful check

#### Scenario: Read content only when the document changed

- **WHEN** a Google Drive Cloud check finds no change to the manifest and no change to any board log
- **THEN** the plugin does not read their content
- **AND** it does not reapply any board's events

#### Scenario: Read the file only when its observation changed

- **WHEN** a local folder or Google Drive Local check finds that the manifest's last-modified time and size are unchanged
- **THEN** the plugin does not read the manifest
- **AND** it does not read or reapply a board log that is unchanged
### Requirement: Team Settings interface

Configuration SHALL include a **Team Settings** section for the active Hub. That section SHALL present the team storages as selectable cards, each with an icon, a name, and a one-line description — Git, Google Drive Cloud, Google Drive Local, and Local folder — and SHALL render the selected storage's surface. For a Git binding the section SHALL present the repository address, the check interval, the Hub status, the per-board states, the locally removed boards, and the actions Connect, Publish board, Publish manifest, Get updates, Refresh, and Disconnect. For a Google Drive Cloud binding the section SHALL present the connected account, the Drive and folder location, the check status, the per-board draft and update counts, the last successful check, the current failure, the per-board states, the locally removed boards, and the actions Connect, Publish board, Publish manifest, Get updates, Refresh, Disconnect, and Switch account. For a Google Drive Local binding the section SHALL present the Google account and the folder location, the check interval, a **Choose folder** or **Change folder** action, the check status, the per-board draft and update counts, the last successful check, the current failure, any storage-level review together with the step that clears it, the per-board states, the locally removed boards, and the actions Publish board, Publish manifest, Get updates, Refresh, and Disconnect. The Google Drive Local folder browser SHALL present the discovered accounts and locations, a breadcrumb of the current location, the folders of that location, a filter for that location, and the host's native folder picker as an alternative. When no Google Drive for desktop location is detected, or the platform does not support it, the section SHALL explain that condition, SHALL offer a rescan action together with the native folder picker, and SHALL NOT create a binding. For a local folder binding the section SHALL present the folder path, a folder selection surface that accepts a typed path or the host's folder picker, the suggested default folder, the check interval, the per-board draft and update counts, the last successful check, the current failure, any storage-level review together with the step that clears it, the per-board states, the locally removed boards, and the actions Connect, Publish board, Publish manifest, Get updates, Refresh, and Disconnect. A refused connection SHALL name the specific condition that prevented it. The storage cards SHALL change the rendered surface while the Hub has no binding and SHALL show the bound storage without changing it while the Hub is published; changing storage SHALL require Disconnect. Every per-board state in the section SHALL offer the update action for that board when the board has unapplied team events, and the local-version and team-version choice when the board needs a choice. The board SHALL present a banner on the active board when that board has team updates available or needs a choice, and the banner SHALL offer the same update action for that board. The Hub tab SHALL indicate available team updates, pending drafts, and boards needing a choice without opening Configuration, and SHALL show them simultaneously when more than one applies. Each board tab SHALL indicate its own publishing state. A refusal SHALL name the blocking board, the stage, and the task count and SHALL NOT offer an override. The interface SHALL NOT require knowledge of revision-control concepts: it SHALL NOT present commit, branch, remote, fetch, or push wording.

#### Scenario: Open the Publishing section

- **WHEN** the user opens Team Settings for a Git-published Hub
- **THEN** the section presents the repository address, interval, Hub status, per-board states, locally removed boards, and the Git actions

#### Scenario: Open Team Settings for Google Drive

- **WHEN** the user opens Team Settings for a Google Drive Cloud-published Hub
- **THEN** the section presents the account, Drive and folder location, check status, per-board draft and update counts, last successful check, current failure, per-board states, locally removed boards, and the Drive actions

#### Scenario: Open Team Settings for Google Drive Local

- **WHEN** the user opens Team Settings for a Google Drive Local-published Hub
- **THEN** the section presents the account, folder location, interval, check status, per-board counts, last successful check, current failure, any storage-level review, per-board states, locally removed boards, and the Drive Local actions

#### Scenario: Open Team Settings for a local folder

- **WHEN** the user opens Team Settings for a local-folder-published Hub
- **THEN** the section presents the folder path, check status, per-board counts, last successful check, current failure, any storage-level review, per-board states, locally removed boards, and the local folder actions

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
- **AND** the browser reports whether the published layout is already present there

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

- **WHEN** the active board has team updates available
- **THEN** the board presents a banner naming that state
- **AND** the banner offers the update action for that board

#### Scenario: Show a board banner for a needed choice

- **WHEN** the active board needs a choice
- **THEN** the board presents a banner that leads to the review
- **AND** the banner does not offer an update action for that board

#### Scenario: Update one board from the banner

- **WHEN** the user activates the banner's update action
- **THEN** only that board's team events are applied
- **AND** no other board is read or changed

#### Scenario: Indicate Hub publishing state on the Hub tab

- **WHEN** a published Hub has pending drafts, team updates, or boards needing a choice
- **THEN** its Hub tab indicates that state
- **AND** the indication is present while the Hub is not active

#### Scenario: Indicate board publishing state on the board tab

- **WHEN** a board is a draft, has team updates, needs a choice, or is an orphan
- **THEN** its board tab indicates that state with an accessible label

#### Scenario: Explain a refusal without an override

- **WHEN** an update application is refused
- **THEN** the interface names the blocking board, the stage, and the task count
- **AND** no override control is offered

#### Scenario: Avoid revision-control vocabulary

- **WHEN** Team Settings, the banner, or the indicators describe state and actions
- **THEN** they use storage or synchronization vocabulary rather than commit, branch, remote, fetch, or push wording

### Requirement: First connection

Connecting a storage whose published layout already exists while the Hub has no received layout SHALL present the differences per board and SHALL require choosing either to receive the published configuration or to publish the local one. Connecting a storage with no published layout SHALL publish the local configuration without requiring that choice. A Git repository with no commits or no manifest, a Google Drive folder with no manifest, and a local folder with no manifest SHALL all count as having no published configuration. A manifest in any format version this installation reads SHALL count as a published configuration, including the single-document format, which SHALL be read as the published board set. A manifest SHALL be adopted by its file ID on Google Drive and in place in a local folder when the selected location already contains one, and a directory of board logs that already exists SHALL be adopted rather than replaced.

#### Scenario: Connect an empty repository

- **WHEN** the user connects a Git repository that contains no published layout
- **THEN** the local configuration is published
- **AND** no choice is requested

#### Scenario: Connect a repository that already has content

- **WHEN** the user connects a Git repository that already contains a published layout
- **THEN** the interface presents what differs between the published configuration and the local Hub, board by board
- **AND** the Hub stays unpublished until the user chooses

#### Scenario: Connect an empty Drive folder

- **WHEN** the user connects a Google Drive folder that contains no manifest
- **THEN** the local configuration is published to a new manifest and its board logs
- **AND** no choice is requested

#### Scenario: Connect a Drive folder that already has a document

- **WHEN** the user connects a Google Drive folder that already contains a manifest
- **THEN** the interface presents what differs between the published configuration and the local Hub
- **AND** the Hub stays unpublished until the user chooses

#### Scenario: Connect an empty local folder

- **WHEN** the user connects a local folder that contains no manifest
- **THEN** the local configuration is published to a new manifest and its board logs
- **AND** no choice is requested

#### Scenario: Connect a local folder that already has a document

- **WHEN** the user connects a local folder that already contains a manifest
- **THEN** the interface presents what differs between the published configuration and the local Hub
- **AND** the Hub stays unpublished until the user chooses

#### Scenario: Connect to a single-document published configuration

- **WHEN** the user connects a storage whose configuration is the earlier single-document format
- **THEN** the differences are presented exactly as for the current format
- **AND** the choice is offered without requiring the team to republish

#### Scenario: Receive the published configuration on connection

- **WHEN** the user chooses to receive the published configuration
- **THEN** a local board with the same name as a published board is adopted as that published board instead of being rejected as a name collision
- **AND** the application rules for team updates apply to every other board
- **AND** the Hub becomes published

#### Scenario: Publish the local configuration on connection

- **WHEN** the user chooses to publish the local configuration over an existing published configuration
- **THEN** the published layout is replaced after explicit confirmation
- **AND** the Hub becomes published

### Requirement: Storage-provider boundary

Access to the published layout SHALL go through a storage-provider boundary that offers two operations: reading and writing the hub manifest with a version token, and reading and appending to one board's log with the expected head of that log. A provider that supports an atomic conditional write (Git) SHALL refuse a stale write without modifying the stored content. A provider that does not support an atomic conditional write (Google Drive Cloud, Google Drive Local, and a local folder) SHALL compare the expected value before writing, verify the written content after writing, and report a concurrent change without claiming an atomic guarantee; the previous content SHALL remain recoverable from the storage's own history or conflict copies. The boundary SHALL also answer which board logs changed since a given observation, using the cheapest mechanism the storage offers, and SHALL NOT require a stored head for a board to answer it. The supported storages SHALL be Git, Google Drive Cloud, Google Drive Local, and a local folder; any other storage SHALL be rejected with an explicit error. The published layout, the event vocabulary, the merge rules, and the interface states SHALL NOT depend on the storage. Provider-specific connection, location, and synchronization state SHALL be exposed through the storage's own surface, and provider-specific connection rules SHALL be applied through the storage descriptor rather than by branching on the storage inside the publishing service.

#### Scenario: Read and write a document with its token

- **WHEN** the plugin reads or writes the hub manifest
- **THEN** the provider returns or requires the manifest's version token

#### Scenario: Refuse a stale board append

- **WHEN** a board append supplies a head that no longer matches that board's log
- **THEN** the append is refused and the stored log is unchanged

#### Scenario: Refuse a stale manifest write

- **WHEN** a manifest write supplies a token that no longer matches the stored manifest
- **THEN** the write is refused and the stored manifest is unchanged

#### Scenario: Detect a stale write on Google Drive

- **WHEN** a Google Drive Cloud write supplies a value that no longer matches the stored content
- **THEN** the write is not presented as a success
- **AND** the local changes remain pending for review

#### Scenario: Detect a stale write on Google Drive Local

- **WHEN** a Google Drive Local write supplies a value that no longer matches the content on disk
- **THEN** the write is refused without replacing that content
- **AND** the local changes remain pending for review

#### Scenario: Detect a stale write on a local folder

- **WHEN** a local folder write supplies a value that no longer matches the content on disk
- **THEN** the write is refused without replacing that content
- **AND** the local changes remain pending for review

#### Scenario: Answer which boards changed

- **WHEN** a check asks the provider which board logs changed since the previous observation
- **THEN** the provider answers from the storage's own change detection
- **AND** the answer does not depend on a head recorded in the manifest

#### Scenario: Reject an unsupported provider

- **WHEN** a Hub is configured with a storage other than Git, Google Drive Cloud, Google Drive Local, or a local folder
- **THEN** the plugin reports an explicit unsupported-storage error
- **AND** no publishing operation starts

#### Scenario: Keep the document and merge rules storage-independent

- **WHEN** a Hub is published with a different storage
- **THEN** the published layout, event vocabulary, merge rules, board keys, and interface states remain the same

#### Scenario: Refuse a stale write

- **WHEN** a write supplies a value that no longer matches the stored content
- **THEN** the write is refused and the stored content is unchanged
### Requirement: Google Drive connection

Google Drive SHALL be available as a team storage only after the user authorizes a Google account through an installed-application OAuth flow that uses the system browser, a loopback redirect, and PKCE. The consent request SHALL ask only for the Drive access required to list the selected location, to read and write the Hub's published layout, and to observe changes. The authorization SHALL persist on this machine and SHALL refresh without another sign-in while it remains valid. The interface SHALL support connecting the account, disconnecting the account, and switching the account. Authorization tokens SHALL NOT appear in the snapshot, logs, the published layout, or any board or task content. Losing authorization SHALL present a reconnect state and SHALL NOT discard local boards, workflows, or pending changes. When the Google Cloud project, a Workspace policy, or the account blocks the authorization, the plugin SHALL report the block and SHALL NOT start a Drive operation.

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
- **AND** local boards, workflows, pending changes, and the team's published layout remain unchanged

#### Scenario: Switch the Google account

- **WHEN** the user switches the Google account
- **THEN** the plugin obtains consent for the new account before using it
- **AND** bindings that the new account cannot access are reported as requiring attention

#### Scenario: Disconnect the Google account

- **WHEN** the user disconnects the Google account
- **THEN** the stored authorization is removed
- **AND** every Drive binding presents a reconnect state without losing local data
- **AND** the team's published layouts are unchanged

#### Scenario: Authorization blocked by policy

- **WHEN** the Google Cloud project, a Workspace policy, or the account blocks the authorization
- **THEN** the plugin reports the block and starts no Drive operation

#### Scenario: Tokens are never exposed

- **WHEN** the plugin reports status or a failure
- **THEN** no access token, refresh token, or authorization code appears in the snapshot, logs, or the published layout

### Requirement: Google Drive storage location

A Google Drive binding SHALL identify its location by the Drive and folder identity and SHALL NOT depend on names for the bound location after the connection. The user SHALL select a folder in My Drive or a Shared Drive. When the selected folder has no published layout, the plugin SHALL create the manifest and the board log directory; when the folder already contains a manifest, the plugin SHALL adopt it by file ID together with the board logs it names. The plugin SHALL keep the manifest file ID and one log file ID per known board, and SHALL adopt a log this installation has not recorded by its file name in the bound folder, because Drive has no directories to speak of. The plugin SHALL NOT modify other files in the selected folder and SHALL NOT delete the team's published layout on disconnect or Hub deletion. A folder already bound to another Hub SHALL be refused with an explicit error. Losing access to the folder, the manifest, or a board log SHALL present an explicit unavailable state and SHALL NOT delete local boards, workflows, or pending changes.

#### Scenario: Select a Drive folder

- **WHEN** the user selects a folder in My Drive or a Shared Drive
- **THEN** the binding records the Drive and folder identity and the manifest file ID
- **AND** the interface presents the selected location

#### Scenario: Create the document in an empty folder

- **WHEN** the selected folder contains no manifest
- **THEN** the plugin creates the manifest and the board log directory from the local Hub
- **AND** the Hub becomes connected

#### Scenario: Adopt an existing document

- **WHEN** the selected folder already contains a manifest
- **THEN** the plugin adopts that file by its file ID together with the board logs it names
- **AND** first connection applies the connection choice rules

#### Scenario: Adopt a board log recorded by another member

- **WHEN** the manifest names a board whose log file this installation has no file ID for
- **THEN** the plugin adopts that log by its name inside the board log directory
- **AND** no duplicate log is created

#### Scenario: Leave other files untouched

- **WHEN** the selected folder contains files that are not part of the published layout
- **THEN** the plugin does not read, modify, or delete them

#### Scenario: Lose access to the folder or document

- **WHEN** the account loses permission to the folder or the manifest
- **THEN** the Hub presents an unavailable state with the permission failure
- **AND** local boards, workflows, and pending changes remain

#### Scenario: The document is deleted or trashed

- **WHEN** the manifest is deleted or trashed outside the plugin
- **THEN** the Hub reports the published configuration as missing
- **AND** no local board, workflow, or task is deleted

#### Scenario: Refuse a folder already bound to another Hub

- **WHEN** the selected folder already belongs to another Hub's binding
- **THEN** no binding is created and the section reports that the folder is already in use

#### Scenario: Disconnect keeps the team document

- **WHEN** the user disconnects or deletes a Google Drive Cloud Hub
- **THEN** the binding is removed and no automatic check runs
- **AND** the folder, the manifest, and the board logs remain unchanged
### Requirement: Google Drive local storage location

**Google Drive Local** SHALL be available as a team storage only through the folders that Google Drive for desktop exposes on this computer, and SHALL require no account authorization and no Google Drive API call. A binding SHALL identify its storage by the resolved absolute path of the selected folder together with display-only account and drive labels, and the plugin SHALL accept the folder only when that resolved path lies inside a discovered Google Drive location. Connecting SHALL refuse a folder that does not exist, resolves to a file rather than a directory, is not writable by the plugin, is already bound to another Hub, lies inside the plugin's managed publishing workspace, or resolves outside every discovered location, and each refusal SHALL name its specific condition. The plugin SHALL own exactly three entries in the selected folder: the `kanban-hub.yaml` manifest, the `kanban-boards` directory that holds one log per published board, and the `team-files` directory that holds the team's files. It SHALL create the manifest only when it is absent, SHALL create each of the two directories only when the first entry inside it is written, SHALL adopt either directory when it already exists, and SHALL NOT read, create, modify, or delete any other entry. A folder SHALL bind at most one Hub and a Hub SHALL bind at most one folder, and two paths that resolve to the same directory SHALL be treated as the same folder. The user SHALL select the folder through the folder browser or the host's native folder picker; the connection surface SHALL NOT require a typed path, and both selection routes SHALL be validated by the same rules. The first-connection rules of this capability SHALL apply to the selected folder exactly as they apply to a local folder. A bound Hub SHALL offer a **Change folder** action while it is connected; after an explicit confirmation the action SHALL select another Google Drive Local folder, SHALL keep every local board, task, note, project, conversation, and worktree, SHALL discard the previous board keys, bindings, orphans, removals, and pending removals, and SHALL then follow the first-connection rules for the new folder. When the bound location or the folder is missing, unreadable, no longer discovered, or no longer provided by the application at check time, the Hub SHALL report an unavailable state with a typed failure, SHALL keep every local change pending, SHALL NOT delete the folder or the published layout, and SHALL resume normal operation without a new selection when the same resolved path becomes readable again. The plugin SHALL NOT relocate a binding to a different discovered path on its own. The conflict-copy, concurrent-write, draft and pending, team-update, board-removal, and locally-removed-board guarantees that this capability states for a local folder SHALL apply unchanged to a Google Drive Local folder. Disconnecting the Hub or deleting it SHALL remove the binding and SHALL NOT delete the folder, the manifest, the `kanban-boards` directory, the `team-files` directory, any other entry, or the Google Drive for desktop installation.

#### Scenario: Connect a discovered empty folder

- **WHEN** the user selects a folder inside a discovered location that contains no manifest
- **THEN** the plugin creates the manifest and the board log directory from the local Hub
- **AND** the Hub becomes connected
- **AND** no account authorization is requested

#### Scenario: Adopt an existing document

- **WHEN** the selected folder already contains a manifest
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

- **WHEN** the selected folder contains files that are not part of the published layout
- **THEN** the plugin does not read, modify, or delete them

#### Scenario: Change the folder keeps local work

- **WHEN** a connected Google Drive Local Hub changes its folder and the new folder contains a published layout
- **THEN** the user confirms the change before it starts
- **AND** every local board, task, note, project, conversation, and worktree remains
- **AND** the first-connection choice is presented for the new configuration

#### Scenario: Change the folder to an empty folder

- **WHEN** a connected Google Drive Local Hub changes to a folder with no manifest
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
- **THEN** the Hub resumes checking and publishing without a new folder selection

#### Scenario: The application is removed after connecting

- **WHEN** Google Drive for desktop is uninstalled or stops mounting the bound folder
- **THEN** the Hub reports the location as unavailable
- **AND** the plugin does not move the binding to another folder

#### Scenario: Disconnect keeps the folder and the document

- **WHEN** the user disconnects or deletes a Google Drive Local Hub
- **THEN** the binding is removed and automatic checks stop
- **AND** the folder, the manifest, the board logs, the team files directory, every other entry, and the installed application remain unchanged

#### Scenario: Unsupported platform cannot connect

- **WHEN** the host runs on a platform where Google Drive for desktop does not exist
- **THEN** no Google Drive Local binding can be created
- **AND** the local Hub state is unchanged

#### Scenario: A conflict copy blocks automatic synchronization

- **WHEN** a Google Drive Local check finds a conflict copy beside the manifest or a board log
- **THEN** the Hub presents the review and applies and publishes nothing for the affected board
- **AND** the plugin does not choose, rename, merge, or delete either version

#### Scenario: Own the team files directory

- **WHEN** an agent creates the first team file for a Google Drive Local Hub
- **THEN** the `team-files` directory is created inside the bound folder
- **AND** every other entry in that folder is unchanged

### Requirement: Concurrent writes on Google Drive

A Google Drive write SHALL compare the value read before the write, SHALL verify the written content after the write, and SHALL report a concurrent change when either check differs. This SHALL hold per written file: the manifest and each board log carry their own expected value, and a concurrent change to one board's log SHALL NOT be reported as a concurrent change to another board. A detected concurrent change SHALL keep the local changes pending and SHALL require review; it SHALL NOT be presented as a successful publication and SHALL NOT silently discard the local or the team version. The plugin SHALL NOT promise an atomic conditional write on Google Drive, and the previous content SHALL remain recoverable from the Drive revision history.

#### Scenario: Detect a concurrent write before writing

- **WHEN** a file changed after it was read and before the write
- **THEN** the plugin refuses the write
- **AND** the local changes remain pending

#### Scenario: Detect a concurrent write after writing

- **WHEN** a file is changed by another writer after this installation wrote it
- **THEN** the plugin reports the concurrent change
- **AND** the local changes remain pending

#### Scenario: Scope a concurrent change to its board

- **WHEN** one board's log changed concurrently while another board's log did not
- **THEN** only the changed board is reported as concurrent
- **AND** the other board remains publishable

#### Scenario: Keep both versions recoverable

- **WHEN** a concurrent write is reported
- **THEN** the local version is retained
- **AND** the previous content remains available in the Drive revision history

### Requirement: Local folder storage location

A local folder binding SHALL identify the storage by an absolute directory path. The plugin SHALL accept an absolute path or a path beginning with `~`, SHALL resolve symbolic links, and SHALL store the resolved path. The selected directory SHALL already exist and SHALL be writable by the plugin; connecting SHALL refuse a path that does not exist, a path that resolves to a file rather than a directory, a directory the plugin cannot write, a directory already bound to another Hub, and a directory inside the plugin's managed publishing workspace. The plugin SHALL own exactly three entries in that directory: the `kanban-hub.yaml` manifest, the `kanban-boards` directory that holds one log per published board, and the `team-files` directory that holds the team's files. It SHALL create the manifest only when it is absent, SHALL create each of the two directories only when the first entry inside it is written, SHALL adopt either directory that already exists, and SHALL NOT read, create, modify, or delete any other entry. A folder SHALL bind at most one Hub and a Hub SHALL bind at most one folder. Two paths that resolve to the same directory SHALL be treated as the same folder, compared case-insensitively on a case-insensitive filesystem. Team Settings SHALL suggest the default folder `~/.dsh-kanban/<Hub id>` and SHALL pre-fill it in the path field. Connecting to exactly the suggested path SHALL create that directory when it is absent; connecting to any other path SHALL NOT create a directory. Disconnecting a Hub, deleting a Hub, or replacing the binding SHALL NOT delete the folder, the manifest, the board logs, the `team-files` directory, or any other entry. When the bound directory or the manifest is missing or unreadable at check time, the Hub SHALL report an unavailable state with a typed failure, SHALL keep every local change pending, and SHALL resume normal operation without a new binding when the directory and the manifest become readable again.

#### Scenario: Connect an existing empty folder

- **WHEN** the user connects a Hub to an existing directory the plugin can write that contains no manifest
- **THEN** the plugin creates the manifest in that directory
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
- **AND** no content is created

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

- **WHEN** the manifest disappears from a bound folder that was previously read
- **THEN** the Hub reports a typed missing-configuration failure
- **AND** the plugin does not recreate it without an explicit user action

#### Scenario: Disconnect keeps the folder and the document

- **WHEN** the user disconnects a Hub or deletes a Hub published to a local folder
- **THEN** the binding is removed and automatic checks stop
- **AND** the folder, the manifest, the board logs, and every other entry remain unchanged

#### Scenario: Own the team files directory

- **WHEN** an agent creates the first team file for a local folder Hub
- **THEN** the `team-files` directory is created in the bound directory
- **AND** every other entry in that directory is unchanged

### Requirement: Conflict copies in a local folder

A local-folder check SHALL inspect the bound directory, and the board log directory inside it, for entries that look like a copy of the manifest or of a board log and are not the file the plugin wrote, including the copies a synchronization client creates when two machines change the same file. When such an entry exists, the Hub SHALL present a review that names the entries found, SHALL NOT apply team events, SHALL NOT publish, and SHALL NOT choose, rename, merge, or delete any of them. The review SHALL clear on the next successful check after those entries are no longer present. The plugin's own temporary files SHALL be excluded from that detection.

#### Scenario: A conflict copy is present

- **WHEN** a check finds an entry beside the manifest or beside a board log that looks like a copy of it
- **THEN** the Hub is presented as requiring review
- **AND** the review names the entries found

#### Scenario: Automatic synchronization is suspended

- **WHEN** a conflict copy exists in the bound folder and a board has local changes or team updates
- **THEN** no board event is applied and nothing is published
- **AND** the Hub keeps the review presented

#### Scenario: The plugin never chooses a version

- **WHEN** a conflict copy is present
- **THEN** the plugin does not merge, rename, delete, or prefer either version
- **AND** the user decides which content becomes the shared file

#### Scenario: The review clears after the copies are removed

- **WHEN** the conflict copies are no longer present at a later check
- **THEN** the review clears
- **AND** applying and publishing resume

#### Scenario: The plugin's temporary files are not reported

- **WHEN** a check finds a temporary file written by the plugin itself
- **THEN** it is not reported as a conflict copy

### Requirement: Concurrent writes on a local folder

A local-folder write SHALL compare the value read before the write, SHALL replace the file through a temporary sibling and a rename within the same directory, and SHALL verify the written content after the write, reporting a concurrent change when either check differs. A reader SHALL observe either the previous complete file or the new complete file, never a partially written one. This SHALL hold per written file, so a concurrent change to one board's log SHALL NOT be reported as a concurrent change to another board or to the manifest. The plugin SHALL NOT promise an atomic conditional write on a local folder, because the synchronization client may introduce a change between the read and the replacement. A detected concurrent change SHALL keep the local changes pending and SHALL require review; it SHALL NOT be presented as a successful publication and SHALL NOT silently discard the local or the team version. A successful write SHALL leave no temporary sibling behind.

#### Scenario: Detect a concurrent write before writing

- **WHEN** a file changed after it was read and before the write
- **THEN** the plugin refuses the write
- **AND** the local changes remain pending

#### Scenario: Detect a concurrent write after writing

- **WHEN** a file is changed by another writer after this installation wrote it
- **THEN** the plugin reports the concurrent change
- **AND** the local changes remain pending

#### Scenario: Scope a concurrent change to its board

- **WHEN** one board's log changed concurrently while another board's log did not
- **THEN** only the changed board is reported as concurrent
- **AND** the other board remains publishable

#### Scenario: Never expose a partial document

- **WHEN** a check reads the manifest or a board log while a write is in progress
- **THEN** it reads either the previous complete file or the new complete file

#### Scenario: An interrupted write leaves the previous document readable

- **WHEN** a write is interrupted before its replacement completes
- **THEN** the previous file remains the readable file
- **AND** the next successful write leaves no temporary sibling behind

### Requirement: Published document version negotiation

Reading the published configuration SHALL compare its format version with the versions this installation supports. The current format version SHALL be 3. A version 1 or version 2 published configuration, which carries whole board workflows in one document, SHALL be read and normalized to the current format: each of its boards SHALL become a manifest entry together with a board log whose initial state is that board's authored workflow, and each stage SHALL receive a stable stage identity derived from the authored identifier, so that a later rename is still distinguishable from a replacement. Such a configuration SHALL NOT be rejected, and the stored publishing state SHALL be normalized the same way when it is loaded, so an installation that already published keeps its bindings, its orphan records, and its recorded removals. A configuration whose format version is newer than this installation supports SHALL NOT be applied and SHALL NOT be published over, because its shape is unknown and writing it would drop content this installation cannot represent. In that state the installation SHALL keep its local edits, SHALL keep the Hub's publishing binding, and SHALL present a warning that the plugin must be updated. The warning SHALL be presented in the Team Settings panel and in the Hub's publishing status. The state SHALL clear without user action once a plugin that supports that version reads the configuration. An individual board log written by a newer plugin SHALL be treated the same way for that board alone: the board SHALL report that the plugin must be updated, SHALL NOT be applied, SHALL NOT be published over, and SHALL NOT prevent another board from being applied or published.

#### Scenario: Read a version 1 document

- **WHEN** the installation reads a published configuration written with format version 1
- **THEN** it reads the boards with no project keys
- **AND** no board is presented as restricted

#### Scenario: Read a version 2 configuration

- **WHEN** the installation reads a published configuration written with format version 2
- **THEN** each of its boards becomes a manifest entry with a board log carrying that board's authored workflow
- **AND** every stage receives a stable stage identity derived from its authored identifier
- **AND** the team is not required to republish

#### Scenario: Normalize stored version 1 state

- **WHEN** the installation loads publishing state whose stored documents use format version 1
- **THEN** the state is normalized and retained
- **AND** its board bindings, orphan records, and recorded removals are kept

#### Scenario: Refuse to apply a newer document

- **WHEN** the installation reads a published configuration whose format version is newer than it supports
- **THEN** no team change is applied
- **AND** the local Hub is unchanged

#### Scenario: Refuse to publish over a newer document

- **WHEN** the published configuration uses a newer format version and the user asks to publish
- **THEN** nothing is written to the team storage
- **AND** the local change is kept as a draft

#### Scenario: Isolate a newer board log

- **WHEN** one board's log was written by a newer plugin version
- **THEN** that board reports that the plugin must be updated and is neither applied nor published over
- **AND** every other board remains applicable and publishable

#### Scenario: Warn that the plugin must be updated

- **WHEN** the published configuration uses a newer format version
- **THEN** the Team Settings panel presents a warning that the plugin must be updated
- **AND** the Hub's publishing status presents the same state

#### Scenario: Clear the warning after an update

- **WHEN** a plugin that supports the published configuration's version reads it
- **THEN** the warning is no longer presented
- **AND** checking and publishing proceed normally

## ADDED Requirements

### Requirement: Team updates and event application

Applying team changes SHALL read the manifest, then read each board's log and apply only the events after that board's stored cursor. Applying SHALL be scoped to one board: applying one board's team events SHALL NOT require or wait for another board, and a board that cannot be applied SHALL NOT prevent another board from being applied or published.

Applying an event SHALL change only what that event describes. An event that renames a stage identifier SHALL apply to the same stage, because stage events address a stable stage identity rather than the authored identifier. Applying an event that changes a stage identity SHALL migrate the local board's task references in the same transaction that stores the resulting workflow: every task of that board whose stage reference is the old identity SHALL be reassigned to the new one, and every pending transition, recorded transition, and unresolved stage instruction that names it SHALL be rewritten, so no task is left in a stage the workflow does not define. When an event would leave a local task in a stage the resulting workflow does not define and no event of the same batch renames that stage, the board SHALL be refused as defined by Refusal of destructive application.

When two installations append to the same board log, the storage order SHALL decide: the event appended later takes precedence over a conflicting value appended earlier for the same stage and field, and the replaced value SHALL be recorded and presented as a superseded value rather than discarded silently. Identity and lifecycle divergence SHALL NOT be resolved that way: when applying a batch would rename a stage differently from a local rename that is itself unpublished, or when an event renames a stage the local installation no longer has, the board SHALL require an explicit per-board choice, and no part of that board's batch SHALL be applied before the choice.

Applying SHALL preserve the authored workflow text of the board. An applied event SHALL change only the spans of the authored text that the event describes, so comments, key order, quoting, blank lines, and every untouched stage SHALL remain exactly as authored locally.

After a successful application the stored cursor SHALL advance to the last applied event of that board, and the board SHALL be presented as up to date. The display order and board names SHALL come from the manifest, and a manifest change SHALL be applied independently of any board.

#### Scenario: Apply a team-only change

- **WHEN** the team changed one board and the local installation did not change it
- **THEN** that board's events are applied on the next update action
- **AND** the board is presented as up to date

#### Scenario: Apply one board without touching another

- **WHEN** two boards have pending team events and only one of them can be applied
- **THEN** the applicable board is applied
- **AND** the other board keeps its pending state and is presented as needing attention

#### Scenario: A rename keeps the local tasks

- **WHEN** the team renamed a stage identifier and the local installation holds tasks in that stage
- **THEN** the board's workflow is updated
- **AND** every task of that board that was in the renamed stage is in the same stage under its new identifier
- **AND** the update is applied without a refusal and without a review

#### Scenario: A rename rewrites every local reference

- **WHEN** a task of the board has a pending transition, a recorded transition, or an unresolved stage instruction in the renamed stage
- **THEN** those references are rewritten to the new identifier in the same transaction

#### Scenario: Keep a local draft

- **WHEN** the local installation changed a board and the team did not
- **THEN** applying that board's team events leaves the local board unchanged and it remains a draft

#### Scenario: The later append wins for one field

- **WHEN** the team and the local installation both changed the same field of the same stage
- **THEN** the value appended later to that board's log is the applied value
- **AND** the replaced value is presented as superseded

#### Scenario: A divergent rename requires a choice

- **WHEN** the team renamed a stage and the local installation renamed the same stage to a different identifier without publishing
- **THEN** that board is listed as needing a choice
- **AND** no event of that board is applied before the choice

#### Scenario: Choose the team version

- **WHEN** the user chooses the team version for a board that needs a choice
- **THEN** the board's team events are applied locally
- **AND** the local draft for that board is replaced

#### Scenario: Choose the local version

- **WHEN** the user chooses the local version for a board that needs a choice
- **THEN** the local workflow is retained as a draft
- **AND** the team events of that board are not applied

#### Scenario: Preserve the authored workflow text

- **WHEN** applying team events changes one stage of a board whose workflow carries comments and a custom key order
- **THEN** every comment, key order, and untouched stage remains
- **AND** only the spans the events describe changed

#### Scenario: Apply a team-only project scope change

- **WHEN** the team restricted a board's project scope and the local installation did not change that board
- **THEN** applying the manifest stores the team's project keys for that board
- **AND** the board presents that restriction

#### Scenario: Both sides changed the project scope

- **WHEN** the team and the local installation both changed the same board's project keys
- **THEN** the board is listed as needing a choice
- **AND** choosing the team version applies the team's project keys
- **AND** choosing the local version keeps the local project keys

#### Scenario: Apply a manifest-only change

- **WHEN** the team changed the board order and no board log changed
- **THEN** the local order is updated from the manifest
- **AND** no board's workflow is read or rewritten

#### Scenario: Apply a layout-only difference without a choice

- **WHEN** the team moved or resized a stage and the local installation did not
- **THEN** that board's layout event is applied
- **AND** the board is not listed as needing a choice

#### Scenario: Keep the local placement for the same stage

- **WHEN** the team and the local installation moved the same stage and the local move was appended later
- **THEN** applying keeps the local position for that stage
- **AND** the replaced team position is presented as superseded

#### Scenario: Merge changes to different stages from both sides

- **WHEN** the local installation changed one stage and the team changed another stage of the same board
- **THEN** applying keeps both changes
- **AND** the board is not listed as needing a choice

#### Scenario: Keep the local scope beside a team workflow change

- **WHEN** the team changed a board's workflow and only the local installation changed that board's project keys
- **THEN** applying the team's workflow leaves the local project keys on the board
- **AND** the board remains a draft for the local project keys

### Requirement: Board event log content

Each published board SHALL have one log that carries the board's published workflow as a snapshot together with a tail of events appended after that snapshot. The snapshot SHALL carry the board's authored workflow text, so the authored text and its formatting are recovered exactly, and the stable stage identity of every stage it names. An event SHALL carry the kind of change, the format version of that event, a sequence number that orders it within the board's log, the moment it happened, and, when it addresses a stage, the stable stage identity it addresses.

The event vocabulary SHALL distinguish, at least: the board workflow being created or replaced as a whole, a change to a workflow-level field, a change to the initial stage, a stage being created, a change to one stage field, a change to a stage identifier, a stage being removed, a change to a stage's stored layout, a stage group being created, changed, or removed, and a connection layout being set or removed. A change that alters only stored layout SHALL be coalesced so that one user gesture produces one event. A change to a stage identifier SHALL be one event that names the stable identity and the new identifier; it SHALL NOT be expressible as a removal followed by a creation.

The log SHALL be compacted: when the tail grows past the supported bound, the tail SHALL be folded into a new snapshot and the folded events SHALL be dropped. A member whose stored sequence for a board is older than the retained snapshot SHALL re-establish that board from the snapshot, and that recovery SHALL NOT lose the stage identity of a stage the snapshot names. The published layout SHALL be recoverable without replaying the whole history of a board.

An event whose kind or format version this installation does not know SHALL NOT be skipped silently. It SHALL stop that board's cursor at that event, SHALL be reported as a board that requires a plugin update, and SHALL NOT prevent another board from being applied.

#### Scenario: Recover a board from its snapshot and tail

- **WHEN** a member reads a board's log for the first time
- **THEN** it reads the snapshot and the events after it
- **AND** the resulting workflow equals the workflow the publisher held

#### Scenario: Preserve authored workflow text through the log

- **WHEN** a board's log carries a workflow with comments and a custom key order
- **THEN** the recovered authored text matches it exactly

#### Scenario: A rename is one event

- **WHEN** the team renames a stage identifier
- **THEN** the board's log gains one event naming the stable identity and the new identifier
- **AND** no event removes the stage

#### Scenario: One gesture produces one layout event

- **WHEN** the user moves or resizes a stage
- **THEN** the board's log gains one layout event describing the result
- **AND** it does not gain one event per intermediate position

#### Scenario: Compact the tail

- **WHEN** a board's tail grows past the supported bound
- **THEN** the tail is folded into a new snapshot
- **AND** the folded events are dropped
- **AND** the recovered workflow is unchanged

#### Scenario: A member behind the retained window recovers

- **WHEN** a member's stored sequence for a board is older than the retained snapshot
- **THEN** the board is re-established from the snapshot
- **AND** no stage loses its stable identity

#### Scenario: An unknown event stops only its board

- **WHEN** a board's log contains an event whose kind or version this installation does not know
- **THEN** that board's cursor stops at that event and the board reports that the plugin must be updated
- **AND** another board remains applicable

### Requirement: Board publication isolation

Publishing and receiving SHALL be scoped to one board. Publishing a board SHALL write only that board's log, and, when the manifest does not yet name it, that board's manifest entry. Applying a board SHALL read only that board's log and advance only that board's cursor. A board that cannot be applied, that requires a choice, that reports a concurrent write, or that requires a plugin update SHALL NOT prevent another board from being applied, published, or checked, and SHALL NOT prevent the Hub manifest from being published. Every failure SHALL name the board it belongs to. A failure of the Hub's storage as a whole, a conflict copy in the bound folder, or a manifest whose format version this installation does not support SHALL still suspend every operation for that Hub.

#### Scenario: One board cannot be applied

- **WHEN** one board needs a choice and another board has applicable team events
- **THEN** the other board is applied
- **AND** the board that needs a choice keeps its state

#### Scenario: One board cannot be published

- **WHEN** one board's publish is refused and another board is a draft
- **THEN** the other board remains publishable

#### Scenario: A whole-storage failure still suspends the Hub

- **WHEN** the bound storage is unreachable or a conflict copy exists
- **THEN** no board is applied or published for that Hub

#### Scenario: Name the board in every failure

- **WHEN** a board's operation fails
- **THEN** the reported failure names that board
- **AND** other boards' states are unchanged
