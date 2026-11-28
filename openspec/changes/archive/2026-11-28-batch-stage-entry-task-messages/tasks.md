# Tasks

## 1. Stage-entry message admission

- [x] 1.1 Add a deterministic regression to the isolated DSH messages lane: queue at least two handoffs through `send_task_message` with `deliver_at`, enter the instructed stage, and assert that its first replay request contains the instruction followed by both distinct task messages in order. Assert that no subsequent model step or turn is started for their delivery; demonstrate that the old separate release path fails the first-request assertion.
- [x] 1.2 Add one shared same-conversation batch admission at the native pre-step boundary, anchored to the actual stage instruction and exact current entry. Verify main and specialist targets, intact native sources, queue order, and no inclusion in unrelated, rejected, or stale-entry steps, including a later visit to the same column.
- [x] 1.3 Exclude the resolved instruction conversation from the existing separate release path even while its messages await acceptance. Verify that a different conversation still receives its own message after instruction admission, a stage without an instruction still releases after placement, and a reorder or immediate send retains its existing behavior.

## 2. Release confirmation and recovery

- [x] 2.1 Confirm each batched message from its durable native append, then remove it and record the released identity atomically. Test that a canceled or rejected step leaves unrecorded messages held and that a repeated tool call cannot requeue a confirmed identity.
- [x] 2.2 Reconcile interrupted local release writes against the native conversation log and pending input using the original source and request IDs. Test one already-recorded item beside an unrecorded item, exact-entry revalidation after history reads, and no second delivery of a recorded item.

## 3. Checks and documentation

- [x] 3.1 Update the deferred-delivery paragraph in `docs/user/agent-tools.md` to explain first-step behavior for the same conversation while keeping other destinations separate; bump the installed plugin patch version in `package.json` and verify the documentation gate passes.
- [x] 3.2 Run the focused host tests, `pnpm run check`, the isolated DSH messages replay lane, and `openspec validate batch-stage-entry-task-messages --strict`. Keep evidence out of Git; do not use a real model or the owner's profile. No UI implementation changed, so no visual capture is required.
