# Design

## Context

See `proposal.md` for motivation and `specs/task-conversations/spec.md` for the behavior contract.

The plugin currently derives a task's conversation lineage only from retained `sessionIds` plus native descendants whose session header records `origin: subagent`. The native session header uses `parentSession` for seed lineage and reserves `origin` for subagent children, so a fork is a session with `parentSession` set, `origin` absent, and `isSeeded: true`. The plugin has no host listener that reacts to a new session, which is why a fork never reaches `sessionIds`.

The native branch action (`forkAt`) is internal to the host chat view: it always calls `sessions.fork`, then navigates to the child. It is not a slot the plugin can replace, and the `session/fork` access is not session-scoped. Adoption must therefore observe the fork host-side rather than intercept the action.

Two native constraints shape the approach:

- `SessionHeader.cwd` is immutable creation metadata. `WorkingDirectoryService.set` changes the effective directory only, appending a `working-directory/change` event and a notice; it is a no-op when the path is already current. The plugin already uses this alignment after creating a conversation.
- `WorkspaceEntity.attachSession` validates `header.cwd` against the workspace path. A migrated conversation's fork cannot be attached to the task's native workspace even after its effective directory is aligned.

## Goals / Non-Goals

**Goals:**

- Associate a fork of a task conversation with that task through the existing conversation-retention path, with no new command and no client UI.
- Keep the ownership model single-valued: once adopted, a fork is an ordinary task conversation.
- Keep the plugin entry thin: the coordinator is an isolated unit with injected ports, independently testable.
- Never fail, cancel, or roll back the native fork because adoption failed.

**Non-Goals:**

- Intercepting, replacing, or suppressing the native branch action, or changing the host navigation that follows it.
- Repairing the native workspace grouping of an adopted fork.
- Retroactively scanning and adopting historical forks at startup.
- Adding any tool, command, or board control for forks.

## Decisions

### 1. Observe `agent/created`, not `session/created`

In `initializeAgent` the host enters and announces the session (`session/created`) before it enters and announces the agent (`agent/created`). Adoption may need `SessionPort.setDirectory`, which resolves a live agent, so a `session/created` listener would race an unpublished agent and need retries or arbitrary delays. `agent/created` fires with the agent already entered and the session fully initialized. The listener must return `undefined` synchronously and run adoption as a detached promise, because `agent/created` is a serial hook that creation awaits and a rejection would fail agent creation.

Alternative considered: `session/created` plus a deferred microtask or retry. Rejected because it encodes timing assumptions that the serial hook removes.

### 2. Fork predicate lives in the domain, based on the direct parent

A fork is recognized by `header.parentSession !== undefined && header.origin !== 'subagent'`. Adoption additionally requires that the direct parent session is currently retained by a task, which keeps forks of subagent descendants and forks of untracked sessions foreign, matching the lineage rule. `clear` and `compact` cannot produce false positives: the agent loop announces fresh sessions as `startup` and resumes as `resume`, and neither creates a session with `parentSession`.

Alternative considered: adopt any session whose ancestry reaches a task conversation. Rejected because it would turn subagent forks into tabs and contradict the peek model.

### 3. A dedicated coordinator with narrow ports

A `ForkAdopter` receives `locate(sessionId)`, `directory(sessionId)`, `setDirectory(sessionId, path)`, `attach(hubId, taskId, sessionId)`, `sleep(milliseconds, signal)`, and `report(error)`. A thin `registerForkAdoption(ctx, ports)` function subscribes and disposes. The coordinator depends on interfaces, not on `KanbanApp`, `HubRepository`, or cordis, so it is unit-testable without a host.

Alternatives considered: a method on `KanbanApp` (grows an already large class and couples adoption to command serialization) and a client-side observer issuing a command (duplicate state, extra round trip, and the client can miss sessions created by another client).

### 4. Adopt only after aligning the effective directory

Adoption reads the fork's effective directory and calls `setDirectory` only when it differs from `task.effectiveCwd`. A missing or failing alignment leaves the fork foreign and reports the failure. This mirrors `createConversationNow`, avoids an adopted conversation that the execution guard would reject, and avoids a directory-change notice when the paths already match.

Alternative considered: adopt as-is and let the execution guard fail on send. Rejected because it produces a conversation tab the user cannot use.

### 5. Attach through the existing conversation-retention transaction

Adoption calls the same `HubRepository.addSession` transaction as explicit conversation creation. That transaction already rejects a session associated with any task, rejects an in-progress context operation, increments the Hub revision, and notifies subscribers, so the board snapshot advances without a new notification path. Idempotency comes from resolving the child session first: an already-associated session is skipped.

Alternative considered: a new `conversation.adopt` command. Rejected because the host, not the client, owns the event, and a command would add a second write path with the same invariants.

### 6. Bounded retry while the task is busy, then report

A rejected `TASK_BUSY` is retried on an injected sleep with a short, bounded attempt budget tied to the plugin lifetime signal. After the budget, the failure is reported and the fork stays foreign. No persistent queue is introduced.

Each attempt re-resolves the direct parent task and re-applies the directory alignment, because a pending switch can change the task's effective directory before the retry. The attachment transaction also receives the expected effective directory and rejects `CONTEXT_CHANGED` when the task moved in between, mirroring the explicit conversation-creation check.

Alternative considered: an unbounded queue that retries on every Hub change. Rejected because it adds durable-ish state and reconciliation for a transient condition.

### 7. No client change

The conversation tab strip already derives from `task.sessionIds`. The adopted fork is appended, stays unselected, and navigates natively. No new surface, command, or selection heuristic is added.

### 8. Adoption failures never veto the fork

The coordinator catches and reports every failure. The listener never throws, never rejects the serial hook, and never calls a native archive or directory change on failure beyond the alignment attempt that precedes attachment. A fork is always usable as a native conversation.

## Risks / Trade-offs

- [Native workspace grouping cannot be repaired for a migrated conversation's fork] → documented limitation; the effective directory is aligned so Kanban executes correctly, and only the native sidebar grouping can differ.
- [The fork inherits the `kanban-task` context message and any open structured question from the forked prefix] → accepted native branch semantics; the plugin adds no special case, and the first-turn injection already skips a session with a durable user message.
- [Adoption is asynchronous, so a tab can appear a moment after the host opens the native session] → the Hub revision bump publishes the tab on the next follow frame; no user-visible failure.
- [A fork created while the plugin is unloaded is adopted only when resumed] → consistent with the decision to adopt on create and resume; there is no startup sweep.
- [Adopted forks change ownership: they no longer block worktree cleanup and are archived with the task] → intended; unadopted forks still block, and the existing sharing tests keep covering the foreign case.
- [The retry timer could outlive the plugin] → the wait is bound to the plugin lifetime signal and the registration disposes the listener.

## Migration Plan

No data migration. The behavior applies prospectively: new forks are adopted on creation, and forks created before this version are adopted when they are resumed. Rolling back the code is safe: previously adopted sessions stay in `sessionIds` and continue to behave as ordinary task conversations; no destructive cleanup or data rewrite is required.

## Open Questions

None.
