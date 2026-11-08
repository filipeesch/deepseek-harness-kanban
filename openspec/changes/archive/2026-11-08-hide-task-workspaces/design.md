# Design

## Context

See `proposal.md` for the motivation and the spec delta for the required behavior. The current implementation provisions native workspaces inside `KanbanApp`: `ensureProjectWorkspace` and `ensureWorktreeWorkspace` call `WorkspacePort.ensure(path, title)`, `reconcileWorkspaces` repairs workspaces on startup, and `cleanupWorktreeWorkspace` removes an owned worktree registration on task deletion. `WorkspacePort` is a narrow adapter over `ctx.workspaceRegistry` in the host plugin.

Two constraints shape the implementation:

- The DSH workspace visibility API (`create(path, { title, hidden })`, `Workspace.hidden`, `Workspace.setHidden`) exists in the current `dsh-private` source but is not in the published SDK pinned by this repository (`@deepseek-ai/dsh-workspace@0.2.1-rc.2`, including the published `0.2.2-rc.1`) and is not in the installed DSH runtime used for local verification. The plugin must keep working on the original DSH without the API.
- The project deliberately keeps no new persisted visibility state. The existing task/project workspace binding is the only durable record available for adoption.

## Goals / Non-Goals

**Goals:**

- Register task worktree and session-directory workspaces hidden by default on hosts that expose workspace visibility.
- Hide a pre-existing worktree workspace once when the plugin adopts it for a task, using the persisted task binding as the adoption record.
- Keep the shared base-project workspace visible.
- Leave existing workspaces and pre-existing session-directory workspaces untouched; never run a retroactive migration.
- Never re-hide a workspace after a reader reveals hidden workspaces.
- Keep the plugin fully functional on DSH builds without the visibility API.
- Move the workspace policy out of `KanbanApp` without changing its constructor or the existing workspace-binding state.

**Non-Goals:**

- Hiding workspaces the plugin does not create or adopt.
- Hiding the shared base-project workspace.
- A retroactive migration, a visibility marker in `KanbanMeta`, or any new persisted field.
- Changing the DSH sidebar, the reveal preference, or the remote API.
- Bumping the pinned DSH SDK or the peer range in this change.

## Decisions

### 1. Detect visibility support at the adapter boundary

`WorkspacePort` gains `supportsHidden: boolean`. The native adapter detects the capability from the **Workspace entity**, not from the registry: `workspace.setHidden` is a method on the entity. It inspects a resolved, listed, or created workspace and caches the answer. When true, `ensure` calls `ctx.workspaceRegistry.create(path, { title, hidden })`; when false, it calls the legacy positional `create(path, title)` and reports `hidden: false` on every `WorkspaceInfo`. When support is still unknown because the registry lists no workspace, the first creation uses the positional API, then inspects the returned entity, repairs the title through `workspace.setTitle` when the capable registry ignored the positional title, and hides it through `workspace.setHidden(true)` when requested. `setHidden(id)` resolves the entity through the registry and delegates to its `setHidden`, no-opping when the entity has no such method.

The published SDK has no `hidden` type, so the adapter uses a small local structural interface for the new members and a runtime guard. The type cast is deliberately confined to `src/host/native.ts`; the rest of the plugin consumes the stable `WorkspacePort` contract.

*Alternatives considered:* raising the SDK and peer-dependency ranges to a release that contains the API (blocks the change until DSH publishes and drops older hosts, contrary to the compatibility requirement); pinning the local checkout (not installable for users). Both are rejected for this change.

### 2. One owner for workspace provisioning: `WorkspaceCoordinator`

Create `src/host/workspace-coordinator.ts` with the responsibility currently spread across four `KanbanApp` methods:

```ts
class WorkspaceCoordinator {
  ensureProject(hubId: string, project: Project): Promise<string | undefined>;
  ensureTaskWorkspace(hubId: string, task: HubTask, project: Project): Promise<string | undefined>;
  reconcile(): Promise<void>;
  cleanup(task: HubTask): Promise<void>;
}
```

It depends on `WorkspacePort`, `SessionPort`, a narrow binding store (read tasks/projects, persist project/task workspace ids, read the current workspace state), and the existing `report` callback. `KanbanApp` keeps its public constructor and delegates. The coordinator follows the same composition style as `WorktreeCoordinator`: ports and callbacks in, policy inside, no knowledge of the plugin lifecycle.

*Alternatives considered:* keeping the private methods (smaller diff, but keeps the policy spread through a large class); putting the hiding policy in the port adapter (hides product behavior in an adapter and makes it harder to test the adoption rules independently). Both are rejected.

