# Design

## Context

See `proposal.md` for motivation and `specs/kanban-board/spec.md` plus `specs/task-conversations/spec.md` for the behavior contract.

The plugin is one bundled host/client pair. The host owns sessions, Git, and storage; the client renders the board and task drawer. Attention is the only board fact that is not persisted: it is recomputed and pushed.

Observed current state:

- `KanbanApp.snapshot()` reads each task conversation's attention through the `SessionPort`, caching one promise per session in a map. That cache is cleared by `session/event`, `schedule/changed`, and one 50 ms retry after either signal. The retry also resumes pending worktree operations, and existing tests depend on that single coalesced tick.
- The native attention read returns `running`, `awaitingReply`, and `failed`. `running` is `agent.status === 'running' || owned.length > 0`, where `owned` comes from the `workspace/session-activity` waterfall.
- The waterfall families are `turn` (contributed by the agent package while its status is running), `job`, `subagent`, and `schedule`. Every family carries `{ kind }` and non-turn families carry `items: [{ id, label }]`.
- The canonical turn edge is the Cordis `agent/status` event (`idle <=> running`). The plugin does not observe it; the session controller does and republishes it to the client as `api-session/status`.
- `subagent/start` and `subagent/end` are Cordis events; schedules publish `schedule/changed`; the jobs package publishes no Cordis event and exposes settlement only through its own service subscription. This plugin does not inject that service.
- The client bridge merges the host snapshot with the client-owned `uiSession.sessionStatus` and a per-session read reminder (epoch, acknowledged, viewers). It ORs both running sources, so neither can correct the other, and the feed has no periodic reconciliation.
- `Attention` is four booleans. `SnapshotSchema` validates it strictly, and `EMPTY_ATTENTION` seeds every task.

Constraints: no new dependency and no new injected service; host and client ship together; the client's native `completionUnread` and pending-interaction behavior must keep working; batch deletion keeps its conservative "any owned activity" rule.

## Goals / Non-Goals

**Goals:**

- One authoritative turn fact per conversation, delivered in the existing snapshot, that clears on the idle edge and cannot stay stuck.
- Turn execution and background activity are distinct facts from the same native read, so the board never has to infer one from the other.
- The client attention merge becomes a pure projection with client-owned concerns isolated from transport.
- Attention logic is testable without a live host, a native model, or a browser feed.

**Non-Goals:**

- Elapsed time, clocks, or turn start timestamps. The approved treatment has no duration.
- Per-conversation running indicators in the drawer tabs.
- Failure-acknowledgement semantics. The red failure dot keeps its current behavior.
- Splitting transition dispatching, question persistence, or conversation creation out of `KanbanApp`.
- Injecting the jobs service. Background settlement is covered by the bounded reconcile.
- Changing deletion eligibility, worktree coordination, or execution permissions.

## Decisions

### One activity read splits turn from background

The native fact source reads the `workspace/session-activity` waterfall once per conversation and partitions it:

```text
waterfall(sessionId)
  +--> kind 'turn'      -> turn = true
  +--> kind 'job'       --+
  +--> kind 'subagent'  --+-> background[] = items mapped to { kind, label }
  +--> kind 'schedule'  --+
```

Turn is taken from the `turn` family, not from a second `agent.status` read. The agent package contributes that family exactly while the session's agent is running, so the waterfall is already the single native answer for both facts.

Alternatives considered: reading `ctx.agents` directly for turn (a second truth next to the waterfall); deriving background on the client from native events (the client cannot see jobs). Rejected to keep one read and one contract.

### Host is the sole owner of turn state

`Attention.running` becomes turn-only and is produced only by the host. The client stops ORing `uiSession.sessionStatus.running` into the card. Native status remains the source for `completionUnread` transitions, reminder epochs, and `pendingInteraction`, which are client-owned concerns.

Alternatives considered: native status as the sole owner (splits the contract across layers and needs separate plumbing for background), or precedence between two sources (keeps the stale-correction problem and needs freshness tracking). Rejected.

### Event edges plus a bounded reconcile with one scheduler

The coordinator owns a single timer. Edge signals from the wiring request an early refresh; after every refresh it arms the next tick only while some conversation has turn or background facts:

```text
edge (agent/status | subagent/start | subagent/end | schedule/changed)
        |
        v
  schedule(50 ms) --\
                     >-- tick: invalidate, refresh worktrees, re-project,
  safety (2 s) -----/         publish only if facts changed, then re-arm
                              (50 ms coalesces bursts; 2 s only while active)
```

