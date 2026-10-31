# Design

## Context

See `proposal.md` — Why. This design covers the attention path from the native session facts to the card, board tabs, drawer tabs, and the conversation read state.

Current implementation, as it stands on `main`:

- `src/host/native-facts.ts` reads three native sources per conversation in parallel —
  the `workspace/session-activity` waterfall, projections, and an inspection — and
  produces `SessionFacts { turn, background, awaitingReply, failed }`. `partitionActivity`
  maps the waterfall's `turn` family to `turn`, and `job`, `subagent`, and `schedule`
  items to `background`. `lastOutcomeFailed` scans every `turn/end` and reports whether
  the last one ended with `reason.kind === 'error'`.
- `src/host/attention.ts` (`AttentionCoordinator`) caches one read promise per session,
  invalidates on session events and activity edges, coalesces a 50 ms refresh plus a
  2 s reconcile while anything is active, and projects **task-level** attention with
  `mergeTaskAttention` (OR the booleans, concatenate background items, sort by kind and
  bound labels) and `sameAttention` change detection.
- `src/client-bridge.ts` merges the host snapshot with the native
  `SessionStatusSnapshot` through `projectTaskAttention` and the client-owned
  `ReminderTracker`. Unread therefore depends on the native `completionUnread` flag,
  which is set when a non-main session's `running` goes true to false and cleared when
  it starts running again. Nothing persists it.
- `src/client/conversation-surface.tsx` mounts `viewSession` for the visible
  conversation content; `src/client/drawer-conversations.tsx` renders the conversation
  tabs and the closed list; `src/client/task-card.tsx`, `activity.tsx`, and the style
  modules render the working badge, background chip, and the attention dots.

Native facts that shape the approach: the waterfall's `turn` family reports only the
queried session's own agent (`packages/core/agent/src/archive-admission.ts`), while the
`subagent` family reports every running descendant at any depth
(`packages/subagent/subagent/src/archive-admission.ts`). Job and schedule families report
their own unsettled work. `SessionPort.isIdle` already treats every family as active, so
changing the display classification does not change deletion or directory safety.
Host and client ship together, the snapshot schema is internal, and the plugin already
owns a `localStorage` helper for UI preferences.

## Goals / Non-Goals

**Goals:**

- One authoritative, durable fact per conversation: which agents are running, and the
  identity and outcome of its last settled turn.
- Blue and red derived from that fact plus a per-conversation read acknowledgment, so
  they are only shown when the whole conversation is idle and they clear when read.
- Per-conversation attention available to the client for the drawer tabs, while the
  card and board/hub tabs keep a task-level aggregate.
- A host that owns facts and a client that owns reading and presentation, with each
  unit independently testable.

**Non-Goals:**

- Changing workflow, execution admission, deletion eligibility, or worktree behavior.
- Changing the Hub or board tab aggregation requirements.
- Adding per-tab working indicators, elapsed time, unread counts, or dots on closed
  conversation entries.
- Surfacing a failed subagent turn as the parent conversation's red dot.
- Persisting acknowledgments on the host.

## Decisions

### Execution classification folds owned subagents into agent execution

`partitionActivity` returns `{ running, background }`:

```text
waterfall(sessionId)
  kind 'turn'      -> running = true                    (this conversation's own agent)
  kind 'subagent'  -> running = true, labels captured    (owned descendants, any depth)
  kind 'job'       -> background[]                       (job items)
  kind 'schedule'  -> background[]                       (schedule items)
```

`SessionFacts.turn` becomes `running`; `BackgroundKind` narrows to `job | schedule`; the
drawer's `Background:` line and the card chip stop naming subagents. The native
`subagent` family already lists only running descendants, so a delegated subagent keeps
the conversation working until it finishes, and a job or schedule that outlives the turn
is the only background work left.

Alternatives considered: keep `subagent` in background and add a separate
"delegating" flag for the working badge (rejected — two truths for one native fact, and
the chip would need client-side filtering); show both Working and a subagent chip
(rejected — it is the confusion the user reported).

### The settled turn is the notification identity for both indicators

`lastOutcomeFailed` becomes `lastSettledTurn(inspection)`, returning the **last**
`turn/end` event's `{ seq, outcome }`, with `outcome: 'error'` only when
`data.reason.kind === 'error'`, or `null` when the conversation never ended a turn:

```ts
interface SettledTurn { seq: number; outcome: 'ok' | 'error' }
```

