# Proposal: Hubs, Boards, and Per-Board Workflows

## Why

The plugin now has one global board, one global workflow, and one global project registry. That model works for a single stream of work, but it cannot separate unrelated project families, parallel delivery flows, or the workflows they need. Railyin solves this with a workspace hierarchy; DSH already uses "workspace" for native session and file grouping, so this change introduces a separate, logical **Hub** instead of overloading that term.

## What Changes

- **BREAKING** Replace the single global board with Hub-scoped boards. A Hub owns its project registry and zero or more boards. A board owns its name, its tasks, and its own workflow YAML. Tasks belong to exactly one board and one project in the same Hub and never move between boards or Hubs.
- Add a Hub model with a name only. Hubs are purely logical: they have no filesystem root, do not map to a native DSH workspace, and do not change project paths, Git roots, worktrees, sessions, or sandbox behavior.
- Add Hub and board navigation: Hub tabs at the top of the Kanban page, board tabs inside the active Hub, and persistence of the active Hub and board in `localStorage`. A Hub with no boards shows a create-board empty state.
- Add aggregated attention to Hub and board tabs. The Hub tab aggregates unread and execution facts from all of its boards; the board tab aggregates the tasks of that board.
- Add Hub and board lifecycle rules: a board can be deleted only when it has no tasks; a Hub can be deleted only when none of its boards has tasks, removing its empty boards and task-free projects; the last Hub cannot be deleted.
- **BREAKING** Change the persisted state to Hub-scoped aggregates with a per-Hub revision. Migrate the existing workflow, projects, tasks, and notes into a default Hub named `My Hub` and one board named from the current workflow (or `Kanban` for a new installation), without recadastramento and without changing native sessions or worktrees.
- Keep the worktree base path global. It is no longer described as a board setting.
- **BREAKING** Rework board tools around the board as the discovery anchor. Add `list_hubs`; require a Hub for board discovery and a board for task-scoped reads and writes. In a task conversation the board is inferred from the task; ordinary chats must discover and pass IDs. Hub/board administration remains UI-only.
- Update the configuration experience to cover global settings, Hub settings, Hub projects, and the active board's workflow. The General section remains the default and holds the global worktree base path.
- Update the first-turn task context to name the task's Hub and board so agents can use board-scoped tools without inferring context from the native workspace.
- Add the automated verification for this change inside the same change: module-level in-memory suites for schemas, operations, repository, and migration; host integration for commands, tools, attention, and task context; client jsdom for navigation, configuration, and selection; browser navigation and tab-appearance specs; and one release-gate e2e for Hub/board isolation. The existing suite is migrated mechanically as part of implementation; no test-specific capability spec is added.

## Capabilities

### New Capabilities

- `hubs`: Hub as the logical segregation boundary, including Hub ownership, lifecycle, selection and persistence, migration/bootstrap, and aggregated Hub attention.

### Modified Capabilities

- `kanban-board`: multiple boards per Hub, a workflow owned by each board, board selection, and task creation and filtering scoped to the active board.
- `project-contexts`: projects are registered and owned inside a Hub, tasks and boards resolve within that Hub, and Hub/project context is never inferred from a native DSH workspace.
- `harness-navigation`: the Kanban page hosts Hub and board tabs and configuration sections for General, Hub, Projects, and Board.
- `product-tools`: board-anchored discovery through `list_hubs` and `list_boards`, required board scope for task tools in ordinary chats, and no Hub/board administration tools.
- `task-conversations`: first-turn task context includes the task's Hub and board names.

## Impact

- **State and storage**: `BoardState` v2 becomes Hub-scoped state (`HubState` with projects, boards, tasks, and notes). A new per-record storage domain holds one record per Hub plus global settings. The existing `kanban` domain is read once for migration and left untouched as a backup.
- **Host**: `KanbanApp` becomes a coordinator over Hub repositories and command handlers; `BoardStore` is decomposed into a Hub repository/store and domain mutation modules. Attention, task lookup, native workspace reconciliation, and execution guards must resolve tasks across Hubs.
- **Client**: `BoardView` is split into a Hub page shell and a board surface; configuration is split into global, Hub, project, and board sections. New tabs, create/rename/delete dialogs, empty states, and persisted selection.
- **Tools and contracts**: the snapshot, command, and tool schemas change. The remote snapshot/command contract changes, and the persisted state moves to a new domain. Existing agent instructions that omit a board ID must be updated.
- **Compatibility**: no new dependency and no DSH core change. Native DSH workspaces, sessions, worktrees, sandbox policy, and execution remain owned by the host. The previous plugin version can still read the untouched legacy domain, but changes made after migration are not visible to it.
- **Verification**: automated verification is part of this change. Module-level in-memory tests cover the domain, repository, and migration without a DSH host; host integration covers commands, tools, attention, and task context; client jsdom and browser specs cover tabs, selection, configuration, and tab appearance; one release-gate e2e covers Hub/board isolation in the real composition. The existing suite is migrated mechanically so `pnpm check` stays green.
