# Design

## Context

See `proposal.md` for motivation. The constraints that shape this design:

- `src/host/session-history.ts` is the only module allowed to read a Session log. It calls `ctx.sessionQuery.observeSession(id, { projectionMode: 'none' })`, which throws `SessionQueryError` with `SESSION_QUERY_CORRUPT_SESSION` for an unreadable log and `SESSION_QUERY_SESSION_NOT_FOUND` for an absent one.
- `createNativeSessionFacts` folds live sessions and calls that read only for cold ones, so a corrupt log surfaces exactly in the post-restart case.
- `ConversationFactsCache.start()` swallows every rejection into `lastGood ?? EMPTY_CONVERSATION_FACTS`, keeps a retry allowance of five, and `AttentionCoordinator.refresh()` clears a failure for the ids it re-reads. This is where the error signature is lost today.
- `HostSnapshot.conversations` is the wire surface; the card status strip is composed client-side by `cardStatusEntries`.
- `TaskConversationWindow` returns early on `openState === 'error'`, so the host window never renders and the plugin's own message replaces it.
- The plugin already registers session-scoped contributions into the host conversation, including `conversation.input.dock` for the question dock. Slot props for a session-scoped slot deliver `props.sessionId` and `props.useSession`, and the composer stays mounted while history failed, so one seat there reaches the drawer and ordinary DSH chats.
- The host publishes the loader chain the validator uses: `@deepseek-ai/dsh-session-format-catalog`, `@deepseek-ai/dsh-session-persistence`, and `@deepseek-ai/dsh-session-format-v3-to-v4`. The build already marks `@deepseek-ai/*` as host-external.
- A proven procedure exists outside the product: a renumbering repair for the repeated PTC dispatch identifier, plus a verification tool that drives the loader chain over an artifact file.

## Goals / Non-Goals

**Goals:**

- Lose no Session-observation failure: classify it where it is produced.
- Keep `ConversationFacts` meaning "observed successfully", so no consumer of conversation facts is taught about failures.
- Use one vocabulary and one presentation for the board and for every native conversation.
- Repair exactly one corruption class, with the running host's own validator as the gate, and leave the artifact unchanged on any refusal or failure.

**Non-Goals:**

- Fixing the writer that emits the duplicate identifier; shipping an official repair command; extending tool payloads.
- Repairing a missing log or a torn tail; supporting the v0-v1 `tool/code-dispatch-start` variant.
- Gating the host's native composer.

## Decisions

### D1. Classify in a decorator over the facts source

A `createObservedFactsSource({ source, index })` decorator wraps the existing `ConversationFactsSource`. It awaits the inner read, records a classification in a new `ConversationObservationIndex` when the read rejects with a recognised code, and clears the record when a read resolves. Nothing else changes: `ConversationFactsCache` keeps owning cache, queue, and retry, and `AttentionCoordinator` keeps owning presentation scheduling.

- Alternatives: adding failure/recovery callbacks to `ConversationFactsCache` (spreads a new concern across the cache and its tests); classifying inside `createNativeSessionFacts` (the error is still swallowed downstream, and the source would need the index); classifying in `AttentionCoordinator` (mixes taxonomy with publication). The decorator sees the exact error before any swallow and is testable alone.

### D2. A parallel wire field, never a field on the facts

`HostSnapshot` gains `conversationObservations?: Record<string, SessionObservation>` with `SessionObservation = { state: 'unreadable' | 'missing'; cause: string }`, omitted when empty and added to the zod snapshot schema. `ConversationFacts` is untouched.

- Alternatives: an optional field on `ConversationFacts` (auto-advance, attention, and aggregated activity read those facts; a failed observation would enter decision paths as if it were data); a separate stream (unnecessary for a value that arrives with the snapshot).

### D3. One classifier, shared by both halves

`src/domain/session-observation.ts` exports a pure classifier from an error's `code` to `'unreadable' | 'missing' | null`, plus the presentation builders the card and the seat both use. The host applies it to the thrown error; the client applies it to the session's `openError`, which is a `RemoteFailure` carrying the same code. The client already imports from `src/domain/`.

- Alternative: two mappings (they would drift; the code list is the contract).

### D4. One seat in every native conversation

The client registers a second `conversation.input.dock` entry that reads `props.useSession(s => s.openError)`, classifies it, and renders the diagnosis with its details and actions. `TaskConversationWindow` loses its `openState === 'error'` branch, so the host window renders and the host's own history error stays visible beneath the seat. Unclassified open failures therefore keep exactly the host's presentation.

- Alternatives: keeping the plugin's early return (duplicate message, and the seat never mounts in the drawer because the window is not rendered); another slot such as `conversation.hero.options` (less room, no proven composer-adjacent seat).

### D5. The card line reads the aggregated observation

`cardStatusEntries` receives the observation for the task's open conversations and emits a failure-toned line. The signature grows by one optional positional input, matching its current shape; normalizing it to an object is deliberately left out of this change.