`seq` is the durable session event sequence. It is stable across restarts, increases per
conversation, and is already available from the inspection read the host performs today.
A single identity lets blue and red share one acknowledgment: a failed turn shows red,
a successful turn shows blue, and both stop when the acknowledgment reaches that `seq`.
A later turn always produces a newer identity, so a new failure re-arms the red dot even
when the previous turn was already read.

Alternatives considered: keep separate `failed` and `unread` facts (rejected — two
acknowledgment rules that can disagree); keep the native `completionUnread` as the unread
source and only add failure acknowledgment (rejected — it is not durable, not
conversation-tree aware, and cannot be re-armed by a later failure while the flag stays
false); compare turn timestamps (rejected — `seq` is already ordered and durable).

### Per-conversation facts cross the wire; task aggregation moves to the client

The host stops producing presentation. The wire snapshot carries conversation facts:

```ts
interface ConversationFacts {
  running: boolean;                       // own agent or an owned descendant
  background: BackgroundActivity[];       // jobs and schedules only
  awaitingReply: boolean;
  settledTurn: SettledTurn | null;
}
// wire: conversations: Record<sessionId, ConversationFacts>
```

The bridge projects each conversation with the client-owned acknowledgment and the
native `pendingInteraction`, and derives the aggregate:

```text
projectConversation(facts, acknowledged, status)
  unread       = !facts.running && facts.settledTurn.seq > acknowledged
  failed       = !facts.running && facts.settledTurn.outcome === 'error'
                   && facts.settledTurn.seq > acknowledged
  awaitingReply= facts.awaitingReply || status.pendingInteraction !== undefined

taskAttention = OR(running) , OR(unread) , OR(awaitingReply) , OR(failed) ,
                concatenated background, ordered job -> schedule, bounded labels
```

`AttentionCoordinator.project` returns the session-keyed facts and keeps its cache,
invalidation, coalescing, and change detection; `mergeTaskAttention`,
`normalizeBackground`, and the task-keyed `sameAttention` leave the host. The client
projection owns ordering and label bounds because they are presentation.

The wire and the client snapshot are separated in the shared types: the host response
carries `conversations`, and the client snapshot adds the derived `attention`, the
`conversationAttention` map, and the client epoch. `SnapshotSchema` validates only the
host facts; the browser fixtures keep building a client snapshot with explicit maps.

Alternatives considered: keep the task-keyed aggregate and add a parallel per-conversation
map (rejected — two shapes of the same facts, payload duplication, drift); let the host
apply acknowledgments (rejected — a new command, host storage, and a client viewer signal;
the acknowledgment is a client read concern and the existing reminder logic already lives
there).

### Read acknowledgment is a durable client concern behind a storage port

New units under `src/client/`:

- `key-value-storage.ts`: the `KeyValueStorage` port (`get`, `set`) with a
  `localStorage` adapter that swallows storage failures, mirroring the existing
  preferences behavior.
- `read-acknowledgments.ts`: loads one versioned record
  `{ version: 1, ack: { [sessionId]: seq } }`, exposes `acknowledged(sessionId)`,
  `acknowledge(sessionId, seq)`, `prune(knownSessionIds)`, and a coalesced `flush()`.
  An absent entry means `0`, so the conversation's settled turn reads unread — the
  explicit no-seeding choice.
- `conversation-read-tracker.ts`: replaces `ReminderTracker`. It owns viewer counts,
  acknowledges the settled turn of every viewed conversation whenever a projection
  arrives (so a turn that settles while the content is mounted is read immediately),
  and exposes `close(sessionId)` for tab closing. It does not know about snapshots,
  sessions, transport, or how unread is presented; the projection derives unread and
  failure from the acknowledged sequence it exposes.
- `attention-projection.ts`: pure functions `projectConversation` and
  `aggregateTaskAttention`, replacing `projectTaskAttention` and absorbing
  `normalizeBackground`.

The bridge keeps orchestration: it loads/creates the tracker, projects every task
session on publish (using empty facts when the host has not reported that conversation
yet, so a native pending interaction still contributes), and still exposes `viewSession`
for the mounted content. On every accepted snapshot it compares each task's
`closedSessionIds` with the previous one and calls `tracker.close` for a newly closed
conversation before refreshing the facts, so the acknowledgment targets the turn the
reader had seen at the close; a turn that settles afterwards stays unread. A conversation
that was already closed when the bridge started has no observed close transition, so its
settled turn stays unread until it is reopened and read. `src/client/attention.ts` shrinks
to these focused units; no unit grows into a second bridge.

