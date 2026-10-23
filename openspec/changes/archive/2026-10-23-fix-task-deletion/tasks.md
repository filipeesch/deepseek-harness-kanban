# Tasks

Implementation tasks come first, followed by the verification plan. Each task states a completion check.

## 1. Session ownership and topology

- [x] 1.1 Add `SessionLineage` and `SessionTopology` value types plus a narrow `SessionTopologyPort` in `src/shared/ports.ts`, and make `SessionPort` extend it; verify both TypeScript programs typecheck.
- [x] 1.2 Add the pure `ownedSessionIds(roots, lineage)` helper in `src/domain/session-lineage.ts`; verify the cases in section 6.1 pass.
- [x] 1.3 Implement `topology(within?)` in `src/host/native.ts` from one `sessionController.list()` read plus live session headers, preserving the existing related-directory classification; verify the cases in section 6.4 pass.
- [x] 1.4 Update session test fakes and host helpers to implement the new topology contract so the host, native, and worktree suites compile; the detailed fixtures are in section 5.1.

## 2. Sharing guard and cleanup

- [x] 2.1 Add `WorktreeSharingGuard` in `src/host/worktree-sharing.ts` using the worktree store and `SessionTopologyPort`; verify the cases in section 6.2 pass.
- [x] 2.2 Inject the guard into `WorktreeCoordinator`, remove its local `shared()` method, and delegate both pre-switch and pre-removal checks; verify the coordinator cases in section 7.1 pass.
- [x] 2.3 Skip the sharing check for an absent worktree directory and verify the existing `GitAdapter.remove` path removes an absent registered checkout's registration without using a repository-wide prune; verify the Git cases in section 7.2 pass.
- [x] 2.4 Use the owned closure in `KanbanApp.cleanupWorktreeWorkspace` so a task-owned subagent session does not retain an otherwise removable workspace; verify the app cases in section 7.3 pass.
- [x] 2.5 Improve `SHARED_WORKTREE` messages and details for another task (title/path) and a foreign native session (session ID/path); verify the client rendering cases in section 8.2 pass.

## 3. Client destructive dialogs

- [x] 3.1 Extract the destructive confirmation, discard, bulk-confirmation, and bulk-result surfaces from `src/client/board.tsx` into a dedicated client module with clear request/confirmation types; verify the board tests still pass after the state rewiring.
- [x] 3.2 Implement the structured single-task `DeleteTaskDialog` with conversation count and retained histories, worktree path/branch/created-vs-attached status, unclaimed checkout paths, running and local-change notes, one destructive action, Cancel initial focus, and a busy state; verify the dialog content cases in sections 6.5 and 8.2 pass.
- [x] 3.3 Keep the deletion dialog open on failure, show a friendly inline problem with an optional details disclosure, and expose retry/return recovery while preserving the `DISCARD_REQUIRED` discard handoff; verify the failure and discard cases in sections 6.5 and 8.2 pass.
- [x] 3.4 Implement the structured bulk confirmation and result surfaces with compact per-task rows, aggregate consequences, a deleted count, and user-facing skip reasons; verify the bulk cases in section 8.3 pass.
- [x] 3.5 Update the discard dialog to the same visual language without changing its explicit checkbox semantics; verify the lifecycle consent cases in section 8.1 pass.
- [x] 3.6 Add optional initial-focus and description support to `Modal` and a details-capable problem notice, then focus Cancel in destructive dialogs; verify the modal focus and accessibility cases in sections 6.5 and 8.1 pass.

## 4. Operation status and recovery

- [x] 4.1 Add a pure `describeOperation(task, operation)` descriptor for kind, phase, progress facts, actions, and return eligibility; verify the cases in section 6.3 pass.
- [x] 4.2 Move operation status above the drawer tabs for every section and remove the duplicate renderings from Conversations and Git while keeping the pending-transition status; verify the drawer cases in sections 6.6 and 8.1 pass.
- [x] 4.3 Render retry and return actions from the descriptor, hide return once archiving has begun, and preserve the existing discard handoff from retry; verify the recovery cases in sections 6.6 and 8.2 pass.
- [x] 4.4 Style the status stack, consequence list, and details disclosure with the existing host theme tokens and responsive dialog layout; verify the styles and browser layout cases in sections 8.1, 8.4, and 8.5 pass.

## 5. Test infrastructure and fixtures

- [x] 5.1 Extend `tests/worktrees/helpers.ts` and `tests/host/helpers.ts` with `topology(within?)`, lineage metadata, and a `seedSubagent(parent, child, directory, options?)` helper. The fake must filter `related` by `within` but return global `lineage`; verify `pnpm run typecheck` and the existing host, native, and worktree suites pass.
- [x] 5.2 Add the reported failed `SHARED_WORKTREE` operation fixture in `tests/host/app.test.ts` and the client task fixtures in `tests/client/delete-dialog.test.tsx` and `tests/client/board.test.tsx` (failed operation, worktree, attached, no-worktree, unclaimed, running, and waiting tasks); verify both suites compile and the existing tests pass.
- [x] 5.3 Add deferred-command and rejection helpers to `tests/client/helpers.ts` for busy, inline failure, and bulk-progress tests; verify the client suite compiles.
- [x] 5.4 Extend `tests/browser/fake-api.ts` and `tests/browser/harness.tsx` with a delete-target task and a failed-deletion task; verify the existing browser specs pass.
- [x] 5.5 Add a two-turn deterministic child fixture under `tests/e2e-dsh/` and thread its path through `scripts/e2e-dsh.mjs`; verify `node scripts/e2e-dsh.mjs --check` still passes and the fixture is consumed by the deletion scenario in section 9.

