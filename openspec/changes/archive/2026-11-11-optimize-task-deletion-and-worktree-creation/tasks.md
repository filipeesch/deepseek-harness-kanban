# Tasks

## 1. Repository context

- [x] 1.1 Extract `RepositoryLayout` from [src/host/git.ts](../../../src/host/git.ts): target-safety and path-containment rules as pure functions, with the existing target, subproject, and registered-worktree rules covered by unit tests
- [x] 1.2 Add `RepositoryProbe` and the `RepositoryContext` value (Git root, project path, common directory, registered worktrees) resolved once per operation, verified by a host test that resolves one context and inspects through it
- [x] 1.3 Split the adapter into `WorktreeReader` (`inspect`, `branches`, registered listing) and `WorktreeWriter` (`create`, `remove`, `repair`) over the shared context, keeping `GitPort` behavior identical, verified by [tests/worktrees/git.test.ts](../../../tests/worktrees/git.test.ts) and the recording executor's command order
- [x] 1.4 Make removal refresh the registered worktree list through the writer instead of re-resolving the repository layout, verified by a test that removes a checkout and asserts the reachable facts were resolved once

## 2. Binding index

- [x] 2.1 Add the `worktreeBindings()` projection to [src/host/hub-repository.ts](../../../src/host/hub-repository.ts), cached per repository change and built without cloning Hubs, verified by a host test that reads it twice across a change and sees the cache refresh
- [x] 2.2 Add `TaskBindingIndex` over that projection plus one native topology read per pass, answering the bound-task, foreign-session, and active-operation questions currently answered by `allTasks()`, verified by unit tests for each of the three questions
- [x] 2.3 Rewire `WorktreeSharingGuard` and the force-removal check onto the index, verified by the existing sharing and force tests plus a test that a task with an active operation on the same checkout is still refused

## 3. Checkout preflight and removal

- [x] 3.1 Introduce `DeletionPlan` and `CheckoutPreflight` covering the persisted-binding comparison, idleness, sharing, absent-checkout tolerance, and local-change detection in one evaluation, verified by unit tests for each refusal and for the tolerant absent checkout
- [x] 3.2 Skip local-change detection when the recorded request already carries discard consent, verified by a test asserting removal proceeds from a dirty tree under recorded consent without reporting `DISCARD_REQUIRED`
- [x] 3.3 Extract `CheckoutRemoval` and re-validate the persisted binding plus the registered-worktree entry immediately before the Git removal, verified by a test that changes the binding after the plan and observes the refusal
- [x] 3.4 Delete the second `assertPreRemoval` and the third sharing scan from the destructive execution, verified by the deletion and background-deletion suites passing unchanged

## 4. Idleness probe

- [x] 4.1 Add `ConversationProbe` returning one verdict for a session set per pass, verified by a host test asserting a single native read for a multi-conversation task
- [x] 4.2 Use the probe throughout the destructive execution and the directory switch while keeping `SESSION_ACTIVE` refusals from the ports, verified by the busy-conversation tests moving the operation to `waiting` and by a test where the port refuses a directory change

## 5. Journal

- [x] 5.1 Split `OperationJournal` into `RecoveryWriter` (phase, archived ids, completed checkout, failure) and `ProgressWriter` (returned conversations, previous directories), verified by unit tests for both writers and by an unchanged journal schema test
- [x] 5.2 Flush accumulated progress at phase boundaries and on failure, verified by a test that fails mid-switch and observes the flushed progress in the recorded operation
- [x] 5.3 Use the recovery writer only where a restart must not repeat work, verified by the restart-resume tests passing unchanged

## 6. Teardown

- [x] 6.1 Extract `SessionArchiver` with per-conversation recovery state, verified by tests for skip-already-archived, refusal on an active conversation, and a failure recorded with its phase
- [x] 6.2 Add `TaskTeardown` running `CheckoutRemoval` and `SessionArchiver` concurrently after the directory return and awaiting both, verified by a test that gates one step and observes the other completing while the operation stays in progress
- [x] 6.3 Attribute failures per step and record the archiving phase when both fail, verified by tests for removal-only failure, archiving-only failure, and both failing
- [x] 6.4 Make the phase derivation follow the design (removing, then archiving once removal finished) without adding a persisted field, verified by [tests/host/background-deletion.test.ts](../../../tests/host/background-deletion.test.ts) and the drawer status tests
- [x] 6.5 Reduce `DestructiveExecution` to an orchestrator over the new collaborators, verified by `pnpm check` and the full destructive suite passing

## 7. Worktree creation defaults

- [x] 7.1 Make branch and destination optional for new-branch creation in `CreateWorktree` and the `worktree.create` command schema, verified by a remote-schema test accepting both forms
- [x] 7.2 Derive the collision-free title defaults inside creation when the request omits them, verified by a host test creating without values and by a test where the derived name became occupied and advances instead of failing
- [x] 7.3 Keep supplied values authoritative, verified by a test that creates with explicit values differing from the derived defaults
- [x] 7.4 Remove `FirstExecutionPorts.worktreeDefaults` and let the automatic first execution request creation without derived values, verified by [tests/host/first-execution.test.ts](../../../tests/host/first-execution.test.ts) and the `prepare` e2e lane
- [x] 7.5 Verify the checkout creation just produced using the context and the checkout's own branch instead of a full inspection, verified by a host test asserting creation succeeds and reports the created branch

## 8. Wiring and cleanup

- [x] 8.1 Compose the new collaborators in [src/host/worktrees.ts](../../../src/host/worktrees.ts) and [src/host/app.ts](../../../src/host/app.ts) with injected ports, verified by `pnpm check` and by every existing host test constructing the coordinator
- [x] 8.2 Delete the code paths the refactor orphaned (duplicated preflight helpers, `allTasks()`-based scans in the destructive path, the unused defaults port) and confirm no call site remains, verified by a repository-wide search and `pnpm check`
- [x] 8.3 Confirm the lane, admission, and resume invariants are untouched, verified by the operation-queue, bulk-admission, and failed-operation-recovery suites

## 9. Verification and delivery

- [x] 9.1 Run `pnpm check` and confirm host and client typechecks, vitest, and the build pass
- [x] 9.2 Run `pnpm test:browser` and confirm the client suites pass with screenshots under `.verification/`
- [ ] 9.3 Run the isolated real-composition lane for `deletion` and `prepare` and confirm both scenarios pass without owner data
  - Note: the deletion lane's subagent-child scenario fails identically on the base commit against the inspected DSH checkout (0.2.2-rc.1) instead of the pinned SDK (0.2.1-rc.2), so it is a pre-existing environment failure, not a regression from this change; the retained-checkout scenario passes.
- [x] 9.4 Update `README.md` and `docs/operations.md` where they describe the destructive lane's execution sequence and creation defaults
- [x] 9.5 Bump `version` in `package.json` for the changed plugin artifact and confirm the profile reports the new build
