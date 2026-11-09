# team-files Specification

## Purpose
Let an agent search, read, create, edit, and delete the documents a team keeps in its Hub's team storage, inside one directory the plugin owns, without exposing the rest of that storage.

## Requirements

### Requirement: Team file location per storage binding

A Hub's team files SHALL live in a `team-files` directory at the root of the Hub's team storage location when that storage is a Git repository, a local folder, or a Google Drive Local folder. For a Git binding the directory SHALL be inside the plugin-managed clone; for a local folder or Google Drive Local binding it SHALL be inside the bound folder. The plugin SHALL create the directory when the first team file is written and SHALL adopt a `team-files` directory that already exists without moving, renaming, or rewriting its contents. The directory SHALL be a folder directly inside its bound location: a `team-files` entry that resolves to another folder, or to a folder outside the bound location, SHALL be refused instead of adopted. A Hub bound to Google Drive Cloud, and a Hub with no storage binding, SHALL be refused with a typed error that names the condition and the corrective action, and the plugin SHALL NOT perform a file operation or fall back to another location in that case. Team files SHALL NOT be part of the published document, SHALL NOT require a board, a task, or a project, and SHALL NOT change the published document format.

#### Scenario: Reach the team files of a folder-backed binding

- **WHEN** an agent searches a Hub bound to a local folder or to a Google Drive Local folder
- **THEN** the results come from the `team-files` directory inside the bound folder
- **AND** no other entry in that folder is read

#### Scenario: Reach the team files of a Git binding

- **WHEN** an agent searches a Hub bound to a Git repository
- **THEN** the results come from the `team-files` directory inside the plugin-managed clone

#### Scenario: Create the directory on the first write

- **WHEN** an agent creates a team file in a binding whose team files directory does not exist
- **THEN** the directory and the file are created
- **AND** every other entry in the location is unchanged

#### Scenario: Adopt an existing directory

- **WHEN** the bound location already contains a `team-files` directory with documents
- **THEN** search and read reach those documents
- **AND** none of them is moved, renamed, or rewritten

#### Scenario: Refuse a storage without team file support

- **WHEN** an agent invokes a team file tool for a Hub bound to Google Drive Cloud
- **THEN** the tool reports a typed error naming the storage
- **AND** no file is read, created, changed, or deleted

#### Scenario: Refuse an unbound Hub

- **WHEN** an agent invokes a team file tool for a Hub with no storage binding
- **THEN** the tool reports a typed error stating that the Hub is not bound to a team storage
- **AND** no file is read, created, changed, or deleted

### Requirement: Team file path and content rules

Every team file SHALL be addressed by a POSIX-style path relative to the `team-files` directory. The plugin SHALL reject an absolute path, a path containing an empty segment, a `.` or `..` segment, a backslash, a NUL, or a control character; SHALL resolve symbolic links and reject a path whose resolved target lies outside the directory; and SHALL reject the reserved entry `.trash` together with every entry inside it. A team file SHALL be UTF-8 text, and the plugin SHALL refuse a file it detects as binary with a typed error that names the path instead of returning replacement characters. The plugin SHALL preserve a byte order mark it reads and SHALL refuse to write content that a later read would classify as binary. Reading, searching, and every read that precedes a write SHALL refuse an entry larger than 8 MiB with a typed error that names the path and the entry's size, before loading it, so a bound that a deadline cannot interrupt exists. Reading and searching SHALL be bounded by 2000 lines, 50 KiB of rendered output, 2000 characters per line, 100 path matches, and 250 content matches, and a result that reaches a bound SHALL state which bound it reached. A byte bound SHALL measure the serialized representation the tool emits, including the indentation and separators the result adds, not only the text of the lines. Writing SHALL NOT impose a size limit of its own and SHALL preserve the file's UTF-8 content exactly. A path glob SHALL support `*`, `?`, `[...]` character classes with ranges and negation, and `**` across directories; a class SHALL never match a path separator, and a malformed pattern SHALL be refused with a typed error instead of reaching the regular-expression engine.

#### Scenario: Reject a path that escapes the directory

- **WHEN** an agent supplies an absolute path, a path with a `..` segment, a path with a backslash, or a path containing a control character
- **THEN** the tool reports a typed invalid-path error naming the rejected value
- **AND** no file is read, created, changed, or deleted

#### Scenario: Reject a symbolic link that leaves the directory

- **WHEN** a path resolves through a symbolic link to a target outside the team files directory
- **THEN** the tool reports a typed invalid-path error
- **AND** the target outside the directory is not read, created, changed, or deleted

#### Scenario: Refuse a binary file

- **WHEN** an agent reads a file that is not UTF-8 text, such as an image or a PDF
- **THEN** the tool reports a typed error naming the path and stating that only text files are supported
- **AND** no replacement characters are returned as content

#### Scenario: State a reached bound