## 6. Fast module tests

- [x] 6.1 Add `tests/domain/session-lineage.test.ts` for roots, direct and nested descendants, forks, missing parents, cycles, and duplicate edges; verify the file passes.
- [x] 6.2 Add `tests/host/worktree-sharing.test.ts` for an owned child, nested child, foreign session, another task, fork, missing-parent child, absent target using a temporary path, and topology failure; verify the file passes.
- [x] 6.3 Add `tests/client/operation-description.test.ts` for every operation kind and phase, delete-specific copy, archived/archiving Return suppression, and progress facts; verify the file passes.
- [x] 6.4 Extend `tests/native/native.test.ts` for cold and live lineage, filtered related directories with global lineage, no-target topology, missing lineage metadata, and fail-closed topology errors; verify the file passes.
- [x] 6.5 Add `tests/client/delete-dialog.test.tsx` for worktree, attached, no-worktree, unclaimed, and running content, inline failure and recovery, busy state, Cancel focus, details disclosure, and no duplicate board error; verify the file passes.
- [x] 6.6 Add `tests/client/operation-status.test.tsx` for visibility from every drawer section, kind/phase copy, waiting and failed states, Return hidden after archiving, and raw-code secondary presentation; verify the file passes.

## 7. Host integration tests

- [x] 7.1 Extend `tests/worktrees/coordinator.test.ts` with an owned child, nested child, post-switch second check, foreign/fork/missing-parent blockers, absent checkout, and attached-checkout deletion; verify the file passes.
- [x] 7.2 Extend `tests/worktrees/git.test.ts` for an absent registered checkout and verify unrelated missing worktrees are not pruned; verify the file passes.
- [x] 7.3 Extend `tests/host/app.test.ts` for owned-child workspace cleanup, foreign-session retention, and failed-operation retry; verify the file passes.
- [x] 7.4 Extend `tests/host/product-walkthrough.test.ts` with a real Git + app + parent/child deletion case, update the `directories` spy to `topology`, and verify the file passes.

## 8. Client integration and browser tests

- [x] 8.1 Update `tests/client/board.test.tsx`, `lifecycle-consent.test.tsx`, `unclaimed.test.tsx`, `modal.test.tsx`, and `styles.test.ts` for the new labels, copy, focus, details disclosure, and selectors; verify the suite passes.
- [x] 8.2 Add single-delete integration cases for worktree, attached, no-worktree, unclaimed, running, inline `SHARED_WORKTREE`, no duplicate board error, busy dismissal, focus, and discard handoff; verify the suite passes.
- [x] 8.3 Add bulk confirmation, progress, and skipped-result cases; verify the suite passes.
- [x] 8.4 Add `tests/browser/delete-dialog.spec.ts` for layout, consequence sections, focus, and overflow; verify `pnpm run test:browser` passes.
- [x] 8.5 Add `tests/browser/operation-status.spec.ts` for Info/Notes visibility, Retry/Return availability, and no duplicate status; verify `pnpm run test:browser` passes.

## 9. Manual real-DSH e2e

- [x] 9.1 Add `tests/e2e-dsh/kanban-deletion.e2e.template.ts` and a `deletion` option in `scripts/e2e-dsh.mjs`; verify the DSH lane copies and compiles the template.
- [ ] 9.2 Implement the protocol gate: wait for the parent task Agent, start a real continuable child with `ctx.subagents.startActivation` and the replay child fixture, and assert the child's `parentSession`, `origin: subagent`, and worktree directory before any destructive step; also verify the drawer still shows only the parent task conversation tab. Verify the gate passes on the pinned checkout.
- [ ] 9.3 Delete through the UI and assert the card is gone, the worktree is removed, the branch is kept, the parent is archived, the child is not archived, and the base files are intact; verify the scenario passes.
- [ ] 9.4 Prompt the child while the parent is archived and assert the turn is blocked without a model step and the second replay turn remains unconsumed; verify the scenario passes.
- [ ] 9.5 Unarchive the parent, prompt the child, and assert it runs with the base project directory and consumes the second replay turn; verify the scenario passes.
- [ ] 9.6 Run `node scripts/e2e-dsh.mjs --checkout /path/to/deepseek-harness --only deletion` with `DSH_SNAPSHOT=replay` after installing plugin dependencies; record the actual run in `docs/verification-runs.json` and verify the exact tag, built DSH artifacts, and plugin prerequisites.

## 10. Documentation, evidence, and final verification

- [x] 10.1 Update `README.md` and `docs/operations.md` for lineage ownership, attached-checkout removal, absent-checkout handling, and kind-aware recovery; verify the wording matches the implemented behavior and links resolve.
- [x] 10.2 Update `docs/scenario-evidence.md` with the new module, integration, browser, and manual e2e references for every changed scenario; verify every changed scenario is mapped and no evidence is claimed without a run.
- [x] 10.3 Run `pnpm run typecheck`, the full `pnpm test` suite, `pnpm run test:browser`, and the production build; verify all pass without changing the accepted native boundary.
- [ ] 10.4 Rebuild, reconcile the existing plugin installation, refresh the existing GUI, and smoke the delete flow for a task with a subagent child, with and without a worktree, with an attached checkout, with unclaimed checkouts, and with a forced failure; verify the dialog, banner, and recovery behavior.
- [ ] 10.5 Confirm an existing failed preflight deletion such as the reported JetPack case retries successfully after deployment and that no persistence migration is required; verify the task is removed, its worktree is cleaned up, and its branch remains.
- [x] 10.6 Confirm the change adds no host preview API, no new remote method or tool, no new dependency, and no board-schema change; verify the final diff and `openspec validate fix-task-deletion --strict`.
