# Proposal

## Why

Team sharing publishes one whole `kanban-hub.yaml` document and applies it whole. A stage
identifier rename is transported as a state difference, so every other member reads it as
"one stage disappeared, another appeared" and cannot tell which local tasks belonged to the
renamed stage. The apply is then refused with `SHARING_ORPHAN_COLUMNS`, and because applying
is all-or-nothing for the Hub, one such board blocks the team updates of every other board.
The member who renamed can publish normally; everyone else is stuck until they finish their
own work in that stage. The problem is not that the document is YAML: it is that the transport
carries state where the receivers need intent, and that the blast radius is the Hub rather
than the board.

## What Changes

- **BREAKING** (published format): the single published document is replaced by a small hub
  manifest plus one file per board. A v2 document is still readable and is normalized to the
  new format's genesis, so no team has to republish to keep working.
- Each board file holds a snapshot plus an append-only event log. The log is the transport and
  each member applies only the events after its own cursor for that board.
- A board change becomes an identity-bearing event. Renaming a stage identifier emits one
  identity event instead of describing a new state, so a rename stays distinguishable from a
  delete plus a create for every member, at any time.
- Receiving a rename rewrites the member's own task references in the same transaction that
  stores the new workflow, so an unrepresented column stops being a refusal.
- Stages gain a stable identity in the workflow document. The authored identifier becomes a
  mutable field, and the identity is what events, cursors, layout and connections address.
- Applying and publishing are isolated per board: a board that cannot be applied no longer
  stops another board's team updates or another board's publish.
- Field-level divergence resolves last-writer-wins, because the per-board log gives a total
  order. Divergence over a stage's identity or lifecycle keeps a per-board review.
- Applying an event rewrites only the affected spans of the authored workflow text, so
  comments, key order, quoting, and the untouched stages survive every team update.
- Publishing is manual and per board. A read-only check per Hub lights an update badge and an
  **Update** action on the board, instead of replacing the local configuration automatically.
- Change detection belongs to each storage adapter (Git commit range, folder observations,
  Drive change feed) rather than to a shared head cached in the manifest.

## Capabilities

### New Capabilities

None. The published format and the transport are one contract that is only meaningful
together, so they stay under `hub-sharing` instead of creating a near-duplicate capability.

### Modified Capabilities

- `hub-sharing`: the publication layout, the published content and its version negotiation,
  the transport boundary, team updates and three-way application, refusal of destructive
  application, board removal and orphan handling, continuous synchronization, automatic
  checks and status, the Team Settings interface, first connection, and the four storage
  location requirements all change.
- `stage-editing`: editing a stage identifier no longer defers the outcome to a team review,
  and the rename keeps the stage's stable identity.
- `kanban-board`: the workflow document gains an optional stable stage identity, and the
  record of a board removal moves from the published document to the hub manifest.
- `google-drive-local`: browsing a folder reports whether the published layout is present,
  instead of whether one named document is present.
- `hubs`: deleting a published Hub leaves the published layout untouched, not one named
  document.

## Impact

- `src/domain/sharing/`: `document.ts`, `plan.ts`, `apply.ts`, `workflow-merge.ts`,
  `projection.ts`, `identity.ts` are reworked around a per-board unit and an event
  vocabulary.
- New pure domain code for the event codec, the reducer, event derivation, event
  materialization, conflict classification, and compaction.
- `src/domain/workflow.ts`, `schema-parts.ts`, and `hub-schema.ts`: an optional stable stage
  identity, its canonical form, and its uniqueness.
- `src/domain/stage-update.ts` and `src/domain/hub-operations.ts`: an identifier rename keeps
  the stage identity.
- `src/host/sharing/`: `service.ts` is decomposed; `state.ts`, `view.ts`, and all four
  provider descriptors and stores move to the manifest plus board log ports.
- `src/host/board-administration.ts`: per-board publish and per-board update actions.
- Client: Team Settings surfaces, the board sharing banner and badges, and the per-board
  update action.
- Tests: every sharing test, the workflow fixtures, and the provider stores.