Edges: `agent/status` clears turn execution immediately; `subagent/start` and `subagent/end` cover both ends of a child lifecycle; `schedule/changed` covers schedules. Jobs and any future provider without an edge settle on the safety tick, so a missed edge costs at most two seconds rather than staying stuck indefinitely. A transient facts failure arms the same bounded retry (up to five reconciles, reset by a new edge), so a failed read cannot disable the self-heal.

The tick keeps calling the injected worktree-resume hook before publishing, preserving the existing behavior that a pending context operation resumes when activity ends. Publishing compares the projected attention with the previous value and calls the host's change notification only when it differs, so a quiet 2 s tick does not advance the snapshot sequence or push frames.

Alternatives considered: edges only (a provider without an edge stays stale forever); always polling (needless reads while idle); subscribing to the jobs service (new injected service and lifecycle for one provider); a second timer for safety (breaks the single-coalesced-tick assumption and risks publish storms).

### Wire contract: turn boolean plus background items

```ts
type BackgroundKind = 'job' | 'subagent' | 'schedule';
interface BackgroundActivity { kind: BackgroundKind; label: string }

interface Attention {
  running: boolean;                  // turn only
  background: BackgroundActivity[];  // non-turn work owned by the task
  unread: boolean;
  awaitingReply: boolean;
  failed: boolean;
}
```

Task aggregation ORs `running`, `awaitingReply`, `failed`, and `unread`, and concatenates background items across the task's conversations, ordered job, subagent, schedule. Every activity is retained so the displayed count is exact; only the label length is bounded. The ordering and label bound live in the projection, not in the native read, so the native facts stay complete.

No `since` field: the approved treatment has no duration, so turn start times are not read or transported.

Alternatives considered: a boolean `background` only (cannot satisfy the count and label requirements); a per-session attention map (unneeded without per-tab indicators); nesting the background count and labels (an array already yields the count and the detail).

### Client projection and reminders are separate units

`projectTaskAttention` is a pure function over the host attention, the native status map, the reminder view, and the task's session ids. It keeps the two client-owned merges that are not host facts:

- `unread = host.unread || (native.completionUnread && !acknowledged)`
- `awaitingReply = host.awaitingReply || native.pendingInteraction !== undefined`

`ReminderTracker` owns epoch, acknowledged index, running, unread, and viewer counts, plus the "new run resets a local read" rule and `viewSession`. The bridge keeps transport, question preparation, and composer claims.

### Presentation: one activity module, two variants

The card variant renders a working badge (pulsing dot plus `Working`) and, when background items exist, a quieter chip whose copy derives from the kinds (`1 job`, `2 jobs`, `1 subagent`). The chip is focusable, its accessible name carries both the count and the labels, and `title` carries the labels. A persistent hidden `role="status"` element stays mounted empty while idle and changes once to `Working on <task title>` when a turn starts; it does not include the pulse, so animation never announces. The drawer variant has no live region, so a selected card cannot announce the same transition twice. The card root gets a working attribute that drives the accent. The card keeps one meta line shared by the project name and the activity signals (attention dots, Working, background count), so there is no dedicated attention or activity row: the card stays compact and its height is identical while idle and while Working or background activity is shown. The card shows the background count; the full labels remain in the drawer and the chip tooltip.

The drawer variant renders the same working badge plus a secondary background line listing the labels, mounted in the header so it survives section switches.

Reduced motion replaces the pulse with a static dot through a media query; the accent and colors stay. Colors use host tokens already used by the plugin (`--dsw-alias-state-business-primary` and, with a fallback, `--dsw-alias-label-deep-diving`), so light and dark appearances follow the host.

Alternatives considered: mirroring the native chat's whale and shimmer (chat-specific asset and voice); elapsed-time clocks (rejected by the approved treatment); a fourth dot in the existing attention row (not distinguishable from unread/awaiting/failure).

### Module seams

```text
src/host/attention.ts         SessionFacts, SessionFactsSource port,
                              AttentionCoordinator (cache, single scheduler,
                              invalidation, projection), task aggregation
src/host/native-facts.ts      createNativeSessionFacts(ctx, deps):
                              waterfall partition, awaiting, failure
src/host/app.ts               delegates invalidation and projection; keeps the
                              worktree resume hook and store commands
src/index.ts                  registers the three activity edges

src/client/attention.ts       ReminderTracker, projectTaskAttention
src/client/activity.tsx       TaskActivity (card | drawer), background copy/ARIA
src/client/activity-styles.ts working/background rules and keyframes,
                              concatenated into styles
src/client-bridge.ts          transport, questions, composers; delegates attention
```

The coordinator receives its facts source, a worktree-resume hook, and a change callback. The fact source receives the native ports it needs (activity waterfall, projections, inspect) instead of reaching into the service container. Both are injectable fakes in host tests.

`native.ts` keeps session creation, directory validation, sandbox policy, Git execution, and workspaces; `attention()` and its three private helpers move out.

