# Design

## Context

See `proposal.md` - Why. The current question path has two independent latencies:

- `QuestionForm` awaits `conversation.send` (host prompt admission) before it can mark the round as submitted, and keeps rendering the strip in the meantime.
- The strip is removed only when `round.answered` arrives through `kanban.follow`, whose `snapshot()` awaits `AttentionCoordinator.project()` and therefore `sessions.facts` (activity, projections, and a full session inspection) for every task conversation.

The plugin already owns a canonical `QuestionIndex` in the host and a `ClientBridge` in the browser. The DSH host/client split compiles as separate TypeScript programs, and remote methods are declared in `src/remote.ts` with strict Zod codecs. The client uses `RemoteSnapshotStream` for supervised reconnecting streams.

## Goals / Non-Goals

**Goals:**

- Remove the strip on Submit before admission settles, with a truthful rollback.
- Make Submit enablement and round retirement independent of board/attention projection.
- Preserve the existing turn-completion gate and make it explicit.
- Surface a newly arrived page while the user is on Additional Notes without losing position or draft.
- Leave the question surface with a single authoritative transport.

**Non-Goals:**

- Changing queue/steer semantics, native approvals, `userQuestions`, or the decision lifecycle.
- Optimistic retirement when the reply comes from the native composer; that path relies on the new feed's lower latency.
- Persisting unsent drafts or the optimistic submitted state across reload.
- Changing the "only the most recent unresolved round is displayed" product rule.

## Decisions

### D1. Conversation-scoped question feed instead of snapshot fields

Add `kanban/questionsFollow` as a `@Remote({mode:'stream'})` method with a `sessionId` parameter. It yields a baseline frame followed by updates whenever that session's projection changes, and never calls `AttentionCoordinator` or board projection.

Alternatives:

- *Split `kanban/follow` into question-first and attention-later frames*: keeps one stream but changes frame semantics for every board consumer and still couples two lifecycles.
- *Keep `questionRounds` in the snapshot and rely on optimistic UI only*: leaves Submit enablement and composer-reply retirement waiting on the heavy projection.
- *Poll `kanban/questions`*: adds latency and traffic, and still needs a change signal.

`QuestionIndex` gains a per-session monotonic revision so a global index event does not emit a redundant frame for unrelated conversations. The stream compares the revision before yielding.

### D2. Baseline/update frames through the existing supervisor

The frame is `{ kind: 'baseline' | 'update'; rounds: QuestionRound[] }`, described by a new Zod codec in `remote.ts`. The client opens one `RemoteSnapshotStream` per tracked session, using `replace` for a baseline and `update` for an update. Reconnection re-baselines, so a missed frame cannot leave stale rounds.

The unary `kanban/questions` method is removed; the feed baseline replaces it. `KanbanApp.rounds(sessionId)` remains the host projection entry point and keeps its existing one-time `prepareQuestions` bootstrap.

### D3. `QuestionRoundCache` owns question state

Extract a `QuestionRoundCache` from `ClientBridge` with an explicit feed port and dismissal callback:

```
QuestionRoundCache
  rounds: QuestionRound[]
  tracked: Set<sessionId>
  dismissed: Set<roundId>
  submitted: Map<roundId, sessionId>
  errors: Map<sessionId, Problem>
  view: HostObservable<{ rounds, errors }>
  track(sessionId) / retry(sessionId)
  dismiss(sessionId, roundId)
  submit(roundId) / rollback(roundId)
  apply(sessionId, rounds, mode)
  dispose()
```

The bridge only wires remote adapters and delegates. This removes `rounds`, `prepared`, `questionSessions`, and `dismissed` from the bridge and gives the cache a single reason to change.

Alternatives:

- *Keep the logic in `ClientBridge`*: the class already combines feed merging, attention, read tracking, and composer claims.
- *Inject a submission controller into the form*: more indirection for one consumer and does not survive remounts.

### D4. Optimistic submission protocol

