# Spec Delta

## Purpose

Let the host find the folders that Google Drive for desktop exposes on this computer and let the user browse them, so a team storage can be chosen without a typed path, an account authorization, or the Google Drive API.

## ADDED Requirements

### Requirement: Discovery without authorization

The plugin SHALL discover the Google Drive for desktop locations on this computer by reading local evidence only. On macOS it SHALL consider the File Provider mounts under `~/Library/CloudStorage`, the per-account mount points stored in the `com.google.drivefs.settings` preferences, and the legacy mounts under `/Volumes`; on Windows it SHALL consider the settings and mount points under `HKCU\Software\Google\DriveFS` together with the volumes the operating system reports. The plugin SHALL NOT require an OAuth authorization, SHALL NOT call the Google Drive API, and SHALL NOT create, modify, or delete any Google Drive content during discovery. No single source SHALL be required: when one source is unavailable the plugin SHALL use the others, and it SHALL NOT assume a fixed path, a fixed volume name, or a fixed drive letter.

#### Scenario: Discover File Provider mounts on macOS

- **WHEN** discovery runs on macOS and Google Drive for desktop has one or more accounts mounted through File Provider
- **THEN** each mounted account is reported as a discovered location with its account label and root path
- **AND** discovery does not ask for authorization

#### Scenario: Discover Windows mounts without a fixed drive letter

- **WHEN** discovery runs on Windows and the configured mount point is a drive letter other than the default, or a folder path
- **THEN** the configured mount is reported with its actual root path
- **AND** discovery does not assume any particular letter

#### Scenario: Combine sources

- **WHEN** the preferences source is unreadable but a visible mount exists, or the visible mount list is empty but the preferences name mount points
- **THEN** discovery still reports the locations it could establish from the remaining evidence
- **AND** it reports the unreachable source as a failure reason

#### Scenario: Legacy macOS mounts

- **WHEN** discovery runs on a macOS version whose Drive for desktop build mounts under `/Volumes`
- **THEN** those mounts are reported as discovered locations
- **AND** they are not required to exist on a newer system

#### Scenario: No account is mounted

- **WHEN** the application is installed but no account is mounted
- **THEN** discovery reports an empty result with the reason, not an error

#### Scenario: The application is not installed

- **WHEN** no local evidence of Google Drive for desktop exists
- **THEN** discovery reports that the application was not detected
- **AND** it does not report a generic failure

#### Scenario: Unsupported platform

- **WHEN** the host runs on a platform where Google Drive for desktop does not exist
- **THEN** discovery reports that the platform is unsupported
- **AND** no filesystem location is reported as a Drive mount

#### Scenario: Discovery performs no network access

- **WHEN** discovery runs on a machine with no network connection
- **THEN** it completes with the locally available evidence
- **AND** no request to a Google service is attempted

### Requirement: Mount identity and stability

Each discovered location SHALL be identified by its root path, with the account label and any drive label carried for display only. When two sources describe the same root path, the plugin SHALL report it once. A bound location that is no longer discovered SHALL be reported as unavailable rather than replaced by a different location with a similar name, and rediscovering the same root path SHALL restore the location without a new selection.

#### Scenario: One mount from two sources

- **WHEN** the preferences and the visible mount list describe the same root path
- **THEN** the location appears once in the discovered list

#### Scenario: Renamed account

- **WHEN** the account label changes while the root path stays the same
- **THEN** the location keeps its identity
- **AND** the new label is used for display

#### Scenario: Mounted under a different path

- **WHEN** the application remounts a previously discovered account under a different root path
- **THEN** the previous path is reported as no longer present
- **AND** the new path is reported as a new location
- **AND** the plugin does not silently treat the two as the same location

### Requirement: Folder browsing

The plugin SHALL list one folder level at a time inside the discovered locations and SHALL return the folders of the requested location together with whether the published document `kanban-hub.yaml` is present in it. The plugin SHALL list only directories, SHALL NOT read the content of any file, and SHALL NOT create, modify, rename, or delete anything while browsing. At a location root the plugin SHALL omit the Drive application's own bookkeeping entries and SHALL NOT omit any other folder. A requested location outside every discovered root SHALL be refused, including through `..` segments or symbolic links that resolve outside a root. When a location cannot be read, the response SHALL name the typed reason instead of returning an empty list, and a location with more entries than the supported maximum SHALL be reported as truncated with the number of entries shown.

#### Scenario: List a discovered root

- **WHEN** the user opens a discovered location
- **THEN** the plugin returns the directories directly inside it
- **AND** it reports whether `kanban-hub.yaml` is present there

#### Scenario: Navigate into a subfolder

- **WHEN** the user opens a folder inside a discovered location
- **THEN** the plugin returns the directories directly inside that folder
- **AND** the path shown to the user reflects the navigation

#### Scenario: Refuse a location outside the discovered roots

- **WHEN** a listing is requested for a path outside every discovered root
- **THEN** the plugin refuses the request with an explicit error
- **AND** no directory is read

#### Scenario: Refuse a traversal escape

- **WHEN** a requested path uses `..` segments or a symbolic link that resolves outside a discovered root
- **THEN** the plugin refuses the request
- **AND** no directory outside the root is read

#### Scenario: Hide the Drive bookkeeping entries

- **WHEN** a discovered location root contains the Drive application's hidden bookkeeping folders
- **THEN** those known entries are not listed
- **AND** a hidden folder that is not a bookkeeping entry remains listed, including at the location root

#### Scenario: Browsing never changes the Drive

- **WHEN** the user browses locations and folders without connecting
- **THEN** no file or directory is created, modified, renamed, or deleted
- **AND** no account authorization is requested

#### Scenario: An unreadable location

- **WHEN** a folder cannot be read because the operating system denies access
- **THEN** the response names that reason
- **AND** the plugin does not present the folder as empty

#### Scenario: A large folder

- **WHEN** a folder contains more entries than the supported maximum
- **THEN** the response reports that the list is truncated and how many entries are shown
- **AND** the plugin does not read the whole folder eagerly

### Requirement: Accounts, My Drive, and Shared Drives

The folder browser SHALL present the real folder names of each discovered location. It SHALL group folders as My Drive and Shared Drives only when it can recognize that structure, and it SHALL NOT hide a folder whose name it does not recognize. Recognized structure SHALL be derived from the discovered location and the folder names present, never from a single hard-coded localized name, and an unrecognized name SHALL be presented as the literal folder it is.

#### Scenario: Recognize My Drive and Shared Drives

- **WHEN** a discovered location contains the recognizable My Drive and Shared Drives structure in a supported locale
- **THEN** the browser presents the two groups
- **AND** each group can be opened to reach its folders

#### Scenario: Unrecognized localized names

- **WHEN** the folder names do not match any recognized structure
- **THEN** the browser lists the real folder names without grouping
- **AND** every folder remains reachable

#### Scenario: Shared Drives appear as folders

- **WHEN** the account has access to one or more Shared Drives and the application exposes them as folders
- **THEN** those folders are reachable through browsing
- **AND** the browser does not claim to know access the account does not have

#### Scenario: No Shared Drives

- **WHEN** the account has no Shared Drives
- **THEN** the browser presents the account's folders without an empty Shared Drives group
