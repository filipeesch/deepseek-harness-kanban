# Task Files

A task can carry files: spreadsheets, logs, screenshots, PDFs, or any other artifact that belongs to the work rather than to a single message.

Every file is kept as stored bytes and shown as a plain file, images included; the product makes no thumbnail and treats no format specially.

## The Files panel

The task drawer **Info** section lists the task files below the title and description.

Each row shows the file name and its size and offers **Download** and **Remove**; the section states that the task has no files when the list is empty, and adding stays available.

## Adding a file

Files come from three sources.

**Attach a file by host path** takes an absolute path on the machine serving the plugin, and **Add** copies that file into the task.

**Choose a file** opens the browser file dialog.

Pasting a file into the path field attaches it from the clipboard; pasted text stays text and is never treated as a file.

Attaching a file by path is the efficient route because the plugin already runs on that machine; the browser route is the one that works when the interface is served elsewhere.

A path that does not exist, names a directory, or cannot be read is refused with a message naming that source, and the task is left unchanged.

## Creating a task with files

The **New task** dialog collects files under **Files**, with the same path, browser, and clipboard sources.

The files are attached in the same operation that creates the task, so a created task never appears without the evidence it was created with.

Creation is all or nothing: one unreadable source creates no task and stores nothing.

## Downloading a file

**Download** returns the exact stored bytes under the file name the task recorded.

The browser receives the bytes from the plugin rather than an address on the machine, so a file stays readable without exposing where it is stored.

Downloading is unavailable when the stored bytes are not present on the serving machine.

## Removing a file

**Remove** asks for confirmation naming the file, and confirming deletes its stored bytes; the file cannot be restored from the task afterwards.

Removing a file from the task does not disturb an answer that already delivered it, because a delivered answer holds its own copy inside its conversation.

## Deleting a task

Deleting a task removes its records and deletes the bytes of its files from disk.

Files of another task are untouched, and a delivered answer keeps the copy its conversation holds.

A stored file that cannot be deleted is reported instead of being left behind silently, and deletion still completes.

## Where files live, and why two places exist

Task files live in a directory the plugin owns inside the DSH profile, outside the project and outside any worktree.

They therefore never enter version control, they survive a worktree being removed, and they are unaffected by a task switching between its project directory and a worktree.

Files attached to a **question answer** are kept differently: they belong to the conversation and are stored in the host attachment store, which is immutable.

The two lifetimes are deliberate. A task file is working data that the person can take back, so it must be deletable; an answer file is conversation history that must remain readable when the conversation is resumed, so it must not disappear with the task.

The consequence is accepted openly: the same file exists twice once it has been delivered in an answer, and removing it from the task leaves the answer intact.

## What the agent sees

Files are listed in the task context delivered before a conversation starts, each with its name, its size, and a path the agent reads with its own file tools; the list has its own budget, so a task with many files still gives the agent its workflow stage and transitions.

The list is bounded in what it prints, never in what it stores: a long list states how many files it left out and points at the detailed card read.

A file added after the conversation began is discovered by reading the task again, so an agent that re-reads the task sees the new evidence.

The card tools can also attach files: creation takes absolute paths and resolves every one before the task exists, and editing can add files or remove them, removal requiring explicit confirmation because it deletes bytes.

[Agent tools](agent-tools.md) owns the tool contract; this document owns what the person sees.

## Answer files

A question round accepts files as part of the answer: each question slide has its own **Attach file** control, and the **Additional Notes** slide has one for files that belong to the round as a whole.

Files come from the browser file dialog or a clipboard paste, and neither requires a task card, so an answer in an ordinary chat accepts files the same way.

An attached file does not answer a question and does not make Submit available; a question with files and no answer stays unanswered.

The reply names each file inside the block it belongs to, so the agent knows which question a file answers, and the files travel with that reply as real attachments.

A round whose file cannot be delivered fails as a whole, reports why, and keeps the draft so the answer can be retried; no partial reply is sent.

Attached files are part of the durable draft, so they survive closing the drawer, switching conversations, and reloading the application, and they remain deliverable when the answer is finally submitted.
