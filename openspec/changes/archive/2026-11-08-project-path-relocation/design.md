# Design

## Context

See [proposal.md](proposal.md) — Why. The constraints that shape this approach:

- Saving a project rejects a project path or Git root change while the project has tasks ([`src/domain/project-registration.ts`](../../../src/domain/project-registration.ts) `assertProjectConversion`), and the rejection is required by the current `project-contexts` spec.
- Task deletion resolves the base project directory for every deletion, including one without a worktree ([`src/host/destructive-operation.ts`](../../../src/host/destructive-operation.ts)), through `GitAdapter.projectDirectory` and the canonical `realpath` in [`src/host/git.ts`](../../../src/host/git.ts). A moved directory therefore fails the queued preflight with `PATH_UNAVAILABLE`, and retry repeats it.
- Destructive work already has the pattern this change reuses: persisted-state admission, a durable journal on the owner record, a per-repository lane in `OperationQueue`, event-driven resume, and background phases ([`src/host/worktrees.ts`](../../../src/host/worktrees.ts), [`src/host/destructive-admission.ts`](../../../src/host/destructive-admission.ts), [`src/host/operation-queue.ts`](../../../src/host/operation-queue.ts)).
- A project record is a plain value in `HubState` with no operation state ([`src/shared/types.ts`](../../../src/shared/types.ts), [`src/domain/schema-parts.ts`](../../../src/domain/schema-parts.ts)). Projects are not part of a shared Hub document; only boards are published by team storage.
- Host behavior limits what a migration can promise. Native workspace membership is validated from the session header, so a conversation that joined the previous project workspace keeps that grouping after its effective directory changes. `workingDirectory.set` changes one session's effective directory, requires that session to be idle, and leaves sandbox writable roots anchored to the original project.
- The Git port exposes `branches`, `inspect`, `create`, `remove`, `assertPolicy`, and `projectDirectory` only; the host sandbox policy of the task conversations governs Git writes.

## Goals / Non-Goals

**Goals**

- Remove the deadlock with two independent seams: deletion that never depends on a resolvable project directory, and a durable relocation that repairs the project.
- Keep one journal, one recovery model, and one serialization unit for all slow context work.
- Keep each collaborator narrow: a pure relocation plan in the domain, a coordinator for IO, a target resolver for deletion, and presentation-only client components.
- Ship the deletion fix first inside the same change so the reported incident can be verified before relocation lands.

**Non-Goals**

- Rolling a relocation back, or returning a project to a previous location after migration starts.
- A durable record of retained checkouts across restarts.
- Detaching, moving, or removing worktrees because of a relocation.
- Verifying repository identity (remote URL) during relocation.
- Changing DSH sandbox anchoring, workspace membership, or session header semantics.
- Extracting the `KanbanApp` command switch, or adding a new dependency.

## Decisions

### 1. Two task groups: deletion tolerance first, relocation second

The deletion group changes only the destructive path and the four approved cleanups. The relocation group adds the project operation. They share the `OperationQueue` rename but no phase or journal code, so the first group can be implemented and verified on its own inside the same change.

**Alternative rejected:** a single group, which would make the incident fix wait for the much larger relocation work and hide a failure in either area behind the other.

### 2. The relocation journal lives on the project

`Project` gains an optional `operation` field. Absence means no relocation, so every existing project literal and every existing persisted record stays valid without a data version bump. The record holds the operation id, the previous location (`projectPath`, `gitRootPath`, `defaultBranch`), the confirmed target (`ProjectInput`), the phase, the recorded problem, the migrated session ids, and the creation time.

Recording both the previous and the target location is what makes retry idempotent: after the project record changes, the previous path is still available to identify tasks and sessions that have not migrated yet.

**Alternatives rejected:** a Hub-level relocation field (serializes unrelated projects and mixes operation state into the aggregate); a separate storage record (new persistence, resume, and cleanup for one rare operation); storing only the target (a retry could not tell which tasks still need migration).

