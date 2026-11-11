# Spec Delta

## MODIFIED Requirements

### Requirement: Folder browsing

The plugin SHALL list one folder level at a time inside the discovered locations and SHALL return the folders of the requested location together with whether the published configuration is present in it, which is the case when the `kanban-hub.yaml` manifest or a `kanban-boards` directory is present. The plugin SHALL list only directories, SHALL NOT read the content of any file, and SHALL NOT create, modify, rename, or delete anything while browsing. At a location root the plugin SHALL omit the Drive application's own bookkeeping entries and SHALL NOT omit any other folder. A requested location outside every discovered root SHALL be refused, including through `..` segments or symbolic links that resolve outside a root. When a location cannot be read, the response SHALL name the typed reason instead of returning an empty list, and a location with more entries than the supported maximum SHALL be reported as truncated with the number of entries shown.

#### Scenario: List a discovered root

- **WHEN** the user opens a discovered location
- **THEN** the plugin returns the directories directly inside it
- **AND** it reports whether the published configuration is present there

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
