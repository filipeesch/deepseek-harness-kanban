# Design

## Context

See `proposal.md` for motivation. The current shape that constrains the approach:

- `createDeterministicRouter` (`src/host/deterministic-routing.ts`) owns the delivery gate today: it re-checks entry/result authority, a structural `blocked()` predicate, `sessions.isIdle()` per open conversation, the conversation set and directory identity, and a final `hubs.transact`. Every refusal returns a bare `{ status: 'held' }`; the `catch` around the awaited reads turns any failure into the same value.
- `DeterministicSupervisor.deliver()` sets `phase: 'delivering'`, calls the router, and on `held` returns the phase to `result-ready` with no other trace. `drive()` only calls `deliver()` when an owner is started; `reconcile()` starts an owner for a task whose saved result is not yet accepted.
- `DeterministicSupervisor.wake()` is the only direct retry entry point. It is called by `KanbanApp.sessionActivity` (agent status and subagent edges), `task.resume`, context-admission release, and implicitly by `sync()` from `hubs.subscribe` and `attentionChanged()`. `attentionChanged()` currently calls `sync()` over every task.
- `SessionPort.isIdle` in `src/host/native.ts` is the single readiness verdict. It concatenates: the `workspace/session-activity` waterfall (turn, subagent, job, schedule families), the live agent's status and `inbox.nextTurn`, the `turnBoundary` and `inbox` projections, and a full history read (`inspectedOpenTurn`, `nativePending`). It throws `SESSION_STATE_UNAVAILABLE` when the projection is not sequenced. Other callers use it for directory changes and archiving, where all owned activity genuinely matters.
- The job registry is the public `ctx.jobs` service (`@deepseek-ai/dsh-jobs`), registered as a cordis service with no `@deprecated` marker; `kill(id, caller, reason)` rejects a foreign job and reports `already-finished`.
- Client surfaces: `ScriptPanel` in the drawer receives `DeterministicSummary`; `ScriptActions` owns Play/Stop/Retry/Run again; the drawer already has a `kb-status-stack` slot immediately under the header for operation and pending-transition notices.
- Session conversation reads are expensive: the cited conversation is a 9.6 MB compressed log, and every `isIdle` call reads the full event log.

## Goals / Non-Goals

**Goals:**

- One refusal vocabulary shared by the host decision and its presentation, produced by a pure domain function.
- The held state is durable and self-describing; no new polling of conversation history.
- Delivery retried on the events that remove a blocker, with a single coalesced safety re-check per hold.
- Play is delivery-honest; re-execution is a distinct, explicit action.
- A user-controlled recovery for the common blocker (a runaway background job) from the drawer.

**Non-Goals:**

- Weakening the gate: a busy conversation still refuses delivery. No auto-delivery into an open turn or pending user work.
- Changing the job registry contract, the job lifecycle, or the native guard.
- General-purpose job management in the Kanban UI beyond the job named by the current hold.
- Splitting `DeterministicSupervisor.drive()`, reducing conversation-fact reads beyond what this design needs, or deduplicating presentation labels.

## Decisions

### 1. The hold is durable entry state, not an error and not a history row

Add `hold?: DeterministicHold` to `DeterministicControl` in `src/shared/deterministic.ts`:

```ts
interface DeterministicHold {
  code: DeterministicHoldCode;       // stable vocabulary, see below
  at: string;                        // when this reason was observed
  background?: Array<{ kind: 'job' | 'schedule'; id?: string; label: string }>; // bounded
  pending?: PendingUserWorkKind[];   // sorted, from the existing vocabulary
}
```

Codes: `task-operation`, `project-operation`, `pending-transition`, `worktree-not-ready`, `project-directory-missing`, `execution-directory-changed`, `auto-mode-hold`, `context-reserved`, `conversation-active` (open turn/subagent), `background-work` (job/schedule), `pending-user-work`, `conversation-unreadable`, `stale-authority`.

The supervisor writes it when a delivered attempt returns `held` and clears it when delivery is admitted or settles. Bounds: at most 3 background facts, labels at most 200 characters, pending kinds from the existing ordered vocabulary. The projection adds `hold` to `DeterministicSummary`; `src/domain/deterministic-state.ts` and `src/remote.ts` gain the schema (`hold` optional, so stored controls remain valid).

Why not reuse `error`: `error` already has a settled-failure meaning, and a hold is a recoverable wait that must not read as a failed execution. Why not a task-history row per refusal: the spec bounds diagnostics and forbids one row per retry; a history row would also rewrite on every conversation event.

