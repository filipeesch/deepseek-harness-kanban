# Design

## Context

See `proposal.md` for motivation and `specs/` for the required behavior. The constraints that shape this approach:

- A Hub aggregate owns `projects`, `boards`, `tasks`, and `notes`; a project identifier is unique within its Hub and a board identifier is unique across Hubs. `Board` currently carries only an identity and a workflow, and the only board option that exists today lives inside the workflow YAML (`defaultView`).
- Task creation has one domain entry, `createTask(hub, input)`, which already resolves both the board and the project. The command path, the `create_card` tool, and the legacy board store all funnel into it, and `create_card` additionally re-validates that the project belongs to the Hub before calling it.
- The published document is a projection of `Board` limited to `{ key, name, workflow }`, compared by content rather than by revision. `SharingContent` is `{ name, workflow }`, and it is what decides `needs-review` and what the review dialog resolves as one block.
- Publishing state is persisted per Hub with the last received, last seen, and preview documents embedded. It is validated on open by re-serializing each stored document and parsing it again; a record whose documents fail that round trip is dropped with a report.
- The document schema and the Hub schemas are strict objects, so an unexpected field is a load failure rather than a warning.
- The client already stores per-board presentation preferences in a browser map keyed by board id (`dsh.kanban.views`), with best-effort reads and no host round trip.
- The workflow canvas fits the whole diagram every time its measurements become ready, and it has no notion of a stored viewport.

## Goals / Non-Goals

**Goals:**

- One authority for "may this project create a task on this board", reached by both the UI and the agent surface.
- Project identity that survives a rename, a relocation, a publication, and a reinstall, without introducing a second project record.
- A published document that can add a field later without silently discarding local publishing state.
- A viewport preference that is provably local: no host call, no board write, no team effect.

**Non-Goals:**

- Moving a task between boards, or restricting which boards a task's conversation may create into.
- A shared identity for tasks, notes, or conversations; only board entries and project keys cross the sharing boundary.
- Syncing the viewport across browsers, devices, or installations.
- Retroactively rejecting or moving cards whose project left a board's scope.
- Deleting projects that disappear from a received scope; only keys are removed or placeholdered.

## Decisions

### 1. The scope lives on `Board` as an optional key list

`Board.allowedProjectKeys?: string[]`. Absent means every project of the Hub, an empty array means none, and a non-empty array restricts to those keys. The field is optional so existing boards load unchanged and no migration writes every board.