### 3. Asymmetric adoption reflects the available durable record

- **Worktree adoption:** a task has a persisted `worktreeWorkspaceId`/`worktreeWorkspaceOwned` pair. When the coordinator resolves a worktree workspace for the first time (`owned: false`, no binding yet), it calls `setHidden(true)` once, then persists the binding. Later reconciles return early on the persisted id, so a reader reveal is respected.
- **Session-directory adoption:** the plugin has no per-session workspace binding. Hiding such a workspace on every reconcile would undo a reveal; hiding it only once would require the state the project explicitly rejected. The coordinator therefore hides only session-directory workspaces it creates. A pre-existing session-directory workspace is reused with its current visibility.
- **Project workspace:** the shared workspace is created or adopted visible and is never marked hidden. If the resolved workspace reports hidden, the coordinator reveals it when the capability exists, because the project workspace is intentionally visible.

*Alternatives considered:* a durable set of already-hidden workspace ids (rejected: new state); reapplying `setHidden` on every reconcile (rejected: undoes the reveal); hiding session-directory adoptions on every startup (same problem). The asymmetry is the direct consequence of the no-new-state decision.

### 4. Creation and adoption are separate operations

`WorkspacePort.ensure(path, options?)` creates with the requested visibility and returns the existing record unchanged, matching DSH's idempotent `create`. Adoption hiding is an explicit `setHidden` call made by the coordinator, not a side effect of `ensure`. This keeps `ensure` idempotent and makes the "hide once, at the binding moment" behavior explicit.

`WorkspaceInfo` gains `hidden: boolean` so the coordinator can avoid redundant writes and tests can assert the resulting state.

### 5. Best-effort hiding never blocks work

`ensure` failures still fail conversation creation, as today. A `setHidden` failure is different: it is presentation-only, so the coordinator catches it, sends it to `report`, and continues. The workspace remains visible. The binding is still persisted, so a later reconcile does not retry or re-hide it; this is consistent with the no-new-state decision.

*Alternatives considered:* failing the conversation when `setHidden` fails (rejected: a sidebar preference must not block the task); retrying on reconcile (rejected: conflicts with never re-hiding and has no state to distinguish a retry from a reveal).

### 6. Compatibility fallback is observable and quiet

On a host without the API, conversations are created exactly as before, with the positional call and visible workspaces. No warning is emitted per conversation; the capability is a property of the host, not a per-conversation error. This preserves the "works on original DSH" requirement and avoids noisy logs.

### 7. Reconciliation only repairs; it does not migrate

`reconcile` runs the same `ensureProject`/`ensureTaskWorkspace` paths for tasks with sessions and ensures a workspace for each session directory. Because `ensure` never changes an existing workspace's visibility and bound task workspaces return early, reconciliation cannot re-hide a task workspace. The shared project workspace is the explicit exception: a hidden project workspace is revealed because the project workspace is intentionally visible. There is no migration pass, no `KanbanMeta` field, and no one-time flag. Existing workspaces keep their state.

## Risks / Trade-offs

- **Workspaces created before this change stay visible** -> Accepted and documented; the change improves new cards only. The spec's "do not hide retroactively" scenario makes this explicit.
- **Pre-existing session-directory workspaces stay visible** -> Accepted consequence of having no binding and no state; the coordinator hides only what it creates.
- **The first creation on a capable host with an empty registry can be briefly visible** -> Support is unknown until an entity exists; the adapter creates positionally, repairs the ignored title, and hides the entity immediately. The durable end state is correct; only that first creation can flash a row.
- **The project workspace still adds one sidebar section per project** -> Accepted by decision; the project workspace is the visible base for tasks without a worktree.
- **Temporary structural cast in the native adapter** -> Confined to one file, covered by tests for both supported and unsupported hosts; remove it when a published DSH SDK exposes the API.
- **A failed hide leaves a visible workspace and is not retried** -> Reported through `report`; consistent with best-effort and no visibility state.
- **Race when two tasks create the shared project workspace concurrently** -> `WorkspaceRegistry.create` is serialized and idempotent; the existing ownership race is unchanged. The coordinator does not add a new write to that path.
- **Rollback does not reveal workspaces hidden by the new version** -> The reader can reveal them from the DSH sidebar; the plugin stores no visibility state to roll back.

## Migration Plan

1. Ship the plugin with the new coordinator and capability detection.
2. On a capable host, new task workspaces are created hidden; existing workspaces are untouched.
3. On the original DSH, the positional path keeps every workspace visible and the board works as before.
4. Rollback: install the previous plugin version. No data migration is required; workspaces hidden by the new version remain hidden until a reader reveals them.

## Open Questions

None.