### Invalidation details

- `invalidate(sessionId)` drops only that conversation's cached read; the safety tick invalidates all cached reads before re-projecting.
- The cache is pruned against the task sessions present in the current board state, so deleted or removed conversations do not accumulate.
- Close disposes the timer, the source subscription, and the coordinator, and it drops late resolutions exactly as the current cache does.

## Risks / Trade-offs

- Worktree resume is behavior-bearing and tested through the same tick -> keep one scheduler and invoke the resume hook inside the tick, not beside it; update the existing attention-refresh and schedule-wake tests together, never one without the other.
- Reconcile ticks could churn the snapshot -> project first and notify only on a deep difference; assert no notification on a quiet tick.
- A timer could outlive the plugin -> dispose clears it and late resolutions are ignored; keep the existing close tests and add the reconcile case.
- Background activity can lag up to two seconds -> accepted; turn execution still clears instantly on its edge, and the background indicator is explicitly secondary.
- Labels can inflate the snapshot -> bound each label in the projection while retaining every activity, so the count stays exact; the native facts remain complete.
- Mixed host and client versions could misread the attention shape -> the plugin ships both halves as one bundle, and the strict schema rejects a mismatch instead of silently degrading.
- The reconcile repeats `resumePending` every two seconds while activity stays active -> the coordinator is serialized and idempotent, and it skips tasks whose operations are still waiting on activity.
- Two animations could distract (card pulse and the native chat indicator in the drawer) -> the drawer header is static text plus a dot, and the pulse is a single subtle dot, not a full-card shimmer.
- The failure dot's persistence is unchanged but still looks like the same class of bug -> explicitly out of scope here; noted for a follow-up decision.
- A failed facts read arms a bounded retry (up to five reconciles) -> a new edge resets the allowance; a permanently unavailable conversation stops polling until the next event instead of running forever.
- The card already uses a whole-surface `role="button"` with a nested selection checkbox; the focusable background chip follows that existing pattern. Restructuring the card to an inner open button would change the established whole-card activation and drag contract, so that structural accessibility refactor remains a follow-up.
- The meta line shares the project name with the signals -> a long project name truncates (its full value stays in the title attribute), and a card with every attention dot plus Working and background gives the project the remaining width. The drawer header still grows when its status line appears; reserving that row too can be a follow-up if it becomes distracting.

## Verification approach

Four fast plugin-owned layers plus one isolated appearance harness. The native `agent/status` emission remains upstream-owned; the integration layer emits it through a real Cordis context, which is the same public-contract boundary the previous change used for native engines. Real-composition web rendering was not executed for this change because the pinned checkout on this machine has an incomplete install and stale built libraries; that lane remains the release gate for a fully installed checkout.

1. **Node/in-memory units** — whole modules with injected fakes, no host, no timers except fake ones. New `tests/host/native-facts.test.ts`, `tests/host/attention-coordinator.test.ts`, and `tests/client/attention-projection.test.ts`. `tests/host/attention-refresh.test.ts` remains the app-level contract.
2. **jsdom components** — `tests/client/activity.test.tsx` for the card and drawer variants, plus updates to `tests/client/board.test.tsx` and `tests/client/styles.test.ts`.
3. **Real-Cordis host integration** — `tests/host/attention-lifecycle.test.ts`, modeled on `tests/host/schedule-wake-race.test.ts`: a real `Context`, fake native ports, a mutable activity-family map, manual `agent/status` emissions, and fake timers. This proves the edge wiring, the single coalesced tick, the worktree-resume coupling, and the push behavior.
4. **Playwright browser harness** — `tests/browser/running-status.spec.ts` and attention fixtures in `tests/browser/fake-api.ts`. This is the plugin-owned layer that computes real CSS animation and reduced motion.
5. **Isolated appearance harness** — `tests/browser/appearance.spec.ts` with `tests/browser/theme-fixture.ts`, which mirrors the pinned host's design-platform tokens. It emulates light and dark, asserts the working indicator resolves to the host token, the working text meets 4.5:1 contrast, the card accent is present, the background chip stays legible, and the drawer header keeps the status across sections. Screenshots land under `.verification/`.

Commands: `pnpm check` runs layers 1–3 (typechecks, full vitest, build). `pnpm test:browser` runs layers 4–5 through the existing harness build and stays out of `check`.


### Regression-first scenarios

These are the tests that would fail on the current implementation and must pass after it:

