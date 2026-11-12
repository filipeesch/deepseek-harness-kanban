# Design

## Context

See `proposal.md` for the motivation. The current transport (the third published
format) separates a `kanban-hub.yaml` manifest that owns board names, order, and
project scopes from one log per board that owns only the workflow, and each log is a
YAML document holding a snapshot plus a tail that every append rewrites whole. The
following properties of that shape matter here:

- `HubSharingService` (`src/host/sharing/service.ts`, 799 lines) owns command
  routing, the lane registry, binding lifecycle, the manifest repository, per-board
  apply, per-board publish, the check, removals, and orphan bookkeeping. A per-board
  unit existed during the previous change and was folded back into the service.
- The board state is decided twice: by `evaluateBoard` in
  `src/domain/sharing/board-plan.ts` and again by `boardState` in
  `src/host/sharing/view.ts`. They disagree about a renamed board, which is the
  defect the user hit.
- The storage boundary offers a manifest port (read/write with a token) and a board
  log port (probe/read/create/append), so the transport can only be changed in
  whole-document terms.
- `src/host/sharing/state.ts` stores published text digests and, during a review, a
  copy of the published text, because the view has no local materialized copy.
- Published formats 1 and 2 are still read, and their `legacyWorkflows` field is
  transported by three stores and never consumed.

## Goals / Non-Goals

**Goals:**

- One published artifact per board, append-only, and one place that decides a board's
  state for checks, publishing, applying, and the interface.
- A local materialized version per board, so a check applies only new events and the
  interface never needs the storage to answer "is this a draft".
- Keep the authored workflow text byte-identical through publish and apply.
- Remove the manifest, its token, the whole-document reader, and every legacy reader
  in the same change that removes their data shape.
- Shrink the publishing service instead of growing it, with the provider mechanics
  behind ports and the per-board unit independently testable.

**Non-Goals:**

- No change to how tasks execute, move, schedule, or converse.
- No shared tasks, notes, conversations, projects, or Hub names.
- No real-time transport, subscription, or server; the storage stays files.
- No byte-offset tail reads; the format enables them, this change does not use them.
- No new storage provider.

## Decisions

### D1 — The board log is the only published unit

One `.jsonl` file per board; no file lists boards. The published board set is the set
of logs present, and a board's name, project scope, and position are events in its own
log.

*Why:* the user asked for the publish to be an append of the board's events, and a
board's identity is part of what that board is. Removing the list removes the split
between "workflow draft" and "manifest draft" that no single action could clear.

*Alternatives:* keep the manifest as an index (rejected: it is the thing that broke);
one log for the whole Hub (rejected: reintroduces the Hub-wide blast radius).

### D2 — The stamp stays, but carries only a version

`kanban-hub.yaml` keeps its name and holds `version: 4` and nothing else. It is a
layout stamp, not a document.

*Why:* presence detection, first-connection behaviour, and version negotiation need one
cheap, well-known entry; and an older plugin must be able to tell that it is looking at
a layout it does not understand instead of an empty folder. Keeping the name keeps
presence checks and conflict-copy detection pointed at the same entry.

*Alternatives:* no Hub-level file (rejected: an older plugin would see an empty storage
and publish its own layout over it); rename the file (rejected: needless churn for
every presence check).

### D3 — Events only, one JSON object per line

A board's log holds events and nothing else. The first event establishes the whole
workflow; a later whole-workflow event is a checkpoint. There is no snapshot in storage
and no compaction that rewrites the file. Events keep their own kind, version, sequence,
and timestamp.

*Why:* the log is then genuinely append-only, which removes the whole-file rewrite that
today rewrites every log on every publish, invites conflict copies on synchronized
folders, and makes a publish's cost proportional to history rather than to the change.

*Alternatives:* keep a snapshot line and append events after it (rejected: that is the
current shape, and the user explicitly asked for the snapshot to stay local); compact in
storage (rejected: compaction rewrites the file and needs a snapshot in it).

### D4 — Each installation keeps its own mirror

For every board it holds a cursor for, an installation stores the materialized published
workflow, the applied name, project scope, and position, the last applied sequence, and
the last observed probe/head. The mirror is never written to the team storage. Publishing
derives events from the local board against the mirror; the interface compares the local
board against the mirror to decide a draft.

*Why:* it makes a check proportional to what changed, keeps the interface local, and
removes the published-text digest and the review copy the record carries today.

