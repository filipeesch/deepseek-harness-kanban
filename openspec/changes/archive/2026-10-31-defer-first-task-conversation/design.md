# Design

## Context

See `proposal.md - Why`. The relevant native constraint is that a DSH session's `header.cwd` is immutable. Kanban's directory migration calls `workingDirectory.set` and preserves the session id and history, but the header stays at the session's creation directory. Native chat resolves relative image destinations from the session list row's `cwd`, which is that header. DSH 0.2.2's `openFile` resolves relative file links from the `workingDirectory` projection, but the pinned host is 0.2.1-rc.2 and image resolution is still header-based. The plugin cannot rewrite the header or inject a different chat `cwd` without a native change.

Current code paths:

- `App.createTaskNow` creates a project workspace and a native session before saving the task, and archives the session if the save fails.
- `domain/hub-operations.createTask` and the legacy `BoardStore.createTask` require a session id and set `sessionIds: [sessionId]`.
- `App.createConversationNow` already creates a conversation at `task.effectiveCwd` through the project or worktree workspace, then associates it with the task.
- `App.runInstruction` already finds the first open conversation or creates one, so the stage-instruction path is prepared for a task with no conversation.
- The task schema currently requires at least one session id (`z.array(id).min(1)` in both `domain/hub-schema.ts` and `domain/schema.ts`).
- The missing-worktree notice's Dismiss action is local drawer state; it resets on remount/reload.

## Goals / Non-Goals

**Goals:**

- A new task has no native conversation or native workspace until its first conversation is created.
- The first explicit Start/`+` conversation is created at the task's current effective directory, so a ready worktree gives it the correct native header.
- The explicit first start is withheld while a Git-backed task has no conversation, no worktree, and no recorded decision.
- A ready created/attached worktree or a persisted base-project choice unlocks the first start.
- The stage-instruction path can still create the first conversation while the choice is pending.
- Existing tasks with conversations remain valid; the task and command schemas evolve additively where possible.
- Keep the change inside Kanban: no DSH patch, no pin update, no session clone, no header rewrite.

**Non-Goals:**

- Do not fix relative image previews in conversations that were created before a worktree. Those conversations keep the current migration and header behavior; the limitation is accepted.
- Do not add a clone/rehome repair, a session-id replacement, or direct session-log editing.
- Do not change the native ChatView or the DSH pin.
- Do not add warning or repair UI for the existing-conversation case.
- Do not change worktree Git operations, worktree sharing, or directory migration semantics.
- Do not add a task-level default agent mode or a plugin-owned composer.

## Decisions

### Decision 1: Lazy first conversation instead of eager creation

New tasks save with `sessionIds: []`. The first native conversation is created on:

- the explicit Start/`+` action in the Conversations section, or
- `runInstruction` when a stage entry needs a conversation and none is open.

Rationale: this is the only approach that gives the first session the correct header without a native change or a clone. `createConversationNow` already uses the task's effective directory and workspace, and `runInstruction` already has the find-or-create behavior. The alternative (eager session plus blank-session replacement) loses composer drafts, changes native session identity, and needs crash journaling. The eager-plus-clone alternative changes identity and must repeat on every directory migration.

Consequences:

- `App.createTaskNow` no longer calls `ensureProjectWorkspace` or `sessions.create`, and loses the session-archive error path.
- `HubRepository.createTask`, `hub-operations.createTask`, and the legacy `BoardStore.createTask` no longer take a session id; they set `sessionIds: []`. `assertAvailableSession` remains on `addSession`.
- `domain/hub-schema.ts` and `domain/schema.ts` allow an empty `sessionIds` array.
- The task-context injection is unchanged: it runs on the first prompt of the first conversation, whether that prompt is a user message or a stage instruction.

### Decision 2: Persist the base-project choice on the task

Add optional `worktreeDismissed?: boolean` to `Task`, the hub task schema, and the legacy schema. Add a `worktree.dismiss` command that sets the field idempotently and updates the task's `updatedAt`.

Rationale: the Start gate must survive drawer close/reload and must be host-owned. The current notice's local `dismissed` state resets and would re-block the Start. The field is optional, so existing tasks load unchanged. It is only consulted while the task has no conversation; it has no effect after the first conversation exists.

Alternatives considered:

- Client `TaskPageState`/local storage: resets across clients/reloads and is not host-authoritative.
- Reuse `worktree: null` only: cannot distinguish "undecided" from "chose base".
- Create a sentinel worktree: confuses the worktree state machine.

`WorktreeNotice` becomes the owner of the dismiss action through `run({ type: 'worktree.dismiss', taskId })`; the drawer removes its local `dismissed` state and shows the notice when the task has no worktree and is not dismissed. The button copy becomes the explicit "Continue in base project" decision.

### Decision 3: A shared gate predicate, enforced in the host and reflected in the client

Add a shared helper, for example `requiresWorktreeDecision(task, project)`:

```ts
gitBacked(project)
  && task.sessionIds.length === 0
  && task.worktreeDismissed !== true
  && task.worktree?.status !== 'ready'
```

`task.worktree` being `preparing` or `error` does not satisfy the choice; a null worktree with a recorded base choice does. A folder project, a ready worktree, or an existing conversation returns false.

Host enforcement:

- `createConversationNow` takes an optional internal `{ allowUndecided?: boolean }`. It asserts the context, then rejects with `WORKTREE_DECISION_REQUIRED` when the gate applies and the flag is absent.
- The `conversation.create` command and the public `createConversation` use no bypass.
- `runInstruction` calls the internal creation with `{ allowUndecided: true }`. This is the explicit stage-instruction exemption required by the spec.
- The task is idle/operation checks remain in front of the gate.

