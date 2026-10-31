# Tasks

## 1. Persisted model and command

- [x] 1.1 Add optional `worktreeDismissed` to `Task` and allow an empty `sessionIds` array in both task schemas (`domain/hub-schema.ts` and the legacy `domain/schema.ts`); verify with `pnpm typecheck` and a schema parse of a task containing `sessionIds: []`.
- [x] 1.2 Add `worktree.dismiss` to the shared `Command` union and `CommandSchema`; verify `pnpm typecheck` and a schema round-trip for the new command.
- [x] 1.3 Add a shared `requiresWorktreeDecision(task, project)` helper; verify it returns true for Git/no-worktree/undecided and Git/worktree-preparing-or-error, and false for a ready worktree, a recorded base choice, a folder project, or an existing conversation.
- [x] 1.4 Add the dismiss mutation to `hub-operations`/`HubRepository` and the host command switch; verify the field persists idempotently and a repeated dismiss changes nothing.

## 2. Lazy task creation

- [x] 2.1 Remove the session-id parameter and `assertAvailableSession` call from `HubRepository.createTask`, `hub-operations.createTask`, and the legacy `BoardStore.createTask`; create `sessionIds: []`; verify with `pnpm typecheck` and the host/domain task-creation tests.
- [x] 2.2 Remove workspace and session creation plus the session-archive error path from `App.createTaskNow`; verify a new task has no native conversation/workspace and no agent execution.
- [x] 2.3 Update the `create_card` tool description and its expected task result to state that no conversation or agent is created; verify the tool contract test.

## 3. First conversation and worktree gate

- [x] 3.1 Add the optional `allowUndecided` bypass to `createConversationNow`; reject the explicit path with `WORKTREE_DECISION_REQUIRED` when the gate applies; keep the `conversation.create` command and public `createConversation` on the strict path; verify the host rejection and the no-bypass behavior.
- [x] 3.2 Call the create-on-demand path from `runInstruction` with the bypass enabled; verify a stage instruction creates the first conversation, uses the current effective directory, sends only the instruction, and still receives the first-turn task context.
- [x] 3.3 Verify a first explicit start after a ready worktree creates the session in the worktree workspace so its native directory and header are the worktree; verify a first start after a recorded base choice creates it in the base project.
- [x] 3.4 Audit the empty-`sessionIds` paths (attention, task deletion/bulk deletion, worktree switch/removal, deletion confirmation, operation status) and verify each handles zero conversations without requiring a session.

## 4. Client start state and notice

- [x] 4.1 Add the no-conversation empty state with an explicit Start action, a gate hint, and the plus/Start disabled state; keep the existing all-conversations-closed state; verify via the plugin's browser tests.
- [x] 4.2 Make `WorktreeNotice` own the `worktree.dismiss` command, persist the base choice, remove the drawer's local `dismissed` state, and disable the action while the task is busy; verify the notice stays hidden after reload.
- [x] 4.3 Pass the gate from `TaskDrawer` to `DrawerConversations`, show the notice when the task has no worktree and is not dismissed, and verify that a created first conversation is auto-selected and rendered with the native header/composer.
- [x] 4.4 Verify the start gate does not appear for a folder project, a ready worktree, or a task that already has a conversation.

## 5. Documentation

- [x] 5.1 Update the README first-use, Conversations, worktree, and timed-stage-instruction sections, including the accepted limitation for conversations created before a worktree; verify the documented flow matches the implemented behavior.

## 6. Verification

- [x] 6.1 Update the existing host/client tests affected by lazy creation and the new gate, then run `pnpm check`; verify typechecks, the task-focused vitest suites, and the build pass.
- [x] 6.2 Run an isolated browser smoke covering: new task with no conversation, worktree created before the first start, first chat in the worktree, base choice persisted across reload, stage instruction creating the first conversation while undecided, and an existing conversation before a worktree; capture evidence under `.verification/`.
- [x] 6.3 Confirm the final diff contains no DSH package/pin change, no session clone/rehome, and no session-header rewrite; verify the change remains inside Kanban.
