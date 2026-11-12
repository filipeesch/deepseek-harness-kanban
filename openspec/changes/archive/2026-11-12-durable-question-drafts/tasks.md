# Tasks

## 1. Setup and shared draft model

- [x] 1.1 Install the worktree dependencies and record a green baseline: run `pnpm install --frozen-lockfile` and `pnpm check`; verify it passes before any change.
- [x] 1.2 Add the transport-neutral stored draft shape to `src/shared/types.ts` (`StoredQuestionDraft` with `answers`, `generalNotes`, `active`, `updatedAt`, and optional `drafts` on `QuestionFeedFrame`); verify `pnpm typecheck` accepts the additive change.
- [x] 1.3 Implement `src/questions/draft.ts` as a pure module (`emptyDraft`, `restoreDraft` with active-page fallback, `toStoredDraft`, `hasContent`, and the choice/Other/text/notes/Additional Notes/active-slide updaters) and export it from `src/questions/index.ts`; verify `tests/questions/draft.test.ts` covers empty state, round-trip through `toStoredDraft`/`restoreDraft`, missing `callId` fallback, and content detection.

## 2. Host draft storage

- [x] 2.1 Open a second per-record domain (`kanban_question_drafts`, version 1) from `src/host/question-storage.ts` with the session record schema from the design, add `remove` to `QuestionStore`, and add `QuestionDraftStore` (`load`, `save`, `remove`, `records`); verify `tests/host/question-draft-storage.test.ts` asserts the declared domain/layout and round-trips records, removal, and the session listing.
- [x] 2.2 Update `tests/host/questions-persistence.test.ts` for the new `openQuestionStorage` return shape and verify the existing projection persistence tests still pass.
- [x] 2.3 Add `questionDraftStore` to `KanbanApp` options plus `questionDrafts(sessionId)` and `saveQuestionDraft(sessionId, roundId, draft | null)`; serialize writes per session, merge one round, validate the payload (bounded text and answer counts, `INVALID_QUESTION_DRAFT`), drop answered or dismissed rounds, and report best-effort failures; verify `tests/host/question-drafts.test.ts` covers merge across rounds, clear, oversized payload rejection, the answered-round guard, and that a failed save is reported without throwing.
- [x] 2.4 Implement bounded retention as a background startup job in `KanbanApp.initialize` that keeps the 100 most recently updated draft records (`QUESTION_DRAFT_RETENTION`); verify a test with 101 records asserts the least recently updated one is deleted and that dropping a record leaves the conversation's rounds intact.

## 3. Transport and host composition

- [x] 3.1 Add `StoredQuestionDraftSchema` and the optional `drafts` field on `QuestionFeedFrameSchema`, and declare `kanban/saveQuestionDraft` (request `{ sessionId, roundId, draft | null }`, outcome of the saved round) in `src/remote.ts`; verify `pnpm typecheck` covers the new remote member.
- [x] 3.2 Implement the controller method and include stored drafts in the `questionsFollow` baseline only, leaving updates rounds-only; verify `tests/host/question-feed.test.ts` asserts the baseline carries drafts once and an update does not.
- [x] 3.3 Open the draft store in `src/index.ts`, pass it to `KanbanApp`, and close it in the disposal chain; verify the existing plugin load/dispose tests pass.

## 4. Client transport and draft state

- [x] 4.1 Implement `src/client/question-draft-state.ts` with hydration that never overwrites a locally written round, immediate in-memory `update`/`clear`, and per-round debounced saves plus `flush`; verify `tests/client/question-draft-state.test.ts` covers hydration, dirty-round protection, debounce coalescing, flush-on-demand, and clear.
- [x] 4.2 Wire `ClientBridge` to construct the draft state, hydrate it from each feed frame before the frame reaches `QuestionRoundCache`, send `draft: null` on clear, and expose the dock-facing draft port; verify the bridge tests (including `tests/client/question-round-cache.test.ts`) still pass and a remount reads the in-memory draft synchronously.

## 5. Form and dock extraction

- [x] 5.1 Implement `src/questions/use-question-draft.ts` and refactor `src/questions/QuestionForm.tsx` to render from it, keeping only transient UI state (collapsed, submission, admission error, dismissal confirmation, refs, seen pages) and adding optional `storedDraft`/`onDraftChange` props; verify `tests/questions/QuestionForm.test.tsx` still passes plus new cases: restored draft renders, restore does not auto-submit, a new round starts empty, and omitted props keep in-memory behavior.
- [x] 5.2 Extract the dock into `src/client/question-dock.tsx` exporting `QuestionDock` and `createQuestionDockServices`, update `src/client.tsx` to register the slot with the new component, and add the `saveQuestionDraft` mock to the bridge test fixture; verify `tests/bridge/plugin.test.tsx` passes, including a new test that unmounting and remounting the dock restores the typed answer and that an answered frame clears it.
- [x] 5.3 Verify the browser harness still renders the strip unchanged with `pnpm test:browser`.

## 6. Lifecycle cleanup

- [x] 6.1 Prune a round's draft when the round becomes answered (submit or ordinary reply) and after a successful dismissal, reusing the write guard; verify tests in `tests/host/question-drafts.test.ts` assert the record is gone after an answered human event and after `dismissQuestions`, and that a late save for a finished round is ignored.
- [x] 6.2 Add `QuestionIndex.forget(sessionId)` that drops the conversation's events, dismissals, rounds, and revision; verify `tests/questions/indexer.test.ts` asserts a forgotten session returns no rounds and no revision growth.
- [x] 6.3 Extend `onTaskDeleted` in `src/host/app.ts` to remove both the draft records and the question projection for `task.sessionIds` and to forget the index state; verify a host test deletes one task and asserts its records are gone while another task's and an ordinary chat's state remain.
- [x] 6.4 Verify deletion cleanup failures are reported and never fail the deletion, matching the existing callback behavior, with a test that injects a rejecting store.

## 7. Documentation and gates

- [x] 7.1 Update the README question section (the `Questions and model-facing tools` paragraph and the dismissal paragraph) to document durable drafts, the restore scope, and the cleanup rules; verify no sentence still says drafts are reload-ephemeral.
- [x] 7.2 Bump `package.json` version and verify `openspec validate durable-question-drafts --strict` passes.
- [x] 7.3 Run `pnpm check` and verify host/client typechecks, vitest, and the build.
- [x] 7.4 Run `pnpm test:browser` and verify the question panel appearance and submit evidence still match.
- [x] 7.5 Extend `tests/e2e-dsh/kanban-conversation-ux.e2e.template.ts` to type an answer, reload, assert the restored answer before dismissing, then keep the existing durable-dismissal assertions; verify with `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only conversation`.
- [x] 7.6 Verify restore and cleanup in isolated, reviewable evidence: the real-composition lane (throwaway `DSH_HOME`, no owner profile) restores the draft after reload and discards it on dismissal, writing `.verification/e2e-question-draft-restored.png`; `tests/bridge/plugin.test.tsx` covers the drawer-equivalent dock unmount/remount restore; and `tests/host/question-drafts.test.ts` covers task-deletion cleanup. A task conversation cannot receive a `decision_request` without a model turn, so its drawer surface is covered by the dock remount test rather than a seeded task conversation.