*Trade-off:* the record grows with the workflows of the boards this installation holds.
If cloning it per snapshot becomes hot, the workflow text moves to a side table keyed by
Hub and board; the interface contract does not change.

*Alternatives:* re-materialize from the log on every read (rejected: replay cost per
snapshot); keep only a digest (rejected: the review needs both texts and a digest cannot
be diffed).

### D5 — Identity events with a sparse rank

`board.renamed`, `board.scope-changed`, and `board.rank-changed` join the event
vocabulary. Position is a short string ordered lexicographically; moving one board
appends one event to that board's log, and ranks are rebalanced only when no rank fits
between two neighbours.

*Why:* order is a Hub-wide fact that must be published without a Hub-wide write. A dense
index would append an event to every board after the moved one.

*Alternatives:* dense integer positions (rejected: a move rewrites N logs); order by name
(rejected: the user wants to control order).

### D6 — Removal is a tombstone

Publishing a team-wide removal appends `board.removed` to that board's log and keeps the
file. The published set excludes a tombstoned board, but the log stays enumerable so an
installation that holds the board can learn about the removal. The absence of a log is
never a removal.

*Why:* with no list, absence is ambiguous between "removed", "not synchronized yet", and
"never published here". A tombstone makes the removal explicit and keeps the storage
append-only.

*Alternatives:* delete the file (rejected: a partially synchronized folder then looks like
a removal); keep the removal only in local state (rejected: no other installation would
learn about it).

### D7 — Checkpoints bound replay

A publisher appends a new whole-workflow event when the events after the most recent one
pass the accepted bound (the constant today is 200 events). A reader recovers from the last
checkpoint at or before its cursor, or from its cursor when that is later.

*Why:* the log grows forever by design; a checkpoint bounds what a fresh or long-absent
installation replays without rewriting the file or dropping history.

*Alternatives:* unbounded growth (rejected: first read of an old board replays its whole
history); rewrite the file to a new snapshot (rejected: it is compaction by another name).

### D8 — Two narrow ports, one of them the layout

The storage boundary becomes: read and write the stamp with its version; list the board
logs; probe one log; read one log; create one log; append events to one log against its
head. The manifest port disappears. Enumeration is a provider capability: a directory
listing for a folder or a Git checkout, a folder query for Google Drive Cloud.

*Why:* the transport no longer has a Hub-wide document to read or a token to compare, and
the per-board unit can be tested with a memory store implementing one interface.

*Alternatives:* keep a manifest port for the stamp (rejected: a port named for a document
that no longer exists); expose raw directory paths to the service (rejected: provider
mechanics leak into the publisher).

### D9 — Decompose the service along the board

`HubSharingService` keeps command routing and binding lifecycle and delegates to:
`BoardSync` (observe, evaluate, apply, publish one board, and update its mirror),
`BoardPublisher` (derive changes, append, checkpoint), `SharingChecker` (enumerate,
probe, count, never apply), and `BindingLifecycle` (connect, receive, publish initial,
change location, disconnect). `view.ts` becomes an aggregation over the record and the
local Hub.

*Why:* the previous change's decomposition was reverted into a 799-line class and the
publishing bug lived exactly there. Each seam above is needed by the new model anyway.

*Alternatives:* add the new operations to the existing class (rejected: it would pass 1000
lines and mix provider plumbing with Hub state).

### D10 — One state decision

`evaluateBoard` becomes the only place that decides a board's state — draft, updates
available, needs review, update required, orphan — from the local board, the mirror, the
last observed head, and the log. The host stores that decision from the check and the
interface renders it; the duplicate decision in `view.ts` is deleted.

*Why:* two decisions disagreed about renamed boards, which is the user-visible defect.
One function also makes the per-board row, the banner, the tab count, and the publish
guard agree by construction.

*Alternatives:* keep the host decision and delete the domain one (rejected: the domain
one is the only one that can be unit-tested without a Hub).

### D11 — Publishing derives and appends; publish-all loops

A board publish derives the event batch from mirror to local board (workflow events plus
identity events), appends it, updates the mirror, and marks the checkpoint when due. A
Hub-level action iterates the boards with local changes and reports per-board outcomes.
Nothing writes another board's log.

*Why:* derivation keeps every write path ignorant of sharing, and the loop gives the
convenience the user asked for without a Hub-wide write.

*Alternatives:* manual per-board publishing only (rejected: the user asked for publish
all); emit events from each write path (rejected: every future write would have to
remember to emit).

