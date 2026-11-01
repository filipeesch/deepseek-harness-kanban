# Design

## Context

See `proposal.md` for motivation and the delta specs for required behavior.

The current advance path is: `KanbanApp.observe` forwards every canonical session event to `AutoAdvanceCoordinator`; a live `turn/end` with reason `completed` queues the task, a 250 ms settle tick re-reads `ConversationFacts` through the app-level `facts` port, an `idleGate` decides, and `admitAutoAdvance` persists one `pendingTransition` that `dispatchPending` places and sends.

The pieces the change builds on:

- `ConversationFacts` is `{ running, background, awaitingReply, settledTurn }`. `running` comes from the native activity waterfall, `awaitingReply` from the `userQuestions` projection plus the registered `kanbanConversationFacts` fold's open approvals, and the app ORs the plugin question index into it (`src/host/app.ts:63`).
- The same OR exists a second time inside `AttentionCoordinator.withPendingQuestion` (`src/host/attention.ts:188`), fed by an injected `pendingQuestion` callback. Two compositions of one fact.
- `QuestionIndex.pending(sessionId)` is synchronous and in-memory.
- A prompt submitted through `ctx.sessionController.prompt({ mode: 'queue' })` becomes a `user/message` whose source is the SDK's `user-rpc` variant carrying `rpcId`; the queued item is a `UserMessage` in `agent.inbox.nextTurn` / `nextStep` (durable as an `agent/inbox/spliced` event, which the durable `inbox` projection reconstructs). The plugin's own stage instructions go through that same path.
- `ctx.agents.get(sessionId)?.inbox` reads the live queue synchronously; `ctx.sessionController.projections()` exposes the durable `inbox` projection for a conversation that is not live.
- `SessionPort.facts` is the only host-facing fact read; `AttentionCoordinator` caches it with a debounce, so it cannot be the gate's source of truth.

Constraints: no persisted task field changes and no data-version bump; the host and client ship together, so an internal snapshot contract change is acceptable; the advance trigger stays an observed completed turn; the existing five-second countdown, attention dots, and hub aggregation keep their meaning; host decisions must be deterministic and provable without a real model.

## Goals / Non-Goals

**Goals:**

- One authoritative definition and one composition of pending user work, consumed by the advance gate, the admission re-check, and the attention/snapshot path.
- Make the advance impossible while any conversation of the task owes the user input, and make that wait visible on the auto-mode control and self-clearing.
- Remove the retry-then-drop behavior and the duplicated awaiting-reply composition.
- Keep the pure policy (what blocks an advance) out of the coordinator and out of the class that owns wiring.

**Non-Goals:**

- Persisting the held state as a pause, or adding a resume action.
- Retracting an advance that was already admitted.
- Triggering an advance when pending work is consumed without a completed turn.
- Blocking on background jobs or schedules, or on unsent composer drafts.
- Changing the attention dots, the hub aggregation, or the status-strip vocabulary.
- Cancelling or reordering a queued user message.

## Decisions

### 1. Pending user work is a domain value with a pure gate

The value's shape lives with the other wire shapes in `shared/types.ts` (`PendingUserWorkKind`, `PendingUserWork`, `NO_PENDING_USER_WORK`) so `ConversationFacts` and `Attention` can reference it without inverting the layer. The pure rules live in a new `src/domain/pending-user-work.ts`:

```ts
function pendingUserWork(kinds: readonly PendingUserWorkKind[], queuedPrompts?: number): PendingUserWork;
function mergePendingUserWork(values: readonly PendingUserWork[]): PendingUserWork;
function hasPendingUserWork(work: PendingUserWork): boolean;
function awaitingReply(work: PendingUserWork): boolean; // any kind except queued-prompt
function samePendingUserWork(left: PendingUserWork, right: PendingUserWork): boolean;
```

New pure decision beside `domain/auto-advance.ts`:

```ts
type AdvanceDecision =
  | { kind: 'busy' }
  | { kind: 'running'; sessions: readonly string[] }
  | { kind: 'pending'; pending: PendingUserWork }
  | { kind: 'advance' };
function resolveAdvanceDecision(task: Task, facts: ReadonlyMap<string, ConversationFacts>): AdvanceDecision;
```

The coordinator maps the result: `busy` skips silently, `running` uses the bounded settle retry only when the ending conversation is the one still executing, `pending` is a hold with no retry and no pause, and `advance` admits the resolved plan. Alternatives considered: keeping the boolean chain inside the coordinator (rejected: it is the part that keeps regressing, and it is untestable without a fake host); adding the kinds to the existing `awaitingReply` boolean only (rejected: the queue has no representation and the gate would keep reading a partial fact).

