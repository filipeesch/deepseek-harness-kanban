# Tasks

## 1. Shared creation schema and worktree defaults

- [x] 1.1 Add `src/shared/task-creation.ts` with the strict zod schema for the creation input (`projectId`, `title`, `description`, `boardId?`, `autoMode?`), infer `NewTask` from it, and re-export the type from `src/shared/types.ts`; verify a new `tests/shared/task-creation.test.ts` accepts the documented fields and rejects unknown fields and a non-boolean `autoMode`.
- [x] 1.2 Persist the creation `autoMode` in `operations.createTask` and the legacy board store, keeping the entry marker behavior for an instructed initial column; verify `tests/domain/hub-operations.test.ts` and `tests/domain/store.test.ts` cover enabled, absent, and default-off creation.
- [x] 1.3 Add the portable repository-sibling derivation to `src/shared/worktree-name.ts` (`<dirname(gitRootPath)>/<basename(gitRootPath)>-<branch>`, configured base path wins, branch segments preserved); verify `tests/shared/worktree-name.test.ts` covers a configured base, no base, accented titles, nested branches, and Windows-style separators.
- [x] 1.4 Add the discriminated `WorktreeDefaults` result type and move the first-execution decision into `src/domain/first-execution.ts` with interactive and automatic modes; verify `tests/domain/first-execution.test.ts` reproduces today's interactive gate for no-worktree, folder, recorded-choice, unresolved-binding, and existing-conversation tasks, and covers the automatic mode for instructed and uninstructed initial stages.

## 2. Host preparation, command, and defaults

- [x] 2.1 Implement `src/host/first-execution.ts` with injected ports and the order validate entry → return an existing open conversation → create the default worktree and wait for ready → create the first conversation → optionally send through `admitStageInstruction`; verify `tests/host/first-execution.test.ts` covers Git and folder projects, entry-identity rejection, busy/relocating rejection, idempotent retry, worktree failure, conversation failure, and the send path.
- [x] 2.2 Add the `task.prepareFirstExecution` command to `Command`, the strict wire schema, `KanbanApp.execute` with serialization, and the client bridge/API; verify `tests/host/app.test.ts` and the wire-schema tests accept the command and reject a missing entry identity.
- [x] 2.3 Extend `task.create` (wire, app, domain) with `autoMode` and confirm the creation receipt and the entry marker are unchanged; verify the command test persists auto mode and returns the task receipt.
- [x] 2.4 Make `app.worktreeDefault` return `{ kind: 'derived', branchName, path, sourceBranch? } | { kind: 'unavailable', reason }`, update the remote controller and schema, and keep collisions advancing branch and destination together; verify `tests/host/worktree-default.test.ts` covers a configured base, the repository-sibling default, a collision, occupancy, and name exhaustion as `unavailable`.
- [x] 2.5 Add `auto_mode` to `create_card`, route it through the same application use case as the command, always prepare and dispatch for an instructed initial stage, and return a `firstExecution` outcome; verify `tests/host/tools.test.ts` covers instructed and uninstructed stages, auto mode, a start failure, and the scope rejection, and update the tool description.

## 3. Client creation flow and presentation

- [x] 3.1 Add the Auto mode control (off by default) and the Start execution now control (on by default, only when the initial column has an entry instruction) to `NewTaskDialog`, with the conditional copy replacing "No agent starts automatically."; verify `tests/client/board.test.tsx` covers both controls, their defaults, conditional visibility, and the submitted `autoMode`.
- [x] 3.2 Extend `AutoRunController` with the `preparing` status, `prepare`, `recordFailure`, and reconcile handling for a preparing record; verify `tests/client/auto-run.test.ts` covers prepare → arm, prepare failure, cancel during preparing or counting, marker resolution, replacement, disposal, and no persistence.
- [x] 3.3 Wire `BoardView.onCreated` to open the drawer, call `task.prepareFirstExecution` when the initial column is instructed and start is enabled, and arm the countdown only after the preparation resolves; verify `tests/client/board.test.tsx` covers start, no start, prepare failure, and the drawer/board unmount after creation.
- [x] 3.4 Render the preparing state in `CardInstructionAction` and `DrawerAutoRunNotice` and keep the failed state on the card status strip; verify `tests/client/auto-run-ui.test.tsx` covers the busy state, accessible names, cancel after arming, failure, and the play-action restore.
- [x] 3.5 Update `worktree-draft`, the missing-worktree notice, the Git panel, and `execution-preparation/gate.ts` to the discriminated defaults and the shared planner; verify `tests/client/worktree-draft.test.tsx`, `tests/client/worktree-defaults.test.tsx`, `tests/client/execution-preparation-gate.test.ts`, and the notice/Git tests cover no base path (always derivable), the unavailable state, and unchanged interactive behavior.

## 4. Documentation and release

- [x] 4.1 Update the README creation, auto-mode, worktree, and tool sections with the auto-mode/start options, the five-second countdown after creation, the sibling worktree default, and the tool always-start behavior; verify the README statements match the four spec deltas and contain no stale "no agent starts automatically" or missing-destination copy.
- [x] 4.2 Bump `version` in `package.json` to the next unreleased version (`0.8.0`; `0.6.0`, `0.6.1`, and `0.7.0` were released on main while this branch was open) and verify no release tag or asset already uses it, per the repository release rule.

## 5. Verification

- [x] 5.1 Run `pnpm check` (host/client typechecks, vitest, and the build) and verify it passes with the new and updated suites.
- [x] 5.2 Run `pnpm test:browser` and verify the creation countdown, preparing state, auto-mode chip, and appearance assertions pass in the plugin-owned harness.
- [ ] 5.3 Run the isolated real-composition lane (`node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only auto-run` plus the new creation scenario) and verify creation → sibling worktree → first conversation → countdown → send, cancel, the unchecked path, auto mode, and the `create_card` start outcome.
- [ ] 5.4 Run the AGENTS.md fresh isolated smoke checklist for the creation flow with a throwaway `DSH_HOME` and profile, and store the report and screenshots under `.verification/` without tokens or owner data.
## Verification notes

- 5.1 `pnpm check` passed: host and client typechecks, 203 test files, 2,906 tests, and the build.
- 5.2 `pnpm test:browser` passed: 115 tests, including the creation countdown, auto-mode chip, and appearance coverage.
- 5.3 The isolated `create-start` scenario passed with the expanded composition: a folder task starts, sends, and receives its replay response; a real Git task prepares the repository-sibling worktree and cancels its countdown; the capture path records auto mode without starting. The existing `auto-run` scenario still fails on the available DSH checkout (`dsh-v0.2.2-rc.1`, newer than the plugin's pinned `0.2.1-rc.2`): after the host-composition changes, the second recorded model script is not bound for the draft task. That is a host/replay limitation, not the creation-start behavior.
- 5.4 Not run: the available desktop composition reports the same DSH version skew as 5.3.
- Independent verification (`openspec-verify-change` plus code review by `openai-codex/gpt-6.1-sol` high) found no remaining implementation blocker after the requested-column-identity and queued-workflow-save fixes. Its strict-wire, send-failure, worktree-exhaustion, and concurrent-preparation test gaps were closed; the remaining open items are the 5.3/5.4 environment limits above.
