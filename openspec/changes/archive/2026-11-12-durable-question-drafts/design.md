# Design

## Context

See `proposal.md` for motivation and the specs delta for the behavior contract. The current implementation facts that shape this design:

- The question strip is a host slot occurrence registered in `src/client.tsx` (dock `kanban-decision-questions`) whose form component, `src/questions/QuestionForm.tsx`, holds the draft in `useState`. Its mount points are all unmount points: the task drawer (`src/client/drawer.tsx`), the drawer's Conversations section (`src/client/drawer-conversations.tsx`, `ConversationBody` keyed by the active session), and the application page itself on reload.
- The question round is already durable per conversation: `src/host/question-storage.ts` opens the `kanban_questions` per-record storage domain, `src/questions/indexer.ts` projects rounds from canonical events, `src/host/app.ts` restores/persists one record per session, and `src/host/controller.ts` streams one conversation's frame (`kanban/questionsFollow`).
- The per-conversation feed is the only conversation-scoped question channel and its baseline is requested when the dock mounts, so it is the natural place to deliver a stored draft together with its round.
- `QuestionRound.id` is `question-round:<sessionId>:<turn>` and answers are keyed by page `callId`, so a restored draft can merge with pages that arrive later without positional coupling.
- The host already has a task-deletion cleanup callback (`onTaskDeleted` in `src/host/app.ts`, invoked by `src/host/destructive-operation.ts` after the task record is removed) used for workspace and deterministic cleanup.
- The pinned DSH `@deepseek-ai/dsh-storage-domain` API used here (`defineDomain`, `domainTable`, per-record layout, table `get/put/delete/entries`) carries no `@deprecated` marker in the pinned DSH checkout; no deprecated host API is introduced by this change.

## Goals / Non-Goals

**Goals:**

- Make the in-progress question form state durable per conversation, independent of component lifetime, and restore it on remount.
- Keep the host authoritative for when a draft stops being valid, so no client can resurrect a finished round's draft.
- Bound stored draft data and remove it when the task that owns the conversation is deleted.
- Separate the draft state machine from the form presentation and the dock wiring from the client composition root, without touching the round projection's contract.

**Non-Goals:**

- Real-time collaboration on a draft between simultaneously open surfaces (a draft is read when a surface mounts; writes merge per round).
- Persisting the panel's collapsed state, the new-page notice marker, or focus.
- Changing the submission path, the dismissal confirmation, the transcript, or the native pending-question behavior.
- Deleting the question projection for any reason other than deleting the owning task.

## Decisions

### D1: Host-owned drafts in a dedicated per-record domain

Open a second domain next to the question projection, from `openQuestionStorage`, and return both stores from the same lifecycle:

```ts
QuestionDraftSessionRecordSchema = {
  version: 1,
  sessionId: string,
  drafts: Record<roundId, {
    answers: Record<callId, QuestionAnswer>,
    generalNotes: string,
    active: { kind: 'page'; callId: string } | { kind: 'notes' } | null,
    updatedAt: string,          // ISO timestamp used by retention
  }>,
  updatedAt: string,            // session-level ordering for retention
}
```

`QuestionDraftStore` is a narrow port: `load(sessionId)`, `save(sessionId, record)`, `remove(sessionId)`, `records()` (sessionId + updatedAt, for retention). Retention policy lives in the app, not the storage adapter.

- **Why host, not `localStorage`:** a draft must follow the conversation. `localStorage` is bound to the serving origin (port/profile) and to the browser, so a relaunch on another port, another browser, or Remote SSH would silently lose the work; and deletion of a task could only be inferred from a board snapshot instead of being executed.
- **Why a new domain instead of a `drafts` table in `kanban_questions`:** the question projection is deliberately transcript-free derived metadata; a draft is user-entered text that is not in the transcript yet. Keeping them in separate versioned domains keeps that boundary explicit and lets drafts evolve without touching projection reads.
- **Alternatives considered:** extending the `kanban_questions` record with an optional `drafts` field (couples user text to projection writes and races the 250 ms projection save); client `localStorage` mirroring `ReadAcknowledgments` (rejected above).

### D2: Transport — drafts on the feed baseline, one per-round write command

- `QuestionFeedFrame` gains optional `drafts: Record<roundId, StoredQuestionDraft>`. The host includes it only on the `baseline` frame, which already precedes every update for that conversation, so the form paints with its round and draft in the same frame and no extra round trip or flicker is introduced. Updates keep carrying rounds only, which avoids echoing a client's own write back to it, and an empty draft map is omitted so a conversation without drafts keeps its original baseline shape.
- A new command `kanban/saveQuestionDraft({ sessionId, roundId, draft | null })` persists one round's draft (or clears it). The host merges it into the session record instead of replacing the record, so two surfaces that each edit a different round cannot clobber each other.
- Writes for one session are serialized by a small per-session queue in the app (promise chaining keyed by session id, like the existing per-repository lanes). The merge is read-modify-write inside that queue.
- The command validates the payload (`INVALID_QUESTION_DRAFT` for a malformed or oversized draft: bounded text fields and bounded answer/page counts) and drops the write when its round is already answered or dismissed, which makes a late debounced write harmless.
- The client marks the draft dirty immediately and debounces the command (~400 ms, per round); it flushes on form unmount and on `pagehide`. The in-memory value is authoritative for the mounted surface, so remounting inside the same page is synchronous.

### D3: Bridge-level draft state with explicit hydration rules

`src/client/question-draft-state.ts` exposes `QuestionDraftState`, a sibling of `ConversationReadState`, constructed by `ClientBridge` with the write port:

