# Proposal

## Why

A task card whose conversation Session log cannot be observed shows nothing on the board. The host refuses the read with `SESSION_QUERY_CORRUPT_SESSION`, the plugin's conversation-facts cache converts that rejection into empty facts, and the card therefore reads as idle. The person learns otherwise only by opening the conversation, where the plugin replaces the host's own error with "Close and reopen this tab to retry" — advice that cannot work, for a log that never changes on its own.

The failure class is known and reproducible. `run_code` numbers internal calls as `<callId>:ptc:<n>` with `n` restarting at 1 on every execution, so a retried provider call id stores `:ptc:1` twice, and the log validator refuses the entire log with "PTC dispatch repeats subCallId". A proven repair for exactly this class already exists outside the product, as a personal script with a verification tool. Leaving it there means every new occurrence costs an undocumented manual procedure on the user's own session storage.

## What Changes

- Classify a failed Session observation instead of swallowing it, and publish the result per conversation beside the conversation facts. `ConversationFacts` keeps its current meaning: a conversation that was observed successfully.
- Separate three states that today collapse into "no conversation": the conversation was never created, the durable log is missing, and the durable log is unreadable.
- Present an unreadable or missing log in the task card's status strip. The card stays listable, movable, and editable.
- Present the diagnosis inside every native conversation — the task drawer and ordinary DSH chats — through a session-scoped seat. The plugin's own open-failure message is replaced, not supplemented.
- Offer the repair in that seat: a confirmation-gated action that renumbers colliding PTC dispatch identifiers only, validates the rewritten artifact before replacing it, swaps it atomically, and keeps the original as a backup.
- Block only sending into an unreadable conversation. Moving, editing, and every other board action keep working.
- Re-evaluate without restarting the plugin: a failed observation is recorded on the first failure, and an explicit recheck or a Session event clears it.
- Out of scope, in separate changes: fixing the writer that emits the duplicate identifier, and shipping an official repair command in the harness. Tool payloads are not extended.

## Capabilities

### New Capabilities

- `session-diagnostics`: classification of an unobservable Session, the diagnosis presented on the task card and in every native conversation, and the bounded repair of a repeated PTC dispatch identifier together with its safety contract.

### Modified Capabilities

- `kanban-board`: the task card status strip reports an unreadable or missing Session log and keeps the card usable.
- `task-conversations`: the conversation area presents the diagnosis instead of a plugin-owned open-failure message, and the conversation stays closable and navigable.

## Impact

- Host: `src/host/session-history.ts` (the single Session read), `native-facts.ts`, `conversation-facts-cache.ts`, `attention.ts`, `snapshot-assembler.ts`, `app.ts`, and `src/index.ts` for wiring.
- Wire: `src/shared/types.ts` for the observation record, `src/remote.ts` for the snapshot field plus a bounded artifact-location read and the repair command.
- Client: `src/client.tsx` for the seat registration, `conversation-surface.tsx` for the replaced open-failure presentation, `card-status-entries.ts` and `task-card.tsx` for the card line, plus the new diagnostic seat module.
- Domain: one classifier shared by the host and the client, so both halves agree on the vocabulary and no presentation logic is duplicated.
- New host module owning the repair: artifact scan, renumbering, frame-preserving rewrite, structural validation, atomic replace, and backup retention.
- Tests: host classification and repair behavior, client rendering of the card line and the seat, and a test proving that classification, diagnosis, and recheck never write to session storage.
- `package.json` version bump, because the installed artifact changes.
