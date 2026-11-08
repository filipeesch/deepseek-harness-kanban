# Design

## Context

See `proposal.md` for motivation and `specs/kanban-board/spec.md` and `specs/task-conversations/spec.md` for the behavior contract.

Constraints that shape the approach:

- The plugin may use only pinned DSH public surfaces (`sessionController.inspect`/`projections`, the `workspace/session-activity` waterfall, Session projections, Typert remotes). No DSH patch or new host release is allowed.
- One host process serves every Kanban surface and every ordinary chat. Snapshot work competes with Session opening for the same event loop and wire, so the fix must remove work rather than move it.
- Every published snapshot is validated and delivered to the client as a whole. `KanbanSnapshot` object identity drives React renders, and the board reads it synchronously.
- Persisted data, storage schemas, native Session identity, and automatic-advance semantics must not change.
- Latency measurement and a latency benchmark are out of scope; verification is behavioral plus the existing fast gates.

## Goals / Non-Goals

**Goals:**

- Board selection presents the board from the client's live snapshot, with no host round trip or Session-history read on the first-paint path.
- No publication path reads Session history. Conversation facts are invalidated per conversation and read concurrently with a priority order.
- Attention fills progressively and the published final state is never dropped.
- The auto-mode command persists only its own change, and the snapshot it returns is assembled from caches.
- State updates are sent only when the Hub state revision changed; attention-only publications no longer resend or re-validate Hub content.
- Render work per publication shrinks to the cards whose presentation changed.

**Non-Goals:**

- Changing attention semantics, read acknowledgment, auto-advance admission rules, or the auto-mode setting shape.
- Making commands optimistic; the control keeps pessimistic feedback.
- Redesigning board, card, or drawer presentation.
- Measuring or asserting latency numbers.
- A full snapshot-delta protocol (operation-level patches); the wire change is limited to omitting unchanged state.

## Decisions

### D1. Subscribe replays the current merged snapshot

`ClientBridge.subscribe(listener)` invokes the listener with the current merged snapshot when one exists, before returning the unsubscribe function. `BoardView` paints from that value on mount and keeps its existing accept/ordering rules.

Alternatives considered:

- Expose a separate `current()` accessor: works, but every consumer must remember to call it, and the replay also covers future consumers.
- Keep the blocking unary fetch: the round trip remains on the first-paint path even when the client already holds the exact state.

The board keeps one reconciliation path for the case of a missing or stopped stream: it calls the unary snapshot without forcing a fact refresh, so recovery never reintroduces the cold read on open.

### D2. Separate attention presentation from attention admission

Two read shapes serve different consumers:

- **Presentation** reads the resolved facts cache and never awaits a cold read. The host assembler builds `conversations` from resolved entries only; a task whose conversations are unresolved is presented without those indicators and republished when they resolve.
- **Admission** reads the uncached conversation-facts source directly. `readPendingUserWork`, auto-advance evaluation, and conversation-context guards keep awaiting durable values and keep propagating a read failure, because the cache resolves a failure to the last known value and would otherwise let an unreadable conversation look idle.

This keeps the progressive behavior honest: the board may fill late, but no automatic decision is made from a partial or fallback projection.

### D3. A conversation-facts cache with per-conversation invalidation, priority, and publication

A single collaborator owns the cache map, in-flight reads, retry allowance, and a bounded read queue:

- `read(sessionId)` dedupes and is used by admission and by the queue.
- `resolvedFor(sessionIds)` returns only settled entries for presentation; when a background batch resolves, the coordinator updates the presentation projection before requesting the publication.
- `invalidate(sessionId)` drops one entry and records it as a dirty edge; `touch` does the same and schedules the debounce. A publication that starts a read for a dirty conversation clears that edge; a later touch re-adds it, and a failed read stays dirty for the bounded retry. There is no global clear on board mount or on a status change.
- `ensure(sessionIds, priority)` enqueues missing reads with bounded concurrency (target 4–6 concurrent reads), ordered by priority tier: live events, then tasks with auto mode enabled or requested by the open drawer, then open conversations, then closed/historical conversations.
- A completed batch requests one coalesced publication through the existing publisher, so many resolutions do not produce many frames.
- The reconcile tick re-reads the union of dirty edges, conversations inside the retry allowance, and active work; it never starts the unresolved historical set. Reads run in bounded batches and each completed batch updates the projection and publishes a real change before the next batch starts.

`AttentionCoordinator` keeps its debounce, reconcile timer, and pending-work tick, but delegates the cache and retry bookkeeping to this collaborator. A rising native running status invalidates only the rising session ids instead of clearing the cache, and the unary refresh awaits only those ids.

