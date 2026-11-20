# Spec Delta

## MODIFIED Requirements

### Requirement: Compact and detailed card read payloads

The plugin SHALL distinguish two card read payloads. `list_cards` and `get_cards` SHALL return the compact payload, which carries the task's identity, board, project, stage, position, auto mode, pending transition, recorded transition, instruction marker, worktree summary, activity, and relation references, and SHALL NOT carry the task description and SHALL NOT carry the task's attachments. `get_card` SHALL return the detailed payload, which carries the compact fields plus the task description, the task's attachments, the project record, the board and Hub identity, the incoming and outgoing relations with the other card's identifier, title and stage, and the epic roll-up when the card is an epic.

Each reported attachment SHALL carry its display name, its exact byte length, and a path the agent can read with its own file tools. Reporting the attachments in the detailed payload is what lets an agent discover a file added to the task after its conversation began.

A relation reference in the compact payload SHALL carry the relation identifier, its type, its direction relative to that card, and the other task identifier. The direction SHALL be outgoing or incoming for a directed type and symmetric for a type that has no direction.

Removing the description from the compact payload SHALL NOT remove it from the task search filter: a title-and-description query SHALL still match a card whose description contains the query text.

#### Scenario: Omit the description from a listing

- **WHEN** an agent lists cards of a board or Hub
- **THEN** no returned card carries its description
- **AND** no returned card carries its attachments
- **AND** each returned card carries its relation references

#### Scenario: Read the description through the detail read

- **WHEN** an agent reads one card
- **THEN** the result carries that card's description

#### Scenario: Read a card's attachments through the detail read

- **WHEN** an agent reads one card that has attachments
- **THEN** the result reports each attachment with its display name, byte length, and readable path

#### Scenario: Discover a file added after the conversation began

- **WHEN** the user adds an attachment after the task's conversation began and an agent then reads the task in detail
- **THEN** that attachment is reported with its display name, byte length, and readable path

#### Scenario: Search a description that the listing omits

- **WHEN** an agent lists cards with a query that occurs only in a card's description
- **THEN** that card is returned

#### Scenario: Report a relation reference

- **WHEN** an agent lists a card that is the epic of another card and is related to a third card
- **THEN** the compact payload reports both relations with their identifier, type, direction, and the other task identifier

## ADDED Requirements

### Requirement: Attachment paths on task write tools

The plugin's task creation and editing tools SHALL accept absolute host paths for a task's attachments. Task creation SHALL resolve every supplied path before the task exists, so a creation call never leaves a task carrying only part of the supplied files; a path that cannot be read SHALL fail the call and create no task. The same all-or-nothing rule SHALL apply to an edit that adds several files.

An edit SHALL be able to add attachments and to remove them. Removing an attachment SHALL delete its stored bytes, so the tool SHALL require explicit confirmation for a removal and SHALL refuse one supplied without it.

#### Scenario: Create with several paths

- **WHEN** an agent creates a task supplying several readable absolute paths
- **THEN** the task is created carrying every one of them
- **AND** the detailed card read reports them

#### Scenario: Refuse creation when one path is unreadable

- **WHEN** an agent creates a task supplying several paths and one cannot be read
- **THEN** no task is created
- **AND** no attachment bytes are stored
- **AND** the problem names the path that could not be read

#### Scenario: Add files to an existing task

- **WHEN** an agent edits a task and supplies additional readable paths
- **THEN** those files join the task's attachments
- **AND** the previously attached files remain

#### Scenario: Refuse an unconfirmed removal

- **WHEN** an agent edits a task to remove an attachment without confirming
- **THEN** the removal is refused with an actionable problem
- **AND** the attachment and its bytes remain unchanged

#### Scenario: Remove a confirmed attachment

- **WHEN** an agent edits a task to remove an attachment with explicit confirmation
- **THEN** the attachment leaves the task's collection
- **AND** its stored bytes are deleted

### Requirement: Stored file read for the browser

The plugin SHALL expose a host method that returns the exact stored bytes of a file attachment the conversation or task already references, so the browser can restore a persisted draft attachment and offer a download without knowing a host filesystem path. The method SHALL accept the durable reference, SHALL verify it against the stored object, and SHALL refuse a reference that does not resolve.

#### Scenario: Read a stored file's bytes

- **WHEN** the client asks for the bytes of a stored file attachment it holds a reference to
- **THEN** it receives the exact stored bytes and the display name

#### Scenario: Refuse an unresolvable reference

- **WHEN** the client asks for the bytes of a reference whose stored object does not exist
- **THEN** the method fails with an actionable problem
- **AND** no bytes are returned
