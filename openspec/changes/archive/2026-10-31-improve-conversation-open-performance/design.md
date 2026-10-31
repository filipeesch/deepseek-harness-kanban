# Design

## Context

See `proposal.md` for motivation and `specs/task-conversations/spec.md` for the behavior contract.

Current constraints that shape the approach:

- The drawer conversation is mounted deep inside `TaskDrawer` → `DrawerConversations` → `RetainedConversation`, and the drawer component is remounted per selected task. The Conversations section is conditionally rendered, so the lease lifetime must outlive that section while still ending with the drawer.
- The plugin may only use pinned DSH public surfaces: `ISessions.retain`/`refresh`/`list`/`subagentAddress`, `SessionReference.ready`, the `SessionProvider` and conversation factory slot, `ctx.sessionProjections.register`, and `sessionController.inspect`. No DSH patch or new release is allowed.
- The Host is a single process shared by every chat in the application. Kanban publication and attention reads therefore compete with Session opening for the same event loop and wire.
- Acknowledgment of a settled turn is tied to the conversation content being mounted and visible, and leaving Conversations must clear a subagent peek. Warm retention therefore cannot mean "keep the content mounted everywhere".

## Goals / Non-Goals

**Goals:**

- Make opening a task conversation independent of the Session-catalog round-trip and of history settling.
- Make revisited conversations, visited tabs, and drawer section round-trips reuse the already-open native Session.
- Bound Host publication and attention work by task conversations and by event bursts rather than by every Session event.
- Keep the new lifecycle out of god components through injected, single-purpose collaborators.

**Non-Goals:**

- Board-wide render refactor (subscription splitting, card memoization, splitting `BoardView`/`BoardPage`).
- Changing conversation creation, retention persistence, archival, or native DSH behavior.
- Instrumented benchmarking; verification is planned separately.
- Changing the attention semantics or indicator meaning.

## Decisions

### D1. Resolve the Session from the catalog before retaining; refresh only on a miss

`ConversationLeaseRegistry` checks the client catalog (`sessions.list` snapshot `byId` plus `subagentAddress`) before acquiring. A hit retains synchronously. A miss awaits one `sessions.refresh()` and retries the lookup once; a second miss is reported as an acquisition failure. `retain` failures are still caught and surfaced instead of parsed for text.

Alternatives considered:

- Keep the unconditional `refresh()` (current): adds a full `session.list` RPC to every open, which is the direct cause of the placeholder latency.
- Retain first and refresh on a thrown unknown-session error: avoids the preflight read but depends on the error text/type of a pinned host method; rejected as brittle.

### D2. Render the native surface without waiting for `ready`

The component renders the `SessionProvider` as soon as the synchronous retain returns. `EmbeddedConversationBody` already passes `phase: 'settling'` while `openState !== 'open'` and already renders the host's failure message on `openState === 'error'`, so the plugin's own async error state and `attempt` retry are removed. Only acquisition states keep a plugin surface: a compact status while a catalog-miss refresh is in flight, and an error state for a synchronous acquisition failure (unknown Session after one refresh, duplicate composer claim). The close action stays reachable in both. History settling is never a plugin surface.

Alternatives considered:

- Keep `await reference.ready` but render a skeleton: still serializes the visible conversation behind history, unlike the DSH sidebar.
- Keep the current blocking placeholder: leaves the reported symptom in place.

### D3. A drawer-scoped `ConversationLeaseRegistry` with lazy warmth

A new client module owns Session lifetimes for the drawer:

- Inputs (injected): `Pick<ISessions, 'retain' | 'refresh' | 'list' | 'subagentAddress'>`, the client lifetime signal, and an optional `onClaimError` port.
- State: a map of `sessionId → { reference?, error?, pending?, abort }` exposed as an `ObservableSnapshot` (`getSnapshot`/`subscribe`), following the existing controller pattern (`ModeSeatController`).
- Operations: `ensure(target)` (acquire once, idempotent), `release(sessionId)`, `releaseAll()`, `retry(sessionId)`.
- Owns a transient acquisition path for a peeked subagent address: released when the peek ends, never stored as a task conversation.

The registry is created by `TaskDrawer` (per mounted task) and provided to the drawer subtree through a small context. This gives exactly the required lifetime: it survives Conversations unmounting for Info/Git/Notes, but dies with the drawer and with a task switch. Warmth starts when `ensure` is first called for the active conversation; other tabs are not opened in the background. An effect prunes leases whose Session no longer belongs to the task's open conversation IDs (tab closed) and releases the peek lease when the peek clears.

Alternatives considered:

- Registry per `DrawerConversations` mount: destroyed by every section switch, so re-reads return.
- Global singleton: leaks across tasks and contradicts the drawer-scoped lifetime.
- Eager warm of every open tab: opening a task with many conversations would start several history loads at once, which is the load we are reducing.

### D4. Only the active conversation content is mounted

`DrawerConversations` keeps rendering at most the active conversation (or the peeked child). Warm leases are separate from mounted content, so:

- acknowledgment still requires visible mounted content (existing requirement),
- leaving Conversations still clears the peek through the existing drawer effect,
- closing the drawer or a tab releases the lease.

Tab switching continues to remount the native content (`key` by active session), but the Session is already open, so remount reuses the live history window instead of downloading it.

### D5. Host publication through a coalescing publisher

A new Host collaborator owns publication timing and exposes a single `request()`:

