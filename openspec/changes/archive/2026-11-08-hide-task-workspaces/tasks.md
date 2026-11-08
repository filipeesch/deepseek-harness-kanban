# Tasks

## 1. Workspace port and native adapter

- [x] 1.1 Extend `WorkspaceInfo` and `WorkspacePort` in `src/shared/ports.ts` with `hidden`, `supportsHidden`, the options-based `ensure(path, options)`, and `setHidden`; migrate every `ensure` call site in `src/host/app.ts` and `tests/host/helpers.ts` to the options form without changing visibility. Verify `pnpm typecheck` passes and the existing workspace-binding tests still pass with `pnpm vitest run tests/host/ux-refinement.test.ts`.
- [x] 1.2 Implement the native adapter in `src/host/native.ts`: detect the workspace entity's `setHidden` from a resolved, listed, or created workspace, branch between `create(path, { title, hidden })` and the positional `create(path, title)`, repair the title on the unknown-support bootstrap path, map `hidden` in `get`, and make `setHidden` a no-op when the host does not support the API. Verify with the adapter tests from 3.2 and `pnpm vitest run tests/native/native.test.ts`.

## 2. WorkspaceCoordinator

- [x] 2.1 Create `src/host/workspace-coordinator.ts` with `ensureProject`, `ensureTaskWorkspace`, `reconcile`, and `cleanup`, using narrow binding-store, `WorkspacePort`, and `SessionPort` interfaces; move the current behavior out of the four private `KanbanApp` methods without adding visibility behavior yet. Verify `pnpm typecheck` and the existing host workspace tests with `pnpm vitest run tests/host/ux-refinement.test.ts tests/host/app.test.ts`.
- [x] 2.2 Wire `KanbanApp` to the coordinator: `initialize` calls `reconcile`, `createConversationNow` calls `ensureTaskWorkspace`, and the worktree deletion callback calls `cleanup`; keep the public constructor signature and the existing binding persistence. Verify `pnpm typecheck` and `pnpm vitest run tests/host/background-deletion.test.ts tests/host/auto-advance-app.test.ts tests/host/move-override.test.ts`.
- [x] 2.3 Implement the visibility policy in the coordinator: create new task worktree and session-directory workspaces hidden; hide an adopted worktree workspace once before persisting its binding; keep the shared project workspace visible and reveal it when it reports hidden; leave existing session-directory workspaces unchanged; never mark a workspace already recorded in a binding hidden during reconcile; report a `setHidden` failure and continue without blocking the conversation. Verify with the coordinator tests from 3.1.

## 3. Tests

- [x] 3.1 Extend `TestWorkspaces` in `tests/host/helpers.ts` with `hidden`, `supportsHidden`, `setHidden`, and a `setHidden` call log; add `tests/host/workspace-coordinator.test.ts` covering new hidden worktree and session-directory workspaces, an adopted worktree hidden exactly once, an existing session-directory workspace left unchanged, the project workspace kept visible/revealed, reconcile after a simulated reveal not calling `setHidden` again, an unsupported host, and a failed `setHidden` that is reported without blocking. Verify `pnpm vitest run tests/host/workspace-coordinator.test.ts`.
- [x] 3.2 Add native adapter tests in `tests/native/native.test.ts` for supported and unsupported hosts, options versus positional `create`, `get` mapping `hidden`, and `setHidden` delegation or no-op. Verify `pnpm vitest run tests/native/native.test.ts`.
- [x] 3.3 Add integration coverage in `tests/host/ux-refinement.test.ts` for a conversation creating a hidden worktree workspace, reusing the same workspace without duplicates, and the existing cleanup assertions. Verify `pnpm vitest run tests/host/ux-refinement.test.ts tests/host/app.test.ts`.

## 4. Documentation, version, and verification

- [x] 4.1 Update the workspace paragraph in `README.md` and the working-directory section in `docs/operations.md` to state that task worktree and session-directory workspaces are hidden by default on capable hosts, the shared project workspace stays visible, no retroactive migration occurs, a reader reveal is never undone, and the original DSH fallback keeps workspaces visible. Verify no stale claim remains with `grep -rn "no hidden-workspace" README.md docs AGENTS.md`.
- [x] 4.2 Add a `## Workspaces` section to `AGENTS.md` with the same rules for future agents. Verify the section exists and does not contradict the spec delta.
- [x] 4.3 Bump `version` in `package.json` to the next unreleased patch, following the repository release rule, and verify the metadata parses with `node -p "require('./package.json').version"`.
- [x] 4.4 Run the full fast gate `pnpm check` (host/client typechecks, vitest, and build) and record the result. Do not run UI acceptance checks against the developer's personal DSH profile; if a built hidden-capable DSH checkout is available, use the isolated board lane separately. Result: `pnpm check` passed with 173 test files and 2507 tests, and the host, lazy client module, and public declarations built successfully.