### 3. Admission is persisted-state only; the lane owns the authoritative preflight

`project.relocate` validates the target path and Git root and the task preconditions, records the operation with `phase: 'queued'`, enqueues it in its repository lane, and returns. It performs no native session read, no Git inspection beyond the location validation the save path already performs, and no workspace provisioning.

The lane job starts with the authoritative preflight: the project still has the same recorded operation, no task of the project has an unresolved operation or a pending transition, and every conversation is idle. The preflight re-reads that task state inside the lane, so a stage transition admitted while the relocation waited defers it to `waiting` instead of failing it. A busy conversation moves the operation to `waiting` and returns; native activity events resume it, exactly like a destructive operation. When migration is reached, the order is project and base-task locations, worktree repair and revalidation, conversation directories, then the workspace binding, so every conversation moves to its final directory. This is why the earlier "reject while a conversation is active" rule is replaced by waiting: the journal already provides the place to wait.

**Alternative rejected:** a synchronous command. It would hold the serialized command lane for native directory work and would have to be either partially applied on failure or rolled back, both of which the host cannot do safely.

### 4. One queue, injected by the app, with an honest owner field

`OperationQueue` moves from `WorktreeCoordinator` ownership to the app, which injects the same instance into `WorktreeCoordinator` and the new `ProjectRelocationCoordinator`. A relocation and a destructive operation for the same repository therefore share a lane without duplicating lock logic, while different repositories still progress independently.

The queue's `taskId` field becomes `ownerId`, because it now identifies either a task or a project. This is a mechanical rename in the queue, the worktree coordinator, and the fakes.

Resume and shutdown change accordingly: the app enumerates task and project operations when pending work is triggered, and `close()` disposes both coordinators before awaiting the shared queue settle.

**Alternatives rejected:** a second queue with a cross-queue lock (two serialization mechanisms for one repository); routing relocation jobs through `WorktreeCoordinator` (it would own a lifecycle it does not understand).

### 5. Phases are forward-only and every step is idempotent

The recorded phases are `queued`, `preflight`, `waiting`, `migrating`, `worktrees`, `sessions`, `workspace`, and `failed`. A failure records its phase and problem. There is no rollback phase; the target is the user's repair, and the previous directory usually no longer exists.

Idempotency rules:

- **Migrating**: apply the target project location only when the stored location still equals the recorded previous location. Rebase tasks only when the task's effective directory equals the recorded previous project path or the previous worktree-derived directory, then set the new one. A relocated task no longer matches, so a retry skips it.
- **Worktrees**: the plan decides which bindings are revalidated (a folder-project target keeps a retained plain checkout), repair and revalidation run before conversation migration, so a worktree task's effective directory is final before any session moves.
- **Sessions**: a session already at its target directory is recorded without a repeated native write; `migratedSessionIds` keeps progress visible and limits work on a retry.
- **Workspace**: `ensure` for the new path is find-or-create, so a retry reuses the workspace it created.

Cancellation is a command that clears the operation. The operation records `started` in the same transaction that first applies the project location, and a cancel is rejected once that record exists, even when the phase returns to `waiting` for a busy conversation. Before every write the lane re-reads the operation and stops when it is no longer the recorded operation, so a cancel that wins the race leaves the project untouched. Cancel is offered only while `started` is false.

**Alternative rejected:** compensating writes to undo a partial migration. They would need the previous directory to exist and would rewrite conversation directories again, with a second chance to fail.

### 6. A pure relocation plan in the domain, IO in the coordinator

`src/domain/project-registration.ts` keeps association policy and adds a pure plan: given the recorded previous location, the confirmed target, the project, and its tasks, return the per-task target directory and the tasks to skip. The domain never resolves a directory, inspects Git, or touches a session.