Client reflection:

- `TaskDrawer` computes the gate with the active project and passes it to `DrawerConversations`.
- `DrawerConversations` disables the plus and the first-conversation Start when the gate applies or the task is busy; the `createConversation` handler also guards.
- The empty state explains the pending choice: create/attach a worktree or continue in base. If the task has an error/preparing worktree, it points to the Git/operation surface instead of the absent notice.
- The host remains authoritative; the client gate is an affordance, not the only enforcement.

### Decision 4: The empty state distinguishes "no conversation" from "all closed"

`DrawerConversations` currently uses one empty message for every case. Add a small `EmptyConversations` presentation for `task.sessionIds.length === 0`:

- no conversation: "No conversation yet", a primary Start action, and the gate hint;
- all conversations closed: keep the existing closed-tabs message and reopen action.

The plus remains available in the tab toolbar; when the task has no conversation it is the same explicit first start. The Start and plus share the same creation handler and pending/error state. The native session header/composer appears only after a conversation exists.

### Decision 5: Worktree creation with no conversations stays in the existing coordinator

The worktree coordinator already tolerates an empty conversation list: the idle wait is vacuously satisfied, `switchDirectories` loops no sessions, and the task's `effectiveCwd` is updated. No Git, sharing, or migration code changes are needed. After the worktree is ready, the next `createConversationNow` ensures the worktree workspace and creates the session there, giving it the correct header.

The worktree's `preparing`/`error` state is not a decision. While it is not ready, the Start remains withheld; the empty state points to Git/operation status. Removing the failed worktree restores the no-worktree notice path, where the user can dismiss to base.

### Decision 6: Existing conversations keep current behavior

If a conversation already exists when a worktree is created, `sessionIds.length > 0` makes the gate false. The existing directory migration runs unchanged: all conversations must be idle, `workingDirectory.set` updates the effective directory, and native identities/histories stay. The header remains the creation directory, so relative image previews in that conversation may keep resolving there. This is accepted and not repaired.

No warning, clone, replacement, header rewrite, or native change is added for this case. The worktree notice may remain visible when the task has no worktree and has conversations, as it does today; it does not gate any existing tab.

### Decision 7: Schema and command evolution

- `Task.sessionIds` stays a required array but may be empty; both task schemas drop `.min(1)`.
- `worktreeDismissed?: boolean` is optional in `Task`, `hub-schema`, and the legacy schema.
- `CommandSchema` gains `worktree.dismiss` with `taskId`; the shared `Command` union and the host `execute` switch gain the case.
- `HubRepository`/`hub-operations` own the dismissal mutation. The field is persisted through the existing hub transaction/revision path.
- The `create_card` tool description should state that it creates a task without a conversation or agent; the tool returns the task with an empty session list.

## Risks / Trade-offs

- **Empty `sessionIds` breaks older readers** → The schema change is intentionally breaking for persisted tasks created after the change. Ship host and client together; the old schema's `.min(1)` would reject a task with no conversation. Document that rollback requires restoring a pre-change task snapshot or accepting those tasks cannot be read by the older build. Existing tasks are unaffected.
- **An extra step before chatting** → The Conversations empty state and the worktree notice make the first action explicit. The stage-instruction path remains a one-click escape for execution.
- **Dismissal persistence changes current notice behavior** → The notice no longer reappears after a reload for the same task. The Git section still offers worktree creation, so the choice can be revisited.
- **Preparing/error worktree blocks the Start with no notice** → The empty state points to Git/operation status; removing the worktree restores the dismiss path. The operation status remains the authoritative recovery surface.
- **Stage instruction before the choice can still create a base conversation** → This is the required exemption and preserves the current behavior. It is not treated as a worktree decision; the user accepted that such a conversation keeps its creation header and preview limitation.
- **Existing conversations keep broken relative image previews** → Accepted non-goal. No clone/header rewrite. Native `openFile` improvements remain a future DSH/pin concern.
- **Host/client gate drift** → Use one shared helper and enforce the gate in the host; the client gate is only affordance. A stale client receives `WORKTREE_DECISION_REQUIRED`.
- **Task deletion/attention/worktree code assumes at least one session** → Audit the paths that iterate `sessionIds`: attention returns empty facts, deletion/bulk deletion have no sessions to archive, worktree migration loops zero sessions, and the deletion confirmation reports zero conversations. Leave the loops empty-safe; add focused coverage.
- **`pendingTransition.sessionId` validation** → A task with no conversation cannot have a session-bound pending transition; the command paths that require one are not reachable for a fresh task. Keep the existing validation and do not invent a session.

## Migration Plan

1. Ship the schema/field/command changes and the host lazy creation together with the client empty state/gate.
2. Existing tasks load unchanged: `sessionIds` non-empty, `worktreeDismissed` absent.
3. New tasks save with `sessionIds: []`; the first conversation is created on demand.
4. Rollback: the older schema rejects empty `sessionIds`, so back up the hub state before deploying. A rollback must restore that snapshot or a compatibility build that accepts empty session lists; do not run the older build against tasks created under the new schema.
5. Verify the first conversation in a worktree task uses the worktree workspace/header; verify base-choice dismissal survives reload; verify a stage instruction creates the first conversation while the choice is pending.

## Open Questions

None. UI copy (for example the exact Start and Continue-in-base labels) can be finalized during implementation without changing the specs, approach, or task breakdown.
