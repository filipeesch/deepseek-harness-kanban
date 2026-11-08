# Tasks

## 1. Baseline and shared path resolution

- [x] 1.1 Capture the baseline by running `pnpm check` and the isolated `pnpm test:browser` lane, and record the passing set before any edit
- [x] 1.2 Confirm in the pinned DSH checkout that the host APIs the relocation touches (`workingDirectory.set`, `workspaceRegistry.resolveByPath`, session projections) carry no `@deprecated` marker, and record the alternatives if one does
- [x] 1.3 Introduce one directory resolver that produces the canonical path and the `PATH_UNAVAILABLE` problem, and make the Git adapter and the probe's directory resolver share it; verify `tests/worktrees/git.test.ts` and `tests/host/project-probe.*.test.ts` pass
- [x] 1.4 Make `KanbanApp.project()` delegate canonicalization, directory validation, containment, and Git root validation to the project probe and the resolver instead of repeating them; verify `tests/host/project-save.test.ts` plus a new case asserting an unavailable path returns `PATH_UNAVAILABLE`
- [x] 1.5 Split `assertProjectConversion` into an association policy used by `saveProject` and a relocation plan entry point, keeping the current save behavior; verify `tests/domain/project-conversion.test.ts` and `tests/host/project-save.test.ts` pass

## 2. Tolerant task deletion

- [x] 2.1 Extract a deletion target resolver that decides the directory-return target and whether the checkout is removed, retained, or absent; verify unit tests for a task without a worktree, a resolvable base, an unavailable project path, and an unavailable Git root
- [x] 2.2 Integrate the resolver into `DestructiveExecution` so a retained checkout skips the directory return and Git removal while conversations are archived and the task is deleted; verify host deletion tests using a Git fake that raises `PATH_UNAVAILABLE`
- [x] 2.3 Preserve a return failure that is unrelated to an unavailable project context as today's retained-worktree failure; verify a host test asserts the task is not deleted and the recovery information remains
- [x] 2.4 Publish a transient `retainedCheckouts` projection in the host snapshot when a checkout is retained because its context is unresolved; verify a host test asserts the projection and that it is absent for a normal deletion
- [x] 2.5 Render the retained unverifiable checkout in the destructive-operation notice with a dismiss action; verify a browser test asserts the path, the "not removed" wording, and dismissal
- [x] 2.6 Extend the isolated `deletion` e2e lane with a project directory removed on disk, and verify the deletion completes, the checkout stays, and the notice reports the path

## 3. Relocation domain and command admission

- [x] 3.1 Add the optional project operation to the shared types and the strict project schema, and add the `project.relocate` command shape; verify `tests/domain/schema.test.ts` and `tests/host/hub-commands.test.ts` accept records with and without the field
- [x] 3.2 Implement the pure relocation plan that maps the recorded previous location and the confirmed target to per-task target directories and skipped tasks; verify unit tests for base tasks, worktree tasks, a monorepo subdirectory, and a task whose directory does not match either source
- [x] 3.3 Reject a save that changes the project path or Git root while tasks exist, reject any save while a relocation is pending, and preserve an existing operation in `buildProject`; verify domain and host save tests
- [x] 3.4 Accept `project.relocate` from persisted state only, validate the location through the probe, reject a Git association conversion and an unresolved task operation, record `queued`, and return before migration; verify host tests for acceptance and each rejection
- [x] 3.5 Implement retry admission and cancellation, allowing cancel only while the phase is `queued`, `preflight`, or `waiting`; verify host tests assert the operation is cleared and the project unchanged on cancel

## 4. Relocation coordinator

- [x] 4.1 Move the `OperationQueue` to app ownership, inject it into the worktree coordinator, and rename `taskId` to `ownerId` in the queue and its callers; verify the queue, worktree coordinator, and deletion tests
- [x] 4.2 Create the project relocation coordinator with the journal phases, the lane job, the authoritative preflight, and the `waiting` state; verify host tests for preflight rejection, a busy conversation moving to waiting, and a resumed lane job
- [x] 4.3 Apply the project location and rebase eligible task effective directories in the `migrating` phase with the recorded previous location as the idempotency guard; verify host tests for a successful migration and for a retried migration that skips applied tasks
- [x] 4.4 Migrate every idle task conversation in the `sessions` phase, recording migrated session ids and returning to waiting for a busy conversation; verify host tests for success, waiting, failure at the step, and retry resumption
- [x] 4.5 Rebind the project workspace to the new path in the `workspace` phase without renaming or deleting the previous registration; verify host workspace tests for creation, reuse, and the retained previous binding
- [x] 4.6 Add `GitPort.repair`, implement it in `GitAdapter` with write policy over the common directory and each existing checkout, and update the test fakes; verify Git adapter tests for a repaired link, an absent checkout, and a denied policy
- [x] 4.7 Revalidate every worktree binding in the `worktrees` phase, keeping repaired bindings and recording an error for an unverifiable one without failing the relocation; verify coordinator tests for both outcomes
- [x] 4.8 Resume unfinished project relocations at startup and on native activity, and include the shared queue in shutdown settling; verify host tests for restart resumption and for `close()` awaiting both coordinators
- [x] 4.9 Add the project guard that rejects execution, conversation creation, worktree operations, project save, and project deletion while a relocation is unresolved, and keeps task text, notes, and stage moves available; verify host tests for each blocked and allowed command

## 5. Client surfaces

- [x] 5.1 Route an edited project whose path or Git root changed and which still has tasks to a relocation impact confirmation computed from the snapshot, and keep `project.save` for unchanged locations and projects without tasks; verify browser tests for the confirmation, the active-conversation wording, and the direct save
- [x] 5.2 Present relocation progress, failure, retry, and cancel in the Projects row and disable project deletion while a relocation is unresolved; verify browser tests for waiting, failed, retry, cancel, and the disabled delete action
- [x] 5.3 Add the compact board relocation notice with the project, its state, retry for a failure, and removal when resolved; verify browser tests for waiting, failed, retry, and clearing
- [x] 5.4 Update the client snapshot normalization and types for the project operation and the retained-checkout projection; verify client tests and a reload scenario in the browser lane

## 6. Verification and release

- [x] 6.1 Run `pnpm check` and `pnpm test:browser`, and record the results under `.verification/`
- [x] 6.2 Extend the isolated `project` e2e lane with a repository moved on disk, covering acceptance, waiting, migration of a conversation, workspace rebinding, and worktree revalidation, and record screenshots and a report under `.verification/`
- [x] 6.3 Cover the failed relocation and its retry with the deterministic host test (failed step, forward-only state, unavailable cancel, re-submission retry) and the browser failure/retry presentation; record that real-composition fault injection is not available
- [x] 6.4 Run `openspec validate project-path-relocation` and review the final diff for the design's non-goals and the no-rollback rule
- [x] 6.5 Bump the `version` in `package.json` for the release that contains this change
