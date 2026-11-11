# Design

## Context

See `proposal.md` — Why. The current implementation is a whole-document transport:
`src/domain/sharing/document.ts` defines one `kanban-hub.yaml` v2 document,
`src/domain/sharing/plan.ts` compares three whole documents and produces a per-board
decision, and `src/host/sharing/service.ts` writes the whole document atomically behind an
opaque content-hash token through four provider stores.

Two properties of the current model shape every decision below.

First, the published unit is the Hub, not the board. `applySharingPlan` mutates one Hub
draft in a single transaction and `applyUpdatesNow` refuses the whole application when any
board reports a blocker, so a board that cannot be applied freezes every other board.

Second, a stage has no identity other than its authored identifier. That identifier is also the
key of `initial_column`, `groups[].columns`, `allowed_transitions[].to`, and
`connections.from/to`, and tasks reference it through `columnId`,
`pendingTransition`, `recordedTransition`, and `instructionPending`. A published
workflow that renames it is indistinguishable, for a receiver, from a workflow that removed one
stage and added another, and `workflowMeaning` treats the identifier set as meaning, so the
rename can never merge as a layout difference.

## Goals / Non-Goals

**Goals:**

- Make a stage identity survive an identifier rename end to end, so a receiver migrates its own
  tasks instead of refusing the update.
- Make publishing and receiving independent per board, including the failure of one board.
- Keep the authored workflow text authoritative: an applied event must not reformat the board.
- Keep one code path per concern: one transport boundary, one event codec, one materializer.
- Shrink the publishing service rather than grow it, and keep provider mechanics out of it.

**Non-Goals:**

- No change to how tasks are executed, scheduled, or moved between stages.
- No shared task, note, conversation, or project projection: the published layout still carries
  boards only.
- No real-time transport, subscription, or server. The storage stays a set of files.
- No reuse of the event log as a local undo history or an audit trail for the user.
- No new storage provider.

## Decisions

### D1 — The aggregate is the board, not the stage

One file per board; the stage is a row inside it, never a file.

*Why:* `initial_column`, `groups[].columns`, `allowed_transitions`, and
`connections` cross-reference stages inside one workflow, and today they change under one
transaction. Splitting per stage would trade that atomicity for diffs that are already small,
because the authored workflow is line-based text and an authored edit is a text-range change.

*Alternatives:* one file per stage (rejected: cross-references become multi-file writes with
visible intermediate states on every non-Git storage); keep one file per Hub (rejected: keeps the
Hub-wide blast radius the change exists to remove).

### D2 — Layout: `kanban-hub.yaml` manifest plus `kanban-boards/<key>.yaml`

The manifest keeps its current file name and directory position, and the board logs live in a
sibling directory. The `team-files` directory is untouched.

*Why:* presence detection is currently by that file name in four places (folder browsing, first
connection, conflict-copy detection, discovery), and a v2 document sits at exactly that path. Keeping
the name means a v2 installation and a v3 installation disagree about content, not about where to
look, and the first-connection flow can read either.

*Alternatives:* a new `hub.yaml` name (rejected: every presence check and every conflict-copy
pattern changes, and a v2 team would be invisible to a v3 installation at connect time).

### D3 — Two narrow ports replace `SharedConfigStore`

`HubManifestStore` reads and writes the manifest with a version token. `BoardLogStore`
reads one board's log, appends events to it against an expected head, and answers which board logs
changed since an observation. A provider implements both and nothing else.

*Why:* the current boundary is one whole-document read and one whole-document write
(`src/host/sharing/store.ts`, lines 19-28), which is what forces the Hub-wide token, the
Hub-wide refusal, and a single expected value for a change that concerns one board. Two ports also
let the service depend on capabilities instead of a storage identity, which is what the existing
descriptor field `syncMode` was approximating.

*Alternatives:* widen `SharedConfigStore` with optional board methods (rejected: every provider
would implement a partially supported interface, and callers would branch on presence).

### D4 — A stable stage identity lives in the authored workflow

Each stage gains an optional opaque identity alongside its identifier. It is allocated by the
sharing layer when a stage first enters a published workflow, preserved by every edit path, and it
is what events, cursors, and layout address. The authored identifier remains what the user edits and
what the board renders.

