# Design

## Context

See `proposal.md` for motivation and the delta specs for required behavior. The constraints below shape the approach.

The plugin is a DSH host plugin with a browser client. Tasks live in a per-Hub aggregate validated by a strict schema, delivered whole to the client in the board snapshot, and mutated through one command lane. The board's sharing layer publishes configuration only, so tasks and their files never travel.

Two distinct byte stores exist, and they differ in ways that decide most of this design:

- The host attachment store (`ctx.attachments`) is content-addressed by the SHA-256 of the bytes, immutable, and shared by conversations and forks. It exposes save, streamed save, streamed read, and a host-path lookup. It exposes no deletion: the platform documents itself as retention-neutral with reference-aware collection deferred.
- A plugin-owned directory is ordinary files that the plugin creates and removes. The plugin already does this for scripted captures, with mode `0o700` directories and explicit unlinking.

A native conversation message accepts a file part as a durable file reference, and request assembly projects each file occurrence to handle text naming a readable path, so an agent reads the file with its ordinary file tools. The browser can only submit a file part through an upload receipt minted by the host's upload service, and a receipt is retired once its prompt is accepted. The host's own read-back method accepts images only, so a stored file cannot currently be read back by the browser.

The task context delivered before a conversation's first turn is a user message with a byte budget of `6 KB` that the workflow snapshot currently consumes entirely.

## Goals / Non-Goals

**Goals:**

- One attachment model for a task, with bytes the plugin can actually delete.
- One attachment model for a question answer, with bytes that survive because the answer is conversation history.
- File support on the three write paths that already exist for a task: agent creation, agent editing, and the shared human creation experience.

**Non-Goals:**

- Publishing attachments, or any change to the sharing layer. The published board document carries configuration only, and this design keeps that true.
- Thumbnails, dimension probing, or native image parts for task attachments or answer files. Every file is generic.
- Deleting objects from the host attachment store, or adding collection to the platform.
- Attachment limits by count or size.

## Decisions

### Two stores, chosen by the lifetime of what they hold

A task attachment's bytes live in the plugin's own directory; an answer attachment's bytes live in the host attachment store.

Both places were chosen deliberately, because they have opposite lifecycles and the product needs both. A task attachment is working data: the user must be able to take it back, and deleting the task must remove it, so it belongs where the plugin can unlink it. An answer attachment is conversation history: it must outlive the task it came from and stay readable when the conversation is resumed or forked, so it belongs in the store the platform keeps for messages.

The consequence is accepted explicitly: the same file can exist twice once it is attached to an answer, and a task attachment deleted from the task does not disappear from a message that already carries it.

Alternative considered: store everything in the attachment store and accept that removal only drops a reference. Rejected because it cannot honor a removal or a task deletion, which is the whole reason the plugin stores bytes at all.

Alternative considered: store everything in the plugin directory and give the platform a path instead of a durable reference. Rejected because an answer's message would then point at a path that a later removal or task deletion invalidates, leaving history that references nothing.

### Task attachment metadata on the task record

The ordered attachment collection is a field of the task in the Hub aggregate.

The client already receives the whole task in the board snapshot, so the Info section can render the list with no additional feed or request. The Hub's deletion cascade already removes a task's notes and relations in one mutation, which is where the attachment metadata belongs too. The field is optional, so an existing Hub opens unchanged.

Alternative considered: a separate storage domain keyed by task identifier. Rejected because the surface that must render the list would need a new feed and the deletion path would have to clean two places, for no gain: the metadata is small and is genuinely part of the task.

### Bytes outside the checkout, in the DSH profile

The plugin stores attachment objects under its own private directory inside the DSH profile, beside the directory it already uses for scripted captures.

This keeps the files out of version control, makes them independent of which worktree the task currently uses, and survives worktree removal and switching. It reuses a directory the plugin already owns and a pattern it already implements, including restrictive modes.

Alternative considered: store under the task's effective working directory. Rejected because the files would enter version control, could be committed by accident, and would be destroyed when the worktree is removed without going through any attachment-aware path.

### Every file is a generic file

Task attachments and answer files are stored and delivered as generic files. No image is decoded, thumbnailed, or sent as an image part.