`ProjectRelocationCoordinator` owns the journal writes, the lane job, native session directory changes, workspace binding, and worktree repair. It depends on narrow ports: a project store (`locate`, `all`, `transactProject`), `SessionPort`, `GitPort`, `WorkspacePort`, the shared queue, clock, and a report callback.

**Alternatives rejected:** planning inside the coordinator (untestable mapping mixed with IO); a single relocation service with Git, session, workspace, queue, and journal logic (a god class).

### 7. Deletion target resolution is extracted from the destructive execution

A small resolver replaces the unconditional `git.projectDirectory` call in `DestructiveExecution`. Its inputs are the task, project, request, and recorded operation; its output is:

- `directoryTarget`: the directory conversations must return to, present only when the task has an associated worktree and the base directory resolves.
- `checkout`: `remove` when the worktree can be inspected and removed, `retain` when the project path or Git root cannot be resolved, or `none` when the task has no worktree.

When the resolver reports `retain`, execution skips the directory switch and the Git removal, sets `gitCompleted`, archives the conversations, and completes the task deletion. The retained path travels to the client as described in decision 8. A return that fails for any other reason keeps today's behavior: the worktree and recovery information are retained and deletion is not reported as successful.

**Alternatives rejected:** a special-case `if` inside `drive()` (the method already owns preflight, Git, sessions, and journaling); deleting an unverifiable checkout without Git (unsafe and untruthful).

### 8. Retained checkouts are published through a transient snapshot projection

The client cannot discover that a Git context is unresolvable, and admission is persisted-state only, so the host publishes retained checkouts itself. `HostSnapshot` gains an omitted-when-empty, in-memory `retainedCheckouts` list of `{ path, projectId, taskTitle }`. The host appends an entry when a deletion retains a checkout because its project path or Git root cannot be resolved. The client renders it in the existing destructive-operation notice and dismisses it locally by path for the session, matching today's retained plain-checkout behavior.

**Alternatives rejected:** a durable Hub field (new schema, dismiss command, and permanent clutter for a rare event); a client-side prediction (the client cannot stat the filesystem); logging only (the user must know a directory remains).

### 9. Workspace rebinding keeps the previous registration

The relocation ensures a workspace whose canonical path is the new project path and updates the project's workspace binding to it. It never renames or deletes the previous project workspace registration. The host keeps the previous conversations grouped under that record because membership is header-based, and a reader can remove the stale registration from the host UI if desired.

This is a deliberate acceptance of a host truth rather than a plugin workaround: deleting the previous registration would leave those conversations ungrouped and the host would not adopt them into the new workspace.

### 10. Worktree repair is an explicit Git port method and is best-effort per binding

`GitPort` gains `repair(project, worktreePaths, sessionIds, signal)`. `GitAdapter` canonicalizes the paths, restricts the repair to existing checkouts, asserts write policy over the common Git directory and each checkout, runs `git worktree repair` from the project root, and the coordinator revalidates each binding with `inspect`. The coordinator repairs one checkout at a time with that task's own conversation policies; a task with no conversation skips the repair rather than widening to the host write policy.

A repair failure or an absent checkout records an error on that binding with the typed problem and does not fail the relocation. The repair runs under the task sessions' existing policy, matching `remove`; it never bypasses a host denial. Passing no session ids would fall back to the host policy used for lazy tasks, but that would silently widen write access for an existing task, so it is rejected.