*Why:* without an identity that is independent of the authored identifier, an event cannot say which
stage changed after a rename, and no amount of journaling fixes that. The identity must also survive
a wholesale `saveWorkflow` replacement, which is the reason it belongs in the authored text
rather than in a side table keyed by the identifier: a side table cannot distinguish a rename from a
delete plus a create on a wholesale replacement, and the sharing record is not available while the
Hub is unpublished.

*Alternatives:* keep the identity map in the publishing record, like `BoardBindings` (rejected:
a wholesale `saveWorkflow` desynchronizes it, and the record does not exist before first
publish); carry an operation envelope beside a state document (rejected: intents must be retained
until every member applies, which needs a cursor — and once a cursor exists, the log is the simpler
carrier).

### D5 — Hybrid event granularity

Semantic events are per field: workflow created or replaced, workflow field changed, initial stage
changed, stage created, stage field changed, stage identifier changed, stage removed, stage group
created/changed/removed, connection set/removed. Stored layout is one event per stage and per
gesture.

*Why:* the two kinds of state have opposite natures. A semantic change is low-frequency, must keep
history, and can conflict with another member. A layout change is high-frequency, is
last-writer-wins by nature, and already has its own three-way composition in
`src/domain/sharing/workflow-merge.ts`. Emitting one event per intermediate pointer position
would make the log grow with drag interaction and force aggressive compaction immediately.

*Alternatives:* every field as its own event including coordinates (rejected: log growth and a
compaction problem on day one); one event per whole stage (rejected: two members editing different
fields of one stage would collide when they need not).

### D6 — Snapshot plus a bounded tail

A board log is a snapshot of the board's authored workflow, with its stage identities, followed by
the events appended after it. When the tail passes the supported bound, the tail folds into a new
snapshot.

*Why:* there is no acknowledgement channel, so no compaction rule can know that every member has
passed a point. A snapshot that carries the stage identities makes re-bootstrapping from it lossless
with respect to identity, which is the one property compaction could otherwise destroy.

*Alternatives:* events only, replay from genesis (rejected: unbounded read cost per check and per
bootstrap); one file per event (rejected: an operation generating several events stops being atomic
on every non-Git storage).

### D7 — Events are derived by diffing at publish time

Publishing computes the difference between the last published board state and the local board state,
and appends the resulting events. No write path hand-emits events.

The identity derivation allocates an identity for a stage the published board never had, so the
publisher SHALL write the allocated identities into the local authored workflow as part of the
same operation that appends the events. Until it does, a second derivation of the same local state
would allocate a different identity for that stage; the derivation is therefore only pure when
every local stage already carries one.

*Why:* `createBoard`, `renameBoard`, `saveBoardWorkflow`,
`setBoardProjectScope`, `updateBoardStage`, and `editBoardWorkflow` all exist today
and know nothing about sharing. Deriving events keeps them that way, keeps the sharing layer the only
place that understands the log, and makes a missed event impossible — the worst case is a coarser
diff, not a missing fact.

*Alternatives:* emit from each write path (rejected: every future board write must remember to emit,
and `noteLocalChange` already shows how easy that is to get wrong).

### D8 — Apply materializes through text-range edits

Applying an event translates it into edits on the authored workflow text using the existing
text-range machinery (`applyWorkflowEdits`, `writeSequenceItemField`,
`replaceListScalars`), then stores the result through the same board write path the editors use.

*Why:* the authored text is the product surface — comments, key order, quoting, and stage ordering
are authored. Serializing derived state would erase them on every team update, which contradicts the
existing "Authored workflow text preservation" requirement. The machinery already exists and is
tested because the stage editor uses it.

*Alternatives:* regenerate canonical YAML from derived state (rejected: a direct regression of an
existing requirement, and a second serializer to maintain).

### D9 — Task migration happens in the same transaction as the workflow

Applying a stage identifier event rewrites, in one board transaction, the tasks' `columnId`,
their pending and recorded transition references, and their unresolved stage instruction reference,
then stores the workflow.

*Why:* the receiving member owns its tasks, so it is the only party that can migrate them, and the
cascade already exists for the local rename in `renameTaskStage`. Doing it in one transaction
keeps the Hub schema invariant that a task's column exists in its board's workflow, so the store never
observes an inconsistent Hub.

*Alternatives:* migrate lazily on next read (rejected: the Hub schema validates on save, so an
orphaned task would block the very transaction that should fix it); defer the whole board until idle
(retained as a fallback for a board with a running turn).

### D10 — Field conflicts are last-writer-wins; identity conflicts need a choice

