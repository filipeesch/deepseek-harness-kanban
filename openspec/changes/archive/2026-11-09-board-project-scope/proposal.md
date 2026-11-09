# Proposal

## Why

A board accepts tasks from every project in its Hub, so a planning board and an implementation board share one flat project list: people and agents can create a card on the wrong board with the wrong project, and there is no way to state that a board only accepts work from specific repositories. That intent also cannot travel with the board, because the published document carries only the board name and workflow while project identity stays local. Separately, the workflow diagram forgets where the user was looking on every visit, so returning to a board always re-frames the whole diagram.

## What Changes

- A board gains a **project scope**: an optional list of allowed project keys. An absent field means every project of the Hub may create tasks; an explicit empty list means the board accepts no new task.
- Projects gain a stable **project key**: generated from the project name at registration, editable, and unique within the Hub. Editing a key rewrites the board scopes of the same Hub in the same transaction, so no board is left pointing at a key nobody owns.
- Task creation is gated in exactly one place: the host rejects a project whose key the target board does not allow, and rejects a project that exists only as a published placeholder. Creation into a different board of the same Hub keeps working; the target board's scope decides.
- **BREAKING** (published data): the shared document moves to format version 2 and carries each board's project keys. Version 1 is still read and normalized, so existing publishing state is not discarded. A document written by a *newer* version blocks applying and publishing, keeps local edits, and asks the user to update the plugin.
- A published board whose scope names a key that does not exist locally **creates a placeholder project**. A placeholder has no project path, cannot create tasks or worktrees, and is adopted through the same edit dialog, which requires a path.
- Deleting a project removes its key from every board of the Hub, and deleting a placeholder does the same, which also removes that key for the team once the board is published.
- Existing projects receive a deterministic key when the Hub opens, before any document is published.
- The **New task** project list contains only the projects the active board allows, and a board that allows none explains why creation is unavailable. The board's project filter instead lists only the projects that already have cards on the board.
- `list_projects` returns every project of the board's Hub with an `allowed` flag for the requested board, and `get_board_summary` reports the scope, so an agent sees the restriction before attempting a write.
- The workflow diagram remembers its pan position and zoom **per board** in the browser, restores it when that board is opened, and stores the new position whenever the user navigates. A workflow change and the fit action re-frame the diagram and become the new stored position.

## Capabilities

### New Capabilities

None. The behavior belongs to capabilities that already exist.

### Modified Capabilities

- `kanban-board`: task creation is limited to the projects a board allows, a board's project scope is configured in its settings, a board with an empty scope refuses creation with an explanation, and the project filter lists only projects that already have cards on the board.
- `project-contexts`: a project carries a stable, editable key and a published placeholder is a project without a project path that cannot create tasks until it is adopted.
- `hub-sharing`: the published document gains a format version 2 that carries each board's project keys, receiving applies and conflicts on the scope together with the workflow, an unknown key creates a placeholder, and a newer document version blocks applying and publishing with a visible warning.
- `product-tools`: `list_projects` reports whether each project may create a card on the requested board, and board creation or a rejected project is reported before the write.
- `workflow-view`: the diagram's pan position and zoom persist per board and survive a reload instead of being forgotten.

## Impact

- **Domain**: the board record and its schema gain the project scope; the project record and its schema gain the key and the placeholder origin; a new pure scope module owns "is this project allowed here"; task creation, project save, project delete, and board scope save route through it; the sharing document, its token, its content key, and its three-way comparison carry the scope.
- **Host**: the Hub repository backfills project keys when it opens and creates placeholders when applying a received document; board administration gains a scope write with the same publishing outcome as the other board writes; the sharing state accepts and normalizes version 1 documents on read; the discovery tools project the scope.
- **Client**: board configuration is split into identity, deletion, and project-scope blocks; the New task project list is filtered by the scope; the project editor exposes the key and adopts a placeholder; the project filter derives its options from the board's tasks; the workflow canvas restores and stores its viewport per board.
- **Published data**: a document version bump. Local publishing state written against version 1 documents must load, so the read path normalizes it instead of rejecting it.
- **Tests**: domain, host, client, and the real-composition lane gain cases for the gate, the placeholder lifecycle, the document version policy, and the persisted viewport.
