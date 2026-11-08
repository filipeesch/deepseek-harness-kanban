# Proposal

## Why

Every task conversation that the plugin provisions today gets a native DSH workspace that appears in the sidebar. A board with many cards, worktrees, and projects therefore accumulates one sidebar section per task, worktree, and session directory, even though those workspaces are implementation details of the board. DSH now supports hiding a workspace from browsing surfaces without affecting access, ordering, expansion, or session behavior. The kanban should register the task workspaces it manages as hidden by default while remaining compatible with DSH builds that do not expose the visibility API.

## What Changes

- Register task worktree workspaces hidden when the host supports hidden workspaces.
- Register session-directory workspaces hidden on creation when the host supports it.
- When an existing worktree workspace is adopted for the first time, hide it once; the persisted workspace binding records that decision.
- Keep the shared project workspace visible; it is not a task workspace.
- Do not run a retroactive migration. Workspaces created or adopted before this change keep their current visibility.
- Do not re-hide a workspace after the reader reveals hidden workspaces; startup reconciliation only creates new task workspaces hidden and never calls `setHidden` for bound workspaces.
- Fall back to the positional workspace creation API on DSH builds without `setHidden`; those builds keep every workspace visible and the board continues to work.
- Treat hiding as best effort: a failed `setHidden` is reported but never blocks conversation creation.
- Extract workspace provisioning from `KanbanApp` into a dedicated `WorkspaceCoordinator` so the visibility policy has one owner.
- Update the `project-contexts` specification and the product documentation to state the task-workspace visibility rule, the project exception, the no-retroactive-migration boundary, and the compatibility fallback.

**BREAKING**: None. The peer DSH range and the persisted board schema stay unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-contexts`: the native-workspace binding and workspace-ownership requirements gain hidden-by-default task workspaces, a visible shared project workspace, one-time adoption hiding, no retroactive migration or re-hide, and a visible fallback for hosts without workspace visibility.

## Impact

- Host: `src/shared/ports.ts`, `src/host/native.ts`, new `src/host/workspace-coordinator.ts`, `src/host/app.ts`.
- Tests: host workspace-binding and reconciliation coverage, native adapter coverage, and the `TestWorkspaces` fake.
- Documentation: `README.md`, `docs/operations.md`, `AGENTS.md`; the spec delta under `openspec/changes/hide-task-workspaces/specs/project-contexts/spec.md`.
- Dependencies: none; the plugin keeps its current DSH peer range and uses capability detection until a published DSH SDK includes the API.
- Persistence: no new board or meta field and no migration.
- Accepted scope adjustments: the shared project workspace stays visible, and workspaces created before this change are not hidden retroactively.
