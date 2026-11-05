# Tasks

## 1. Destructive queue foundation

- [x] 1.1 Extract `OperationJournal` (`read`, `update(taskId, operationId, change)`, `requireTask`, the operation-changed invariant) and inject it into `WorktreeCoordinator` and the destructive handler; verify the existing host suites pass with `pnpm vitest run tests/host`
- [x] 1.2 Make `OperationQueue` lane-aware (`enqueue` takes a lane, one running job per lane, global idempotency key, `settle` across lanes, `dispose` across lanes); verify a new unit test shows two lanes overlapping while a third job on a busy lane waits
- [x] 1.3 Add the repository lane key (Git root for a Git project, project identity otherwise) and group `resumePending()` by lane ordered by `operation.createdAt`; verify a host test proves two repositories run concurrently and one repository stays serial after resume

## 2. In-memory admission

- [x] 2.1 Split the destructive handler into `DestructiveAdmission` and `DestructiveExecution` and delete the `admissionOnly` flag; verify `pnpm vitest run tests/host/background-deletion.test.ts` still covers admission, force, restart, and resume
- [x] 2.2 Implement the admission predicate — persisted target match, no active operation (or a `failed` operation of the same kind), pending transition not mid-delivery — and verify a host test whose Git and session ports throw on any call still admits the deletion
- [x] 2.3 Stop canonicalizing the target during `start()` and `confirmationMatches()` for `delete` and `remove`, and compare the persisted binding instead; verify a host test whose binding changes after confirmation records `WORKTREE_CHANGED` from the lane preflight instead of removing the new target
- [x] 2.4 Persist the operation as `queued`, enqueue the lane job, and return the command response before any cleanup; verify a host test asserts the command resolves with no removed checkout and no archived conversation until `worktrees.settle()`
- [x] 2.5 Record queued preflight failures for a busy conversation, a shared checkout, and local changes with their failing phase, then verify each recovers through retry and, for local changes, through the separate discard consent
- [x] 2.6 Remove `requireIdle` from the `Command` type, the remote schema, the host case, and `assertBatchDeletable`; verify the host suite passes and a schema test rejects a `task.delete` that still carries the field
- [x] 2.7 Keep the waiting path event-driven: a lane job that finds a busy conversation records `waiting`, and verify a host test re-enqueues it after the conversation settles through `resumePending()`

## 3. Bulk deletion on the client

- [x] 3.1 Implement `useBatchDeletion` (close on accept, optimistic selection exit, concurrent fan-out of `task.delete`, per-task admission rejection as a board error); verify a `renderHook` client test covering an all-accepted batch, a rejected task, and no result payload
- [x] 3.2 Wire the hook into `src/client/board.tsx` and delete `BulkResultDialog`, `BulkDeletionResult`, and `BulkProgress` while keeping the confirmation dialog; verify the browser harness still renders the confirmation and no result dialog appears after confirming
- [x] 3.3 Name the checking state for destructive operations in `cardStatusEntries`, the destructive notice, and the operation description; verify client tests assert a `preflight` deletion reads as checking rather than as an in-progress deletion or a raw phase token

## 4. Documentation

- [x] 4.1 Update `README.md` and `docs/operations.md` for the admission contract, per-repository destructive lanes, and the bulk behavior without a result dialog, and verify no section still claims a single global destructive queue or synchronous bulk skips

## 5. Verification

- [ ] 5.1 Add `tests/e2e-dsh/kanban-background-delete.e2e.template.ts` with the gated `archiveSession` choreography and register it as `background-delete` in the `scenarioTemplates` map and the usage line of `scripts/e2e-dsh.mjs`; verify `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only background-delete` passes against an isolated checkout
  - Blocker: the lane is implemented and registered, but this machine only has DSH `0.2.2-alpha.2` built (`~/projects/pessoal/deepseek-harness`), while the plugin pins `0.2.1-rc.2`. The copied scenario fails inside the plugin preflight with `ctx.sessionController.inspect is not a function`, so every destructive scenario, not only this one, is unverifiable against that checkout. Re-run the lane against a checkout pinned to `0.2.1-rc.2` before closing this task.
- [x] 5.2 Run `pnpm check` and `pnpm test:browser`, and record any real-composition gap as a follow-up instead of widening this change
- [x] 5.3 Measure the bulk fan-out latency for a selection of ten tasks and record the result in the change; if the snapshot cost is material, note the batch-command follow-up without implementing it here
