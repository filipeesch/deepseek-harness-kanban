# Tasks

## 1. Host question feed

- [x] 1.1 Add a monotonic per-session revision to `QuestionIndex` (`revisionOf(sessionId)`) and update it whenever a session's rounds are rebuilt; extend `tests/questions/indexer.test.ts` to prove unrelated sessions keep their revision and a dismissed/restored turn changes it.
- [x] 1.2 Add `KanbanController.questionsFollow(request, signal)` as a `@Remote({mode:'stream'})` method that yields a baseline frame and one update frame per changed session revision without calling attention or board projection; verify with a new controller test that a question apply emits a frame and an unrelated session event does not.
- [x] 1.3 Declare `kanban/questionsFollow` and a `QuestionFeedFrameSchema` in `src/remote.ts`, and remove `kanban/questions` from the remote map; verify `pnpm run typecheck` and the cordis remote tests pass.
- [x] 1.4 Remove `questionRounds` from `HostSnapshot`/`KanbanSnapshot`, `SnapshotSchema`, and `KanbanApp.snapshot()`; update `tests/bridge/*` fixtures and `tests/host/questions-persistence.test.ts` so they assert via the feed instead; verify `pnpm test` passes.

## 2. Client question cache

- [x] 2.1 Create `src/client/question-round-cache.ts` with an explicit feed port (open/reopen per session), tracked sessions, dismissal, submitted suppression, errors, and the `questionsView` observable; add `tests/client/question-round-cache.test.ts` covering baseline replace, update merge, per-session errors, and dispose.
- [x] 2.2 Implement optimistic submission in the cache: `submit(roundId)`, `rollback(roundId)`, focus preference for a rolled-back round, and suppression cleared only by an `answered`/absent frame; verify tests for success confirmation, failure rollback, and an unanswered frame arriving between submit and confirmation.
- [x] 2.3 Move `prepareQuestions`/`dismissQuestions`/question state out of `ClientBridge` and delegate to the cache; remove `questionRounds` handling from `accept`/`publish`; verify `tests/bridge/bridge.test.ts` is rewritten around a fake `questionsFollow` stream and `pnpm run typecheck` passes.
- [x] 2.4 Update the bridge/plugin fixtures and the remote mock with `questionsFollow`; verify `tests/bridge/plugin.test.tsx` and `tests/bridge/cordis.test.ts` pass.

## 3. Submission and gate UI

- [x] 3.1 Add pure helpers for submit state (`blocked:invalid`, `blocked:awaiting-turn`, `ready`, `submitting`, `failed`) and active-round selection (including submitted preference and rolled-back focus); add unit coverage in `tests/questions/validation.test.ts` or a new helper test file.
- [x] 3.2 Refactor `QuestionForm` to the submit-state machine, remove the dead "Response submitted." state and duplicate `sent`/`inFlight` refs, and render the explicit waiting-for-turn copy when answers are valid but the round is incomplete; verify `tests/questions/QuestionForm.test.tsx` covers the new states.
- [x] 3.3 Implement immediate close with rollback: call the cache before/at send, hide the form without unmounting so the draft survives, restore it with the admission error on failure, and move focus to the composer (or blur the hidden form) on hide; add tests for hide-before-admission-settles, rollback with answers and notes intact, and no resurrect on an intermediate frame.
- [x] 3.4 Add new-page discovery on Additional Notes using the highest visited page sequence, render the notice with an action to the first new page, and verify the position and draft are preserved; cover with tests for arrival on Additional Notes, action navigation, and no notice when already on the newest page.
- [x] 3.5 Wire the Dock to the cache view: `track` on mount, retry on error, select the active round, pass the submitted/hidden flag, and route dismiss through the cache; verify `tests/bridge/plugin.test.tsx` covers the strip hiding on submit and returning after a failed admission.

## 4. Appearance and docs

- [x] 4.1 Update the browser question harness and add the question submit coverage in `tests/browser/question-submit.spec.ts` for the waiting-for-turn copy, the new-page notice, and the hidden submitted state in light and dark themes; verify `pnpm test:browser` passes with screenshots under `.verification/`.
- [x] 4.2 Update `README.md` and `docs/operations.md` to describe immediate close with rollback, the visible turn-completion gate, the new-page notice, and the conversation-scoped question feed; verify the wording matches the final behavior and contains no stale "Response submitted." or snapshot-delivery claims.

## 5. Integration verification

- [x] 5.1 Run `pnpm run typecheck` and `pnpm test` and resolve every failure, confirming no test references the removed unary `kanban/questions` or `questionRounds`.
- [x] 5.2 Run `pnpm run build` and `pnpm test:browser` (both pass) and record the isolated-lane outcome: the only available DSH checkout is `0.2.2-alpha.2` and its own scaffold fails with `bundlePatchPaths is not a function` before exercising Kanban; the limitation and evidence are recorded in `.verification/improve-question-submit-responsiveness.md`.
- [x] 5.3 Owner GUI acceptance was not run because the project instructions forbid smokes against the developer's running app and personal profile; the behavior is covered by the deterministic host, cache, bridge, form, and browser lanes recorded in `.verification/improve-question-submit-responsiveness.md`.