- `hydrate(sessionId, drafts)` is called by the bridge's frame wrapper before the frame reaches `QuestionRoundCache`. A stored draft is accepted only when the round has no locally written draft in memory, so a stale baseline cannot overwrite text typed after the baseline was produced.
- `read(roundId)`, `update(roundId, storedDraft)`, `clear(roundId)`, `flush()`, `dispose()`.
- Clearing is immediate in memory, cancels that round's pending debounce, and is sent as `draft: null` immediately; the host's answered/dismissed guard remains the guarantee if the clear never arrives.
- The bridge wraps the existing `openQuestionFeed` `onFrame` callback (`src/client-bridge.ts`), so `QuestionRoundCache` stays unaware of drafts and keeps its single responsibility (round feed, submission suppression, dismissal).

### D4: Form state machine extracted behind an injected port

`src/questions/draft.ts` becomes the pure state module for the durable subset:

- `QuestionDraft` (client shape): `{ roundId, active, answers, generalNotes }`.
- `emptyDraft(roundId)`, `restoreDraft(roundId, stored)` (falls back to the first available page when the stored `callId` is gone), `toStoredDraft(draft, updatedAt)` (the persisted projection), `hasContent(draft)`, and pure updaters for choices, Other text, free text, per-answer notes, Additional Notes, and the active slide.
- `useQuestionDraft({ round, stored, onChange })` (`src/questions/use-question-draft.ts`) seeds from `stored` on mount, reseeds only when `round.id` changes, and reports the persisted projection on every durable change.

`QuestionForm` keeps only transient UI state: `collapsed`, submission status, admission error, the dismissal confirmation, focus/refs, and the seen-pages marker. New optional props `storedDraft` and `onDraftChange` keep every existing caller (including tests and the browser harness) working with in-memory behavior when they are omitted. This removes the state machine from a 279-line component without changing its markup.

### D5: Dock extracted with a narrow service contract

`src/client/question-dock.tsx` exports:

- `QuestionDock({ sessionId, services })` where `services` is a narrow interface covering the view observable, `track`/`retry`, submission flags and calls, `dismiss`, `send`, `focusComposer`, and the draft port.
- `createQuestionDockServices({ bridge, sessions })` builds that object once; `client.tsx` registers the slot with the component and the stable services value.

The composition root still owns the native scope lookup (`conversation.send`, `input.for(scope).focus()`) and passes it into the service factory, so the dock module has no dependency on the plugin composition or on `scopedSessions`.

### D6: Lifecycle cleanup is host-authoritative

- **Submit:** the admitted reply makes the round answered through the canonical `user/message` event, which the app already observes. After the projection update, the app removes drafts for rounds of that session that are answered or no longer present, saving only when something changed. System shutdown runs any coalesced answered-draft prune before the final flush instead of cancelling it.
- **Ordinary reply:** same path; the round becomes answered and its draft is removed.
- **Dismissal:** `dismissQuestions` runs the index change, the strict projection persistence, the rollback, and the draft removal inside the session's draft lane, so a concurrent debounced save never observes a provisional dismissal that a failed write would undo. The client keeps the drafts of rounds a stale dismissal leaves unresolved.
- **Write guard:** every `saveQuestionDraft` prunes answered/dismissed rounds before persisting, so a debounced write that lands after the round ended cannot recreate a draft.
- **Task deletion:** `onTaskDeleted` tombstones the conversation, removes the draft records and the `kanban_questions` projections for `task.sessionIds`, and calls `QuestionIndex.forget(sessionId)`. The tombstone makes an already-running history replay a no-op and blocks any later persistence, so a deleted conversation cannot be recreated at shutdown; an open feed for that session returns empty. Failures are reported, as the callback already does for workspace and deterministic cleanup.
- **Retention:** a background startup job keeps the 100 most recently updated draft records, and creating a new conversation record while at capacity re-runs the same bound during normal operation (`QUESTION_DRAFT_RETENTION = 100`). Runs are single-flight; a record refreshed after the prune's snapshot is never deleted by it; and a pass that skips refreshed candidates re-reads the ordering and picks replacements until the bound holds. No age-based expiry, and retention only touches draft records.

### D7: Failure policy and versioning

- Draft load/save failures are best-effort: reported through the host `report` hook, never surfaced as a blocking form error, and never preventing Submit. A failed draft read degrades the feed baseline to no drafts instead of withholding the rounds, and a failed save degrades to in-memory durability for the page session, which is better than losing the answer outright.
- The new domain starts at version 1 with no prior data and no migration; the existing projection domain is unchanged. Rolling back the change leaves inert draft records, which are bounded and dropped by retention if a later version reopens the domain.
- `package.json` version is bumped in the implementing pull request, per the repository release rule.

## Risks / Trade-offs

- **Write volume** (a debounced command per edit while typing) → 400 ms coalescing per round, flush on unmount, and one small per-session record; the local daemon transport cost is negligible compared with the current per-turn traffic.
- **Lost update across two surfaces** editing the same round → per-round merge prevents cross-round loss; within a round, last write wins, the same rule the form already applies locally.
- **Echo/ordering** (an old baseline re-hydrating a draft after the user typed) → dirty-marked rounds are never overwritten by hydration; clears are sent through the same per-session queue.
- **Best-effort deletion cleanup** → a cleanup failure leaves a record that retention eventually drops and that the write guard treats as stale; deletion never fails because of draft cleanup.
- **Feed payload growth** → drafts are delivered only on the baseline and only for unresolved rounds; answered/dismissed rounds are pruned at the boundary.
- **Validation in this worktree** → the branch has no installed dependencies, so `pnpm install` is required before the gates (`pnpm check`, `pnpm test:browser`) and the isolated e2e lanes.