**Alternatives rejected:** repairing inside `inspect` (a read operation must not write); calling Git outside the port (no policy enforcement); treating a failed repair as a relocation failure (the user's project path repair should not depend on a checkout that may be gone).

### 11. Blocking is a project guard, not a task guard

A small project guard, evaluated at command admission, rejects execution, conversation creation, worktree creation/attachment/removal/return, project save, and project deletion for a project with an unresolved relocation. Task text edits, notes, and stage moves are not blocked because they do not depend on a directory or compete with the journal.

**Alternatives rejected:** extending `assertContext` (it is a per-task operation guard and does not know about project state); blocking every command of the project (freezes the board for an indefinite wait).

### 12. The editor routes relocation and the client computes the impact

The project editor keeps `project.save` for unchanged locations and for projects without tasks. When a project with tasks submits a different project path or Git root, the editor opens a confirmation component listing the impacted tasks, conversations, worktree bindings, and active conversations, all derived from the current snapshot and attention facts. Only the confirmation sends `project.relocate` with `confirmed: true`.

The Projects row presents progress, failure, retry, and cancel before the first write. The board gets a compact informational notice with retry, reusing the existing destructive-notice visual pattern but as a separate component so the destructive notice keeps one meaning.

**Alternatives rejected:** a host read command for the impact (duplicates snapshot data and adds a contract); an unconditional save (a large side effect without confirmation).

### 13. Path resolution and save validation have one owner

`KanbanApp.project()` currently repeats canonicalization, directory checks, Git root containment, and probe invocation that `HostProjectProbe` already performs, and a missing path leaks a raw `realpath` error. The save path delegates to the probe and to a single directory resolver; `canonicalPath` and the probe's directory probe share the same resolver and `PATH_UNAVAILABLE` problem shape.

**Alternative rejected:** keeping two resolvers (they already differ in message and details, which is what made the failure hard to diagnose).

### 14. Persisted schema stays version 2

`project.operation` is optional and strict-object compatible, so stored records without it remain valid and no `DATA_VERSION` change or migration is required. `buildProject` preserves an existing operation so a registration save cannot silently drop a journal. The publish document is untouched because projects are not shared.

**Trade-off:** an older plugin reading a record that contains a project operation fails strict validation. Downgrades are unsupported, and the migration plan states that an unresolved relocation must be completed or cancelled before a downgrade.

## Risks / Trade-offs

- **Sandbox roots stay anchored to the original project.** After a relocation, an existing conversation can use the new directory but its writable roots still describe the old one; in a confined mode a later Git write may be denied. Mitigation: never bypass the policy; surface the denial; a conversation created after the relocation joins the new workspace and policy. The design accepts that the host, not the plugin, owns this anchoring.
- **Previous conversations keep the previous workspace grouping.** Mitigation: keep the previous registration, document it in the Projects and Git surfaces as a host limitation, and let the reader remove it.
- **The impact preview can be stale.** It is computed from the last snapshot. Mitigation: the host revalidates every precondition in admission and preflight, and the confirmation never claims an outcome the host has not recorded.
- **A relocation can wait indefinitely on a long-running conversation.** Mitigation: the state is visible in Projects and on the board, and cancel is available before the first write.
- **A repair can be denied by host policy.** Mitigation: it is best-effort per binding, records the real denial, and does not fail the relocation or claim the checkout was repaired.
- **Cancel racing the lane.** Mitigation: the lane re-reads the recorded operation before every write and stops when it changed; cancel is only offered before the first write.
- **A large project makes the migration slow.** Mitigation: the work is off the command lane, progress is published, and each step is resumable.
- **Retained checkouts disappear on restart.** Accepted: the notice is transient by decision, and the checkout remains on disk with its path recordable from the drawer before the task disappears.

## Migration Plan

1. Ship the plugin version that contains both task groups; no data migration runs.
2. Existing projects have no `operation` field and behave exactly as before.
3. Existing deletion behavior is unchanged except where the project context is unresolvable.
4. A downgrade is not supported while a project records a relocation; complete or cancel it first, because the previous plugin validates the project shape strictly.
5. Verification: domain plan and policy unit tests, host coordinator tests with the fake Git, session, and workspace ports, browser tests for the editor confirmation and both notices, and the isolated `deletion` and `project` e2e lanes, including a repository moved on disk.

## Open Questions

None. Every decision that would change the specs, the approach, or the task breakdown was resolved before this design.