- `attention-coordinator.test.ts`: a first read returns `turn: true` (the early read at turn end); the source then goes idle and only an invalidation clears the cached value, with no further session event. The same suite proves a missed edge self-heals on the two-second tick, a quiet tick publishes nothing, and close clears the timer.
- `attention-lifecycle.test.ts`: a `turn/end` event while the agent is still running does not clear; the subsequent `agent/status` idle edge clears the snapshot with no additional session event, and the coalesced tick publishes nothing further. Background families appear through `subagent/start` and clear through `subagent/end` and `schedule/changed`.
- `attention-projection.test.ts`: the native status still reports `running: true` while the host reports idle, and the projected card is not running.
- `activity.test.tsx` and `running-status.spec.ts`: the working indicator and accent render, the background-only chip renders without Working, the drawer header keeps the status across sections, the pulse animates, and reduced motion keeps the indicator static.
- `running-status.spec.ts`: idle, working, and background cards in one column keep the same height because the project meta line is always present.

### File plan

New:

- `tests/host/native-facts.test.ts` — turn-only, each background kind with labels, mixed families, empty waterfall, pending approvals/questions, last-outcome failure and recovery.
- `tests/host/attention-coordinator.test.ts` — cache reuse, per-session invalidation, task aggregation with family order and exact counts, bounded failed-read retry and recovery, late-rejection identity fence, close.
- `tests/host/attention-lifecycle.test.ts` — real-context edges, missed-edge self-heal, quiet tick, worktree-resume coupling, push-on-change.
- `tests/client/attention-projection.test.ts` — host-authoritative running, unread acknowledgement, pending interaction, background passthrough.
- `tests/client/activity.test.tsx` — card and drawer variants, copy, tooltip/accessible labels, live-region contract, coexistence with the attention dots.
- `tests/browser/running-status.spec.ts` — animation, reduced motion, card states, one meta line height stability, drawer header.
- `tests/browser/appearance.spec.ts` — host theme fixture, light/dark token and contrast assertions, drawer appearance, screenshots.
- `tests/browser/theme-fixture.ts` — light and dark design-platform token values for the isolated harness.

Updated:

- `tests/host/attention-refresh.test.ts` and `tests/bridge/bridge.test.ts` — keep their app/bridge roles with the new shape and host-authoritative running.
- `tests/client/board.test.tsx`, `tests/client/styles.test.ts` — Working replaces Running; accent, token, keyframe, and reduced-motion contracts.
- `tests/host/helpers.ts`, `tests/worktrees/helpers.ts`, `tests/client/helpers.ts`, `tests/native/native.test.ts`, `tests/browser/fake-api.ts` — attention fixtures gain background items.
- `scripts/e2e-dsh.mjs` — the `running` scenario and its isolated fixture, override, and verification-directory environment.

No new dependency, no model adapter, and no real-model call. Every timing assertion uses fake timers.

### Requirement mapping

| Spec area | Covered by |
|---|---|
| Truthful and self-healing turn state | coordinator unit + real-context integration |
| Turn and background are distinct facts | native-facts unit + coordinator aggregation |
| Visible working indicator and card accent | activity component + styles contract + browser harness |
| Background count, labels, and drawer detail | coordinator aggregation + activity component + browser harness |
| Drawer header status on every section | activity component + browser harness |
| Coexisting attention indicators | activity component |
| Bulk deletion keeps its active-work rule | existing host `isIdle` and batch-deletion tests, unchanged |
| Host theme and reduced motion | styles token contract + browser harness for motion + appearance harness for host tokens and contrast |

### Limits

- The native agent emitting `agent/status` is upstream-owned; the integration test emits it manually. Real-composition web rendering for the new indicators was not executed because the pinned checkout on this machine has an incomplete install and stale built libraries; it remains a release gate for a fully installed checkout.
- Contrast cannot be computed from a stylesheet string; the appearance harness mirrors the host tokens and asserts the rendered token and contrast in both appearances, capturing screenshots under `.verification/`.
- Screen-reader announcement behavior is not automatable; the tests assert the `role="status"` DOM contract and the absence of ticking content.
- Background job settlement is exercised through the activity fake and the coordinator, not through a real job runtime; the browser and component layers cover its presentation.

## Migration Plan

1. Extend `Attention` and `EMPTY_ATTENTION`, then the strict snapshot schema, so the wire and the type move together.
2. Land the host fact source and coordinator with the wiring edges while the client still reads the old fields; then switch the client projection and presentation in the same change before review.
3. Update the host, bridge, client, and browser fixtures in the same change; the apply phase gates on `pnpm check` plus `pnpm test:browser`.
4. Rollback is a whole-plugin rollback; attention is transient, so no stored data needs migration.
5. After implementation and verification, archive the change so the two capability deltas update the main specs.

## Open Questions

None that affect the specs, the approach, or the task breakdown. Copy for mixed background kinds and the exact pulse timing are presentation details settled during implementation.
