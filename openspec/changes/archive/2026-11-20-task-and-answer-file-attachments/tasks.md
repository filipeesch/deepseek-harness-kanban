# Tasks

## 1. Task attachment model and storage

- [x] 1.1 Add an optional ordered attachment collection to the task record in `src/shared/types.ts` (display name, byte length, origin) and mirror it in the persisted task schema in `src/domain/schema-parts.ts`, verifying that a Hub stored without the field opens unchanged and that a task with attachments round-trips through `HubStateSchema`.
- [x] 1.2 Create the plugin-owned attachment directory module beside the scripted capture store, rooted at the DSH profile with restrictive modes, exposing store, read, and remove for one object; verify with a unit test that a stored object is readable, that a removed object's bytes are gone from disk, and that a path-like display name cannot escape the directory (reusing the platform's leaf-name sanitizing rules).
- [x] 1.3 Reject empty and unusable display names and refuse unreadable sources with actionable problems; verify the refusal cases (missing path, directory path, unreadable file, empty name) in unit tests.

## 2. Reading and removing task attachments

- [x] 2.1 Remove a task's attachment bytes when an attachment is removed and when the task is deleted, leaving another task's objects and a delivered message's copy untouched; verify both cascades and the isolation case in domain and host tests.
- [x] 2.2 Report a byte deletion that fails without preventing the rest of the task deletion, and verify the failure is surfaced rather than silently swallowed.
- [x] 2.3 Extend the task deletion cascade so the record's attachments leave with the task, verifying that deletion removes the card, notes, relations, and attachments in one mutation.

## 3. Write paths for the agent

- [x] 3.1 Extend the shared task-creation input so creation accepts attachment paths, resolving every path before the task exists; verify that one unreadable path among several creates no task and stores no bytes.
- [x] 3.2 Extend card editing to add attachments and to remove them with `confirmed: true`, verifying that an unconfirmed removal is refused and that a confirmed removal deletes the bytes.
- [x] 3.3 Report attachments in the detailed card read with display name, byte length, and a readable path, and confirm the compact listing still omits them; verify with tests that a file added after a conversation began appears in a later detailed read.

## 4. Task context listing

- [x] 4.1 Add the attachment listing to the task context delivered before a conversation's first turn, under its own byte budget separate from the workflow snapshot; verify that a task with many attachments still delivers the workflow snapshot and reports the omitted attachment count.

## 5. Task file surface in the drawer

- [x] 5.1 Build the task file surface inside the Info section: list with display name and byte length, empty state, and the add, download, and remove actions; verify the rendered states with client tests.
- [x] 5.2 Wire the three add sources (absolute host path, browser file input, clipboard paste) to one attachment operation, verifying that an image added by any source is stored and listed as a generic file with no thumbnail.
- [x] 5.3 Implement removal with explicit confirmation naming the attachment, verifying that canceling leaves the attachment and its bytes unchanged.

## 6. Download and stored-file read

- [x] 6.1 Expose a host method returning the exact stored bytes of a referenced file with verification, and wire download in the file surface through it; verify a download returns the exact bytes and that an unresolvable reference fails with an actionable problem.

## 7. Attachments in the shared creation experience

- [x] 7.1 Add attachment inputs to the New task dialog using the same three sources, submitting them with the creation command; verify that a task created with a file lists it in the Info section and that one unreadable source prevents creation.

## 8. Answer files in a question round

- [x] 8.1 Extend the question draft content with per-page attachments and round attachments, update its validation schema and both draft-copy paths, and verify that a draft with attachments persists and restores through the existing storage.
- [x] 8.2 Add the attachment controls to a question slide and to the Additional Notes slide, accepting the browser file input and clipboard paste and listing each file with display name and byte length; verify in a chat without a task that attaching requires no card and offers no host-path source.
- [x] 8.3 Keep answer validity unchanged when files are attached, verifying that a question with files but no answer stays unanswered and Submit keeps its existing gate.
- [x] 8.4 Deliver a submitted round's files as file parts of one prompt with the textual reference inside the matching block, replacing the dock's plain-text send; verify that the reply carries the files in attachment order, that the text names each one in its block, and that a failed delivery keeps the draft and sends no partial reply.
- [x] 8.5 Restore draft attachments on reload by reading their stored bytes back through the new host method, verifying that a reloaded draft still delivers its files and that a vanished object fails the submit instead of delivering a reply with a missing file.

## 9. Documentation and verification

- [x] 9.1 Document the task file surface, the answer attachment flow, and the two storage lifetimes in `docs/user/`, and verify `pnpm run check` passes the documentation gate.
- [x] 9.2 Run `pnpm run typecheck` and `pnpm test`, and verify the full suite passes with no new failures.
- [x] 9.3 Run `openspec validate task-and-answer-file-attachments --strict` and verify the change validates.
