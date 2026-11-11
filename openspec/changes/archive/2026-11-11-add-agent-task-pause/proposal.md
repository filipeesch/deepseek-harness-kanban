# Proposal

## Why

Auto mode chains work: every completed turn moves the card to its next stage and dispatches that stage's instruction. Nothing lets the agent that just finished a unit of work say "stop here — a human should look before the workflow continues".

The two existing mechanisms each answer a different question and neither covers this. Pending user work holds an advance only while an unanswered question, approval, or queued message exists, so an agent can only stop the chain by asking something it does not need. The recorded `autoMode.pause` explains why a turn did not complete, but it is advisory: no reader blocks on it, and an admitted advance clears it. Clearing the recorded transition with `set_next_transition` is not a stop either — the advance falls back to the default destination and continues.

An agent therefore has no way to hand control back without inventing a question or silently turning off automation the user enabled.

## What Changes

- Two new product tools, `pause_task` and `resume_task`. Both accept the same task scope as the other task tools: the calling task conversation, or an explicit task identifier so a conversation can pause or resume another task.
- `pause_task` requires a reason. A blank reason is rejected, and a reason above the accepted length fails the call with an actionable error instead of being truncated, so the recorded text never misrepresents what the agent asked for.
- A durable agent pause is stored with the task. Auto mode stays enabled, so the user's setting survives the pause; the pause itself is what suspends the automatic advance. Auto mode is on and paused at the same time.
- The pause blocks the automatic advance. It is evaluated where a completed turn is decided and again immediately before an advance is admitted, so a pause admitted during the settle window cannot be bypassed. It never blocks the user: a manual move, the next-stage action, and the stage run action stay available.
- `pause_task` on a task whose auto mode is disabled succeeds with an informative result and records nothing, because that task already does not advance.
- Three actions resume a paused task: activating the auto-mode control, `resume_task`, and moving the card. A new user prompt does **not** resume it. Resuming only returns the task to armed; it never moves the card or sends an instruction, and the next completed turn remains the only trigger.
- Activating a paused auto-mode control resumes it for every pause reason, not only the agent pause. This changes the current behavior of the diagnostic pauses, where activation turns auto mode off.
- The pause reason is presented in the card status strip and in the control's tooltip and accessible name.
- The recorded transition is unchanged. Clearing the recording still selects the workflow's default destination and never pauses anything.
- **BREAKING** for this installation's own stored data: the persisted auto-mode record gains a field that a plugin build older than this release rejects. Tasks are never published to a shared Hub document, so no other installation can receive it, and a downgrade requires resuming the pause first.

## Capabilities

### New Capabilities

None. The change extends behavior the existing capabilities already own.

### Modified Capabilities

- `kanban-board`: the auto-mode setting gains a durable pause requested by the agent, the condition that suspends an automatic advance gains that pause, the pause presentation distinguishes the agent pause from the diagnostic pause, and activating a paused control resumes it.
- `product-tools`: the product tool surface gains `pause_task` and `resume_task` with their scope, validation, and boundary — a pause suspends automation and never moves a task.

## Impact

- **Persisted data**: the task's auto-mode record in this installation's Hub document gains the pause field. The Hub schema is strict, so an older build cannot read a stored Hub that contains it; the shared document carries boards only, so nothing is published.
- **Domain**: the advance decision and the admission guard must share one blocking rule; the pause and the diagnostic pause stay separate records so a failing turn cannot erase the agent's required reason.
- **Host**: new commands, repository methods, tool module, and the settle path that drops queued advances.
- **Client**: the auto-mode control derives one more state, and a paused control's activation semantics change for every reason.
- **Docs and release**: `README.md` and `docs/operations.md` describe auto mode; the installed artifact changes, so `package.json` version moves in the same pull request.
- **Tests**: domain decision and admission, host commands and tools, client state derivation, and the existing pause scenarios that assert the old activation behavior.