### D12 — One client action layer, presentational surfaces

A single sharing action hook owns command dispatch, pending state, and failure reporting
for a scope (Hub or board). The banner, the tab counts, the Changes rows, and the workflow
editor's share action consume it; they stop calling `api.sharing` directly.

*Why:* three surfaces dispatch sharing commands today with their own pending and error
state, and one of them published the wrong command for a whole release. One layer makes
that class of mistake impossible and keeps components presentational.

*Alternatives:* keep per-component dispatch (rejected: it is what failed).

### D13 — Team Settings is Connection and Changes

Connection owns the storage, its location, the account, the interval, the check status,
Refresh, Switch account, Change folder, and Disconnect. Changes owns the Hub state, one row
per board with its counts and actions, the locally removed boards, the storage review, and
Publish all / Get updates. The storage cards appear only while the Hub is unbound.

*Why:* the user asked for exactly two areas and less text; the repeated address, account,
and guidance are what made the surface noisy.

*Alternatives:* one status-first page (rejected: the user chose two areas).

### D14 — The review is a semantic summary

The review renders the derived change list with product vocabulary ("stage Backlog renamed
to Inbox", "stage Plan label changed", "project scope restricted") and reveals the full
authored text on demand. Conflict reviews list the identity or lifecycle divergence that
needs the choice.

*Why:* the current review dumps two YAML documents. The derivation that publishing already
performs knows the change; the summary reuses it instead of re-diffing text.

*Alternatives:* a textual line diff (rejected: it is still a text dump); two YAML panels
with better styling (rejected: the user asked for the semantic summary).

### D15 — Zero legacy

The plugin reads format version 4 only. No stored record or published layout is migrated;
an older stamp is treated as no published configuration and the first connection publishes
the local Hub. Forward guards stay: a newer stamp is refused with an update warning, and an
unknown event or event version stops only its board.

*Why:* the only installation is the author's, the v1/v2 reader is dead code with a wrong
effect, and carrying three formats for one installation costs more than it protects.

*Alternatives:* a one-shot migration of the local record (rejected: no benefit for one
installation); keep reading older layouts (rejected: three formats, no consumer).

## Risks / Trade-offs

- **Unbounded log growth** → checkpoints bound replay cost; files stay small in practice
  because each event is one short line and a checkpoint is one workflow text.
- **Enumeration per check** → the drive provider caches file ids and uses the change feed;
  a folder provider uses one directory read plus a stat per log; a Git provider reads the
  tree once. A check still probes before it reads.
- **The team repository is no longer human-readable** → the authored text is preserved
  byte-for-byte inside events, and the application is the review surface; the previous
  YAML layout was already stale (the README documents format 2).
- **The local mirror makes the sharing record bigger** → the mirror holds one workflow per
  bound board; if cloning it per snapshot becomes hot, it moves to a side table without a
  spec or interface change.
- **Tombstoned logs accumulate** → a tombstone is one line, and an enumeration that finds
  it removes the board from the published set without reading the rest.
- **Rank rebalancing** → a move between two adjacent ranks with no gap appends rank events
  to the affected boards; the alternative (dense indexes) is strictly worse.
- **A partially synchronized folder can hold some logs of a board set** → the published set
  is derived per check, so a missing log is a board that is not published here, never a
  removal.

## Migration Plan

1. Remove the read paths and the data shapes together: the manifest port, the
   whole-document reader, the legacy stored-record migration, and the snapshot/compaction
   code. No compatibility branch ships.
2. Ship the v4 read path first (stamp, enumeration, event decode, local mirror), then the
   write path (derive, append, checkpoint, tombstone), then the interface, then document
   the new layout.
3. On the author's machine the Hub opens disconnected (its stored record no longer
   validates) and the published folder keeps its v3 entries. Reconnect the storage: the
   connection reports the older layout, leaves it untouched, and publishes the local Hub in
   v4 beside it. Old `.yaml` logs are ignored by enumeration and can be deleted by hand.
4. Rollback is not supported. A plugin that predates this change sees no layout stamp it
   reads and would publish its own layout into the folder; the release notes state that the
   upgrade is forward-only. Keep the previous release pinned if a rollback is needed.

## Open Questions

- The exact rank alphabet and rebalancing threshold, and the checkpoint bound: tuning
  constants, not interface or approach changes.
- Whether a later change reads only the log tail by byte offset: the JSON Lines encoding
  enables it; this change reads a whole log and applies the events after the cursor.
