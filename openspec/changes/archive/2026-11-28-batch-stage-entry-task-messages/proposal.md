# Proposal

## Why

Kanban wakes the destination conversation with the stage instruction before it releases deferred task messages. A model can start executing the stage without the handoff that was supposed to inform its first request.

## What Changes

- Include all eligible `send_task_message` messages held for the stage and addressed to the instruction’s resolved conversation in the first model step that executes the instruction, immediately after it and in queue order.
- Keep each message’s own source, delivery identity, and native context row. The batch must not create a second model step or turn just to deliver those messages.
- Keep separate delivery for a different conversation or a stage without an instruction. Do not change immediate sends, tool arguments, or workflow routing.
- Verify the first model request with deterministic replay in isolated DSH, not merely eventual transcript arrival.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-messages`: Specify the first-step guarantee, ordering, and release behavior of deferred messages that share the stage instruction’s conversation.

## Impact

Affects host-side stage instruction admission, held-message release and deduplication, and their native DSH integration tests. No client, UI, or required dependency change is planned. No visual design was requested or approved; Design Review is not applicable.
