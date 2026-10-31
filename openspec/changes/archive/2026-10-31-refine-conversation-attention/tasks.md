# Tasks

## 1. Host attention facts

- [x] 1.1 Fold owned subagent descendants into agent execution in `partitionActivity` (`src/host/native-facts.ts`): a `subagent` family sets `running`, jobs and schedules stay in `background`, and `BackgroundKind` narrows to `job | schedule`. Verify `tests/host/native-facts.test.ts` covers a running subagent, a job, a schedule, and a mixed waterfall.
- [x] 1.2 Replace `lastOutcomeFailed` with `lastSettledTurn(inspection)` returning the last `turn/end` `{ seq, outcome: 'ok' | 'error' }` or `null`, and use it in `createNativeSessionFacts`. Verify the native-facts test covers error, success, no turn, and a later success after an error.
- [x] 1.3 Rework `AttentionCoordinator` (`src/host/attention.ts`) to project session-keyed conversation facts: remove `mergeTaskAttention`, the task-keyed `sameAttention` and `normalizeBackground`, keep the cache, invalidation, coalesced tick, and retry, and compare conversation facts for change detection. Verify `tests/host/attention-coordinator.test.ts` and `tests/host/attention-refresh.test.ts` pass with the session-keyed projection.
- [x] 1.4 Update `src/shared/types.ts` with `SettledTurn`, `ConversationFacts`, the narrowed `BackgroundKind`, and the host snapshot versus client snapshot split, then update `KanbanApp.snapshot()`, `src/remote.ts`'s `SnapshotSchema`, and the API types to carry `conversations`. Verify `pnpm typecheck` passes and the host app, hub-command, and question-persistence tests are updated to the new snapshot shape.

## 2. Client read model and projection

- [x] 2.1 Add a `KeyValueStorage` port with a `localStorage` adapter under `src/client/` that swallows storage failures. Verify a unit test covers a missing key, a stored value, and a throwing storage backend.
- [x] 2.2 Add `ReadAcknowledgments` over the storage port: one versioned record `{ version: 1, ack: { [sessionId]: seq } }`, `acknowledged(sessionId)` returning `undefined` when absent, `acknowledge`, `prune`, and a coalesced `flush`. Verify unit tests cover acknowledge, read back from a new instance, pruning, and an invalid stored record falling back to empty.
- [x] 2.3 Replace `ReminderTracker` with `ConversationReadTracker` (viewers, `view`/release, `close`, and acknowledge the settled turn of a viewed conversation on each projection) in `src/client/`. Verify unit tests cover view, hidden content, tab close, a settle while viewed, and a second failure after an acknowledged one.
- [x] 2.4 Add pure `projectConversation` and `aggregateTaskAttention` functions: unread/failed from the acknowledgment and `settledTurn`, awaiting-reply OR with the native `pendingInteraction`, background ordered job then schedule with bounded labels, and task aggregation of the four booleans plus background. Verify unit tests cover idle versus running, acknowledged versus not, error versus ok, and mixed background kinds.
- [x] 2.5 Rework `ClientBridge` to consume the wire `conversations`, publish the derived `attention` and `conversationAttention` maps, diff each task's `closedSessionIds` on accepted snapshots to acknowledge newly closed conversations, and keep `viewSession` for the mounted content. Remove the native `completionUnread` merge and the old reminder tracker. Verify `tests/bridge/bridge.test.ts` covers unread gating, per-conversation acknowledgment, close acknowledgment, and the derived task aggregate.
- [x] 2.6 Delete the remaining dead client attention code and unused imports from the old reminder path. Verify `pnpm typecheck` passes and no module still imports the removed units.

## 3. Presentation

- [x] 3.1 Update the activity copy for the narrowed background kinds (job and schedule only) in `src/client/activity.tsx`, keeping single-kind labels and the mixed-kind total. Verify `tests/client/activity.test.tsx` covers one job, one schedule, mixed kinds, and the absence of subagent copy.
- [x] 3.2 Style the working label at 10.5px, weight 600, and no letter-spacing for the card and the drawer, removing the drawer-only override. Verify the browser running-status lane reads the computed size and letter-spacing on both surfaces.
- [x] 3.3 Extract an `AttentionDots` component from the card context region and reuse it for the card. Verify `tests/client/task-card.test.tsx` still covers the three coexisting dots and the accessible names.
- [x] 3.4 Pass `conversationAttention` from the board through `TaskDrawer` to `DrawerConversations`, render the dots on each open conversation tab, and include the applicable states in the tab's accessible name. Verify a client test shows per-tab indicators and live updates, and the bridge test covers the viewed-conversation acknowledgment while another conversation stays unread.
- [x] 3.5 Keep the closed-conversation list free of attention dots and confirm closing a tab acknowledges that conversation. Verify a client test asserts closed entries have no dots, and a bridge test asserts a close transition acknowledges only the turn settled before it while a later settlement stays unread.

## 4. Fixtures, verification, and evidence

- [x] 4.1 Update the browser fixtures and affected specs (`tests/browser/fake-api.ts`, `tests/browser/running-status.spec.ts`, `tests/browser/appearance.spec.ts`) to build a consistent client snapshot with `attention` and `conversationAttention`. Verify `pnpm test:browser` passes.
- [ ] 4.2 Remove the lane's exact-release pin from `scripts/e2e-dsh.mjs` and the related docs, then run `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --check` and the affected `--only` lanes. Verify the lane passes; record any DSH test-API blocker (the lane currently stops in the DSH test scaffold before the Kanban assertions).
- [x] 4.3 Run `pnpm check` and `pnpm test:browser`, then capture light and dark appearance evidence for the working label, the background chip, the card dots, and the conversation-tab dots under `.verification/`.
- [x] 4.4 Run the isolated smoke described in `AGENTS.md` with a throwaway `DSH_HOME`: boot, Hub/board, project, task, drawer, the `Agent 1` tab, and reload persistence were verified. Accepted alternative: the model-free smoke cannot settle turns, so the unread/failure/tab-dot/closed-list states are covered by the unit, bridge, and browser lanes.
