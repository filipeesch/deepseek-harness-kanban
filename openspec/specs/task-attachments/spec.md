# Task Attachments Specification

## Purpose

Give every task its own collection of file attachments, stored where removing them or deleting the task actually removes their bytes, and expose that collection to the person through the task drawer, to agents through the card tools, and to the task's conversations before their first turn.

## Requirements

### Requirement: Task-owned file attachments

A task SHALL be able to carry an ordered collection of file attachments. Each attachment SHALL record a display name, its exact byte length, and the origin it was added from. The collection SHALL be optional, so a task with no attachments remains valid and readable, and a Hub stored before this capability existed SHALL open without change.

The attachment collection SHALL belong to the task record and SHALL be removed from it in the same operation that removes the task. Attachment metadata SHALL NOT be stored on the board, and SHALL NOT be stored in the board's workflow.

#### Scenario: Add a file to a task

- **WHEN** the user adds a file to a task's attachment collection
- **THEN** the task records that attachment's display name, byte length, and origin
- **AND** the attachment appears in the task's ordered collection

#### Scenario: Read a task that has no attachments

- **WHEN** the plugin opens a Hub whose tasks predate this capability
- **THEN** every such task is read successfully and reports no attachments
- **AND** no existing task field is lost

#### Scenario: Attachments never reach a published board

- **WHEN** a board is published to a team
- **THEN** the published document carries the board's configuration only
- **AND** no task and no attachment metadata is published

### Requirement: Attachment bytes live in a plugin-owned directory

The bytes of a task's attachments SHALL be stored in a directory owned by the plugin inside the DSH profile, outside the task's project and outside its worktree. The plugin SHALL be responsible for creating, reading, and removing those objects.

Attachment bytes SHALL NOT be stored in the project checkout, so they SHALL NOT appear in version control, SHALL NOT be affected by a worktree being removed, and SHALL NOT be lost when a task switches between its project directory and a worktree.

#### Scenario: Store bytes outside the checkout

- **WHEN** a file is added to a task whose project is under version control
- **THEN** the stored object is outside the project and worktree directories
- **AND** the project's version-control status does not report the added file

#### Scenario: Survive a worktree removal

- **WHEN** a task's worktree is removed while the task keeps its attachments
- **THEN** the attachment bytes remain readable
- **AND** the task's attachment collection is unchanged

### Requirement: Add attachments from a browser file or the clipboard

The plugin SHALL accept a new task attachment from a file selected through the browser's file input
and from a file pasted from the clipboard. Each source SHALL produce the same kind of attachment, and
the collection SHALL NOT distinguish how a file arrived beyond recording its origin.

Every added file SHALL be stored as a generic file, including an image. The plugin SHALL NOT treat an
image attachment differently from any other file: it SHALL NOT produce a thumbnail, SHALL NOT decode
its dimensions, and SHALL NOT send it as an image part.

A display name SHALL be reduced to its final path segment before it is stored, so a name carrying a
directory separator is stored under that segment and can never address a path outside the
attachment's own directory.

A file whose display name is empty, whose name yields no usable segment after that reduction, or
whose bytes cannot be read SHALL be refused with an actionable problem, and SHALL NOT be added to the
collection.

#### Scenario: Add from the browser file input

- **WHEN** the user selects a file through the browser's file input
- **THEN** the file is stored as an attachment of the target
- **AND** it is indistinguishable in the collection from a file added by any other source

#### Scenario: Add by pasting from the clipboard

- **WHEN** the user pastes a file from the clipboard while an attachment surface has focus
- **THEN** the pasted file is stored as an attachment of the target
- **AND** pasted text is not treated as a file

#### Scenario: Store an image as a generic file

- **WHEN** the user adds a file whose content is an image
- **THEN** it is stored as a generic file attachment
- **AND** the plugin decodes no dimensions and produces no thumbnail for it

#### Scenario: Refuse an unreadable source

- **WHEN** the selected file cannot be read
- **THEN** the file is refused with an actionable problem naming it
- **AND** the attachment collection is unchanged

#### Scenario: Reduce a name to its final segment

- **WHEN** the selected file's display name carries a directory separator
- **THEN** the attachment is stored and listed under its final segment
- **AND** the stored object stays inside the attachment's own directory

#### Scenario: Refuse a name with no usable segment

- **WHEN** the display name reduces to nothing usable
- **THEN** the file is refused with an actionable problem naming the unusable name
- **AND** the attachment collection is unchanged

