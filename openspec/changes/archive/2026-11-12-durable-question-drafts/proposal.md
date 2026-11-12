# Proposal: Durable Question Form Drafts

## Why

The rich question strip is a composer-dock surface whose answers live only in React component state. Closing the task drawer, switching a drawer section or conversation tab, closing the conversation, or reloading the page unmounts the form and discards everything the user had already answered - even though the unanswered question round itself is durable per conversation. The README records this limitation as intended ("Form drafts and the collapsed state remain live UI state"), so the product actively tells people not to rely on their unfinished answers. That is the opposite of what a decision request asks for: a page is added precisely so the user can take time, consult the code, and return to answer.

## What Changes

- **Durable per-conversation question drafts.** The in-progress form state (selected choices, Other text, per-answer notes, Additional Notes, and the active slide) is persisted in a new host storage domain keyed by conversation and question round. Reopening the drawer, returning to a conversation tab, or reloading restores the draft exactly where the user stopped.
- **Restore scope.** Answers, notes, and the active slide are restored. The collapsed state stays live UI state: a restored round returns with its panel expanded, like a new round.
- **Conversation-scoped, not task-scoped.** A draft belongs to the conversation that owns the round, exactly like the question projection. Ordinary DSH chats without a task card get the same durability.
- **One conversation-scoped channel.** The existing per-conversation question feed carries the stored drafts in its baseline, so the form paints with its draft in the same frame as its round; writes use one new command that merges a single round instead of replacing a session record, and the client debounces them.
- **Lifecycle cleanup owned by the host.** A draft is removed when the round is answered by Submit, when it is answered by an ordinary chat reply, when it is dismissed, and when its task is deleted. The host enforces this at the storage boundary, so a stale client cannot resurrect it.
- **Bounded retention.** Draft records are capped to the 100 most recently updated conversations; older records are dropped. No age-based expiry.
- **Task deletion also clears the question projection.** Deleting a task currently archives its conversations but leaves their durable question records behind forever. The existing task-deletion cleanup now removes both the projection and the drafts for the task's conversations.
- **Refactors carried by the feature.** The form's draft state machine moves out of `QuestionForm` into a pure module plus a hook behind an injected port, and the composer-dock component moves out of `client.tsx` into its own module with a narrow service contract. `QuestionForm` becomes presentation only, and both new units are testable without the plugin composition.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `structured-questions`: adds durable drafts for the form state (restored across close, conversation switch, and reload; cleared by round completion, ordinary reply, dismissal, and task deletion), a bounded retention rule for draft records, and the removal of a deleted task's question state.

## Impact

- **Host storage:** a new `kanban_question_drafts` per-record domain opened by `src/host/question-storage.ts`, plus a delete operation for the existing question projection.
- **Host app and transport:** draft read/write/prune in `src/host/app.ts`, a new `saveQuestionDraft` remote command in `src/host/controller.ts` and `src/remote.ts`, the feed frame schema gains stored drafts on its baseline, and `src/index.ts` wires the new store into `KanbanApp`.
- **Client:** `src/client.tsx` registers the extracted dock component, a new `src/client/question-dock.tsx` owns the dock wiring, `src/client/question-draft-state.ts` (exposed through `src/client-bridge.ts`) owns the draft cache and debounced transport, and `src/questions/draft.ts` + a hook own the state machine used by `src/questions/QuestionForm.tsx`.
- **Docs and specs:** the README question section (`Questions and model-facing tools` and the dismissal paragraph) stops documenting drafts as ephemeral; the `structured-questions` delta records the new behavior; `package.json` version is bumped in the implementing pull request.
- **Tests:** pure draft state machine, `QuestionForm` restore behavior, host storage/merge/prune/deletion, dock remount restore and cleanup, and the plugin bridge composition.
- **Out of scope:** decision ledger, native approvals or pending user questions, transcript changes, cross-device collaboration of drafts beyond the host that owns the conversation, and any change to the existing dismissal confirmation flow.
