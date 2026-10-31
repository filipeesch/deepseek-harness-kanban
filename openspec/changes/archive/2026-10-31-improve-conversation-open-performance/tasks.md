# Tasks

## 1. Client lease registry

- [x] 1.1 Create `src/client/conversation-leases.ts` with a `ConversationLeaseRegistry` that exposes `ensure(target)`, `release(sessionId)`, `releaseAll()`, and `retry(sessionId)` over an `ObservableSnapshot`, injecting the sessions port, the client lifetime signal, and a `catalogHas` lookup; verify with `pnpm typecheck`.
- [x] 1.2 Implement the catalog preflight (catalog hit retains immediately; a miss awaits one `sessions.refresh()` and retries once, then reports an acquisition failure), and abort pending acquisitions on release; verify by exercising the registry's injected ports in a scratch check and `pnpm typecheck`.
- [x] 1.3 Add a transient peek acquisition path that is released when the peek clears and is never stored as a task conversation; verify with `pnpm typecheck` and the existing conversation-close test still compiling.
- [x] 1.4 Create the drawer-scoped provider/context in `src/client/conversation-leases.ts` (or a sibling module) and mount it in `TaskDrawer` so the registry survives Conversations unmounting but is released on drawer close, task switch, and plugin teardown; verify with `pnpm typecheck`.
- [x] 1.5 Prune a task's leases when its open conversation IDs change (closed tab or removed conversation); verify the effect's dependency wiring with `pnpm typecheck` and a manual state inspection in a scratch render.

## 2. Immediate native conversation surface

- [x] 2.1 Rewrite `src/client/conversation-surface.tsx` so `RetainedConversation` gets its reference from the lease registry, renders the `SessionProvider` as soon as the synchronous retain returns, and no longer awaits `reference.ready`; verify with `pnpm typecheck`.
- [x] 2.2 Remove the plugin's async open placeholder, retry state, and duplicate failure alert, keeping only the synchronous acquisition failure surface and the existing close action; verify with `pnpm typecheck`.
- [x] 2.3 Confirm the drawer renders only the active conversation (or peeked child), so hidden/visited leases do not acknowledge turns, and leaving Conversations still clears the peek through the existing drawer effect; verify with `pnpm typecheck` and an observable check in the isolated lane later.
- [x] 2.4 Verify a conversation that is already open in the DSH main panel renders without a new history wait by checking that no catalog refresh is issued on the hit path; record the observation for the later verification phase.

## 3. Narrow render isolation

- [x] 3.1 Add a memoized conversation-host boundary with stable props (Session identity, target, owner, services, registry) and a `useCallback`-stable `renderConversation`; verify with `pnpm typecheck`.
- [x] 3.2 Memoize the `sessionTitles` adapter in `BoardPage` so it no longer breaks memoization on every render; verify with `pnpm typecheck`.
- [x] 3.3 Ensure the memo boundary remounts when the task/session/target changes, so a task switch never shows a stale conversation; verify with `pnpm typecheck` and an observable check in the isolated lane later.

## 4. Host publication

- [x] 4.1 Create the host publication collaborator with a leading publish, a coalescing window of about 50 ms, a guaranteed trailing publish, and an injectable timer/dispose seam; verify with `pnpm typecheck`.
- [x] 4.2 Route `KanbanApp.observe`, `sessionActivity`, `activityChanged`, the Hub subscription, and the question subscription through the collaborator; verify with `pnpm typecheck`.
- [x] 4.3 Restrict `session/event` work to task-relevant Sessions (attention touch and publication) while keeping `QuestionIndex.apply` and question publication for every chat; verify with `pnpm typecheck` and confirm ordinary-chat decision questions still publish.
- [x] 4.4 Cancel the pending trailing timer on app disposal and guarantee the final dirty state is published after a burst; verify with `pnpm typecheck`.

## 5. Attention facts projection

- [x] 5.1 Create a pure host-only Session projection fold recording `lastTurnEndSeq`, `lastTurnOutcome`, and open approval IDs; keep it free of `wire` so it never enters client payloads; verify with `pnpm typecheck`.
- [x] 5.2 Register the projection during plugin startup before consumers start and inject its awaited handle into the native ports; verify with `pnpm typecheck` and confirm registration happens before `app.initialize()`.
- [x] 5.3 Read settled-turn and approval facts from the projection for live Sessions, keep the activity waterfall and `userQuestions` projection reads, and keep `inspect` only as the not-live fallback; verify with `pnpm typecheck`.
- [x] 5.4 Confirm `isIdle` and other operational reads that still need exact history are unchanged and do not run on the attention path; verify with `pnpm typecheck` and a code-level call-site check.

## 6. Snapshot and responsibility cleanup

- [x] 6.1 Cache the Kanban state snapshot in `KanbanApp` and invalidate it from the repository subscription instead of cloning every Hub per publication; verify with `pnpm typecheck`.
- [x] 6.2 Extract the pending-work resume steps from `AttentionCoordinator` into a separate collaborator invoked by its tick, leaving the coordinator with fact caching, projection, and timers; verify with `pnpm typecheck`.
- [x] 6.3 Extract attention projection and read-state orchestration from `ClientBridge` into small collaborators while preserving the public `api` surface and subscription behavior; verify with `pnpm typecheck`.

## 7. Gates

- [x] 7.1 Run `pnpm typecheck` and `pnpm build`; fix any type or bundling error introduced by the new modules.
- [x] 7.2 Run `pnpm test` and triage failures caused by the changed seams without adding new performance tests; record the deferred verification work for the separate phase.
- [x] 7.3 Confirm the diff contains only plugin files and no DSH patch, dependency change, generated artifact, or data migration; verify with `git status` and `git diff --stat`.
