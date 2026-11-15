# Proposal

## Why

The Kanban configuration has grown into a single dialog whose **Hub** section manages boards
while its **Board** section edits only the board that happens to be active. The same board is
therefore reachable — and editable — from two places, so the operator has to know which place
they are in before acting. The dialog also resizes itself per section: General opens at about
960x380 and Board at about 1320x650, so every section change moves the whole surface under the
pointer and loses the reader's place.

Two smaller frictions sit on top of that. The board's default-model control renders its two
mutually exclusive choices flush against each other and against the native model selector.
And every first execution asks whether to create a worktree, even for a project whose owner
always wants one — or never wants one.

## What Changes

- Reorganize the configuration dialog's top-level sections into **General**, **Hub**, **Boards**,
  **Projects**, **Schedules**, and **Team Settings**, keeping **General** first and opened by default. **BREAKING**: the Board
  section is removed from that row; board configuration is reached from the Boards list.
- Add a **Boards** section listing the Hub's boards, each row offering Edit and Delete, plus a
  New board action that reuses the existing creation dialog. Editing a board opens a stacked
  overlay above the list carrying the existing board sub-sections: General, Projects, Defaults,
  Workflow, and Danger zone. Any board of the Hub can be edited, including one that is not the
  active board, and deleting it from the overlay returns to the list.
- Reduce the **Hub** section to the Hub's identity — name and rename — with Hub deletion in a
  separated danger zone instead of beside the board list.
- Give the configuration overlays a fixed height with an internal scroll region and one shared
  width, so switching sections or sub-sections never resizes the overlay. The board overlay
  keeps the widest width because it carries the Workflow editor.
- Present the board's default model as a segmented mode control — deployment default or specific
  model — with the native model selector always rendered beneath it, disabled only while the
  deployment default is chosen.
- Split **Team Settings** into **Connection** and **Changes** sub-tabs. Connection groups a
  Status panel (storage, location, account, last check, effective interval) and a Management
  panel (refresh, switch account, disconnect, and the editable interval). Storage cards remain
  the way to choose a storage while the Hub has no binding; a bound Hub still requires Disconnect
  to change storage. Changes keeps its per-board rows with a clearer hierarchy and no repetition
  of connection details.
- Add a per-project worktree policy with three states — **Ask**, **Always create**, and
  **Never** — chosen with a segmented control in the project editor. Always create starts a
  task's first execution on the derived default worktree without asking. Never uses the base
  project, stops withholding the conversation start action, and stops showing the missing-worktree
  notice. Ask preserves today's behavior. The policy is local to the installation and is
  reflected in the drawer's worktree notice and in the Git section.
- When the policy cannot be honored because a worktree destination cannot be derived, the
  execution preparation falls back to asking, with the failure visible.

## Capabilities

### New Capabilities

None. Every behavior this change introduces belongs to a capability that already owns the
surface being changed.

### Modified Capabilities

- `kanban-board`: the configuration section row and its navigation; the Boards section with the
  stacked board configuration overlay; a stable configuration-overlay size; the board default
  model control.
- `hubs`: the Hub section of the configuration dialog keeps only identity and a separated
  danger zone.
- `hub-sharing`: Team Settings is presented as Connection and Changes sub-tabs, with the
  Connection area grouped into status and management panels.
- `worktree-management`: the missing-worktree notice and the worktree question before a first
  execution honor the project's worktree policy.
- `project-contexts`: project registration carries the local worktree policy.

## Impact

- **Client**: the configuration shell and its section list; the Hub section; a new Boards section
  and board overlay; Team Settings areas; the project editor; board defaults; the execution
  preparation gate and dialog; the drawer's worktree notice; the Git section; the shared modal
  and the segmented control.
- **Domain and host**: project input validation and the stored project record; the shared
  worktree-decision helper; first-execution planning; the host's worktree-decision invariant and
  automatic first execution. No new command and no storage document version changes.
- **Docs**: `docs/operations.md` still points at the Board section.
- **Tests**: the client configuration-shell, board-scope, board-defaults, project-editor,
  execution-preparation and drawer suites, and the browser configuration-layout, board-model,
  publishing and project-editor-appearance specs, plus the end-to-end templates that open the
  configuration at a named section.