### 2. One composition, injected into two consumers

`ConversationFacts` becomes `{ running, background, settledTurn, pending }`. The native adapter produces the native kinds; the app composes the plugin kind once and passes the *same* source to both consumers:

```
KanbanApp.observe ──> AutoAdvanceCoordinator ──> facts source ──┐
                                                               ├─> mergePendingUserWork(nativePending, questions.pending)
AttentionCoordinator.source ───────────────────────────────────┘
```

`SessionPort.facts` keeps its shape (now returning `pending`), and a small `withQuestionPending(source, questions)` wrapper lives in `host/pending-source.ts`, which the app wiring instantiates once and hands to both consumers. `AttentionCoordinator` loses its `pendingQuestion` option and `withPendingQuestion` method. Alternatives considered: a second `pendingUserWork(sessionId)` port (rejected: two sources of truth for one concept and an extra round trip per evaluation); having the gate read the attention cache (rejected: the cache is debounced and coalesced by design).

### 3. Native kinds are read from the most authoritative source available

- **Structured question** — the app's `QuestionIndex.pending`, synchronous, composed in decision 2.
- **Approval** — the registered `kanbanConversationFacts` fold's `openApprovalIds` for a live conversation (synchronous, append-driven); the inspected log otherwise.
- **Native question** — the `userQuestions` projection for a live conversation (the only public source), the inspected log for a cold one. The projection read is current at read time; a failed read is not idle.
- **Queued prompt** — `ctx.agents.get(sessionId)?.inbox.nextTurn` / `nextStep` for a live conversation (synchronous and authoritative), and the durable `inbox` projection for one that is not live; a projection that is missing or not `sequenced` throws instead of reading as empty. The inspected `agent/inbox/spliced` log was rejected as a third tier because it would re-implement the projection's own reconstruction. Only human input counts: the `next-step` inbox also parks host-injected context notices (for example a working-directory change) that are not user work, so an item whose source kind is not `user` is skipped, while an item with an unrecognized shape still counts so an unknown producer fails closed. The plugin's own queued instructions are excluded by `source.rpcId`: `SessionPort.send` records the request identity it used in a bounded per-conversation ledger (64 identities, oldest evicted first). The ledger is deliberately not pruned by the queue's current contents: the identity is recorded before its insertion is observable, so pruning on absence could forget an instruction that is about to appear and read it back as user work. A missing conversation state counts as pending (fail closed).

