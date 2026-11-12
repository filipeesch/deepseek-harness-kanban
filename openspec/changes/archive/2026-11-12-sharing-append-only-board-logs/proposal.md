# Proposal

## Why

Publishing no longer does what the user asks. The published layout separates a hub
manifest that owns board names, order, and project scopes from one log per board that
owns only the workflow, so a board whose name or scope changed is a draft that no
action can clear, three of the four storages expose no manifest publish at all, and the
workflow editor's share action publishes the manifest instead of the board. In the same
model every append rewrites a whole log file, and Team Settings presents connection,
state, review, differences, and per-board actions in one column with repeated values and
raw YAML dumps.

## What Changes

- **BREAKING** (published format): `kanban-hub.yaml` becomes a layout stamp that carries
  only the layout version. It no longer names boards, order, or project scopes.
- **BREAKING** (published format): each board's published log becomes an append-only
  JSON Lines file that carries events only. There is no snapshot in storage; every
  installation materializes and keeps its own mirror of each board it holds a cursor for.
- Board name, project scope, and board order travel as identity events inside the board's
  own log, so one board's publish carries everything that board changed.
- Removing a board for the team appends a removal event (a tombstone) instead of rewriting
  a list. The absence of a log is not a removal.
- Publishing is per board and appends derived events. A Hub-level action publishes every
  board that has local changes, without writing any index.
- A check enumerates the published logs and reads only the logs that changed.
- **BREAKING** (published format): formats 1, 2, and 3 are no longer read. A layout stamp
  older than the current version is treated as having no published configuration, and
  connecting publishes the local Hub in the current format.
- The workflow editor's share action publishes that board instead of the manifest.
- Team Settings is split into **Connection** and **Changes**, and connection details are
  presented once.
- The active board presents publishing in both directions: publish when it has local
  changes, get updates when the team has changes.
- The Hub tab and each board tab present counts instead of undifferentiated dots.
- The review presents a semantic summary derived from the events, with the full text on
  demand.
- Dead code is removed with the format it served: the manifest store and its token, the
  whole-document reader, the legacy normalizers for published and stored state, and the
  storage-side snapshot and compaction.

## Capabilities

### New Capabilities

None. The published format and the transport are one contract and stay under
`hub-sharing`, following the organization the previous transport change established.

### Modified Capabilities

- `hub-sharing`: the published layout, the published content, the log format, drafts and
  publishing, board removal and orphans, locally removed boards, automatic checks and
  status, the Team Settings interface, the board banner, first connection, the
  storage-provider boundary, the two location requirements, concurrent writes, conflict
  copies, format negotiation, team updates, and board publication isolation all change.
- `kanban-board`: the record of a team-scoped board removal moves from the hub manifest
  to a removal event in that board's log, so the removal actions state a different
  carrier.
- `google-drive-local`: folder browsing reports whether the published layout is present
  by enumerating board logs instead of looking for one named document.

## Impact

- `src/domain/sharing/`: `manifest.ts` shrinks to the layout stamp; the legacy document
  reader and its normalizers are removed.
- `src/domain/journal/`: `log.ts` becomes an event-only JSON Lines codec; `event.ts`
  gains the board identity and removal events; `materialize.ts` applies them.
- `src/host/sharing/`: `ports.ts` loses the manifest store and gains log enumeration;
  `layout-directory.ts`, `layout-git.ts`, and `google-drive-layout-store.ts` are
  rewritten; `service.ts` is decomposed into a per-board unit, a publisher, a checker,
  and a binding lifecycle; `state.ts` stores the new local mirror with no legacy
  migration; `view.ts` aggregates the boards and their counts.
- `src/host/board-administration.ts`: a team-scoped removal publishes the removal event
  through the per-board port.
- `src/shared/types.ts`, `src/remote.ts`: `sharing.publish` is replaced by
  `sharing.publishAll`, and the view drops the fields the new model does not have.
- `src/client/`: Team Settings, the board banner, the tab indicators, the workflow
  editor's share action, and the review summary.
- `README.md`: the Team Settings and shared-document sections are rewritten.
- Tests: the sharing host and domain suites, the browser publishing and sharing evidence
  suites, the fixture harness, and the archived-format tests are replaced or removed.
