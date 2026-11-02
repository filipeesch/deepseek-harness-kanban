# Tasks

## 1. Domain and shared contract

- [x] 1.1 Add `src/domain/pending-user-work.ts` with the kind union, the empty value, `mergePendingUserWork`, `hasPendingUserWork`, and `awaitingReply` (every kind except a queued prompt), plus `tests/domain/pending-user-work.test.ts` covering merge, deduplication, empty, and the awaiting-reply derivation; verify `npx vitest run tests/domain/pending-user-work.test.ts`.
- [x] 1.2 Add the pure `resolveAdvanceDecision` decision beside `domain/auto-advance.ts`, returning `busy`, `running` (with the executing sessions), `pending` (with the merged value), or `advance`, and extend `tests/domain/auto-advance.test.ts` with the outcomes, a closed conversation in the input, and a second conversation with pending work; verify `npx vitest run tests/domain/auto-advance.test.ts`.
- [x] 1.3 Replace `ConversationFacts.awaitingReply` with `pending: PendingUserWork`, add `Attention.pending` with `awaitingReply` derived from it, and update both schemas in `src/remote.ts`; verify `pnpm typecheck` and `npx vitest run tests/host/conversation-facts.test.ts tests/host/app.test.ts`.

## 2. Native pending read

- [x] 2.1 Extend the native facts read (`src/host/native-facts.ts`, `src/host/native.ts`) to return `pending` with the approval kind from the registered fold and the native-question kind from the projection, keeping the inspected-log fallback for a conversation that is not live; verify `npx vitest run tests/host/native-facts.test.ts tests/native/native.test.ts`.
- [x] 2.2 Add the queued-prompt kind: the live `agent.inbox.nextTurn`/`nextStep` read and the durable `inbox` projection fallback, counting only human input (host-injected context notices parked in the steering list are not user work) and excluding prompts whose `user-rpc` `rpcId` matches a request identity the plugin sent (bounded ledger recorded by `SessionPort.send`); verify new cases in `tests/host/queued-prompts.test.ts` and `tests/native/native.test.ts`.
- [x] 2.3 Make an unreadable conversation state count as pending and report the failure instead of reporting idle, with a test that injects a failing projection/inspection read; verify that test plus `npx vitest run tests/host/native-facts.test.ts`.

## 3. Host wiring and admission

- [x] 3.1 Compose pending user work once (native facts wrapped with `QuestionIndex.pending`), inject the composed source into both `AttentionCoordinator` and `AutoAdvanceCoordinator`, and delete the duplicated composition (`app.ts:63`, `AttentionCoordinator.withPendingQuestion`, the `pendingQuestion` option); verify `npx vitest run tests/host/attention-coordinator.test.ts tests/host/attention-refresh.test.ts tests/host/attention-lifecycle.test.ts tests/host/app.test.ts`.
- [x] 3.2 Extract `src/host/auto-advance-admission.ts` from `KanbanApp.admitAutoAdvanceNow`: task guards, destination resolution and capture, target conversation resolution, the pending re-check immediately before the transaction, the durable transition, and the dispatch hand-off; `KanbanApp` keeps the serialized tail and wiring only; verify `npx vitest run tests/host/auto-advance-app.test.ts tests/host/auto-mode-command.test.ts`.
- [x] 3.3 Rework `AutoAdvanceCoordinator.settle`: delegate the decision to `resolveAdvanceDecision`, keep the bounded settle retry only for `running`, end the tick without requeue or pause for `pending`, and remove the attempts-based silent drop; verify `npx vitest run tests/host/auto-advance.test.ts`.

## 4. Host behavior

- [x] 4.1 Cover every pending kind at the app level — an unanswered question round, an unanswered native question, a pending approval, a queued user message — plus a closed conversation holding the card: no advance, no pause, no persisted transition; verify `npx vitest run tests/host/auto-advance-app.test.ts`.
- [x] 4.2 Cover consumption: consuming the last item does not advance by itself, and the next completed turn advances; verify `npx vitest run tests/host/auto-advance-app.test.ts`.
- [x] 4.3 Cover the admission re-check: pending user work appearing between the settle evaluation and the admission prevents the advance and leaves the task unchanged, including an unreadable wait state that must hold instead of failing; verify `npx vitest run tests/host/auto-advance-admission.test.ts tests/host/auto-advance-app.test.ts`.
- [x] 4.4 Extend the in-memory fixture (`tests/host/helpers.ts`) with a queued-prompt set and a pending-approval set so the facts read can express each kind; verify `npx vitest run tests/host` stays green.

## 5. Client

- [x] 5.1 Extend `autoModeView` with the task-level merged pending value, the new `held` state, and the `instruction` rename of the former `waiting` state, using the precedence `failed > advancing > paused > held > instruction > dead-end > armed`; verify `npx vitest run tests/client/auto-mode.test.tsx`.
- [x] 5.2 Render `held` on the card chip and the drawer's mirrored control (`data-auto-state="held"`, accessible name and title stating the wait and the kinds) with no status-strip entry and no drawer notice; verify `npx vitest run tests/client/task-card.test.tsx tests/client/board.test.tsx`.
- [x] 5.3 Fold the native client status's `pendingInteraction` into the pending kinds so the dot and the chip cannot disagree, and keep the attention dots' meaning (a queued prompt does not light the orange dot); verify `npx vitest run tests/client` and `pnpm test:browser`, including the `held` assertion added to `tests/browser/auto-mode.spec.ts`.

## 6. Gates, real composition, and docs

- [x] 6.1 Run the fast gate `pnpm check` (host and client typechecks, vitest, build) and confirm the persisted-state suites (`tests/domain/store.test.ts`, `tests/host/storage-migration.test.ts`) still pass unchanged because no schema was added.
- [x] 6.2 Run `pnpm test:browser` and confirm the auto-mode browser spec asserts the held chip and the unchanged dots with the host theme fixture.
- [ ] 6.3 Run the real-composition lane `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only auto-mode` against a built DSH checkout and confirm the automatic advance still works end to end, and that `--only question` still presents the round; record the checkout version the runner reports.
- [x] 6.4 Update `README.md`'s auto-mode section and `docs/operations.md`'s auto-mode notes to the pending-user-work rule and the chip-only held state, and confirm the two capability specs are the only behavior sources referenced by those sections.
