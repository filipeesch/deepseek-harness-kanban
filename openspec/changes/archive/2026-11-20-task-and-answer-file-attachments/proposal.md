# Proposal

## Why

Tasks and structured questions are text-only today. A person can describe a screenshot, a spreadsheet, or a log in prose, but cannot hand the file over, so the agent reasons about a description instead of the artifact. The same gap blocks the agent: `create_card` can open a task but cannot deliver the evidence it already found, and a person answering a `decision_request` cannot return the document the agent asked them to review.

The DSH host already owns a durable, content-addressed attachment store, and a native conversation already accepts file parts. What is missing is the product surface: a place to keep a task's files, a way to attach them while creating or editing a task, and a way to attach files to an answer.

## What Changes

- Each task gains an ordered collection of file attachments. Metadata lives on the task; bytes live in a plugin-owned directory under the DSH profile, so removing an attachment or deleting the task actually removes the bytes.
- The task drawer's Info section becomes the file surface: add by host path, add by browser file input, paste from the clipboard, download, and remove with confirmation.
- The New task dialog accepts the same three inputs, so a task can be created already carrying its evidence.
- `create_card` and `edit_card` accept host paths. A task is never created with a partial attachment set: every path is validated before the task exists. `edit_card` may add and remove, and removal requires `confirmed: true`. `get_card` reports the task's attachments so an agent that re-reads a task discovers files added later.
- The task context delivered before a conversation's first turn lists each attachment's name, size, and readable path, under its own byte budget so the workflow snapshot keeps its existing one.
- A structured question round accepts file answers. The person attaches files to an individual question slide and to the round's Additional Notes slide, by browser upload or clipboard paste; the submitted reply carries the files as durable attachments plus a textual reference naming where each file belongs.
- A question draft persists its attachments and restores them after a reload. Attachments given as an answer live in the host attachment store, so they outlive the task they were attached from.

## Capabilities

### New Capabilities

- `task-attachments`: the task-owned file collection, its metadata, its plugin-owned byte directory, the Info section surface, creation and editing through tools and dialog, the attachment listing in task context and card reads, and the lifecycle that removes bytes.

### Modified Capabilities

- `kanban-board`: the Info section of the task drawer presents the task's files in addition to title and description, and the shared New task creation experience collects attachments.
- `structured-questions`: a question round accepts file answers per page and for the round, by upload or paste, submits them as durable attachments with a textual reference, and persists them in the round's draft.
- `task-lifecycle`: deletion removes the task's attachment bytes from disk together with its other plugin-owned data.
- `product-tools`: `create_card` and `edit_card` accept attachment paths, `get_card` reports attachments, and the plugin exposes the read path a browser needs to restore and download them.

## Impact

- **Hub schema**: the task record gains an optional attachment collection. The board's published document is unchanged, because it carries only configuration and never tasks, so attachments never reach a shared board.
- **Persistence**: a new plugin-owned directory under the DSH profile holds the bytes. Deletion and removal become real filesystem operations, which the plugin already performs for scripted captures.
- **Host surface**: a new remote method for reading a stored file's bytes. The host's own attachment read accepts images only, so a file read must be added for the browser to restore a draft and download a file.
- **Question answer submission**: the dock stops sending a plain text prompt and starts submitting a prompt with file receipts, which changes its local contract.
- **Tools**: `get_card` and the task context grow new payload sections; both need a byte budget so existing sections are not evicted.