- Alternatives: refactoring the signature now (wider diff, unrelated to the acceptance criteria); a separate card component (duplicates the status region's ordering and tone rules).

### D6. The artifact location is read on demand

`session-history.ts` gains `locate(sessionId)`, which calls `ctx.sessionPersistence.stat` and returns the artifact path and revision from metadata without reading the log body. A new query re-observes one Session and returns the diagnosis with that location; the seat calls it when the person expands the diagnosis, and again when they recheck.

- Alternatives: resolving the location inside every snapshot (a metadata read per failing conversation per publication); hardcoding a storage root (the plugin has no public handle on it, and deriving it from the artifact path is exact).

### D7. The repair is a bounded, injected pipeline

A new `src/host/session-repair.ts` owns the pipeline and receives ports: artifact read, stage, atomic replace, discard, backup writing, the facts read used for verification, the loader-chain validator, and a clock. The scan, renumber plan, and field-rewrite are pure functions exported for tests. Attempts on one Session are serialized in-process, so two repairs can never read the same revision and overwrite each other. Order is fixed:

1. Refuse a live Session in this host (`ctx.sessions.get`).
2. Read the artifact bytes and its revision; refuse when the path shape or revision is unavailable.
3. Plan renames per `tool/ptc-dispatch-start` occurrence: only an identifier that already started earlier is renamed, its span runs to its own `tool/ptc-dispatch`, and the rename follows every approved reference — including a job registered inside the span that settles after the invocation closed, paired by `jobId`.
4. Rewrite the approved fields on the parsed record and self-check: same record count, same order, the diff confined to the planned records and to the exact approved paths with their exact old and new values, frames intact, no repeated identifier remains.
5. Validate the rewritten bytes with the installed loader chain, exactly as a read would. The chain is imported lazily here, so activation and diagnosis never depend on it; an unavailable chain refuses the repair.
6. Keep the original as a backup, outside the sessions tree, derived from the artifact path as `<sessions-root>/../session-repair-backups/kanban/<sessionId>/<timestamp>/`.
7. Stage the rewritten artifact beside the original, then re-read the target and compare path and revision, then re-check liveness, and only then replace it with one atomic rename. Those three checks happen after the last awaited write, with no other await before the rename.
8. Re-observe through the facts read. On success, record recovery. On failure, stage the original and restore it only when the artifact still holds exactly the bytes this attempt installed; a foreign artifact is left untouched and reported.

Refusals: torn final frame, unsupported classification, live Session (at entry, and again after the last awaited read), revision or path changed during the work, backup unavailable, failed rename, and a re-observe that still rejects the log. The read-to-rename window cannot be eliminated without the harness lock, so the restore is additionally guarded by byte ownership.

- Alternatives: shelling out to the personal script (unversioned personal path); delegating to a harness command that does not exist yet; replacing the original before validating (an invalid artifact becomes reachable to readers).

### D8. Two small host entry points

`session.inspect` (query) returns the state, cause, and location of one Session, re-observing it. `session.repair` (command) runs the pipeline and returns the backup path or a `Problem` with a specific code. Both are reachable from the bridge, so the seat works outside the board, where a snapshot refresh restricted to task conversations would not.

- Alternative: reusing `refreshSessionIds` (only re-reads task conversations; a plain chat would never recheck).

### D9. Only the plugin's own sends are refused

The plugin's send paths check the observation index before writing and return the diagnosis when the conversation is unreadable. The native composer belongs to the host and is not intercepted, so an attempt there fails exactly as it does today, with the diagnosis visible.

- Alternative: gating the composer through a host slot (the host owns send admission; the plugin would be fighting it).

### D10. Recovery is explicit, not retried

The index records the first failure and clears on the first successful read. The cache's retry allowance keeps working underneath and is neither extended nor reset by classification. A successful recheck clears the index entry, so nothing outlives the repaired artifact.

- Alternatives: retrying a deterministic corruption (wasted reads on a large broken log); a periodic probe (a read of a broken log per tick).

## Risks / Trade-offs

- **Loader-chain drift across DSH releases** → the validator is imported lazily from the installed host rather than copied, so it moves with the release and never blocks activation; a missing package refuses the repair with a stable message; the post-swap facts read remains the authoritative gate.
- **A writer outside this process during the final rename** → the read-to-rename window cannot be closed without the harness lock; the revision and liveness are re-read as late as possible, and the restore only touches bytes this attempt installed.
- **The plugin now writes durable storage** → every write is confined to the pipeline in D7, requires confirmation, keeps a backup, and is reversible; the read-only guarantee becomes a "no writes outside repair" guarantee, testable by revision comparison.
- **Backup outside the sessions tree can fail** → the repair refuses without a backup; nothing is lost.
- **The native composer still reaches the host** → the diagnosis explains the failure; the plugin does not pretend to gate a surface it does not own.
- **A live Session in another process** → a corrupt log cannot be write-opened successfully, so no writer retains the lease; the in-process liveness check plus the revision comparison covers the remaining window.
- **A failed observation for a Session that is also live** → classification only sees cold reads, so a live conversation never reports a diagnostic, which is the intended behavior.

## Migration Plan

- The wire field is additive and optional; an older client ignores it.
- No plugin storage migration is needed: the backup directory is created on first repair.
- `package.json` `version` is bumped in the same change, because the installed artifact changes.
- Rollback: revert the change. Repairs already performed remain valid artifacts; their backups stay on disk and are never read back automatically.
