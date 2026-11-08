# Proposal

## Why

A project's directory can move outside the plugin, and today that produces a deadlock: saving a different project path is rejected while any task references the project, and deleting those tasks fails with `PATH_UNAVAILABLE` because deletion resolves the base project directory or Git root before doing any work. The user cannot repair the path and cannot remove the tasks that block the repair.

## What Changes

- Task deletion becomes tolerant of an unresolvable project context. It resolves the base project directory only when something must be returned there, and treats an unverifiable Git checkout as retained rather than removed.
- A completed deletion that could not verify or remove a checkout reports the retained path in the existing board destructive-operation notice.
- **BREAKING (protocol)**: `project.save` keeps rejecting a project path change while the project still has tasks; the editor routes that change to a new `project.relocate` command instead.
- New `project.relocate` command: a durable, journaled, background relocation of a project with its tasks and conversations.
  - Validates the new location by shape only; a Git-backed project must remain Git-backed and inside a valid Git root.
  - Records the operation on the project before any slow work and returns without holding the command lane.
  - Executes in the repository lane: preflight, wait for every conversation to be idle, then migrate the project, the tasks' effective directories, the conversation directories, the project workspace binding, and the worktree bindings.
  - Rebinds the project to a workspace for the new path and keeps the previous workspace registration intact.
  - Repairs linked worktrees when possible and revalidates every worktree binding; a binding that cannot be verified records an error and does not fail the relocation.
  - Supports retry only, and cancellation only before the first write. A relocation never rolls back.
- While a relocation is pending or failed, the project blocks task execution, conversation creation, and worktree operations; editing task text, notes, and stage movement stay available.
- The Projects section shows relocation progress, failure, retry, and cancellation, and the board shows a compact notice while a relocation is waiting or failed.
- The project editor asks for confirmation with the migration impact when the path of a project with tasks changes.
- Cleanups inside the touched code: project save validation delegates to the project probe instead of repeating path canonicalization and containment; the deletion target resolution is extracted from the destructive execution; `PATH_UNAVAILABLE` uses one canonical resolver; project registration keeps association policy separate from the relocation plan; the operation queue renames its owner field from `taskId` to `ownerId`.

## Capabilities

### New Capabilities

- `project-relocation`: the `project.relocate` command, its durable journal, phases, wait-for-idle behavior, migration of project paths, task effective directories, conversation directories, workspace binding, worktree repair and revalidation, retry/cancel semantics, project-level blocking, and its progress surfaces.

### Modified Capabilities

- `project-contexts`: project registration validation routes a path change through relocation instead of rejecting it outright, and keeps a direct save change rejected while tasks exist.
- `task-lifecycle`: task deletion completes when the project directory or Git root cannot be resolved, retaining an unverifiable checkout instead of failing the deletion.
- `harness-navigation`: the Projects section presents relocation progress, failure, retry, and cancellation, and the project editor confirms a path change with its migration impact.
- `kanban-board`: the destructive-operation notice reports a checkout retained because its Git context could not be verified, and the board presents a compact notice while a project relocation is waiting or failed.

## Impact

- Host: `src/host/app.ts`, `project-probe.ts`, `destructive-operation.ts`, `worktrees.ts`, `operation-queue.ts`, `repository-lane.ts`, `workspace-coordinator.ts`, `git.ts`, and a new relocation coordinator.
- Domain and shared: `src/domain/project-registration.ts`, `hub-operations.ts`, `schema-parts.ts`, `src/shared/types.ts` (project operation, relocation command), `src/shared/ports.ts` (Git worktree repair), and `src/remote.ts` (command, snapshot, and retained-checkout wire schemas).
- Client: `src/client/projects/*`, `src/client/settings/configuration.tsx`, `src/client/board.tsx`, `src/client/destructive-notices.tsx`, and a project relocation notice.
- Persisted data: a new optional `operation` field on the project record. Existing records remain valid; no data version bump and no sharing document change, because projects are not shared.
- Tests: domain policy tests, host coordinator tests with fakes, browser component tests, and the isolated `project` and `deletion` e2e lanes.
- No new dependency and no DSH host change.