Alternatives considered: a separate board-settings record keyed by board id (a second source of truth per board, and a second place to keep consistent with publishing); encoding the scope in the workflow YAML (would put creation policy in the workflow editor, which is a different concern, and would make the workflow's meaning change for an unrelated reason).

### 2. The scope stores keys, never local ids

The board keeps only keys, and local enforcement resolves a key to the Hub's project by lookup. This keeps one representation for the local record and the published entry, and it makes a received board meaningful before its projects exist locally.

Alternative considered: storing local ids and publishing keys (would require translating in both directions on every publication and reception, creating a second invariant that can drift).

### 3. `projectKey` is a deterministic slug, editable, unique per Hub

Generated at registration from the project name with a deterministic collision suffix, so two installations registering the same repository name derive the same key without configuration. Renaming or relocating never regenerates it. The key is editable; saving a new key rewrites the key in every board scope of the same Hub inside the same transaction, so no board is left pointing at a key that no project owns.

Alternatives considered: an opaque per-installation identifier (two installations would never converge without an explicit mapping step); an immutable key (makes a typo permanent and blocks convergence when names differ).

### 4. One enforcement point in the domain

`operations.createTask` checks, in order: the project exists in the Hub, it is not a placeholder, and the board either has no restriction or allows its key. The wire command, `create_card`, and the legacy store inherit it. `create_card`'s own "project belongs to the Hub" check is removed, because the domain check subsumes it.

Alternatives considered: enforcing in `KanbanApp` before the transaction (a second place that can drift, and the tool would still need its own check); enforcing in the client (no protection for the agent surface).

### 5. A placeholder is a `Project` with no path and an origin

`Project.projectPath` becomes optional exactly when `origin === 'published'`; the schema's refinement enforces that pairing. A placeholder has no Git root, no default branch, and no workspace. Every consumer that currently assumes `projectPath` — creation, worktree defaults, workspace binding, relocation — treats a placeholder as unusable with a typed problem rather than an empty path. Adoption is an ordinary project save that supplies a path and keeps the key.

Alternatives considered: a separate key-to-project registry (does not pollute the project list, but introduces a second concept and a new mapping surface); a sentinel invalid path (spreads a fake path through validation, filters, and error logs).

### 6. Backfill runs over raw data before the aggregate is parsed

`HubRepository.open` currently parses each loaded Hub immediately. The deterministic key assignment runs on the raw loaded records, is persisted once, and only then is the aggregate parsed. Existing boards need no backfill because an absent scope is already the unrestricted state.

Alternative considered: deriving the key lazily on read (a project renamed before its first write would change key, breaking any published reference).

### 7. Document version 2, with version 1 read and normalized

The published document becomes `version: 2` with an optional `projectKeys` list per entry, omitted for an unrestricted board. The reader accepts versions 1 and 2, normalizing 1 to boards with no scope, and rejects a newer version as an explicit unsupported-version state that blocks applying and publishing while preserving local edits. The persisted publishing state is normalized the same way when it is loaded, before its documents are re-validated, so recorded bindings, orphans, and removals survive the upgrade.

Alternatives considered: keeping version 1 and adding an optional field (a peer without the feature fails with a shape error instead of an actionable version error, and the incompatibility is invisible); rejecting version 1 outright (the validation on open would drop every existing publishing record).

### 8. The scope travels inside `SharingContent`

`SharingContent` becomes `{ name, workflow, projectKeys }`, so the existing three-way comparison, the `needs-review` state, the per-board local/team choice, and the all-or-nothing application carry the scope with the workflow without a second conflict mechanism. The comparison must treat a scope difference as a board change, and the content key and the document token must include it, or a scope-only edit is invisible to publishing.

Alternatives considered: a separate scope conflict path (a second review UI for the same board); applying the team scope unconditionally (would silently close creation on a board a user had just opened).

### 9. The project filter derives from the board's tasks

The filter's option list is computed from the distinct project ids of the active board's tasks, resolved to names through the Hub. It no longer depends on the Hub's project list or on the scope, so a project that left the scope keeps its cards filterable.

Alternative considered: deriving the filter from the scope (a card whose project left the scope would become unfilterable).

### 10. The viewport is a browser map keyed by board id

A second preference map beside `dsh.kanban.views`, storing `{ x, y, zoom }` per board id, read on mount and written when navigation settles. Restoring happens when a board opens; a workflow change and the explicit fit action still re-frame and then become the stored value, because a stage may have appeared or disappeared. The store is best-effort and never blocks rendering.

Alternatives considered: a board field persisted by the host (would make a personal navigation preference into shared data and would publish it to the team); a single global viewport (does not satisfy per-board positions).

## Risks / Trade-offs

- **A version 1 publishing record is dropped on open** → normalize stored documents to version 2 before the existing round-trip validation, and cover it with a test that opens state written against version 1 and asserts bindings, orphans, and removals survive.
- **A scope-only change is never recognized as a change** → include the scope in `SharingContent`, in the content key, and in the document token, and test a publish that changes only the scope.
- **A backfilled key collides or changes later** → make allocation deterministic from the name and the existing key set, persist it once, and test two projects whose names slug to the same value.
- **A placeholder reaches a path-dependent code path** → make `projectPath` present only for real projects in the schema, and give every consumer a typed rejection that names adoption.
- **Restoring the viewport fights the automatic fit** → restore only when a board is opened or switched to, and let the workflow-change and fit paths overwrite the stored value deliberately.
- **A closed board looks like a broken board** → present the reason in the creation experience and report the same state through `get_board_summary` and `list_projects`.
- **Editing a key leaves remote installations on the old key** → accept it as an inherent property of published keys; document it where the key is edited.
- **Publishing version 2 breaks a teammate on an older plugin** → the incompatible reader reports an unsupported version instead of a shape error, so the failure is actionable rather than opaque.

## Migration Plan

1. Ship the key backfill and the version 1 normalization together, so an upgraded installation can open existing Hubs and existing publishing state without a manual step.
2. Write version 2 on the next publish. The document token changes once, which may present the Hub as having one draft or one update; that is expected and self-clearing after the next publish.
3. Rollback: an older plugin reading a version 2 document reports the unsupported version and writes nothing, so the team document is never overwritten by a plugin that cannot represent it. Local Hub data remains valid because the only removed shape is a placeholder path that never existed.

## Open Questions

- Whether stale viewport entries for deleted boards should be pruned actively or left to be overwritten. It affects only local storage growth, so it can be decided during implementation without changing the specs, the approach, or the task breakdown.
