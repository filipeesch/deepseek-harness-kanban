# Proposal

## Why

Opening the Kanban page from the sidebar currently takes about three seconds, and enabling auto mode on a task card also stalls before the control responds. Both are read-and-command round trips that were expected to be immediate, and the delay grows as the user accumulates tasks and conversations.

The cost is concentrated in three places. Opening the board discards the live snapshot the client already receives and forces a fresh host snapshot that clears the whole conversation-fact cache and re-reads every conversation's durable state one session at a time, including full Session-log inspection for conversations that are no longer live. Every publication also re-reads the credential-backed authorization view, recomputes team-sharing comparisons, and clones each Hub once per task. Every card command repeats the pending-work dispatch and rebuilds the snapshot even when no transition is pending. The plugin startup repeats the same full history replay before the interface becomes usable.

## What Changes

- Opening the board presents the already-published snapshot immediately instead of waiting for a new host snapshot. A background reconciliation still runs, so a stopped stream or a stale client recovers without a reload.
- Conversation attention fills progressively. The board becomes interactive first; facts for running and auto-mode tasks are read before historical conversations, and indicators appear as they resolve without dropping the final state. Automatic-advance admission keeps evaluating the real facts, never a partial projection.
- The host no longer clears the whole fact cache when the board mounts or when a conversation starts running. Facts are invalidated per conversation and read with bounded concurrency, and no Session-history read sits on the snapshot or first-paint path.
- Snapshot composition caches its parts: the Hub state until its revision changes, the team-sharing view until sharing changes, and the authorization view until authorization changes. Published updates omit the Hub state when its revision did not change; baselines and command responses remain complete.
- Host reads stop cloning the whole Hub once per task. A lightweight projection serves callers that only need task identity and conversation ids, and full task records are cloned only when a consumer uses them.
- Card commands perform only the work their change requires. Pending transitions are dispatched only when a pending transition exists, and enabling or disabling auto mode no longer recomputes sharing, authorization, or conversation facts. The control keeps its pessimistic feedback: it changes after the change is durably persisted.
- Plugin startup restores persisted question projections synchronously and defers the Session-history replay and workspace reconciliation to background work. An already-persisted unanswered question still holds an automatic advance while that background work runs.
- The client keeps board renders bounded: cards are memoized and a task's attention value keeps its identity when its facts did not change, so a publication only re-renders the cards whose presentation changed.
- Supporting responsibility splits keep the new behavior out of god classes: snapshot assembly, conversation-fact caching, lightweight board reads, and the pending-transition index move into injected, single-purpose collaborators around `KanbanApp`.
- Out of scope: measuring latency and adding a latency benchmark; changing persisted data, the native DSH runtime, or automatic-advance semantics; redesigning the board's visual presentation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: opening the board, presenting attention progressively, keeping card commands isolated from unrelated work, and preserving the pending-work gate while startup reconciliation runs in the background.
- `task-conversations`: conversation tab indicators may fill after the drawer's first paint, without a reload and without dropping the final state.

## Impact

- Client: `src/client-bridge.ts` (snapshot replay, incremental-frame merge), `src/client/board.tsx` (non-blocking first paint), `src/client/task-card.tsx` and `src/client/kanban-attention.ts` (render isolation and stable attention identity), `src/remote.ts` and `src/shared/types.ts` (snapshot contract), plus the client tests that mock the API.
- Host: `src/host/app.ts` (composition and command path), `src/host/attention.ts` (per-conversation invalidation and progressive projection), `src/host/native-facts.ts` and `src/host/native.ts` (fact reads), `src/host/hub-repository.ts` and `src/host/task-locator.ts` (lightweight reads), `src/host/sharing/service.ts` (cached views), and `src/host/publish-scheduler.ts` if the publication seams change.
- Wire contract: `HostSnapshot` gains a state revision, and update frames may omit the Hub state; the client merges them. No persisted plugin data, storage schema, or DSH patch changes. The plugin version is bumped in the pull request because the published artifact changes.
- Validation: the existing fast gates (`pnpm check`) and the isolated browser/e2e lanes cover behavior; no benchmark or latency threshold is added by this change.
