# Design

## Context

See proposal.md - Why. The constraints that shape this design:

- The host's browser upload service (`fileUpload`) offers three body kinds. A `Blob` or stream
  body posts to the authenticated upload route; exact bytes go through a Remote namespace.
- That namespace is resolved against the context of the code that calls the service, and Cordis
  resolves a service by walking the caller's `inject` list. The plugin's client entry injects
  `remote`, not `remote.fileUploads`, so the exact-bytes branch throws
  `cannot get property "remote.fileUploads" without inject` for every answer file.
- The host's composer uploads a `File`, so the route branch is the exercised, documented carrier and
  returns the same receipt the prompt cites.
- Three person-facing surfaces accept files today, each with its own copy of the code: the New task
  dialog, the drawer's files panel, and the question round. Two of them implement the same
  pending-read, failure-identity, retry and discard gate independently.
- `src/questions` is a lower layer than `src/client`: the client imports the question surface, and
  the question surface imports nothing from the client. A shared UI module must therefore sit beside
  `src/questions`, not inside the client.
- Answer files are stored by the host per conversation, and drafts persist the attachment records, so
  a restored draft must keep delivering bytes. None of that storage changes here.

## Goals / Non-Goals

**Goals**

- Make an answer file actually reach the conversation as a real attachment, on the documented
  carrier, with a regression test that fails if the body stops being a `Blob`/`File`.
- One attachment control implementation for all three surfaces, and one place for the pending and
  failed selection gate.
- Keep every behavioral guarantee the current surfaces already have: order preserved, all-or-nothing
  batches, submission waiting for an in-flight read, a failed selection blocking the action until
  retried or discarded, removal of a detached file's stored copy.
- Keep the question round reachable and complete in an ordinary chat with no task card.

**Non-Goals**

- Fixing the host's exact-bytes branch. It stays defective in the pinned host; this change avoids it.
- Changing attachment storage, the wire schema, or the card tools.
- Making images render, thumbnails, or dimension decoding.
- A host-path affordance anywhere in the person-facing UI.
- Reworking the drawer's file rows (download and remove) beyond the add control.

## Decisions

### 1. Upload answer files as a `File`, behind an adapter

The delivery wiring converts the draft's base64 bytes into a `File` and calls
`fileUpload.upload(sessionId, file, name)`, which takes the route carrier.

- *Alternative - declare `remote.fileUploads` in the plugin's client `inject`:* one line, and other
  host plugins declare remote namespaces that way. Rejected because a plugin's `inject` gates
  activation: on a host that mounts no such namespace the whole Kanban client would never load, and
  the name is an internal host namespace rather than a product contract.
- *Alternative - patch the host:* not this repository's artifact, and the plugin supports a host
  version range rather than one build.
- *Alternative - send the answer as text naming paths:* loses real attachments and contradicts the
  structured-questions contract.

The adapter is a module-level factory taking the upload port, so a unit test can assert the body
kind, the name, the session, the receipt mapping, and both failure messages.

### 2. One shared attachment module at `src/attachments/`

It owns: byte-size text, reading a picked file as base64, the clipboard-file extraction, the
compact icon action, the token list, the failure notice, and the `useAttachmentPicks` hook that
serializes batches, counts reads in flight, keeps one identity per selection, and exposes
`retryFailed` and `discardFailed`.

`useAttachmentPicks` takes the caller's accept function, which performs the surface's own storage
(task bytes, or a draft-copy save) and owns its cleanup on a partial batch. The hook owns only
ordering, the in-flight count, failure identity, and `settle()`, which submission awaits for its
boolean rather than for an exception, so a selection's own notice stays the only reporter of its
failure.

- *Alternative - keep the duplicated implementations:* the two copies already drifted in naming and
  would drift further with a third surface to touch.
- *Alternative - a general dialog/footer component:* too broad; the surfaces share the picker and the
  tokens, not their footers.

### 3. Chips for the two compact surfaces, rows for the drawer list