This holds one representation across the task record, the answer draft, the card payload, and the task context. It also keeps the answer path free of the store's image-specific admission rules.

Alternative considered: route images through the store's image path for thumbnails and native vision. Rejected for this change because it doubles the representation in the draft, the payload, and the delivery path; it can be added later without migrating existing records, since a generic file keeps its bytes and its name.

### Paths on the write tools, resolved before the task exists

Agent creation and editing accept absolute host paths, and creation resolves every path before the task exists.

A single call may carry several files, and the task may start its first execution in that same call. A task created with part of its evidence would let the executing agent reason over incomplete context while believing it is complete, so the call fails whole when any path cannot be read. This mirrors the platform's own batch rule for images.

Paths are not restricted to the task directory. The host process reads any path it can read, and the agent already reads the host filesystem with its own tools, so a path restriction here would add no protection while blocking legitimate evidence outside the checkout. The residual exposure is that an agent can copy a sensitive host file into a task; this is recorded as a risk rather than silently accepted, because the product cannot detect sensitivity.

Alternative considered: confine accepted paths to the task's effective working directory. Rejected because it blocks the ordinary case of evidence the agent generated outside the checkout while providing no real boundary.

### Answer files are delivered as durable parts plus text

A submitted round delivers its attached files as file parts of one prompt, and the reply text names each file in the block it belongs to.

The file part is what gives the agent a readable path; the text is what tells the agent which question the file answers. Delivering the files without the reference would leave the agent to guess their meaning, and the reference alone would leave it with a name rather than a readable object.

This changes the dock's submission: it can no longer send plain text, and it must submit a prompt carrying upload receipts. The dock already resolves the conversation through the session scope, so the change is to its local contract, not to the architecture.

### The browser needs a stored-file read method

A draft that persists its attachments can only restore a usable attachment if the browser can obtain the bytes again, and a download needs them too. The plugin therefore exposes a host method returning the exact stored bytes of a referenced file.

Without it, the platform's image-only read method fails the requirement because it rejects a file reference. The two surfaces have different jobs. A restored draft reads its bytes through the owner-guarded remote method, because it needs a value rather than a response. A download goes through one exact route registered on the shared API channel, because the browser needs the bytes under a disposition header rather than a JSON payload: `ctx.connection.fetch.register` puts the route inside the connection authentication fence, so only the owner peer reaches it, and the plugin never discloses a host path.

Alternative considered: persist the upload receipt in the draft. Rejected because a receipt is retired when its prompt is accepted, so a restored draft could never deliver it.

### The attachment listing gets its own byte budget

The task context lists attachments under a budget separate from the workflow snapshot's existing one.

Measured against realistic lines, one attachment entry costs roughly 180 bytes, so a few dozen files would consume the whole 6 KB budget and evict the workflow snapshot. That snapshot is the agent's only statement of which stage it is in and which transitions exist, so evicting it trades navigation context for a file list. A separate budget lets the ordinary case carry both, and an exceeded budget reports the omitted count instead of dropping files silently.

## Risks / Trade-offs

- **An agent can copy any readable host file into a task.** → Accepted and bounded: the plugin cannot judge sensitivity, so the exposure is documented rather than silently permitted; the mitigation available today is the deletion path, which really removes the bytes.
- **Byte deletion can fail while the rest of the deletion succeeds.** → Reported explicitly instead of hidden; the task is removed so the board stays truthful, and the failure names the object that remained.
- **The same file occupies disk twice once delivered in an answer.** → Accepted: the two copies have different owners and different lifetimes, and deduplicating them would couple a task's lifecycle to a message's.
- **A draft's restored attachment could reference an object deleted in the meantime.** → The submit fails whole and keeps the draft, so the user retries instead of delivering a reply with a missing file.
- **Losing a draft attachment on reload would be invisible.** → Prevented by the stored-file read method; the draft restores a usable attachment or the surface reports that it could not.

## Migration Plan

No data migration is required: the new task field is optional and a Hub without it reads as a task with no attachments. There is no rollback for bytes already written: a downgrade leaves the plugin directory on disk with objects no earlier version reads, and leaves a persisted draft attachment that an earlier version ignores. Neither breaks an earlier version, and both are removable by hand.