Alternatives considered: persist acknowledgments on the host (rejected by the chosen
scope — extra storage and command surface for a read marker); keep the epoch/count
tracker and mark failures as a boolean (rejected — an epoch counter cannot identify
which failure was read, so a second failure while the flag stays true would never
re-arm); seed the acknowledgment on first observation (rejected by the user — existing
settled turns should read unread once).

### A shared attention-dot component serves the card and the conversation tabs

`AttentionDots` renders the existing blue, orange, and red dots in a fixed order from
three booleans plus the labels the current card uses. The card keeps it in the context
region. Each open conversation tab renders the same component for its own projected
conversation, keeps the tab's visible label unchanged, and adds the applicable states to
the tab's accessible name through visually hidden text. The dots themselves stay
decorative inside the tab so the accessible name is not a concatenation of three
images. The closed-conversation list does not render the component.

The board passes a `conversationAttention` map (session id to projected attention) into
the drawer next to the task-level `attention`, so `DrawerConversations` can resolve each
tab's indicators without deriving attention itself.

Alternatives considered: three `role="img"` spans nested in the tab button (rejected —
verbose and unstable accessible names); a per-tab custom markup block (rejected —
duplicates the card's dot contract); a context provider over the snapshot (rejected for
this scope — an explicit prop is easier to trace and test).

### Working presentation is reused and its label is matched to the chip

The working indicator keeps one component for card and drawer. `attention.running`
already carries the new meaning, so no new prop is needed. The activity copy drops the
subagent kind from `UNITS` and `KIND_ORDER` (job, schedule). The working label is styled
at 10.5px, weight 600, with no letter-spacing, matching the background chip and keeping
the reserved one-line activity region. The persistent live region keeps announcing the
idle-to-working transition and does not announce the pulse.

Alternatives considered: shrink only the card (rejected — the drawer would diverge);
drop the word "Working" for an icon (rejected — the spec requires a visible working
indicator and the user asked to keep the label, only smaller).

## Risks / Trade-offs

- [The first load after the upgrade marks every settled conversation as unread] →
  Accepted, explicit no-seeding choice. Opening or closing a conversation clears it; no
  migration writes an acknowledgment.
- [The acknowledgment is per browser origin and can be lost when storage is cleared or
  the origin changes] → The underlying notifications are durable host facts, so they
  reappear as unread instead of being lost; the record is versioned and shared with the
  plugin's existing `localStorage` pattern.
- [The board's blue dot diverges from the native sidebar's unread flag] → Documented
  meaning: a durable unacknowledged settled turn. The plugin stops reading native
  `completionUnread`; no other surface is changed.
- [Task-level aggregation could be tempted to compare settled sequences across
  conversations] → Keep `settledTurn` per conversation and never merge it into one
  number; the task aggregate carries only booleans and background items.
- [A closed conversation can hold task-level attention with no per-conversation hint in
  the closed list] → Explicit choice. The card still signals the task; reopening a
  conversation mounts its content and acknowledges it.
- [A turn can settle between two reads while its content is mounted and be acknowledged
  immediately] → The content is mounted and visible by definition, matching the current
  reminder behavior; the acknowledgment is per conversation, never per task.
- [The wire contract change breaks fixtures and host tests that build task-keyed
  attention] → Host and client ship together and the implementation phase updates the
  tests and browser fixtures with the new shape.
- [Per-conversation facts increase the snapshot payload] → Only the small set of
  conversations belonging to tasks is sent, one entry per conversation, without history.
- [A read failure before any successful read has no last known facts] → The conversation
  projects as idle until the bounded retry succeeds; no blue or red is invented for a
  transport failure, and the retry publishes as soon as the facts differ from the last
  projection.
- [Two browser tabs flush the same acknowledgment record] → Each flush merges the stored
  record before writing, so one tab cannot replace another tab's acknowledgments; live
  cross-tab display updates wait for the next snapshot.
- [Subagents disappear from the drawer's activity labels] → Their work is now the
  working state, which is what the change asks for; job and schedule labels remain
  available on hover and to assistive technology.

## Migration Plan

- No persisted task, hub, or board data changes. A new client key
  (`dsh.kanban.readAcks`) is introduced; its absence means "not read", with no seed and
  no backfill.
- The plugin ships host and client together; the snapshot schema is internal, so there
  is no mixed-version deployment. Rollback is reverting the plugin files: the old
  native-unread path returns and the new client key is ignored.
- Implementation verification follows the project's lanes: host unit tests for the facts
  and projection, client unit tests for the tracker and tabs, the plugin-owned browser
  harness with updated fixtures, and the isolated smoke lane defined in `AGENTS.md`.
