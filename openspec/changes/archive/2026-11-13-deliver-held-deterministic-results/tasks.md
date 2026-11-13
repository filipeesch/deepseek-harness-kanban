# Tasks

## 1. Domain hold model and evaluation

- [x] 1.1 Add `DeterministicHold`, `DeterministicHoldCode` and the optional `hold` field to `DeterministicControl` and `DeterministicSummary` in `src/shared/deterministic.ts`, and add the stored and wire schemas in `src/domain/deterministic-state.ts` and `src/remote.ts`; verify `pnpm typecheck` and that `tests/domain/deterministic-state.test.ts` still passes with a control that has no hold.
- [x] 1.2 Create `src/domain/deterministic-hold.ts` with `evaluateDeterministicHold` (authority, structural conditions, conversation blockers) and `sameDeterministicHold`, with bounds for background facts and labels; verify a new `tests/domain/deterministic-hold.test.ts` covers every code, the precedence order, the bounds, and equality of identical reasons.
- [x] 1.3 Move the router's gate onto the evaluator: `src/host/deterministic-routing.ts` returns `{ status: 'held', hold }`, keeps the awaited-read re-validation and the transactional re-check, and maps a conversation read failure to `conversation-unreadable`; verify `tests/host/deterministic-routing.test.ts` passes with added assertions for the hold payload on each refusal path, including the unreadable conversation.

## 2. Single readiness report in the native adapter

- [x] 2.1 Add `ConversationIdleReport`/`ConversationBlocker` and `SessionPort.idleReport` in `src/shared/ports.ts`, and implement it in `src/host/native.ts` from the same private computation that `isIdle` delegates to, preserving job and schedule ids and the `SESSION_STATE_UNAVAILABLE` failure; verify `tests/native/native.test.ts` asserts report/idle parity for each activity family, the inbox and open-turn cases, pending question and approval, and the unavailable projection.
- [x] 2.2 Consume the report in the routing port (falling back to `isIdle` when a test double omits it) and carry its blockers into `evaluateDeterministicHold`; verify the routing tests exercise a real blocker list and that no other `isIdle` call site changed (search for `isIdle`).

## 3. Durable hold in the supervisor and event-driven re-delivery

- [x] 3.1 Persist `hold` in `DeterministicSupervisor.deliver()` when the router refuses, clear it when delivery is admitted or settles, replace it only when the reason changes, and report one diagnostic per change through the existing report port; verify `tests/host/deterministic-supervisor.test.ts` covers write, replace, clear, and the single report.
- [x] 3.2 Generalize `retryDelivery` to accept a saved result whose delivery is `pending`, keeping its entry and execution identity checks; verify the supervisor test retries a pending delivery without executing the program and rejects a stale identity.
- [x] 3.3 Add one coalesced re-check per held task (`HOLD_RECHECK_MS`, injectable), cleared on dispose, stop, accepted delivery, replaced control, and task deletion; verify fake-timer tests assert one re-check per hold and no timer after each cleanup path.
- [x] 3.4 Pass the changed session ids from `AttentionCoordinator`'s change callback and wake only the tasks whose conversations changed in `KanbanApp`, keeping the broad `sync()` for hub subscriptions; verify `tests/host/attention*.*` and `tests/host/deterministic-app.test.ts` assert that only the affected task re-delivers.
- [x] 3.5 Verify the end-to-end host behavior: a saved result held by a running job is delivered when the job settles, a cancelled job's settlement delivers it, a queued prompt answered later delivers it, and the program runs once; add these cases to `tests/host/deterministic-app.test.ts`.

## 4. Play delivers, Run again executes

- [x] 4.1 Route `task.deterministicPlay` in `src/host/app.ts` to deliver a saved result that is not accepted (retry when pending or failed, wake when delivering) and to start an execution otherwise; verify host tests assert no capture, trust, or execution on the delivery path and that the identities are preserved.
- [x] 4.2 Add the `task.deterministicRunAgain` command (`src/shared/types.ts`, `src/remote.ts`, `src/client/command-scope.ts`, `src/host/app.ts`), refusing an active or stopping entry; verify host tests capture the latest source and start a new execution, and that the old saved result is no longer offered.
- [x] 4.3 Update `ScriptActions` and `deterministic-view.ts` so the primary action is "Deliver result" for a saved result and "Run again" is a separate action rendered only when a saved result exists and the entry is not active; verify `tests/client/deterministic-ui.test.tsx` and `tests/client/deterministic-view.test.ts` cover the labels, the command each sends, and the hidden Run again.

## 5. Cancel the blocking job

- [x] 5.1 Add the optional `SessionPort.cancelJob` and implement it in `src/host/native.ts` through the public `jobs` service with a minimal structural type, returning `requested` or `already-finished` and failing with `JOBS_UNAVAILABLE` when absent; verify a native test with a fake registry covers both outcomes, the ownership rejection, and the missing service.
- [x] 5.2 Add `task.deterministicCancelJob` (`src/shared/types.ts`, `src/remote.ts`, `src/client/command-scope.ts`, `src/host/app.ts`): accept only a job named by the current hold, resolve the owning conversation, cancel with a reason naming the saved-result recovery, and wake the task; verify host tests cover cancel-then-deliver, a foreign job, an already settled job, and a job the hold does not name (`STALE_HOLD`).

## 6. Drawer notice

- [x] 6.1 Add the hold copy helpers to `src/client/deterministic-view.ts` (label, bounded detail, applicable action per code) and verify unit tests cover every code and the bounded label output.
- [x] 6.2 Create `src/client/deterministic-hold-notice.tsx` and render it in `src/client/drawer.tsx` inside `kb-status-stack` above `ScriptPanel`, with one action-local Cancel per job fact and an error shown in the notice; verify `tests/client/` render tests assert the notice, the per-job action, the error path, and its absence when no hold exists.
- [x] 6.3 Add a card-level held attribute in `src/client/task-card.tsx`/board card styles without changing the short label; verify the browser lane asserts the card attribute and the drawer notice for a held summary.
- [x] 6.4 Extend the deterministic browser spec (`tests/browser/deterministic.spec.ts`) for the highlighted notice, the cancel action, the Deliver/Run again actions, and light/dark contrast, writing screenshots under `.verification/`; verify `pnpm test:browser`.

## 7. Specification, preset and documentation

- [x] 7.1 Review `presets/skills/kanban-workflow-design/` and the `kanban-workflow-architect` bundle for statements about Play always executing or about a held result, updating only what this change makes wrong; verify the preset size ceilings and the bundle/skill validation described in `AGENTS.md`.
- [x] 7.2 Check `docs/` and the plugin README for Play and deterministic-delivery guidance, updating any statement the change makes wrong; verify no stale mention of Play re-running with a saved result remains.

## 8. Verification

- [x] 8.1 Run `pnpm check` and confirm host and client typechecks, vitest, and the build pass.
- [x] 8.2 Run `node scripts/e2e-dsh.mjs --checkout /Users/filipe.esch/projects/pessoal/private-dsh --check --only deterministic` against the isolated real composition and confirm the deterministic lane passes without a real model.
- [x] 8.3 Exercise the held-result scenario in the isolated web instance: hold a saved result with a long-running job, confirm the drawer notice and Cancel action, cancel the job, and confirm the card reaches the captured destination without a new Play; record the evidence under `.verification/` and leave the developer's environment untouched.