### Requirement: Task file surface in the task drawer

The task drawer's Info section SHALL present the task's attachments together with its title and
description. The surface SHALL list every attachment in the task's collection with its display name
and byte length, SHALL provide an action to download an attachment, and SHALL provide an action to
remove an attachment.

Adding SHALL be one compact icon action that opens the browser's file input; the surface SHALL NOT
present a file-name field, a host-path input, or a separate per-source button. The surface SHALL also
accept a file pasted from the clipboard while it has focus.

A selection that failed SHALL be reported on the surface with a retry action and a discard action, and
it SHALL keep the surface's own action unavailable until it is retried or discarded.

The surface SHALL be available in every workflow stage. It SHALL present an empty state when the task
has no attachments instead of no surface at all.

#### Scenario: List the task's attachments

- **WHEN** the user opens the Info section of a task that has attachments
- **THEN** each attachment is listed with its display name and byte length
- **AND** the section offers the add, download, and remove actions

#### Scenario: Empty collection still presents the surface

- **WHEN** the user opens the Info section of a task that has no files
- **THEN** the section states that the task has no files
- **AND** the add action remains available

#### Scenario: One compact add action

- **WHEN** the user opens the Info section of a task
- **THEN** adding a file is offered as a single icon action that opens the browser file dialog
- **AND** no host-path field or per-source button is presented

#### Scenario: Paste a file into the surface

- **WHEN** the user pastes a file from the clipboard while the files surface has focus
- **THEN** the file is added to the task's collection

#### Scenario: Recover from a failed selection

- **WHEN** a file selected for the task cannot be read
- **THEN** the surface reports it with a retry action and a discard action
- **AND** retrying reads the same files again while discarding lets the surface proceed without them

### Requirement: Download a task attachment

The plugin SHALL let the user download an attachment's stored bytes through the host's authenticated file route: one exact route registered on the shared API channel, which only the owner peer reaches. A download SHALL serve the exact bytes that were stored, under the attachment's display name, and SHALL NOT require the client to know a host filesystem path.

#### Scenario: Download a stored attachment

- **WHEN** the user activates the download action of an attachment
- **THEN** the browser receives the exact stored bytes
- **AND** the download carries the attachment's display name

#### Scenario: Download from another machine is unavailable

- **WHEN** the stored bytes are not present on the host serving the request
- **THEN** the download fails with an actionable problem
- **AND** the task's attachment metadata is unchanged

### Requirement: Removing a task attachment removes its bytes

Removing an attachment from a task SHALL require explicit confirmation, SHALL remove the attachment from the task's collection, and SHALL delete its stored bytes. Bytes SHALL NOT be retained after a successful removal, and a removed attachment SHALL NOT be restorable from the task.

Removal SHALL NOT alter, damage, or delete an attachment already delivered as part of a conversation message: a message's own durable copy is independent of the task's collection.

#### Scenario: Confirm before removing

- **WHEN** the user activates the remove action of an attachment
- **THEN** the plugin asks for explicit confirmation naming that attachment
- **AND** the attachment and its bytes remain unchanged until the user confirms

#### Scenario: Remove an attachment

- **WHEN** the user confirms removing an attachment
- **THEN** the attachment leaves the task's collection
- **AND** its stored bytes are deleted from disk

#### Scenario: A delivered message survives removal

- **WHEN** an attachment that was already delivered in a conversation message is removed from the task
- **THEN** that message still presents its own attachment
- **AND** the message's stored copy is not deleted

### Requirement: Creating a task with attachments

The shared task creation experience SHALL accept attachments from a browser file input and from the
clipboard, using the same rules as the task file surface. Attaching SHALL be one compact icon action
presented in the dialog's footer next to the save and cancel actions, and the files supplied so far
SHALL be listed beside it as compact tokens, each carrying its display name and a removal action.

A task created with attachments SHALL be stored with them in the same operation that creates the task,
and the created task SHALL present them without a further action.

Task creation with attachments SHALL be all or nothing: every supplied source SHALL be resolved before
the task exists. When any source cannot be read, the plugin SHALL create no task and SHALL report
which source failed. A file still being read, and a failed selection until it is retried or discarded,
SHALL keep the creation action unavailable.

#### Scenario: Create a task carrying files

- **WHEN** the user supplies attachments in the New task dialog and saves
- **THEN** the task is created with those attachments in its collection
- **AND** opening the created task's Info section lists them

#### Scenario: Paste a file while creating

