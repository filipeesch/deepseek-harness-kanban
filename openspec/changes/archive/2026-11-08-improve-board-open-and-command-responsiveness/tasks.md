# Tasks

## 1. Lightweight host reads

- [x] 1.1 Add a task-summary projection to `HubRepository` (task id, Hub id, board id, project id, open and closed conversation ids, auto-mode flag, current stage-entry identity) that is rebuilt on the repository change signal and clones no task; verify with a unit test in `tests/host/` that reads summaries for a multi-Hub fixture and asserts ids and conversation lists.
- [x] 1.2 Expose the projection through `TaskLocator` and replace the hot call sites that only need identity or conversation ids (attention projection, snapshot conversation map, pending dispatch, startup planning, worktree name-occupancy scan); verify with `pnpm typecheck` and the existing host tests still passing.
- [x] 1.3 Add a pending-transition index derived from the same repository signal and make `dispatchPending()` return immediately when it is empty; verify with a test that records dispatch work for a Hub with no pending transition and for one with a pending transition.

## 2. Conversation facts: cache, priority, progressive publication

- [x] 2.1 Create `ConversationFactsCache` with `read`, `resolved`, `invalidate`, retry allowance, and in-flight deduplication; verify with unit tests covering cache reuse, per-conversation invalidation, a transient rejection followed by a retry, and no global clear.
- [x] 2.2 Add a bounded-concurrency priority queue (live-event reads first, then auto-mode and open-conversation tasks, then closed conversations) plus one coalesced batch notification per resolved batch; verify with a fake-port test asserting the read order and that a batch notifies once.
- [x] 2.3 Move the cache and retry bookkeeping out of `AttentionCoordinator` into the new collaborator while keeping the debounce, reconcile timer, and pending-work tick; verify the existing `tests/host/attention-*.test.ts` suites after updating their seams.
- [x] 2.4 Replace the global invalidation used when a conversation starts running with per-session invalidation of the rising session ids, and make the unary refresh await only those ids; verify with a test that a rising status re-reads one conversation and leaves the others cached.
- [x] 2.5 Make the published snapshot project only resolved facts and schedule reads for unknown task conversations, publishing again when a batch resolves; verify with an app test that a snapshot before resolution omits the facts and a later publication includes them.
- [x] 2.6 Keep admission on durable reads: confirm `readPendingUserWork`, automatic-advance evaluation, and execution-context guards still await facts and never consume the presentation projection; verify with the existing `tests/host/auto-advance-app.test.ts` and `tests/host/app.test.ts` after updating expectations.

## 3. Snapshot assembly and the wire contract

- [x] 3.1 Create `SnapshotAssembler` owning the cached state object and a monotonic state revision invalidated by the repository signal; verify with a unit test that two consecutive assemblies share the state object until a Hub write and then report a new revision.
- [x] 3.2 Cache the per-Hub sharing views and the authorization view (short TTL) inside the assembler, with explicit invalidation on hub changes, sharing notifications, and sharing/authorization commands; verify with a test that a repeated publication performs no authorization read and a sharing command refreshes the view.
- [x] 3.3 Add `stateRevision` to `HostSnapshot` and make `state` optional on update frames in `src/remote.ts` and `src/shared/types.ts`; verify the schema accepts a frame without state and rejects a baseline without it.
- [x] 3.4 Emit `state` in `follow` only when the revision changed, keep baselines and command/sharing responses complete, and verify with a controller test covering baseline, attention-only update, and state-changing update.

## 4. Command path and startup

- [x] 4.1 Trim the card command path to its own change: no pending dispatch when none is pending, no conversation-fact reads, and no sharing/authorization recompute for `task.autoMode`; verify with the existing `tests/host/auto-mode-command.test.ts` extended to assert the trimmed work.
- [x] 4.2 Create `StartupReconciler` that restores persisted question projections synchronously, publishes the first snapshot, then runs history replay, instruction-pending reconciliation, and workspace reconciliation with bounded concurrency and reported failures; verify with tests that a persisted unanswered question holds an advance before the replay finishes and that a failing replay does not block the first snapshot.
- [x] 4.3 Add an observable settle seam for background reconciliation, abort it with the plugin lifetime, and compose the new collaborators in `src/index.ts` with injected dependencies; verify with `pnpm typecheck` and a test that closing the plugin settles background work.

## 5. Client feed: replay, merge, and targeted refresh

- [x] 5.1 Replay the current merged snapshot from `ClientBridge.subscribe` and extract frame merging into a pure helper that reuses the previous state when a frame omits it; verify with `tests/bridge/plugin.test.tsx` plus a new unit test for merging with and without state.
- [x] 5.2 Treat a baseline without state as a protocol error: request a fresh unary snapshot and restart the stream; verify with a bridge test that feeds a state-less baseline and asserts one recovery request.
- [x] 5.3 Stop forcing the global attention refresh on the client's reconcile call, and make the rising-status refresh pass the affected session ids; verify with a bridge test that the rising path requests only those ids.
- [x] 5.4 Add the optional priority task ids to the unary snapshot request, enqueue them with the highest non-event priority on the host, and request them when a task drawer opens; verify with a host app test for the read order and a client test that opening a drawer sends the task id.

## 6. Board first paint and render isolation

- [x] 6.1 Make `BoardView` paint from the replayed snapshot and keep a non-blocking reconciliation path for a missing or stopped stream; verify with `tests/client/board.test.tsx` that a mounted board with a published snapshot never waits for `snapshot()` to resolve.
- [x] 6.2 Add structural sharing to `projectTaskAttention` so a task whose facts did not change keeps its previous attention object; verify with a unit test comparing references across two projections.
- [x] 6.3 Render cards through a memoized card component with stable callbacks and verify with a render-count test that an attention-only publication re-renders only the affected cards.

## 7. Gates and rollout

- [x] 7.1 Update affected client and host tests for the new seams (board, bridge, attention, auto mode, controller) and run `pnpm test`; fix every failure introduced by the change.
- [x] 7.2 Run `pnpm check` (host/client typechecks, vitest, build) and confirm the change introduces no DSH patch, dependency, generated artifact, or persisted-data migration with `git status` and `git diff --stat`.
- [x] 7.3 Exercise the isolated lanes for board opening, attention fill, drawer tabs, and the auto-mode toggle (`pnpm test:browser` and the relevant `scripts/e2e-dsh.mjs --only` lanes) and record the evidence under `.verification/`; the browser harness passes, and the two real-composition lanes reproduce a pre-existing failure of this installed DSH checkout that is documented in that report.
- [x] 7.4 Bump `version` in `package.json` for the published artifact and confirm the release guidance in `README.md` still matches the install address.
