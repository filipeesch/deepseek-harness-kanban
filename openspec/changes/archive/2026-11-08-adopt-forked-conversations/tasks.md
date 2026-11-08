# Tasks

## 1. Domain predicate

- [x] 1.1 Add a pure `isForkLineage` predicate to `src/domain/session-lineage.ts` that returns true only when a direct parent session is recorded and `origin` is not `subagent`, and update the `ownedSessionIds` doc comment to state that adopted forks are lineage roots rather than traversed edges. Verify with `pnpm vitest run tests/domain/session-lineage.test.ts`, covering fork, subagent, and missing-parent entries.
- [x] 1.2 Add unit cases proving the predicate does not treat a subagent child, a session without a parent, or a session with a missing parent as a fork. Verify the same test file passes with the new cases.

## 2. Adoption coordinator

- [x] 2.1 Create `src/host/conversation-adoption.ts` with a `ForkAdopter` that receives injected ports for task lookup, effective-directory read, directory set, session attachment, bounded sleep, and error reporting; it must adopt only a fork whose direct parent is a retained task conversation and must skip a session already associated with a task. Verify with a new `tests/host/conversation-adoption.test.ts` using fake ports for adopt, unknown parent, subagent origin, and already-associated cases.
- [x] 2.2 Implement directory alignment: read the fork's effective directory, call the directory port only when it differs from the task effective directory, and skip attachment with a reported failure when alignment fails. Verify with tests for a matching directory (no set call), a mismatch (set before attach), and a failing set (no attach, one report).
- [x] 2.3 Implement the bounded retry for a rejected attachment while the task has a pending context operation, using the injected abortable sleep, and report the failure after the attempt budget. Verify with fake-timer tests for retry-then-success, exhausted budget, and disposal aborting the wait.
- [x] 2.4 Guarantee that every coordinator failure is reported and never thrown to the caller, and that a detached invocation cannot reject its caller. Verify with a test that a rejecting port resolves without an unhandled rejection and reports once.

## 3. Registration and wiring

- [x] 3.1 Add `registerForkAdoption(ctx, ports)` to `src/index.ts`, subscribing to `agent/created`, returning synchronously, running adoption detached, and disposing the listener plus in-flight waits on teardown. Verify with a fake-context registration test that emits `agent/created` for a fork-shaped session, asserts attachment, and asserts no attachment after disposal.
- [x] 3.2 Wire the ports in `apply` from `app.locator`, the native session port, the hub conversation transaction, the plugin lifetime signal, and the existing `report`, and include the new disposer in the plugin teardown chain. Verify with `pnpm typecheck` and by confirming the plugin build succeeds through `pnpm run build`.

## 4. Test fixtures and ownership coverage

- [x] 4.1 Add an explicit `seedFork(parent, child, directory)` helper to `tests/host/helpers.ts` and use it instead of `seedSubagent(..., undefined)` in new tests. Verify `pnpm vitest run tests/host/worktree-sharing.test.ts tests/worktrees/coordinator.test.ts` still passes.
- [x] 4.2 Add an ownership test showing that a fork already adopted into `sessionIds` no longer blocks worktree cleanup, while an unadopted fork still blocks; verify with `pnpm vitest run tests/host/worktree-sharing.test.ts tests/worktrees/coordinator.test.ts`.

## 5. Documentation alignment

- [x] 5.1 Update `README.md`, `docs/operations.md`, and `docs/scenario-evidence.md` so the lineage wording distinguishes an adopted fork (owned task conversation) from an unadopted fork (foreign). Verify with `grep -rn "forks and unrelated sessions" README.md docs` returning only the revised wording, and with a read-through of the changed paragraphs.
- [x] 5.2 Add a host-level integration test that drives the adoption path end to end against the real app fixture: create a task conversation, emit an `agent/created` fork-shaped session, and assert the task snapshot gains the session as an open conversation. Verify with `pnpm vitest run tests/host/fork-adoption-app.test.ts`.

## 6. Verification

- [x] 6.1 Run `pnpm check` and confirm the host and client typechecks, the full vitest suite, and the build all pass with the new tests included.
- [x] 6.2 Run `openspec validate adopt-forked-conversations --strict` and confirm the change validates with all artifact files present.
- [x] 6.3 Record the known limitation that an adopted fork of a migrated conversation cannot be re-attached to the task's native workspace because the native header cwd is immutable; confirm this is stated in the design and in `docs/operations.md` rather than presented as a defect.