The per-board log is linear because the storage serializes appends, so a field divergence has a real
order. The later append wins and the replaced value is recorded as superseded and shown read-only.
Identity and lifecycle divergence — two different renames of one stage, a rename of a stage that no
longer exists locally, a rename diverging from an unpublished local rename — require a per-board
choice and block only that board.

*Why:* the current three-way comparison has to infer an order it cannot observe, which is why it
needs a review for cases that are actually decidable. Resolving identity automatically would let one
member silently re-point another member's tasks.

*Alternatives:* review every field divergence (rejected: friction that scales with team size and
buys nothing once order is observable); last-writer-wins for identity too (rejected: a member's
stages could be renamed and its tasks migrated by another member's decision with no notice).

### D11 — The manifest owns board identity; the log owns the workflow

Board name, project scope, order, and lifecycle are manifest fields. The board log carries only the
workflow.

*Why:* the manifest is what the navigation, the badges, and the periodic check read first; putting
the name in the log would cost one read per board to render a board list. Board renames and scope
changes are rare and are not field-level merges, so a whole-manifest write with the existing token
semantics is the same guarantee the Hub has today.

*Alternatives:* everything in the board log (rejected: N reads per navigation and no atomic place to
create or remove a board); denormalize the name into both (rejected: two sources of truth and a new
failure mode where the manifest and the log disagree).

### D12 — Publishing is per board; a board publish ensures its manifest entry

Publishing one board appends to that board's log and, only when the manifest does not yet name the
board, writes that board's manifest entry. Manifest-only changes (order, name, scope, removal) have
their own publish.

*Why:* if every board publish had to update a shared head in the manifest, isolation would exist on
paper only — every publish would be a global write. Making the manifest delta occur once, at a
board's first publish, keeps the hot path single-file.

*Alternatives:* a separate manifest publish for every board creation (rejected: two actions where one
was asked for, with an easily forgotten second step that hides the board from the team); writing the
manifest automatically on structural change (rejected: silent global writes, which is exactly what
the change removes).

### D13 — Checks stay per Hub and read-only; applying and publishing are per board

The interval and the Hub-level scheduler are unchanged in shape. A check reads the manifest, asks the
storage which board logs changed, and reports counts. It never applies or publishes. The board shows
a banner with an update action when it has team events, and its tab shows the state.

*Why:* a badge must exist without the user opening Configuration, which needs a periodic read; making
it read-only keeps publishing and applying manual for the operations that change shared state, and
the per-board split makes the read cost proportional to what changed. The banner and badge components
already exist and only gain the update action.

*Alternatives:* lazy check on board open (rejected: the team should be notified without opening the
board); automatic apply on check (rejected: contradicts manual publishing and reintroduces silent
change).

### D14 — Change detection belongs to the provider

Each provider answers which board logs changed since a given observation with its own mechanism: a
Git commit range, per-file observations for a folder, the Drive change feed.

*Why:* the alternative — a head per board cached in the manifest — is a global write on the hot path
and, worse, a stale cache would suppress the very badge the feature exists to provide. Every provider
already has a cheap native mechanism; Git currently persists no state at all, which is the only one
that needs a small addition.

*Alternatives:* a manifest head per board (rejected: suppresses badges on non-atomic storage and
serializes publishes); reading every board on every check (rejected: N API calls per tick on Drive).

### D15 — Decompose the service along the new seams

`HubSharingService` keeps command routing and binding lifecycle, and the work below it moves
out: lane registry, binding lifecycle, manifest repository, per-board sync unit, and a checker. New
pure domain modules under `src/domain/journal` hold the event codec (`event.ts`), the text-range
structural edits (`authored-text.ts`), the reducer and materializer (`materialize.ts`), the
derivation (`derive.ts`), the conflict classification and batch application (`conflict.ts`), and
the log with its compaction and recovery (`log.ts`).

*Why:* the class is 717 lines today, holds eight responsibilities, and already mixes provider
plumbing with Hub state. The change adds a per-board unit of work, so keeping it in one class would
guarantee a god class. Every seam above is something the new model needs anyway.

*Alternatives:* add board methods to the existing class (rejected: the class grows past 1000 lines and
the per-board unit cannot be tested without a Hub).

### D16 — Per-file tokens and provider state

The manifest's token is the hash of its canonical content. A board log's head is the sequence number
and the hash of its last event. Provider state becomes: Git — the last observed commit; folder and
Drive Local — a per-file observation map; Drive Cloud — the manifest file ID, a board file ID map,
and the change cursor.

*Why:* the current token is a whole-document hash shared by everything, which cannot express this
board's head. Provider state already exists in the stored record and is validated per provider, so
the extension is additive and a record without the new fields stays readable.

*Alternatives:* derive the head from content only (rejected: a log must also distinguish grown from
rewritten); keep one token for the whole layout (rejected: recreates the Hub-wide serialization).

### D17 — Per-event schema version; unknown events stop that board

Every event carries its kind and its own format version. An unknown kind or version stops that board's
cursor and reports a required plugin update. It never skips.

*Why:* the log outlives a plugin version, so event schema evolution is permanent. Skipping would
silently diverge; stopping the whole Hub would violate isolation, so the stop is per board.

*Alternatives:* a single version for the whole log (rejected: any new event kind would invalidate the
whole board); skip unknown events (rejected: silent divergence).

## Risks / Trade-offs

- **Non-atomic writes on non-Git storage.** Publishing a new board writes its log and its manifest
  entry as two files, which a folder or Drive cannot do atomically. Mitigation: the operation is
  idempotent and retryable; the entry is written only on first publish; a check that finds a log the
  manifest does not name reports it and repairs the entry on the next manifest publish. Git keeps one
  commit for both.
- **Google Drive Cloud costs more.** One file becomes N, and the single file ID becomes a map.
  Mitigation: the change feed already lists changed files, so the per-tick cost stays one request; the
  map is additive in provider state.
- **A stale member re-bootstraps from a snapshot.** Mitigation: compaction is safe because the
  snapshot carries stage identities, so no rename intent is lost; a member behind the window re-reads
  the snapshot instead of failing.
- **A wholesale workflow replacement can drop identities.** A user who rewrites the whole YAML by hand
  may remove the authored identity fields. Mitigation: on apply and on publish, stages are matched by
  identity first and then by authored identifier; an identifier that is known keeps its identity, an
  unknown one is treated as a new stage. The failure mode is a rename read as a replacement, never
  lost content.
- **Authored identity fields are visible in the YAML.** Mitigation: they are one short line per stage,
  preserved by every editor, and documented in the workflow configuration requirement; a workflow
  without them remains valid.
- **Event schema evolution is a permanent surface.** Mitigation: D17 bounds the damage to one board
  and gives the model a version per event from day one; a new event kind is additive.
- **Specification surface.** Nineteen requirements change and one is replaced. Mitigation: the
  vocabulary the user observes keeps its words (draft, review, orphan, publish, update); only the unit
  becomes the board.

## Migration Plan

1. Publish format. Reading accepts v1, v2, and v3. A v1 or v2 document is read as the published board
   set and normalized to the current shape: one manifest entry plus one board log per board, with a
   genesis snapshot carrying the authored workflow and stage identities derived from the authored
   identifiers. Nothing is written to the team storage until the user publishes, so an installation
   can upgrade, check, and apply without republishing and without a coordinated team window.
2. Stored publishing state. The record gains per-board cursors, the last published board heads, the
   stored manifest, and a pending manifest change. Loading normalizes v1 and v2 stored documents the
   same way it does today, so bindings, orphan records, and recorded removals survive the upgrade.
3. Provider state. All additions are optional and defaulted: Git starts recording the observed
   commit, folder providers move from one observation to a map, Drive Cloud adds the board file ID
   map. A record without them is read as nothing observed yet and re-establishes on the first check.
4. Rollback. A plugin that supports only v2 refuses to apply and refuses to publish over a v3 layout,
   which is the existing behaviour for a newer format, so a downgrade keeps every local edit and
   reports that the plugin must be updated. Rolling back after a v3 publish therefore leaves the team
   unable to apply until it upgrades again; the recommendation is to upgrade forward.
5. Ordering. Ship the read path first (v1/v2 normalization and the new ports with a Git provider),
   then the write path, then the per-board UI surfaces. Until the write path ships, publishing keeps
   writing the v2 document.

## Open Questions

- The exact compaction bound (event count, byte size, or both) — a tuning constant, not a design or
  spec change.
- Whether the board log port returns a whole tail or a page — resolved by measurement once the first
  provider exists.
- The coalescing window for a layout gesture (pointer release versus a short debounce) — an
  interaction detail that does not change the event vocabulary.
- Whether the manifest should also expose a per-board last-changed time for display — cosmetic, and
  it can be derived from the log head.