The host reports a diagnostic through the existing `report` port only when `code`, `pending`, or `background` changes for an entry (`sameDeterministicHold`), so a stuck card leaves one line, not a stream.

### 2. Extract the gate into a pure domain module

New `src/domain/deterministic-hold.ts`:

```ts
interface HoldInput {
  task: Pick<HubTask, 'operation' | 'pendingTransition' | 'worktree' | 'autoMode' | 'sessionIds' | 'closedSessionIds' | 'effectiveCwd' | 'stageEntry' | 'deterministic'>;
  project: Pick<Project, 'operation' | 'projectPath'>;
  request: { control, capture, result };   // authority facts
  reserved: boolean;
  conversations: ReadonlyArray<{ sessionId: string; report: ConversationIdleReport }>;
}
function evaluateDeterministicHold(input: HoldInput): DeterministicHold | undefined;
function sameDeterministicHold(left?: DeterministicHold, right?: DeterministicHold): boolean;
```

It first evaluates authority (`stale-authority`), then the structural conditions in the same order as today, then conversation blockers, returning the first applicable hold with the facts that explain it. The router keeps the transactional re-check and maps a guard refusal into `{ status: 'held', hold }`; a stale request (authority lost, context changed, or aborted during an awaited check) stays a plain `held` with no hold payload, because the entry that would receive it is no longer the one that admitted the request. Pending user work is read after the awaited conversation reads and the task is re-read once more after it, so work admitted during a slow read is not missed by the admission. The router no longer owns the vocabulary.

Why: the router currently mixes authorization, blocking predicates, context identity, and a transaction, and the refusal facts are implicit in ordinary `if` statements. A pure function is directly testable per condition and gives presentation one source of truth. Alternative rejected: emitting the hold inline from the router — it would keep the vocabulary scattered across ten return points.

### 3. One readiness report inside the native adapter

Extend the port with `idleReport(sessionId): Promise<ConversationIdleReport>`:

```ts
type ConversationBlocker =
  | { family: 'turn' | 'subagent' | 'inbox'; }
  | { family: 'job' | 'schedule'; id?: string; label: string }
  | { family: 'question' | 'approval' };
interface ConversationIdleReport { idle: boolean; blockers: ConversationBlocker[] }
```

`createNativePorts` computes it once in a private helper from the same four sources `isIdle` uses today, and `isIdle` becomes `(await report(sessionId)).idle`; the public `isIdle` contract and every existing call site are unchanged. `SESSION_STATE_UNAVAILABLE` stays thrown by the helper and is mapped by the router to `conversation-unreadable` (the hold) instead of being swallowed. The routing port consumes the report so the gate and the explanation come from one observation.

Why not a second, explanation-only read: it would duplicate the ten checks and could explain a reason other than the one that refused. Why not replace `isIdle` everywhere with the report: directory changes and archiving need the same verdict and their messages are specific; changing the contract is churn without benefit.

### 4. Event-driven re-delivery, one safety re-check, no polling

- `AttentionCoordinator` already diffs conversation facts. Change its `onChange` callback to pass the session ids whose facts changed; `KanbanApp` maps those to tasks through the locator and calls `wake(taskId)` for each. `attentionChanged()` then only publishes, and `hubs.subscribe` keeps the broad `sync()` for task-state writes.
- A job settlement, a cancelled job, a subagent end, an answered question, a decided approval, a turn end, a schedule change, `task.resume`, and a released context admission all already produce one of: a session event that changes the facts, a `sessionActivity` call, or a hub transaction. Each therefore reaches `wake`.
- After a `held` delivery the supervisor schedules exactly one coalesced re-check per task (constant `HOLD_RECHECK_MS = 5_000`, injectable for tests), stored in a `Map<taskId, timer>`, cleared on `dispose`, `stop`, an accepted delivery, and a replaced control. It exists to close the race where the clearing event arrives while the refusal is being written; it is not a poll.

Alternative rejected: periodic polling while held. Each attempt reads the conversation's full log through `isIdle`/`idleReport`; the cited log is 9.6 MB compressed, and a board with several held cards would re-read them indefinitely.

### 5. Play delivers; Run again executes

