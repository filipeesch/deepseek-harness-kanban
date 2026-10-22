# Tasks

## 1. Shared naming rules

- [x] 1.1 Add `src/shared/worktree-name.ts` with `taskTitleSlug` (NFKD transliteration, lowercase, hyphen runs, 48-character limit, `task` fallback) and `worktreePathForBranch` (empty-input guard, segment guard, POSIX/Windows separator, trailing-separator handling) without importing `node:` modules; verify `pnpm typecheck` succeeds for both host and client programs.
- [x] 1.2 Add `tests/shared/worktree-name.test.ts` covering accented titles, punctuation-only fallback, the 48-character boundary, empty base path, nested branch names, both separators, root base, and `.`/`..` rejection; verify `pnpm vitest run tests/shared/worktree-name.test.ts` passes.

## 2. Board settings domain and host

- [x] 2.1 Add `BoardSettings`, optional `BoardState.settings`, the strict optional schema object, and `settings: {}` in `initialState()`; verify `pnpm vitest run tests/domain/schema.test.ts` accepts missing and valid settings and rejects relative paths, unknown keys, and invalid types.
- [x] 2.2 Add `BoardStore.saveSettings` that replaces the settings object, clears it for an empty object, and honors `expectedRevision`; verify new `tests/domain/store.test.ts` cases for set, replace, clear, and revision conflict pass.
- [x] 2.3 Add the `settings.save` command to `Command`, the remote schema, and the host handler, resolving a non-empty path with `realpath` and `stat` and rejecting non-existent or non-directory values with `INVALID_WORKTREE_BASE_PATH`; verify `pnpm vitest run tests/host/settings.test.ts` covers save, canonicalization, clear, missing directory, file path, and revision conflict.
- [x] 2.4 Confirm an existing stored board without `settings` still loads and snapshots normally; verify the store-loading tests in `tests/domain/store.test.ts` pass without fixture changes.

## 3. Host worktree suggestion

- [x] 3.1 Add the read-only `worktreeDefault` remote method (controller, remote schemas, `ClientApi`, client bridge) returning `{ branchName, path }`; verify `pnpm typecheck`, the strict remote schema, and a bridge forwarding test that passes `{ taskId }` and unwraps the result.
- [x] 3.2 Implement the host suggestion loop using `GitPort.branches`, board worktree and pending paths, filesystem `stat`, and the shared helpers; verify `pnpm vitest run tests/host/worktree-default.test.ts` covers a free title, duplicate titles, branch collisions, destination collisions from another task and another project, no base path, and name exhaustion.
- [x] 3.3 Extend the client fake API in `tests/client/helpers.ts` with `worktreeDefault`; verify the existing client suite mounts without missing-method errors.

## 4. Client configuration

- [x] 4.1 Add the General tab and panel (base path input, Browse, Save, clear by saving empty, derived-destination example, existing-worktree note) with the order General, Projects, Workflow; verify `pnpm vitest run tests/client/board.test.tsx` covers save, browse, validation error, clear, and tab order.
- [x] 4.2 Change `BoardView` configuration state to track the initial section, make the configuration icon open General, and make the empty-board Configure projects action open Projects; verify the corresponding board tests pass.

## 5. Client worktree form

- [x] 5.1 Replace the UUID-based `initialWorktree` branch and path with the shared helpers, pass the base path through the drawer, and add a `worktreeDefault` hook that replaces provisional values only when the user has not edited them; verify tests for an accented title, no base path, and a host suggestion replacing the provisional name.
- [x] 5.2 Add branch and destination touch tracking: a branch edit updates an untouched destination, a manual destination override survives a branch edit, and a reset action restores `base + current branch`; verify `pnpm vitest run tests/client/worktree-defaults.test.tsx`.
- [x] 5.3 Keep existing-branch mode free of counters and keep creation sending the displayed branch and explicit destination; verify client tests for existing-branch prefill, manual values in the command, and a Git collision error shown to the user.
- [x] 5.4 Add a regression check that editing a task title after its worktree exists leaves the branch and destination unchanged; verify the task-edit and worktree client tests pass.

## 6. Documentation and verification

- [x] 6.1 Update the README configuration and worktree sections with the General base path, title-derived names, collision counter, and the note that existing names are untouched; verify the described commands and labels match the implemented UI.
- [x] 6.2 Run `pnpm check` and `openspec validate "worktree-base-path-and-title-names" --type change --strict`; resolve every failure and record the passing output.