- **WHEN** the user pastes a file from the clipboard in the New task dialog
- **THEN** that file is included in the attachments created with the task

#### Scenario: Files are presented compactly in the footer

- **WHEN** the user attaches one or more files in the New task dialog
- **THEN** the dialog footer presents each file as a compact token with its removal action
- **AND** the dialog body spends no field on files

#### Scenario: Refuse the whole creation on one bad source

- **WHEN** the user supplies several attachment sources and one of them cannot be read
- **THEN** no task is created
- **AND** no attachment bytes are stored
- **AND** the failure names the source that could not be read

#### Scenario: Creation waits for the files it was given

- **WHEN** a file is still being read, or a selection failed and was neither retried nor discarded
- **THEN** the creation action is unavailable
- **AND** it becomes available once every selection settled without an outstanding failure

### Requirement: Agent attachment support on card tools

The agent-facing card tools SHALL accept and report task attachments. Task creation through the agent SHALL accept absolute host paths and SHALL resolve them all before the task exists, so that a creation call never produces a task carrying only part of the supplied files. Card editing SHALL accept attachment additions and attachment removals, and SHALL require explicit confirmation for a removal because it deletes bytes.

The detailed card read SHALL report the task's attachments with each attachment's display name, byte length, and readable path, so an agent that re-reads a task discovers files added after the conversation began. A card listing SHALL NOT report attachments.

#### Scenario: Create a task with files through the agent

- **WHEN** an agent creates a task supplying absolute host paths
- **THEN** the created task carries those files as attachments
- **AND** a follow-up detailed read reports them

#### Scenario: Refuse an agent creation with one unreadable path

- **WHEN** an agent creates a task supplying several paths and one cannot be read
- **THEN** no task is created
- **AND** the problem names the path that could not be read

#### Scenario: Add files to an existing task through the agent

- **WHEN** an agent edits a task and supplies additional host paths
- **THEN** those files are added to the task's attachments
- **AND** previously attached files remain

#### Scenario: Removal requires agent confirmation

- **WHEN** an agent edits a task to remove an attachment without confirming
- **THEN** the removal is refused
- **AND** the attachment and its bytes remain unchanged

#### Scenario: Discover a file added later

- **WHEN** the user adds an attachment after the task's conversation began and an agent then reads the task in detail
- **THEN** the read reports that attachment with its display name, byte length, and readable path

#### Scenario: Listing omits attachments

- **WHEN** an agent lists cards
- **THEN** no returned card carries its attachments

### Requirement: Task attachments appear in the first-turn task context

The task context the plugin delivers before a conversation's first turn SHALL list the task's attachments, each with its display name, byte length, and readable path, so the agent can read the file with its own tools. The listing SHALL carry its own byte budget, separate from the budget the workflow snapshot already occupies, so that adding attachments never removes the workflow snapshot from that context.

When the attachments exceed their budget, the context SHALL report how many were omitted rather than dropping them silently.

#### Scenario: Files are listed before the first turn

- **WHEN** a task with attachments opens its first conversation
- **THEN** the delivered task context lists each attachment with its display name, byte length, and readable path

#### Scenario: The workflow snapshot survives many attachments

- **WHEN** a task carries more attachments than the attachment listing budget allows
- **THEN** the delivered context reports the attachments that fit plus how many were omitted
- **AND** the workflow snapshot remains present in the same context

#### Scenario: The agent reads an attachment with its own tools

- **WHEN** an agent reads the path reported for an attachment
- **THEN** the file's contents are available through the agent's ordinary file tools
- **AND** no attachment-specific tool is required

### Requirement: Deleting a task removes its attachment bytes

Deleting a task SHALL remove its attachments from the task record and SHALL delete their stored bytes from disk as part of the same deletion. A deletion SHALL NOT remove bytes belonging to another task, and SHALL NOT remove a conversation message's own stored copy.

When a stored object cannot be deleted, the deletion SHALL report that failure rather than claim complete cleanup, and SHALL NOT prevent the task itself from being removed.

#### Scenario: Delete a task with attachments

- **WHEN** a task with attachments is deleted
- **THEN** its stored attachment bytes are deleted from disk
- **AND** the task record is removed

#### Scenario: Another task keeps its files

- **WHEN** one task is deleted
- **THEN** the attachment bytes of every other task remain readable

#### Scenario: Report a failed byte deletion

- **WHEN** a stored object cannot be deleted during task deletion
- **THEN** the deletion reports that failure
- **AND** the task is still removed from the board