- Requests within a window (target 50 ms) collapse into one publication; a leading publication is allowed for the first request after a quiet period and a trailing publication is guaranteed so the final state is never lost.
- `KanbanApp` routes its `changed()` paths (`observe`, `sessionActivity`, hub subscription, question subscription) through `request()`. An attention-facts change publishes immediately through `request()` + `flush()` instead of waiting for a window: it is already debounced by the attention coordinator, it must replace a pending publication rather than add another, and this keeps exactly one publication per attention edge.
- `KanbanApp.observe` keeps applying `QuestionIndex` for every Session, because structured questions can appear in ordinary chats. It calls `attention.touch(sessionId)` only when the Session belongs to a task and requests publication when either the question index admitted a change or the Session maps to a task. Events from unrelated Sessions no longer publish Kanban snapshots.
- The attention coordinator keeps its own 50 ms fact debounce; worst-case attention latency stays within a few hundred milliseconds, as the spec permits, and busy conversations coalesce instead of serializing one snapshot per event.

Alternatives considered:

- Filtering without coalescing: a burst from many task conversations still serializes full snapshots.
- Client-side coalescing only: the Host would still clone and serialize every snapshot; the cost we need to remove is on the Host.

### D6. Attention conversation facts from a host-only projection

A new pure fold registers as a host-only Session projection (no `wire`, so it never enters client payloads):

- `lastTurnEndSeq` and `lastTurnOutcome` from `turn/end` (`reason.kind === 'error'` → `error`, otherwise `ok`),
- `openApprovalIds` from `approval/asked` / `approval/decided`, cleared by `turn/end`.

`createNativeSessionFacts` gains a projection-backed read for live Sessions: running/background still come from the `workspace/session-activity` waterfall; `awaitingReply` still reads the `userQuestions` projection; settled-turn and approval facts come from the fold. `inspect` remains only for Sessions that are not live, and the existing pure helpers stay as the fallback implementation.

The registration happens during plugin startup, using the pinned host API (a synchronous registration that rides the plugin fiber; the service is read through `ctx.get('sessionProjections')` so a host without projections keeps the inspect fallback). The reader is injected into the native ports, and the registration disposer is tied to the plugin fiber so an unloaded plugin stops folding every Session event. Sessions that existed before registration materialize their cells by folding the in-memory log on first read; new Sessions get a cell at creation.

Alternatives considered:

- Keep `inspect` but only on the touched Session: still reads the full log of the active conversation on every change, which is the scaling problem.
- Derive from `turnBoundary`/`inbox` only: `turnBoundary` does not carry the settled turn's sequence or outcome, and approvals have no standard projection, so those facts would be missing.

### D7. Cache the Kanban state between repository changes

`KanbanApp` caches the `hubs.snapshot()` result and invalidates it from the existing repository subscription. `snapshot()` reuses the cached object until the repository revision changes; only the conversation facts and question rounds are rebuilt per publication. Consumers treat the state object as immutable and the wire path only reads it.

Alternatives considered: keep cloning every Hub per publication (rejected: the clone is pure overhead when only attention changed).

### D8. Narrow memo boundary around the conversation host

The memoized boundary receives only stable inputs: task/session identity, `owner`, `services`, the lease registry, and a `useCallback`-stable `renderConversation` (with a memoized `sessionTitles` value in `BoardPage`). Board snapshots that only change attention still re-render the board, but not the mounted conversation subtree. Cards, columns, and board subscriptions are intentionally left unchanged.

### D9. Responsibility splits

- `ClientBridge` keeps transport, snapshot acceptance, and question view state. Attention projection (`projectConversation` aggregation, rising-running detection) and read-state orchestration move to small collaborators composed by the bridge, preserving the public `api` surface.
- `AttentionCoordinator` owns only fact caching, projection, and its timers. The pending-work steps (`resumePending`, `dispatchPending`) move to a `PendingWorkRunner` invoked from the coordinator's tick callback, so attention logic no longer imports worktree orchestration.
- `RetainedConversation` becomes a consumer: lease state, composer claim, and content rendering, with no catalog logic, no async open state, and no retry UI.

## Risks / Trade-offs

- [Warm leases keep live streams and history memory] → Only visited tabs of the open task; prune on tab close; release on drawer close and task switch; abort pending opens.
- [Rendering before history settles can surface an error later] → The native conversation state reports it; the tab and close action stay reachable; the plugin still reports synchronous acquisition failures.
- [Catalog preflight can misclassify address-only Sessions] → Check both `byId` and `subagentAddress`, and still surface a retain failure rather than assuming a miss.
- [Coalescing could delay or drop the final attention state] → Guaranteed trailing publication and a dirty flag; assertions are part of the later verification phase.
- [Ignoring non-task Session events could hide structured questions] → Publish whenever `QuestionIndex` admits a change for any Session, and keep the question view state independent of task filters.
- [A projection registered after startup folds history on first read] → One-time cost per live Session, replacing repeated full-history inspection; cold Sessions keep the inspect fallback.
- [Cached state object could be mutated by a consumer] → Document and enforce read-only use; the wire path serializes without mutation.
- [Memo boundary could stale the conversation across task switches] → Include the Session identity in the memo key so a task/session change remounts.
- [Warm lease without mounted content could acknowledge a turn] → Acknowledgment stays tied to mounted visible content; the hidden section does not mount the conversation.

## Migration Plan

- No persisted data, schema, or wire contract change. Existing Sessions, histories, and read acknowledgments are untouched.
- The change ships as a plugin update; leases, projections, and publication timers are in-memory only.
- Rollback is a plugin revert; no data migration or cleanup is required.
- No DSH patch or new DSH release is introduced; the pinned public surfaces are used as-is.
- Verification (isolated browser lane and fast gates) is planned as a separate phase per project rules.

## Open Questions

- Which latency bound the later verification phase should assert for opening and for attention freshness, given the 50 ms coalescing target. This does not change the approach or the task breakdown.