1. The form validates and calls `cache.submit(roundId)` before invoking `conversation.send`.
2. The cache adds the round to `submitted` and publishes; the Dock hides the form while keeping it mounted so the draft survives a rollback.
3. On admission success the cache waits for the feed to confirm `answered` or drop the round, then clears the entry.
4. On admission failure the cache calls `rollback(roundId)`, records a focused-round id, and publishes; the same mounted form becomes visible again with its draft and an error.

Reconciliation rules:

- A feed frame never removes a submitted suppression; only `answered`/absence or an explicit rollback does.
- Round selection prefers a submitted round while it is in flight, so its form stays mounted and a newer round cannot unmount the draft mid-admission. After confirmation, the newest unresolved round wins.
- A rolled-back round becomes the focused round so its retry remains visible even if a newer round exists.

Alternatives:

- *Unmount the form immediately and rebuild it from the formatted text on failure*: the formatted reply is lossy for choices, Other text, and notes.
- *Persist submitted state in `sessionStorage`*: a reload during a failed admission could hide the round permanently.

### D5. Remove `questionRounds` from snapshots

`HostSnapshot.questionRounds`, `KanbanSnapshot.questionRounds`, `SnapshotSchema`, `KanbanApp.snapshot()`, and `ClientBridge.accept/publish` stop carrying rounds. `AttentionCoordinator` keeps using the synchronous `questions.pending(sessionId)` check; that is a pure in-memory projection and is not the slow path.

This is a **BREAKING** plugin-internal wire/type change. Host and client ship from the same bundle, so no compatibility shim is retained.

### D6. Submit gate and form state machine

`canSubmit` remains `round.complete && answersValid`. A new pure helper returns a submission view:

```
type SubmitState =
  | { kind: 'blocked'; reason: 'invalid' | 'awaiting-turn' }
  | { kind: 'ready' }
  | { kind: 'submitting' }
  | { kind: 'failed'; message: string }
```

`awaiting-turn` renders the explicit "waiting for the agent to finish the turn" copy. The form's `submitting`/`submitted` booleans plus `sent`/`inFlight` refs collapse into this state machine.

### D7. New-page discovery on Additional Notes

Track the highest `sequence` among question pages the user has actually visited. While the user is on Additional Notes and any page has a higher sequence, show a notice with an action that navigates to the earliest such page. Visiting it updates the tracked sequence and clears the notice. This uses the existing page ordering and needs no new protocol state.

### D8. Focus after removal

When the form becomes hidden, return focus to the native composer through the session-scoped input facade when the loaded DSH version exposes it; otherwise blur the hidden form's active element. The form keeps its own focus management (heading focus on slide change, confirmation focus) and the hidden state uses the native `hidden` attribute plus `aria-hidden`.

## Risks / Trade-offs

- [In-memory submitted state] A reload between Submit and the host's `user/message` confirmation can show the round again. → Accepted; the feed confirms within the same turn and no durable decision record is introduced.
- [Form stays mounted while hidden] It keeps draft state alive but also keeps its subscriptions until the round settles. → The form has no external subscriptions beyond its own refs; unmount happens on confirmation or navigation.
- [Per-session stream count] Many open conversations mean many supervisors. → Streams are opened lazily on `track` and share the existing supervisor lifecycle; the tracked set matches the mounted/tracked sessions the bridge already keeps.
- [Removed unary `questions`] Any external plugin caller of that method would break. → The method is plugin-internal; the proposal marks the snapshot removal breaking and the same release ships both sides.
- [Failed submit with a newer round] A failed admission while a newer round exists could compete for the single dock. → A rolled-back round becomes the focused round and is shown for retry; the newer round appears after it is resolved.
- [Focus API dependency] The composer focus facade may differ across DSH releases. → Keep the fallback blur and cover the behavior with a fake-provider test rather than a native assumption.

## Migration Plan

No persisted data or schema migration is required. Deploy host and client together from the same plugin build. Rollback is a revert of the change; removed `questionRounds` fields are optional at runtime only in the old client, so do not run a new host against an old client build. Reloading the existing GUI after rebuilding is sufficient once the plugin is reconciled.

## Open Questions

None.
