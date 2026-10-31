# Tasks

## 1. Contract and persistence

- [x] 1.1 Add optional `force` to the `delete` and `remove` operation requests in `src/shared/types.ts` and to the corresponding `CommandSchema` entries in `src/remote.ts`; verify `pnpm exec tsc -p tsconfig.host.json --noEmit` and a schema-parse test covering accepted and rejected `force` values.
- [x] 1.2 Add the `queued` operation phase to `ContextOperation` and to both persisted operation schemas; verify a persistence round-trip test and the existing strict-schema tests pass.
- [x] 1.3 Add optional `Worktree.error: Problem` to the worktree type and both persisted worktree schemas; verify a load/save round-trip test for a binding with and without the error.
- [x] 1.4 Define the complete `SHARED_WORKTREE` blocker detail shape (`kind: 'task' | 'session'`) and a narrow predicate for reading it; verify a unit test for both blocker shapes and for legacy details without `blockers`.

## 2. Sharing guard

- [x] 2.1 Change `WorktreeSharingGuard` to collect every blocking task and every foreign native session before throwing, preserving the existing top-level detail fields; verify guard tests assert all blockers and the legacy shape.
- [x] 2.2 Add the guard force option that bypasses only the sharing refusal; verify a test proves force still returns without enumerating blockers and that a non-force call still refuses.
- [x] 2.3 Add the refusal for force while another task has a non-failed context operation on the same checkout; verify a test that refuses force, leaves the checkout intact, and succeeds after the other operation settles.

## 3. Destructive execution and queue

- [x] 3.1 Add a host `OperationQueue` with FIFO order, concurrency 1, idempotent enqueue, `settle()`, and `dispose()`; verify unit tests for order, deduplication, settle, and dispose-before-start.
- [x] 3.2 Extract the delete/remove execution path from `WorktreeCoordinator.drive()` into a destructive-operation handler with explicit prepare and execute steps, leaving create/attach/return on the current path; verify the existing coordinator suite still passes unchanged.
- [x] 3.3 Wire admission: run prepare synchronously, persist `phase = 'queued'`, enqueue execution, and return before cleanup; verify a host test observes the queued operation from the command response and no removal or archive before the queue runs.
- [x] 3.4 Route pending destructive operations through the queue in `resumePending()` and make `settle()` wait for the queue; verify a restart test resumes a queued deletion once and a shutdown test leaves the journal intact.
- [x] 3.5 Re-run idleness and sharing rechecks before execution and fall back to `waiting` rather than proceeding on stale admission; verify a test where a conversation becomes busy while queued.
- [x] 3.6 Mark every other task bound to a force-removed checkout with `status = 'error'` and a persisted `WORKTREE_REMOVED` problem without changing `effectiveCwd`; verify a transaction-level test covering two affected tasks.

## 4. Host command integration

- [x] 4.1 Pass `force` through `KanbanApp` for `task.delete` and `worktree.remove`, keeping pre-admission errors synchronous; verify host tests for force rejection and force acceptance.
- [x] 4.2 Preserve the existing bulk `requireIdle` preflight and treat its errors as skips while admitted deletions return queued snapshots; verify the bulk host tests report queued versus skipped.
- [x] 4.3 Verify background failure publication and cleanup by asserting a failed queued deletion is recorded with its phase and problem and that `app.close()` waits for the destructive queue.

## 5. Client destructive controller

- [x] 5.1 Add a client destructive-operation controller with the `idle -> confirming -> submitting -> accepted | failed | force-consent | discard-consent` transitions; verify unit tests for acceptance, pre-admission failure, late failure, retry, force, and discard.
- [x] 5.2 Replace the board's destructive state and duplicate recovery methods with the controller; verify existing board tests for single delete, remove, retry, return, and bulk still pass after adapting expectations.
- [x] 5.3 Close the confirmation on acceptance, detect acceptance from the returned operation or removed task, and clear the accepted selection; verify a client test where the command resolves with an operation before completion.
- [x] 5.4 Keep bulk accepted/skipped accounting: accepted tasks count as queued, rejected tasks remain selected, and the result reports queued versus skipped; verify the bulk client tests.
- [x] 5.5 Split the destructive dialogs into delete, remove, force, bulk-confirmation, and bulk-result components with shared consequence and recovery components; verify focused component tests for each surface and no duplicated copy.
- [x] 5.6 Add the force dialog with the affected task and conversation list and a required checkbox, wired from the failure confirmation, drawer status, and board notice; verify tests for disabled-until-opt-in, listed blockers, and dispatch with `force: true`.
- [x] 5.7 Preserve `force` through the discard handoff after `DISCARD_REQUIRED`; verify the resulting command carries both `force` and `discardChanges`.

## 6. Board and drawer surfaces

- [x] 6.1 Add the board destructive-operation notice for queued/running operations, failed operations with retry/return/force, and dismissible retained-checkout reports; verify client tests for each state and live updates.
- [x] 6.2 Make card status copy kind-aware for deletion and removal, including queued, in-progress, and needs-attention states; verify card tests assert the labels and that raw phase tokens are not shown.
- [x] 6.3 Show the queued phase and the force action in the drawer operation status; verify drawer tests from every section.
- [x] 6.4 Render the persisted worktree binding error in the Git section; verify the "removed externally" state and that creation/attachment remain available.
- [x] 6.5 Add notice, force-dialog, and card-status styles that follow the host light and dark theme; verify browser specs under both `prefers-color-scheme` values and store screenshots under `.verification/`.

## 7. Documentation

- [x] 7.1 Update `README.md` and `docs/operations.md` to describe background destructive execution, the queued phase, the board notice, and the consented force exception, replacing the statement that shared-target failures are never forced; verify the documented behavior matches the shipped UI and host tests.

## 8. Verification

- [x] 8.1 Run `pnpm check` and confirm typechecks, vitest, and the build pass.
- [x] 8.2 Run `pnpm test:browser` and confirm the new browser specs pass with theme evidence under `.verification/`.
- [ ] 8.3 Run the isolated real-composition deletion lane with `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only deletion` and confirm the background deletion and force scenarios pass without touching the owner's profile.