- **WHEN** a read or a search reaches a line, byte, line-length, path-match, or content-match bound
- **THEN** the result states that it was truncated and which bound was reached

#### Scenario: Read a document longer than the line bound

- **WHEN** an agent reads a file with more lines than the line bound
- **THEN** the result carries the lines in the requested window and the total line count
- **AND** the agent can read the remaining lines with an offset

### Requirement: Team file search

`search_team_files` SHALL accept an optional path pattern in glob syntax — supporting `*`, `?`, `[...]` character classes, and `**` across directories — an optional text pattern, and an optional limit that SHALL NOT exceed the path-match bound. Without a text pattern it SHALL return every matching path with its size and modification time, bounded by that limit. With a text pattern it SHALL search every path-matching file rather than a page of them, SHALL return the matching line number and line text for each content match, and SHALL list only the paths that produced a match, bounded by the path-match bound. It SHALL stop at the content-match bound, at a 50 KiB budget for the emitted representation, or at the 30-second deadline — checked while scanning a long file, not only between files — whichever comes first, and SHALL state which bound stopped it. A path pattern or a text pattern that matches nothing SHALL return an empty result instead of an error. Results SHALL be ordered by path, SHALL exclude the trash directory, and SHALL skip a file that is binary or larger than the read cap. For a Git binding the result SHALL carry the commit the clone is at, so a caller can tell that the clone has not been refreshed.

#### Scenario: Find files by path pattern

- **WHEN** an agent searches with a path pattern such as `docs/**/*.md`
- **THEN** the result lists every matching path inside the team files directory

#### Scenario: Find text inside the files

- **WHEN** an agent searches with a text pattern
- **THEN** the result carries the matching path, line number, and line text for each match
- **AND** a match is not reported from a binary file

#### Scenario: Combine a path pattern with a text pattern

- **WHEN** an agent supplies both a path pattern and a text pattern
- **THEN** only files matching the path pattern are searched for the text pattern

#### Scenario: Report an empty result

- **WHEN** a path pattern or a text pattern matches nothing
- **THEN** the result is empty and the tool reports no failure

#### Scenario: Exclude the trash

- **WHEN** the team files directory contains a deleted file under `.trash`
- **THEN** no search result names that file or any path inside the trash

### Requirement: Team file read

`read_team_file` SHALL accept a path, an optional line offset, and an optional line limit bounded by the line bound. It SHALL return the numbered lines of the requested window, the total line count of the file, whether the output was truncated by lines or by bytes, and the modification time. A missing file SHALL be reported with a typed error naming the requested path. For a Git binding the result SHALL carry the commit the clone is at.

#### Scenario: Read a file

- **WHEN** an agent reads an existing text file
- **THEN** the result carries its numbered lines, its total line count, and its modification time

#### Scenario: Read a window

- **WHEN** an agent supplies an offset and a limit
- **THEN** the result carries exactly that window together with the total line count

#### Scenario: Report a missing file

- **WHEN** an agent reads a path that does not exist inside the team files directory
- **THEN** the tool reports a typed not-found error naming the requested path

### Requirement: Team file creation and editing

`create_team_file` SHALL create a file that does not exist, creating any intermediate directory inside the team files directory, and SHALL refuse to replace an existing file. The refusal SHALL come from the transport's own non-replacing creation, so an entry a listing did not show — a plugin temporary file, another spelling of the same name, or an entry behind an alias — is still protected. `edit_team_file` SHALL accept one or more literal replacements, SHALL require that each existing text occurs exactly once in the current content of the file, SHALL treat the replacement text literally — a sequence such as `$&` is written as those characters — SHALL apply all replacements together, and SHALL write the result only when every replacement can be applied. `edit_team_file` SHALL refuse a file that does not exist, SHALL name the replacement that did not apply when one cannot be applied, and SHALL refuse a result that a later read would classify as binary before anything is written. Neither tool SHALL leave a partially written file visible to another reader, and each SHALL be one atomic operation from the perspective of another caller: the existence or uniqueness check and the write it authorizes SHALL NOT be interleaved with another team file operation or with a document publish.

#### Scenario: Create a new file

- **WHEN** an agent creates a file whose path does not exist
- **THEN** the file is created with the supplied content inside the team files directory

#### Scenario: Refuse to replace an existing file

- **WHEN** an agent creates a file whose path already exists
- **THEN** the tool reports a typed error stating that the file already exists
- **AND** the existing content is unchanged

#### Scenario: Create an intermediate directory

- **WHEN** an agent creates `guides/setup/install.md` and `guides` does not exist
- **THEN** the intermediate directories are created inside the team files directory

#### Scenario: Apply several replacements together

- **WHEN** an agent supplies several literal replacements and each existing text occurs exactly once
- **THEN** every replacement is applied to the file in one write

#### Scenario: Reject a replacement that is not unique

