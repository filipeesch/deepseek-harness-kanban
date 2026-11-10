# Proposal

## Why

A stage instruction is the host's own work order for a task's current workflow stage, but it is delivered as an ordinary user prompt. In the transcript it is indistinguishable from something a human typed, host projections that count human input must be taught to ignore it through a plugin-side ledger, and the plugin cannot present it with the context presentation the task context already uses. The task envelope already has the right shape: a plugin-sourced native message that the host renders as a context row. Column instructions should travel on that same channel.

## What Changes

- Every stage-instruction delivery — the card run action, the timed instruction after a move, the confirmed-transition drain, the automatic advance, and the agent-created first execution — delivers one plugin-sourced native message instead of a user prompt. The message starts the turn and carries `source.kind = 'stage-instruction'`.
- The model-facing content is unchanged: the same entry instruction, followed by the same host-generated transition briefing when the stage configures two or more targets.
- The message declares the host's `notice` context form with a bounded one-line summary (`Stage: <name>` plus the transition target when the stage configures one), so the native context-injection row shows it collapsed and expandable.
- The plugin claims the message with an exclusive Chat Definition and presents it through the host's native context-injection renderer. If that renderer is unavailable, an inline fallback row preserves the instruction text.
- Delivery is at most once per request identity. The native prompt dedupe no longer applies, so the host reads the conversation's log for an already-delivered stage instruction with the same identity before it delivers again.
- **BREAKING** A stage instruction is no longer a user message: it no longer appears as a user bubble in the transcript, it no longer counts as human input in host projections, and it no longer derives a conversation title.
- Cleanup shipped with the change: message composition and delivery move out of the admission module into dedicated units, and prompt-admission bookkeeping is shared instead of duplicated.

## Capabilities

### New Capabilities

None. The behavior belongs to the capabilities that already own task conversations and the board's stage-instruction delivery paths.

### Modified Capabilities

- `task-conversations`: a delivered stage instruction becomes a plugin-sourced native context message; the first-turn context requirement and its first-stage-instruction scenario change to describe that message.
- `kanban-board`: every stage-instruction delivery path, the transition briefing placement, and the pending-user-work classification change to describe delivery as context rather than a user prompt.

## Impact

- Host: `src/host/stage-instruction.ts`, `src/host/native.ts`, `src/host/queued-prompts.ts`, `src/shared/ports.ts`, `src/index.ts`, plus new units for message composition and delivery.
- Host API: the plugin now resolves the live agent and appends to its inbox through `agent.followup`; the human-prompt path stays for schedules.
- Client: one shared context-row module reused by the task-context and stage-instruction rows, plus the stage-instruction Definition and slot registration.
- Tests: host unit tests for admission, briefing, delivery, and pending work; host fakes that implement the session port; three end-to-end templates and their replay fixtures that locate the instruction as a plain user message.
- Specs: `task-conversations`, `kanban-board`.
- Documentation: the project instructions' smoke checklist keeps its assertion that a later instruction adds no second task-context message; it gains the context-row assertion for the instruction itself.