- Generalize `DeterministicSupervisor.retryDelivery` to accept a saved result whose `deliveryStatus` is `pending` as well as `failed`, keeping its identity checks.
- `task.deterministicPlay` handler in `KanbanApp`: when the current entry owns a saved result that is not `accepted`, delegate to `retryDelivery` (or `wake` when the phase is `delivering`); otherwise call `play()` exactly as today.
- New command `task.deterministicRunAgain { taskId, entryId }` calls `play()` for that entry, refusing when an execution is active or stopping. It is the previous Play behavior, now explicit.
- Client `ScriptActions`: primary action sends `deterministicPlay` and is labelled "Deliver result" when a saved result awaits or failed delivery, otherwise Play/Stop as today; the secondary "Run again" sends `deterministicRunAgain` and is rendered only when a saved result exists and the entry is not active/stopping. The existing "Retry delivery" button and the failed-delivery "Run again" label collapse into these two actions.

Why the host-side rule as well as the client: the spec binds the behavior, not one client, and the command stays correct for any caller.

### 6. Cancel the blocking job through the public job registry

- Add `cancelJob(sessionId, jobId): Promise<'requested' | 'already-finished'>` to `SessionPort` (optional, so existing test doubles stay valid), implemented in `native.ts` with `optionalService<JobControlPort>(ctx, 'jobs')` and a minimal structural type; a missing service is `JOBS_UNAVAILABLE`.
- New command `task.deterministicCancelJob { taskId, jobId }`: locate the task, require the current `hold.background` to name the job id, pick the owning session among the task's open conversations, call the port with a reason naming the saved-result recovery, and `wake(taskId)`. A job that already settled returns `already-finished` and still wakes. A request the hold does not name is `STALE_HOLD`; the native registry independently enforces ownership.
- The drawer notice renders one Cancel action per `job` background fact with an action-local pending state; a failure is shown in the notice, not as a global saving indicator.

Why not a general job manager: the requirement is recovery of a held result, and limiting the action to the hold facts keeps authorization narrow and the command auditable.

### 7. Presentation: highlighted notice at the top of the drawer

- `src/client/deterministic-hold-notice.tsx` renders the notice from the summary's `hold`, inside `kb-status-stack` above `ScriptPanel` (the existing slot for operation and pending-transition status).
- Copy comes from a pure helper in `src/client/deterministic-view.ts` (`holdLabel`, `holdDetail`, `holdAction`) so the mapping is unit-testable and the stored record carries no presentation text.
- The notice uses the existing attention colour tokens with an explicit "held" label, so light/dark contrast is asserted by the browser lane like the other status entries. The card keeps its short script label and gains a `data-held` attribute for the existing card styling.

### 8. Preset review

The kanban workflow-architect preset tells an agent what Play does and how a deterministic stage settles. Review `presets/skills/kanban-workflow-design/` for statements about Play always executing, about a saved result being delivered automatically, and about background work; update only the statements this change makes wrong, in the same change, per `AGENTS.md`.

## Risks / Trade-offs

- **More conversation reads** → The report replaces `isIdle` at the same call sites, so a refused attempt makes the same number of reads; only the hold projection is new (no reads). The single re-check adds at most one extra attempt per hold.
- **A permanent blocker still means a permanent hold** (an open turn with no `turn/end`, a `stopping` job that never settles) → The notice names the reason and offers the applicable action; the re-check covers races, not permanent conditions. Permanent-condition recovery remains a manual Play, which now retries delivery instead of re-running.
- **Hold churn on a busy conversation** → One diagnostic per reason change via `sameDeterministicHold`; the record is bounded and replaces itself.
- **Rename of the Play semantics breaks existing specs** → Update the browser specs that assert "Retry delivery" and the host tests that assert Play re-runs; the new labels are part of the changed requirement.
- **A cancelled job changes the conversation history the agent expected** → The cancellation reason is explicit and names the saved-result recovery; the resume event is the normal `job/settled` edge.
- **Timer leakage** → One timer per task, cleared on dispose, stop, accepted delivery, replaced control, and task deletion; verified with fake timers.
- **The report and gate disagree after a future edit** → They are the same computation by construction (decision 3); a unit test asserts `isIdle(id) === report(id).idle` for each blocker family.

## Migration Plan

No stored-data migration: `hold` is optional, and a control written before this change simply has no hold to show; the client and host ship together in the plugin build. Rolling back to a plugin older than this change is a real schema boundary: the stored control schema is strict, so an older reader rejects a record that carries `hold`, exactly as it did for fields added earlier (parameters) and as the rollback guidance already requires. A rollback therefore restores a compatible plugin/record pair, not this newer record with an older reader. No host API deprecation is involved: `ctx.jobs` is the current public job-registry service, and `isIdle`'s public contract does not change.

## Open Questions

None that change the specs, the approach, or the task breakdown. The re-check delay (5 s) and the background-fact bounds (3 facts, 200-character labels) are constants to tune during implementation without changing behavior contracts.