The question footer and the New task footer present attached files as tokens (display name, size,
remove). The drawer keeps its rows because each row also carries Download and Remove, and removal
there deletes stored bytes and stays confirmed.

- *Alternative - chips in the drawer too:* would drop the download action or bury it behind the chip.
- *Alternative - a shared list component with a variant flag:* the two shapes differ in actions and in
  confirmation semantics; a flag would be a boolean-parameter smell.

### 4. Footers own the add action

- Question panel: the icon sits in the footer beside Back/Next/Submit and attaches to the active slide.
  The footer lists the active slide's files only; on Additional Notes it lists the round's files.
- New task dialog: the icon and tokens join the existing action row, ahead of Cancel and Create task.
- Drawer files panel: the icon replaces the path field, the Add button, and the Choose a file button;
  the panel accepts a pasted file while it has focus.

The previous per-slide control is removed, so the question surface no longer spends a block on
attachments. Required-error notices move to a compact band between the scrolling body and the footer,
so a failure stays visible above a long slide.

- *Alternative - keep the per-slide control and only shrink it:* still duplicates the control per
  slide and keeps the round's slides competing with attachment chrome.
- *Alternative - put the question control in the header bar:* the header is the collapse/progress
  affordance; a second interactive group there would be cramped and easy to hit by accident.

### 5. Preserve the accessibility contract while the control moves

The hidden file input keeps a ": choose a file" suffix on its accessible name, the tokens keep a
named group per surface ("Files for this question", "Files for the whole round", "Files for this
task"), and each token's remove action is named after the file. Removal of a token stays immediate
for answer files and stays confirmed for task files.

### 6. Keep the wire fields, drop the UI that fed them

`task.create.attachments` and `task.edit.attachmentPaths` stay on the command because the agent's
`create_card` and `edit_card` tools write through them. Only the client state and controls that
fed them from typed paths are deleted, together with the now-dead `api` parameter of the drawer's
file panel.

## Risks / Trade-offs

- [The route carrier is unavailable in a host that exposes neither the page hook nor Worker support]
  → the upload fails with the carrier's own message and the round keeps its draft; the adapter
  surfaces that message like any other delivery failure, and the round stays retryable.
- [A draft copy whose delete keeps failing stays in the conversation's attachment store] → the
  cleanup is best effort: it is retried on every later opportunity while the form is open, a copy that
  outlives the form is reported instead of silently forgotten, and a cleanup failure never blocks the
  answer. Moving the queue to the host would widen a path that is already best effort.
- [A host install older than the pinned version could differ in carrier behavior] → the plugin's
  supported range is unchanged; the adapter asserts the documented return shape and reports an
  unknown shape as a delivery failure instead of sending a receipt-less prompt.
- [Removing the typed-path route reduces what a person can do from the UI] → the card tools keep the
  path source for agents, and the documentation names the browser dialog and the clipboard as the
  person's sources.
- [Footer chips compete with the action buttons on narrow widths] → tokens truncate with a title,
  the group wraps before the actions, and the existing narrow-width media query keeps the footer
  usable.
- [Long file names are no longer fully visible] → each token truncates with its full name in a
  tooltip, and the size stays visible.
- [Existing tests target the removed controls] → the change updates the question-form, drawer and
  browser specs in the same work, converting them to the group labels and footer control rather than
  weakening them.
- [The authenticated upload route and the native prompt belong to the host, so this change cannot
  requalify them] → the adapter is held to the documented body kind and receipt shape, the prompt
  composition is unit-tested against a recording conversation, and the shipped verification boundary
  keeps native conversation transport a host responsibility. The browser harness proves the surface
  and the reply text it produces, never a real host delivery.

## Migration Plan

No stored data or wire format changes, so there is no migration. Installation is a build and plugin
reload; rolling back is reverting the commit. Drafts written before this change keep their attachment
records and must restore with tokens and remain deliverable, which the restored-draft tests cover.