Alternatives considered:

- Keep the global invalidation and parallelize the reads: still re-reads every historical conversation on each board mount and on each conversation start.
- Persist facts across restarts: removes the cold read but adds a second source of truth with its own staleness and invalidation rules; not needed once the open path no longer reads history.

### D4. Snapshot assembly is a collaborator with explicit caches

`SnapshotAssembler` composes the four snapshot parts and owns their caches:

- `state` (+ `stateRevision`): built once per repository change, invalidated by the existing hub subscription.
- `conversations`: the resolved facts projection (D2/D3).
- `sharing`: per-Hub views cached until the sharing state changes or a cheap projection signature (board ids/names/workflow documents and task-column counts) changes; invalidated by sharing notifications and sharing commands.
- `sharingAuth`: authorization view cached with a short TTL and refreshed explicitly by authorization commands; a stale view is returned as-is while one background refresh runs, so no command waits for a credential-store read. An authorization or sharing notification invalidates it (bumping an authorization generation so a pre-event in-flight read can neither satisfy nor overwrite the new view) so a completed OAuth flow is reflected on the next snapshot. Physical authorization reads are serialized, so an older read can never overwrite the coordinator's newer status.

`KanbanApp.snapshot()` stays the single entry point and delegates to the assembler. The command path reuses the same assembler after its write, in a cache-only mode that schedules no conversation-fact read and no authorization read.

Alternatives considered:

- Cache inside `KanbanApp`: keeps the god class and makes the caches untestable without the whole app.
- Assume authorization and sharing are cheap: they were measured as redundant per frame (credential-store reads and a full comparison recompute), and they will grow with team usage.

### D5. Incremental state on the wire

`HostSnapshot` gains `stateRevision`. In `follow`, the opening frame always carries `state`; a later frame carries `state` only when its revision changed since the previous frame. `command` and `sharing` responses carry the full state because they change it.

The client merges every accepted frame: a missing `state` reuses the previously accepted state; a baseline without state is a protocol error that triggers a fresh unary fetch and a stream restart. `sequence` keeps its ordering role; `stateRevision` only decides whether state is present.

`SnapshotSchema` makes `state` optional and requires `stateRevision`; the bridge is the only component allowed to produce a merged `KanbanSnapshot`, so downstream components keep the current non-optional shape.

Alternatives considered:

- Operation-level deltas: smaller frames but a much larger contract and reconciliation surface; rejected for this change.
- Send only attention frames and let the client refetch state on revision change: adds a round trip exactly when state changes, which is the common case for commands.

### D6. Lightweight reads replace per-task Hub clones

`HubRepository` exposes a task-summary projection (`id`, `hubId`, `boardId`, `projectId`, `sessionIds`, `closedSessionIds`, auto-mode flag, stage entry identity) built once per repository change, without cloning tasks. Hot call sites that only need identity or conversation ids use it: the attention projection, pending dispatch, the snapshot's conversation map, startup reconciliation planning, and the worktree name-occupancy scan. Callers that need a full task still call `requireTask`.

The projection is rebuilt on the existing repository subscription with the same invalidation as the state cache, so it adds no staleness beyond the state itself.

Alternatives considered:

- Return the stored objects without cloning from `allTasks()`: removes the cost entirely, but silently changes the immutability contract for every consumer and risks mutation through a reference; rejected until the read-only contract is explicit.
- Deep-freeze every Hub on write and share references: attractive, but one consumer mutation would then throw at runtime far from the cause; not needed to meet the goal.

### D7. Commands dispatch only when a transition is pending

A pending-transition index is maintained from the same repository change signal. `dispatchPending()` returns immediately when the index is empty; the drain path still scans only the pending ids, not every task. The auto-mode command path therefore performs: one Hub write, one state-revision bump, one pending index refresh, one snapshot assembly, and one publication.

The command response is assembled from resolved caches only: it starts no conversation-fact read, reads no authorization view, and reuses the cached state and sharing views. The auto-mode control keeps its pessimistic feedback: the pressed state changes only after the command resolves, and a failure restores the stored setting and reports the failure.

Alternatives considered:

- Track pending ids only from writes issued by this app: misses restored transitions and background worktree operations; the index must derive from repository state.
- Skip `dispatchPending()` at the end of commands entirely: durable transitions admitted by other paths rely on that call.

### D8. Startup restores cheap state first and reconciles in the background

`initialize()` becomes:

1. Repair interrupted `sending` transitions and admit pending worktree requests (durable, history-free, still awaited).
2. Restore persisted question projections synchronously from the question store for every known conversation.
3. Publish the first snapshot.
4. Schedule background reconciliation with bounded concurrency: per-conversation history replay, instruction-pending reconciliation, and workspace reconciliation. Failures are reported and never block the board.

`prepareQuestions` keeps its debounced persistence and attention re-derivation; only its history replay moves off the startup path. The pending-work gate keeps using the restored projection, so an already-persisted unanswered question holds an automatic advance before the background replay finishes. The only gap is the persistence debounce window (about 250 ms) for events written just before a crash; admission re-reads the native facts, so the gap cannot silently advance a task whose native state reports pending work.

Tests and shutdown get an explicit `whenSettled()` (or equivalent) seam so background work is observable and aborts with the plugin lifetime.

Alternatives considered:

- Defer everything including the question restore: fastest startup, but a persisted question would stop holding advances until the replay ran.
- Keep awaiting the replay but parallelize it: still blocks startup on the slowest conversation and still reads every log.

### D9. Board render isolation

- `projectTaskAttention` keeps structural sharing: when a task's aggregate attention and its conversations' values did not change, it returns the same object reference as the previous publication.
- `BoardView` renders cards through a memoized `BoardCard` that receives the task, the column, the project name, the per-task attention object, the selection flags, and stable callbacks. Unchanged cards skip rendering; the board shell still re-renders, which is cheap.
- Callbacks are stabilized with refs (the existing `runRef` pattern) so a memoized card is not invalidated by a new closure identity.

Alternatives considered:

- Per-task store subscriptions: the strongest isolation but a larger state-management change; memoization plus structural sharing captures most of the win with a smaller diff.
- Split the whole board shell: deferred; the shell render is not the dominant cost.

### D10. Responsibility splits

New single-purpose collaborators owned by `KanbanApp`'s composition and injectable as constructor seams for direct tests:

- `SnapshotAssembler` — composes and caches the snapshot parts.
- `ConversationFactsCache` — cache, retry allowance, priority queue, batch notification.
- `TaskSummaryIndex` — lightweight board reads (owned beside the Hub repository).
- `PendingTransitionIndex` — the dispatch gate.
- `StartupReconciler` — background history and workspace reconciliation.

`KanbanApp` keeps command sequencing, admission, snapshot entry point, and publication. Client-side, snapshot acceptance and merging stay in `ClientBridge`, with frame merging extracted into a pure helper for direct tests.

Alternatives considered:

- Put everything in `KanbanApp`: fewer files, but the caches, queue, and startup work become untestable in isolation and the class keeps growing.

## Risks / Trade-offs

- [A task can be presented without indicators before its facts resolve] → Active tasks (running, auto mode enabled) and the open drawer's task are resolved first; the final state is always published; admission never uses the partial projection.
- [Progressive presentation could look like "no attention" for a task with pending work] → Auto-mode and running tasks are prioritized, and the card's own control derives from persisted task state that is already present, so held/paused states are not delayed by fact reads.
- [A per-conversation invalidation misses a fact change that emits no session event] → The existing reconcile timer, the rising-status refresh, and the transient-read retries keep the bounded recovery guaranteed by Truthful and self-healing turn execution state.
- [Removing the mount-time global invalidation could keep stale facts] → Opening the board reconciles unknown/failed conversations without clearing resolved ones, and the reconcile timer repairs stragglers; a stream restart forces a baseline.
- [An incremental frame without state leaves the client stale if ordering breaks] → Baselines and command responses always carry state, the bridge enforces sequence ordering, and a baseline without state is treated as a protocol error that triggers a fresh fetch.
- [Background startup reconciliation delays badge recovery after a crash] → Persisted questions are restored synchronously; admission re-reads native facts; the remaining gap is bounded by the persistence debounce.
- [Caching authorization/sharing views can show a stale state] → Explicit invalidation on authorization and sharing commands, on hub changes, and a short TTL for the authorization view.
- [Memoized cards could show stale content] → Memoization keys on the task snapshot identity, the per-task attention identity, and the selection flags; any change to those props re-renders the card.

## Migration Plan

- No persisted data, schema, storage, or native Session change; the plugin keeps the same task/conversation identity.
- The wire contract changes only in the plugin's own Typert namespace (`HostSnapshot.stateRevision`, optional `state` on update frames); host and client ship together in the same bundle.
- Rollback is a plugin revert; no data migration or cleanup is required.
- The published artifact changes, so the plugin version is bumped in the same pull request per project rules.
- Verification runs through the existing fast gates and the isolated browser/e2e lanes; no benchmark or latency threshold is introduced.