- **WHEN** a supplied existing text occurs more than once or not at all
- **THEN** the tool reports a typed error naming that replacement
- **AND** the file is unchanged

#### Scenario: Refuse to edit a missing file

- **WHEN** an agent edits a path that does not exist
- **THEN** the tool reports a typed not-found error and creates no file

### Requirement: Team file deletion

`delete_team_file` SHALL require an explicit confirmation and SHALL move the file into `team-files/.trash/` under its original relative path followed by a timestamp suffix, instead of removing it. The suffix SHALL make the destination unique, so a repeated deletion of the same path never overwrites an earlier entry, and the plugin SHALL refuse the deletion rather than replace an entry when no free destination exists. The result SHALL name the destination the file actually reached. The plugin SHALL create the trash path as needed, SHALL never list, read, create, edit, or delete anything inside the trash through a tool, whatever an alias inside the directory resolves to, and SHALL never purge the trash. It SHALL resolve the trash's true identity, so a `.trash` entry that is a symbolic link is refused as a deletion destination rather than followed, and it SHALL NOT load a file's content to delete it. Deleting a path that does not exist SHALL fail with a typed error. Deleting the last file SHALL leave the `team-files` directory in place.

#### Scenario: Move a deleted file into the trash

- **WHEN** an agent deletes `docs/notes.md` with confirmation
- **THEN** the file is moved to `team-files/.trash/docs/notes.md` with a timestamp suffix
- **AND** the path is no longer reachable by search or read

#### Scenario: Delete the same path twice

- **WHEN** an agent deletes a path that was already deleted and created again, and deletes it again
- **THEN** the second move does not overwrite the first trash entry

#### Scenario: Keep the trash out of reach

- **WHEN** an agent searches, reads, creates, edits, or deletes a path inside `.trash`
- **THEN** the tool rejects the path as reserved

#### Scenario: Require confirmation

- **WHEN** an agent deletes a file without the explicit confirmation argument
- **THEN** the tool reports a typed error and the file remains in place

#### Scenario: Report a missing file

- **WHEN** an agent deletes a path that does not exist
- **THEN** the tool reports a typed not-found error and the trash is unchanged

### Requirement: Git team file publication

For a Git binding, a team file write SHALL fetch the repository's default branch before it changes the clone and SHALL compare the file's content on the fetched remote with the content in the clone, which is what the caller read. It SHALL refuse with a typed error when the two differ, and it SHALL leave the clone holding the fetched content so the next read is current. Otherwise it SHALL move the clone to the fetched head before writing, so an unrelated change on the team side is adopted instead of rejecting the push, and then SHALL commit the change and push it immediately. A write whose push is refused SHALL return the clone to the fetched head, SHALL report a refusal that could not be rolled back, and SHALL leave the remote unchanged, so the clone never keeps a commit the plugin did not publish. The automatic publishing check SHALL bring the checked-out team files to the fetched head when no tracked file is modified locally, so a read is at most one check interval behind. Reads and searches SHALL NOT fetch: the automatic publishing check is the only operation that refreshes the clone for reading, so a read may be one check interval behind. Every file write SHALL produce one commit whose message names the operation and the file path.

#### Scenario: Publish a team file change

- **WHEN** an agent writes a team file on a Git binding and the file did not change on the team side
- **THEN** the change is committed and pushed in the same call
- **AND** the remote default branch carries the new content

#### Scenario: Refuse a write the team changed

- **WHEN** the file's content on the fetched remote differs from the content in the clone
- **THEN** the tool reports a typed error naming the file and asking the caller to read it again
- **AND** the clone keeps the fetched content and no commit is created

#### Scenario: Roll back a refused push

- **WHEN** the push of a committed team file change is refused
- **THEN** the clone returns to the fetched head
- **AND** the remote and the team's content are unchanged

#### Scenario: Do not fetch on read

- **WHEN** an agent searches or reads a team file on a Git binding
- **THEN** no fetch is performed and the clone is read as it stands
- **AND** the result carries the commit the clone is at

### Requirement: Team file writes serialize with publishing

A team file write and a document publish on the same binding SHALL NOT run concurrently. A write SHALL wait for an in-flight publish, and a publish SHALL wait for an in-flight write, so neither operation observes the clone while the other holds it in an intermediate state. The wait SHALL cover the whole write — resolving the binding, checking existence or uniqueness, reading, computing the result, preparing the directory, and writing — and SHALL resolve the binding again after waiting, so a write queued behind a disconnect or a changed location is refused instead of using the previous one.

#### Scenario: Wait for an in-flight publish

- **WHEN** an agent writes a team file while a document publish holds the same binding
- **THEN** the write is applied after the publish completes
- **AND** neither operation reports a concurrent-write failure caused by the other

#### Scenario: Publish after a team file write

- **WHEN** a document publish starts while a team file write holds the same binding
- **THEN** the publish runs after the write completes
- **AND** the published document content is unaffected by the team file write
