# Proposal

## Why

New tasks currently create a native DSH conversation in the base project before any worktree decision. The native session header `cwd` is immutable; when the worktree is created later, Kanban migrates the session working directory but the header remains the base project. Native chat resolves relative image and file references from that header, so the first conversation can show broken previews. DSH 0.2.2 already resolves relative file links from the effective working directory, but the pinned host does not, and inline image resolution still uses the header. Rewriting the header is not supported, and cloning the session changes its identity and subagent lineage. Creating the first conversation after the worktree choice gives it the correct header without either workaround.

## What Changes

- New tasks save without a native DSH conversation or workspace; `sessionIds` may be empty.
- The Conversations section shows an explicit start state; Start and `+` create the first conversation at the task's current effective directory.
- A stage instruction that needs a conversation may create the first one without the explicit start action.
- The worktree choice is persisted on the task: creating/attaching a ready worktree or choosing to continue in the base project unlocks the explicit first start.
- While a Git-backed task has no worktree, no recorded base choice, and no conversation, the Start/`+` actions are withheld and the host refuses an explicit `conversation.create`. The stage-instruction path is exempt.
- A worktree that is preparing or in error does not count as the choice; the Start stays withheld until the worktree is ready, removed, or the base choice is recorded.
- Folder projects, tasks with a ready worktree, and tasks that already have a conversation are not gated.
- Conversations created before a worktree keep the current migration behavior. They are not cloned and their header is not rewritten; relative image previews in those conversations may continue to use the creation-time directory. This limitation is accepted.
- **BREAKING** for the product flow: saving a new task no longer creates a native conversation automatically; the first conversation is explicit or stage-driven.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-conversations`: a task starts with no native conversation; the first conversation is created explicitly or by a stage instruction and uses the task's current effective directory; `+` creates later conversations.
- `kanban-board`: top-level task creation creates no native conversation and still starts no agent.
- `worktree-management`: the missing-worktree notice records a persisted base-project choice, gates the explicit first start, and treats a ready worktree or recorded base choice as the decision; stage instructions remain allowed.

## Impact

- Host task creation and conversation creation (`src/host/app.ts`, `src/host/hub-repository.ts`), domain task operations and schemas (`src/domain/hub-operations.ts`, `src/domain/store.ts`, `src/domain/hub-schema.ts`, `src/domain/schema.ts`), the shared task type, and the Remote command schema.
- Client drawer, conversations empty state and start gate, worktree notice/dismiss, and the task drawer (`src/client/drawer.tsx`, `src/client/drawer-conversations.tsx`, `src/client/worktree-notice.tsx`).
- Persisted state gains an optional worktree-base decision and permits an empty `sessionIds`; existing tasks remain valid.
- Specs for `task-conversations`, `kanban-board`, and `worktree-management`; README; host/client tests and the isolated browser lane.
- No DSH source change or pin update, no session clone, and no conversation header rewrite.
