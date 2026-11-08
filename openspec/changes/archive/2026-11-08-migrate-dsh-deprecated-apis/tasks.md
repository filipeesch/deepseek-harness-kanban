# Tasks

## 1. Foundation

- [x] 1.1 Add `@deepseek-ai/dsh-session-query` at `0.2.1-rc.2` to `devDependencies`, run `pnpm install`, and verify `pnpm-lock.yaml` resolves the package and `pnpm typecheck` sees the `Context.sessionQuery` augmentation.
- [x] 1.2 Add `ESNext.Disposable` to the `lib` array in `tsconfig.json` and verify `Symbol.dispose` typechecks when the adapter is compiled.
- [x] 1.3 Implement `src/host/session-history.ts` with `SessionHistory`, `SessionHistoryReader`, and `createSessionHistory`; verify a focused test asserts `header`/`events`/`inheritedEventCount` mapping, signal forwarding, default timeout, and lease disposal on success and error.
- [x] 1.4 Add `sessionQuery` to the plugin `inject` list and verify every test that composes `apply` provides the service.
- [x] 1.5 Bump `package.json` to `0.1.7`, update the lockfile, and verify `pnpm install --frozen-lockfile` succeeds.

## 2. Session-history consumers

- [x] 2.1 Replace the `inspect` helper in `src/host/native.ts` with `history.read`; use `header.cwd`, `header`, and `inheritedEventCount` in `inspectedDirectory`, `policiesFor`, `directory`, and `isIdle`; verify the native tests pass.
- [x] 2.2 Reduce `src/host/native-facts.ts`'s `InspectionLike` to the event list the folds use, remove the unused `meta` dependency, and verify the native-facts tests pass.
- [x] 2.3 Replace `TaskContextInspect` with the history reader in `src/host/task-context.ts`, remove the now-unused `SessionId` import, and verify the task-context tests pass.
- [x] 2.4 Compose one history reader in `src/index.ts` and pass it to `createNativePorts`, `registerTaskContextInjection`, and the `KanbanApp` history callback; verify the app and question-persistence tests pass.
- [x] 2.5 Add a regression test that composes the plugin with a `sessionController` that has no `inspect` method and asserts `questionsFollow` returns its baseline and rounds; verify the test fails on the pre-change source and passes after the migration.
- [x] 2.6 Add a native regression test that asserts `directory`, `isIdle`, and `policiesFor` use the history reader and never call `sessionController.inspect`; verify the test passes.

## 3. Request guard migration

- [x] 3.1 Add `llm` to the plugin `inject` list and import the `@deepseek-ai/dsh-llm` event augmentation; verify the plugin composes with the service in the host tests.
- [x] 3.2 Replace the `agent/request` listener in `registerTaskExecutionGuards` with an `llm/stream` async generator that validates task sessions with an omitted `purpose`, checks the changing operation before and after `assertExecutionContext`, and forwards `next()`; verify the execution-guard tests pass.
- [x] 3.3 Add tests that a directory change during request-configuration middleware prevents the provider call, that an aborted signal rejects before `next()`, and that non-task and purpose-bearing streams pass through unchanged; verify the tests pass.
- [x] 3.4 Update `tests/native/native.test.ts`'s request-middleware scenario to exercise the stream boundary and assert the model stream is never created; verify the test passes.
- [x] 3.5 Confirm no `agent/request` listener remains in `src/` with a grep and record the result in the change notes.

## 4. Projection registration

- [x] 4.1 Make `registerConversationFacts` asynchronous and implement the awaited-registration adapter: use `handle.stateOf`/`handle.dispose` for the `0.2.2` handle and the disposer plus registry `stateOf` for `0.2.1`; verify the conversation-facts tests pass.
- [x] 4.2 Await the reader in `src/index.ts` before creating native ports and keep the existing `ctx.effect` disposal; verify plugin composition tests pass.
- [x] 4.3 Add tests for the handle branch, the disposer branch, and a rejected registration; verify activation fails loudly on rejection and both branches read the fold correctly.
- [x] 4.4 Grep the source for `sessionProjections.stateOf` and the callable `register` return; verify the only `stateOf(session, key)` call is the `0.2.1` compatibility branch.

## 5. Inspector scripts and real-composition template

- [x] 5.1 Migrate `scripts/verify-native-questions.mjs`, `scripts/verify-native-conversations.mjs`, `scripts/verify-native-coordination.mjs`, `scripts/verify-native-worktrees.mjs`, `scripts/verify-native-ask.mjs`, and `scripts/native-coordination-lifecycle.mjs` to a local `readSession` helper over `ctx.get('sessionQuery').observeSession`; replace `meta` with `header`; verify no `sessionController.inspect` or `meta.cwd` remains in those files.
- [x] 5.2 Update the capability preconditions in those scripts from `inspect` to `observeSession` and verify each script still fails safely when the capability is absent.
- [x] 5.3 Update the UAT helper fakes that emulate the scripts to provide `sessionQuery.observeSession` observations with `[Symbol.dispose]`; verify the affected vitest suites pass.
- [x] 5.4 Migrate `tests/e2e-dsh/kanban-deletion.e2e.template.ts` to `scaffold.ctx.sessionQuery.observeSession` with `try/finally`; verify no `sessionController.inspect` remains and the template compiles in the checkout.

## 6. Policy and documentation

- [x] 6.1 Add the **Host API deprecations** section to `AGENTS.md` with the agreed three rules; verify the wording names the pinned source check, the preferred replacement, and the alternative-solution requirement.
- [x] 6.2 Update `docs/operations.md` so the execution guards are described at the `llm/stream` boundary and the deprecation sweep is documented.
- [x] 6.3 Add a troubleshooting note to `docs/operations.md` and the install guidance for a stale `- id: kanban` / `disabled: true` profile override; verify the note includes the `--dump-config` check.
- [x] 6.4 Run a final `@deprecated` sweep against the private DSH checkout for every host API the plugin uses and record the inventory and any deliberate exception in the change notes.

## 7. Verification

- [x] 7.1 Run `pnpm check` (host and client typechecks, vitest, and build) and verify it passes.
- [x] 7.2 Run `pnpm test:browser` and verify the plugin-owned browser harness still passes.
- [x] 7.3 Run `node scripts/e2e-dsh.mjs --checkout ~/projects/pessoal/deepseek-harness --check` and verify the private `0.2.2-rc.1` checkout and its built artifacts meet the lane prerequisites.
- [x] 7.4 Run the isolated `--only conversation` lane against the private checkout and verify the question form, durable round, and dismissal flow work without the history error.
- [x] 7.5 Run the isolated `--only prepare` lane and verify first-turn task context and first-execution preparation work.
- [ ] 7.6 Run the isolated `--only deletion` lane and verify the migrated child-session inspection and deletion flow work.
  - Open, not archive-ready: the child observation through `sessionQuery` passes, but the confirmed delete leaves `worktree-task` in place. The fixture's second model call belongs to the recovery phase after that assertion, so its non-consumption is a consequence, not the cause. No pinned-host baseline exists; collect deterministic lineage/activity evidence before attributing the failure. See `.verification/migrate-dsh-deprecated-apis.md`.
- [x] 7.7 Run the fresh-install smoke with a throwaway `DSH_HOME` and a `kanban-smoke` profile linked to this worktree: verify `--dump-config` has no `disabled: true` for `kanban`, the Kanban sidebar item appears, and the question form renders; stop the background job and remove the throwaway home.
- [x] 7.8 Store the verification report and screenshots under `.verification/` without tokens, credentials, or owner data, and verify the report names the host version and the lanes run.
