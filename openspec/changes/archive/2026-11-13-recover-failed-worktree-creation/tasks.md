# Tasks

## 1. Git deadline classes and cancellation

- [x] 1.1 Add a deadline-class argument to the Git executor port in `src/shared/ports.ts` and map the classes to values in `src/host/native.ts`, leaving the short read deadline unchanged for ref reads; verify `pnpm typecheck` passes and the existing Git tests still report the same commands.
- [x] 1.2 Mark the checkout write and tree-read calls with the long class — `worktree add`, `worktree remove`, `worktree repair`, and the branch, status, and local-change reads of a checkout — and record the requested class in the test executor; verify a test asserts the class of each recorded call.
- [x] 1.3 Add a per-operation abort registry to `WorktreeCoordinator` with a `cancel(taskId)` entry point that aborts only that operation's signal; verify a test cancels one task's creation while another task's creation completes.
- [x] 1.4 Wire an `operation.cancel` command through `src/shared/types.ts`, `src/remote.ts`, and `src/host/app.ts`; verify a command test rejects an unknown task and records `OPERATION_CANCELLED` for a running operation.
- [x] 1.5 Confirm the existing cancellation path records the failure with the same recovery actions as any other failure; verify a test asserts the recorded code and that Retry, Return, and discard remain available afterward.

## 2. Checkout state probe

- [x] 2.1 Parse and expose the `prunable` field of `git worktree list --porcelain` in `RepositoryFacts.registered()` so an orphan registration is visible to callers; verify a real-Git test creates an orphan registration and observes it.
- [x] 2.2 Add `CheckoutStateProbe` reporting the two axes — directory `absent`/`empty`/`present` and registration `none`/`orphan`/`registered` — without throwing for a checkout that does not belong to the repository; verify a unit matrix covers every combination.
- [x] 2.3 Cover the combined state where a directory with content also carries an orphan registration; verify the probe reports both facts and does not collapse them.

## 3. Attempt state and failure classification

- [x] 3.1 Extend the persisted attempt with optional `sourceCommit` and `observed: { directory, registration, at }` in `src/shared/types.ts` and `src/domain/schema-parts.ts`; verify a previously stored journal without the fields still parses.
- [x] 3.2 Record the resolved source commit before invoking Git and add a test that asserts the persisted value equals the commit the create resolved.
- [x] 3.3 Extract `CreateAttempt` as a value object over the persisted attempt with `provable`, `commitProven`, and `retryMode` predicates; verify unit tests cover a matching proof, a mismatched proof, and a legacy attempt.
- [x] 3.4 Extract `CreateFailureClassifier` to decide whether a failure kept an attempt and which phase owns it, replacing the retention expression and the argument sniffing in `src/host/worktrees.ts`; verify the existing coordinator recovery tests pass unchanged.
- [x] 3.5 Record the observed state when a creation fails and revalidate it before each recovery action, writing the fresh observation back; verify a test changes the directory between two actions and observes the updated state.

## 4. Creation recovery routes

- [x] 4.1 Disarm the attempt when the destination directory is absent and the registration is absent or orphan, making Retry, Return, and deletion available; verify tests for each of the three actions, including a stored journal that was already stuck.
- [x] 4.2 Clear an orphan registration by targeting the exact recorded destination and assert that no other registration changes; verify a real-Git test with two stale registrations leaves one intact.
- [x] 4.3 Reuse the attempt's branch when its tip equals the recorded source commit, resolve a legacy attempt once from its source branch or the default branch or HEAD, and raise a distinct error naming the branch and expected commit on mismatch; verify real-Git tests for reuse, legacy resolution, and a moved tip.
- [x] 4.4 Implement the discard: remove the canonical destination only when it is not a registered worktree, clear the exact orphan registration, and remove each empty directory above it from the deepest upward while stopping before the configured base; verify a real-Git fixture with a partial checkout and a two-level parent chain.
- [x] 4.5 Refuse the discard when the destination is a registered worktree, the base project path, the Git root, an ancestor of either, or not the recorded attempt path; verify a test for each refusal leaves the filesystem untouched.
- [x] 4.6 Run the retry as part of the accepted discard and record the outcome as a new attempt; verify a test where the discard succeeds and the creation completes in one command.

## 5. Recovery commands and client surface

- [x] 5.1 Add a confirmed `worktree.discardCreate` command through `src/shared/types.ts`, `src/remote.ts`, and `src/host/app.ts`; verify the command is rejected without confirmation and does nothing when rejected.
- [x] 5.2 Extend `OperationDescription` with the discard and cancel actions and with checkout-state facts; verify unit tests for a failed create in each state, including that a partial checkout is not described as "not completed" alone.
- [x] 5.3 Add the discard confirmation listing the destination, the empty parent candidates, and the reused branch, reusing the existing destructive confirmation pattern; verify a client test shows all three and that cancel performs no action.
- [x] 5.4 Label a failure produced by the last action as not saved, distinct from the recorded operation failure; verify a client test renders both without presenting them as one epoch.
- [x] 5.5 Present the checkout state in the Git section's error path; verify a client test for absent, empty, incomplete, and registered.

## 6. Shared helpers and duplication cleanup

- [x] 6.1 Replace the duplicated recovery-pending block and the repeated "does this path exist" helpers with one implementation each; verify no behavior change through the existing host tests.
- [x] 6.2 Share the proof, inspect, and adopt sequence between the creation pass and the return-to-base path; verify the existing return and unclaimed-checkout tests pass unchanged.

## 7. Documentation and release metadata

- [x] 7.1 Update `docs/operations.md` with the new attempt states, the discard consent, the orphan cleanup, branch reuse, and cancellation; verify every named action matches the shipped command surface.
- [x] 7.2 Bump `version` in `package.json`; verify the manifest reports the new version and `pnpm run build` succeeds.

## 8. Verification

- [x] 8.1 Run `pnpm check` and confirm host and client typecheck, unit tests, and the build pass.
- [x] 8.2 Run `pnpm test:browser` and confirm the client tests for the new recovery surface and theme tokens pass.
- [x] 8.3 Reproduce the incident shape in a real-Git fixture — a killed checkout leaving a partial directory, an orphan registration, a surviving branch, and a retained attempt — and confirm the card recovers through the discard and through the absence disarm without manual filesystem work.
