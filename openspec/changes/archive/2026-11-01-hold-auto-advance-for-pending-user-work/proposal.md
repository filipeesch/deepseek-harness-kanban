# Proposal

## Why

Auto mode advances a task as soon as a completed turn ends and the conversations look idle, but its idea of "idle" is incomplete: the native message queue is invisible to it, the check is a point-in-time read taken before the admission, and an advance that cannot be admitted is silently discarded. A card therefore moves while the user still has pending input — an unanswered question (structured or native), a pending approval, or a message queued for the next turn — which is exactly the reported "it advanced to the next column when the decision request was called" behavior.

## What Changes

- **One complete definition of pending user work.** Auto mode SHALL consider a task's conversations non-idle while any conversation of the task — including a closed one — has any of: an unanswered structured question round, an unanswered native question, a pending approval, or a user message queued for the next turn. Everything the user owes the task SHALL be consumed before an advance is admitted.
- **No advance while pending user work exists.** The trigger stays an observed completed turn. When pending user work exists, no advance is admitted, no pause is recorded, and the next completed turn re-evaluates. The wait is derived, never persisted, and ends when the last pending item is consumed.
- **The wait is visible only on the auto-mode control.** The card's auto chip and the drawer's mirrored toggle gain a held state. The status strip keeps presenting only admitted, failed, and paused advances; no new label is added there.
- **Admission re-validates the wait.** The advance decision and the admission read the same source, and the admission re-reads pending user work before it moves the task, so a question that appears during the settle window cannot be bypassed. A blocked advance is no longer dropped silently: it is simply not admitted, and the derived held state explains why.
- **Authoritative reads.** Pending user work is read from synchronous, durable sources for a live conversation (the plugin question index, the conversation-facts fold, the live agent inbox) and from the durable projection or log otherwise; a failed read fails closed instead of reporting idle. A plugin-sent stage instruction that is still queued is not counted as user work.
- **Refactors in scope.** Compose pending user work in one place instead of the duplicated `awaitingReply` compositions in `app.ts` and `AttentionCoordinator`; extract the automatic-advance admission from `KanbanApp` into its own service; split the coordinator's policy decision from its settle bookkeeping and remove the retry-then-drop path; rename the internal `waiting` chip state to `instruction` so the new `held` state is unambiguous.
- **BREAKING (internal contract).** `ConversationFacts` carries `pending: PendingUserWork` instead of `awaitingReply`; the client derives the awaiting-reply attention from it, so the orange dot keeps its current meaning (queued prompts do not light it). Host and client ship together; no persisted task schema changes and no data-version bump.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: the automatic-advance trigger now requires that no conversation of the task has pending user work, defines that work, keeps the trigger turn-based, requires admission re-validation, and states that the held state is presented only by the auto-mode control; the auto-mode requirement gains the held indicator state; the status strip keeps its admitted/failed/paused scope.
- `structured-questions`: an unanswered round is pending user work that holds auto mode; submitting the round or answering with an ordinary reply consumes it, and dismissing it consumes it.
- `task-conversations`: the drawer's mirrored auto-mode control reflects the held state, and the drawer's automatic-advance notice keeps its admitted/failed/paused scope.

## Impact

- **Domain:** a pure pending-user-work value (kinds, merge, `awaitingReply` derivation, empty case) beside `domain/auto-advance.ts`; the advance gate becomes a pure decision over the resolved plan, the task guards, and the pending work.
- **Host:** the native facts adapter composes the plugin question index into one pending-user-work read; the coordinator keeps the trigger/settle and delegates policy; the admission moves out of `app.ts` into a service that re-validates before moving; the queued-prompt read uses the live agent inbox with a durable projection/log fallback and a bounded ledger of the plugin's own prompt identities (`user-rpc` `rpcId`).
- **Client:** `autoModeView` gains the derived held state and a per-task pending aggregation over every conversation, including closed ones; the card chip and the drawer toggle render it; the attention projection derives awaiting-reply from the new facts.
- **Contracts:** snapshot `conversations` shape changes (internal, host and client ship together); `Attention.awaitingReply` keeps its meaning; no persisted task field, no migration, no data-version bump.
- **Tests:** domain coverage for the pending kinds, merge, and gate; host coverage for a queued prompt, an open round, a pending approval, a closed conversation, admission re-validation, and consumption followed by the next completed turn; client coverage for the held chip and the unchanged dots; the existing browser and real-composition auto-mode lanes.
- **Docs:** `README.md` auto-mode section and `docs/operations.md` auto-mode notes, plus the two capabilities' spec text.