Alternatives considered: reading only `ConversationFacts.awaitingReply` (rejected: no queue, and the native question path is the one that lags behind a just-created turn boundary); counting every queued item (rejected: the plugin's own stage instruction would flash a false hold on the manual-countdown path).

### 4. Evaluation at the turn end, re-evaluation at admission

`AutoAdvanceCoordinator.settle` evaluates once per settle tick and keeps the bounded retry only for `running`. Pending user work ends the tick for that task with no requeue and no pause: the held state is derived, so nothing needs to be stored, and the next completed turn evaluates again. `admitAutoAdvance` re-reads pending user work (concurrently across the task's conversations) after it resolves the target conversation and immediately before the transaction that persists the transition; when work appeared, or when that read fails, it returns without persisting anything and without a pause. A failed gate read is reported and skipped the same way, so an unreadable conversation can never become an advance or a failure pause. Alternatives considered: persisting a hold to make the wait durable (rejected: it would need clearing rules, a schema change, and a restart story, and the state is derivable); keeping the 3-attempt drop (rejected: it silently forgets a task that is waiting for the user).

### 5. The held state is derived on the client and presented only by the control

`ConversationFacts.pending` flows into the snapshot; the client attention projection copies it into `Attention.pending`, folding the native client status's `pendingInteraction` in by its domain kind — a recognizable approval keeps that kind, and an unknown or generic kind only adds the native-question kind when the host does not already name an awaiting kind, so the dot and the chip never disagree and the label never contradicts the host's reason. `Attention.awaitingReply` becomes `awaitingReply(attention.pending)`, so the orange dot keeps its current meaning and a queued prompt does not light it. `autoModeView` gains the task-level merged pending value and the state precedence:

```
failed > advancing > paused > held > instruction > dead-end > armed
```

`held` returns no `status` and no `notice`, so the status strip and the drawer notice keep their admitted/failed/paused scope; the control's accessible name and title state the wait and the kinds that cause it. The client reads the task-level aggregate attention, which already merges every conversation's pending value, instead of re-merging the per-conversation map. The internal `waiting` state (unresolved stage entry) is renamed `instruction` so `held` is unambiguous. Alternatives considered: a host-projected wait state on the snapshot (rejected: the same fact would exist twice); showing the reason in the status strip (rejected by the chosen product behavior).

### 6. Re-project without running pending work

A question round restored from durable state or dismissed through the host changes pending user work without emitting a session event, so the attention cache must be invalidated for the chip to clear or appear without a reload. `AttentionCoordinator.touch` is the session-event path and its debounced tick also runs pending work (worktree resume and the transition drain); using it from a read-only question call re-drove a destructive operation that was still in `preflight` (caught by PW01). The app therefore invalidates the one conversation's facts and requests a publish only — coalesced after a restore, immediate after a dismissal or a failed dismissal — and never runs pending work from that path. Alternative considered: adding a projection-only refresh method to the coordinator (rejected: invalidation plus the existing publish already expresses it, and the coordinator keeps one scheduling policy).

### 7. Extract admission; app.ts keeps wiring

New `src/host/auto-advance-admission.ts` owns: the task guards, destination resolution and capture, target conversation resolution, the pending re-check, the durable transition, and the dispatch hand-off. `KanbanApp.admitAutoAdvance` becomes a thin adapter over it (the serialized command tail, the locator, the conversation creation, the pending source). The coordinator keeps the trigger, the settle, the dedupe, and the pause mapping. Alternatives considered: keeping the admission in `app.ts` (rejected: three repeated guard blocks and the re-validation would be one more copy).

### 8. Test seams

Domain tests cover the kinds, merge, and `awaitingReply`. Host tests use the in-memory fixture: `TestSessions` gains a queued-prompt set and a pending-approval set so each kind is exercised through `facts`; the coordinator and admission tests assert no advance, no pause, and no persisted transition for each kind, the closed-conversation case, re-validation during the admission, and the advance after consumption on the next completed turn. Client tests assert the `held` chip, the untouched dots, and the accessible name. The browser harness extends `tests/browser/auto-mode.spec.ts`; the real-composition lane `node scripts/e2e-dsh.mjs --only auto-mode` must stay green with the same replay fixtures.

## Risks / Trade-offs

- **A pending item in a closed conversation can hold the card for as long as it exists.** → This is the chosen product behavior; disabling auto mode, moving the card, or resolving the input releases it, and the control is the signal.
- **A transient native read failure holds the task until the next evaluation.** → Fail closed is deliberate; the failure is reported through the existing `report` port, and the next completed turn re-evaluates.
- **A persistently unreadable conversation cannot be presented as a specific pending kind.** → The spec requires only that the state is never treated as idle; the control keeps its previous state, the failure is reported, and the gate keeps refusing the advance.
- **The plugin's queued-instruction ledger does not survive a restart.** → A restarted host can briefly count its own queued instruction as user work; the item is consumed when the turn starts and the hold clears without an advance being lost.
- **`ConversationFacts.pending` replaces `awaitingReply` on the wire.** → Host and client ship together (existing precedent); `Attention.awaitingReply` keeps its meaning, and snapshot contract tests are updated in the same change.
- **Chip-only presentation is less discoverable than a status line.** → The accessible name and title carry the reason and kinds; the status strip remains the extension point if the product wants it later.
- **A conversation that was never displayed still counts.** → Pending user work is read from durable conversation state, not from a mounted surface, so this is intended; it also means the client must aggregate over every task conversation, not only the open ones.
- **Each completed turn now reads every conversation, including closed ones.** → The reads run concurrently, the queued-prompt read reuses the projection the facts read already fetched, and the gate only runs on an observed turn end, so the added cost is bounded per turn rather than per event.

## Migration Plan

1. Add the domain value and the pure blocker; keep the existing `awaitingReply` semantics as `awaitingReply(pending)` so the attention path is unchanged in meaning.
2. Change `ConversationFacts` and the wire schemas (host and client in one change), and derive `Attention.awaitingReply` from the new field.
3. Add the native pending read (approval, native question, queue tiers, `rpcId` exclusion) and its unit tests.
4. Compose pending user work once, inject it into attention and the coordinator, and delete the duplicated composition.
5. Extract the admission, add the re-validation, and remove the retry-then-drop path.
6. Add the client `held` state, the `instruction` rename, and the task-level aggregation; extend the client and browser tests.
7. Update `README.md`, `docs/operations.md`, and the two capability specs when the change is archived.

Rollback is safe: nothing new is persisted, so a reverted build reads the same Hub state. The only contract that must move together is the snapshot shape, and the host and client ship as one bundle.

## Open Questions

- The literal chip styling and wording for the held state are deferred to implementation; the specs fix the meaning and require the control's accessible name to state the wait, not the exact copy.
- Whether the queued-prompt count appears in the accessible name is an implementation choice within that meaning.
