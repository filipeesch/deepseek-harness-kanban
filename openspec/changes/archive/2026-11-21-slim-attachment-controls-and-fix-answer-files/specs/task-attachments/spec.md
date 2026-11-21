# Spec Delta

## REMOVED Requirements

### Requirement: Add attachments from a hosted path, a browser file, or the clipboard

**Reason**: The person-facing surfaces no longer offer an absolute host path. Every surface now
presents one compact add action that opens the browser file dialog, so a path field, an add-path
button, and a per-source button set no longer exist for a person to use.

**Migration**: A person adds a file through the browser file dialog or the clipboard. An agent that
needs a file living on the host supplies its absolute path through the card tools, which continue to
accept paths and resolve them before the task exists.

## ADDED Requirements

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

## MODIFIED Requirements

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
