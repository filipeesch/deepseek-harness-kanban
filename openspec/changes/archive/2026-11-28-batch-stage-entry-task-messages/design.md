# Design

## Context

See [proposal.md](proposal.md) for the problem. The shared admission in `src/host/stage-instruction.ts` wakes DSH with a native stage-instruction message. It clears the entry marker, then `releaseHeldMessages` resolves and steers each deferred message independently. The native stage instruction already identifies its entry and request, and deferred task messages already carry stable request identities. The existing host test checks eventual release, not which model request sees the message.

## Goals / Non-Goals

**Goals:** Use the native step admission boundary rather than coordinating wake-up timing. Keep existing routing, stage-instruction content, and independently identifiable transcript messages. Use the existing local held queue and native conversation log as recovery evidence.

**Non-Goals:** Do not add a new workflow field, delivery argument, durable message store, host API dependency, or rendering surface. No visual design was approved or is required.

## Decisions

### Use the stage instruction as the only wake-up and extend its accepted pre-step batch

Use the public `agent/pre-step` waterfall and the placement pattern in `src/host/pre-step-injection.ts`. On an accepted, non-aborted step containing a native stage instruction, resolve the owning task from the receiving session. Match the instruction's producer, request identity, and exact current entry identity; matching only a column ID or an agent name is not sufficient. Select the still-held messages for that stage whose target resolves to this conversation, using the existing main/agent binding rules without creating conversations from the hook. Use the same message builder as separate release. Splice the selected native task messages immediately after the instruction, preserving queue order and every pre-existing input. Only that instruction's step can claim the messages; a running conversation's unrelated steps cannot. Re-read authority after awaited work, before returning the decision.

The supported DSH floor (`dsh-v0.2.2-rc.1`) and the inspected checkout expose `agent/pre-step` without deprecation. The neighboring deprecated call-config hook cannot edit messages and is not suitable. `followup` and `steer` admit individual messages at different boundaries; `inject` targets the nearest pre-step, which can belong to unrelated work in an active conversation. A timer or consecutive sends still leave scheduling dependent on the host. Embedding the bodies in the instruction would avoid the race but discard the separate delivery identities and transcript rows.

### Partition release by the resolved conversation

After shared stage admission, keep the separate release path for the other destinations only. That path must still prepare their conversations and use ordinary steer semantics after instruction admission. Skip the same-conversation messages even while they remain held awaiting native confirmation; failure in a separate destination must not prevent a same-conversation message from entering the batch. For a stage without an instruction, retain the existing placement path. Do not run release on reorders or change how unreachable destinations are discarded. Preserve the existing behavior for immediate sends and scripts' own handoff content.

### Finalize only on durable message acceptance

Do not consume the held queue when the instruction is enqueued or when pre-step returns its proposed batch. DSH appends accepted messages before building the model request. Observe the matching plugin-sourced message append with the public `session/event` observer, following the confirmation pattern in `src/host/scripted-handoff.ts`, and remove that held item and mark its identity released in one local transaction. Keep observation and in-flight bookkeeping scoped by conversation, stage entry, and message identity; do not await a future model step from the task's serialized admission or do persistence inside the synchronous observer. On an interrupted write, reconcile the source and request identities in native history at the next applicable delivery attempt, before selecting messages, and finalize already recorded ones without re-injecting them. Include already pending identities in duplicate detection. A rejected or canceled step that never recorded a message leaves it held for an eligible retry, without an independent wake-up. Report failures through the existing host path; do not silently run the instruction alone when required batch preparation fails.

## Risks / Trade-offs

- **Stage moves or reentry during async checks** → Match the exact current entry and resolved conversation again before joining the batch; never let an older instruction consume a later entry's queue. Keep existing orientation and stale-instruction behavior.
- **Premature acknowledgment or duplicate after restart** → Treat the persisted message, not pre-step selection or the instruction's enqueue, as acceptance. Reconcile each identity independently so an interrupted drain cannot duplicate confirmed items.
- **Additional history I/O** → Only run batch preparation for an instruction with candidate held messages; reuse one session history read for the batch and retain the queue's existing bounds.
- **A transcript-only test misses the bug** → Assert the actual first replay request (or its admitted input batch at the first model boundary) and assert that delivery itself does not trigger another step or turn.

## Migration Plan

No storage migration is required. Existing held records remain in their current local format and use the corrected path on eligible entry. Reverting the plugin restores the previous delivery sequence; it does not require changing persisted records.
