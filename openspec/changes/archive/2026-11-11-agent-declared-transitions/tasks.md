# Tasks

## 1. Data model and schema

- [x] 1.1 Add an optional `reason` to `RecordedTransition` and add `origin: 'agent'` plus an optional `reason` to `PendingTransition` in `src/shared/types.ts`; verify `pnpm typecheck` reports no error in files that construct either record.
- [x] 1.2 Accept the new fields in `src/domain/schema-parts.ts`: an optional non-empty `reason` on a recorded transition, and a pending transition whose `agent` origin requires a reason; verify `pnpm vitest run tests/domain/schema.test.ts tests/domain/hub-schema.test.ts` passes with added cases for both.
- [x] 1.3 Confirm an older stored document without a reason still parses; verify a new case in `tests/domain/schema.test.ts` loads a fixture whose recorded transition omits the field.

## 2. Domain rules

- [x] 2.1 Create `src/domain/transition-reason.ts` with `TRANSITION_REASON_LIMIT = 1000` and `normalizeTransitionReason`, trimming and rejecting a blank or oversized value without truncating; verify a new `tests/domain/transition-reason.test.ts` covers trim, blank, exact limit, and limit plus one.
- [x] 2.2 Require the reason in `recordTransition` (`src/domain/hub-operations.ts`) when it names a target, and keep clearing without a reason; verify `pnpm vitest run tests/domain/hub-operations.test.ts` covers a stored reason, a rejected blank reason, and a reason-less clear.
- [x] 2.3 Expose the reason from `recordedTransition` and add `advanceArmed(workflow, task)` in `src/domain/transition-route.ts` returning true for enabled auto mode or for a resolving recording that carries a reason; verify `pnpm vitest run tests/domain/transition-route.test.ts` covers enabled, disabled, disabled-plus-reason, and a legacy recording without one.

## 3. Delivery composition

- [x] 3.1 Accept an optional reason block in `StageInstructionInput` and compose the text as instruction, then reason, then briefing in `src/host/stage-message.ts`; verify `pnpm vitest run tests/host/stage-message.test.ts` covers all three orders and the two-block cases.
- [x] 3.2 Carry the declared reason and the source stage into `admitStageInstruction` (`src/host/stage-instruction.ts`), resolving the source stage name against the live workflow immediately before the delivery and passing the block only when the advance consumed a recording; verify `pnpm vitest run tests/host/stage-instruction.test.ts` includes a delivered reason, its absence for a plain move, and a renamed source stage.
- [x] 3.3 State in `buildTransitionBriefing` (`src/host/stage-briefing.ts`) that recording a destination requires a reason and that the declared transition is followed at the end of the turn; verify `pnpm vitest run tests/host/stage-briefing.test.ts` asserts both sentences.

## 4. Host advance path

- [x] 4.1 Gate the coordinator's `observe` and `settle` on `advanceArmed` instead of `autoMode?.enabled`, and record a pause for a non-completed turn end only when auto mode is enabled, in `src/host/turn-advance.ts`; verify `pnpm vitest run tests/host/turn-advance.test.ts` covers a disabled task with a recording that queues, and one without that does not.
- [x] 4.2 Parameterize `admitTurnAdvance` (`src/host/advance-admission.ts`) by origin: read `advanceArmed` in the blocked guard, assert the arming condition that matches the origin inside the transaction, and persist `origin` plus the recorded reason on the pending transition; verify `pnpm vitest run tests/host/advance-admission.test.ts` covers both origins and the origin-specific invariant failures.
- [x] 4.3 Rename the coordinator and admission modules and exports to their origin-neutral names (`turn-advance`, `advance-admission`, `TurnAdvanceCoordinator`, `admitTurnAdvance`), updating every import; verify `pnpm typecheck` and `grep -rn "admitAutoAdvance\|host/auto-advance" src tests scripts` returns nothing.
- [x] 4.4 Forward the pending transition's reason and source stage from `drainPending` into the instruction admission, and treat the `agent` origin like `auto` for the agent-pause retention on placement, in `src/host/app.ts`; verify `pnpm vitest run tests/host/auto-advance-app.test.ts tests/host/pause-tools.test.ts`.
- [x] 4.5 Cover the end-to-end host behavior: a task without auto mode that declared a transition advances at its completed turn end and delivers instruction plus reason; a turn ending in `error` moves nothing and records no pause; a stale recording without auto mode moves nothing and records no pause; a failed delivery of a declared advance keeps its reason and is recoverable through the play action or a dismiss; verify these cases in `tests/host/auto-advance-app.test.ts` and `tests/host/transition-briefing-send.test.ts`.

## 5. Tool surface

- [x] 5.1 Add `TaskRoutingPort` and `requireOwnTask` to `src/host/tools/scope.ts`, and make `transitionTools` depend on the port instead of `KanbanApp`; verify `pnpm typecheck` and `pnpm vitest run tests/host/transition-tools.test.ts`, which includes a case that drives the tools against a hand-built port.
- [x] 5.2 Accept `column_id` and `reason` only in `set_next_transition`, require the reason with a target, report the stored reason and whether the declaration arms the turn in the result, and state the explicit-request and end-of-turn contract in its description; verify `pnpm vitest run tests/host/transition-tools.test.ts` covers a declaration, a missing reason, an oversized reason, a clear, a stray task identifier, and a call from an ordinary chat.
- [x] 5.3 Keep `task_id` on `list_allowed_transitions` and report the recorded reason there; verify `pnpm vitest run tests/host/transition-tools.test.ts` reads another task's routing from an ordinary chat and returns its reason.
- [x] 5.4 Wire the port and the new command payload in `src/host/app.ts` so `task.recordTransition` carries the reason; verify `pnpm vitest run tests/host/tools.test.ts` still lists the same tool names and `pnpm typecheck` passes.

## 6. Presentation

- [x] 6.1 Label a pending transition by its origin in `src/client/card-status-entries.ts` and name it in the drawer's recovery status (`src/client/git.tsx`), attributing an `agent` record to the agent and keeping the existing confirmed-action wording for the legacy records; verify `tests/client/task-card.test.tsx` and `tests/client/pending-transition-status.test.tsx` assert all three origins and the recovery actions.

## 7. Documentation

- [x] 7.1 Update the transition and auto-mode sections of `README.md`: recording requires a reason, a declared transition advances at the end of the turn without auto mode, clearing disarms it, the write tool takes no task identifier, and the reason is delivered with the destination instruction; verify no sentence still claims recording never influences a move.
- [x] 7.2 Update `docs/operations.md` with the same contract plus the downgrade note for a Hub document that holds a declared reason; verify the note sits beside the existing pause downgrade guidance.
- [x] 7.3 Bump `version` in `package.json` to `0.24.0`; verify the value differs from the released `0.23.0`.

## 8. Verification gates

- [x] 8.1 Run `pnpm check` and confirm host and client typechecks, vitest, and the build all pass.
- [x] 8.2 Prove the declared advance in the real composition. The auto-run lane replays a single session, so a second task with its own turn could not be added to it; the case is its own lane instead: `tests/e2e-dsh/kanban-declared-transition.e2e.template.ts` with `tests/e2e-dsh/declared-transition.replay.override.json` (one replayed turn that calls `set_next_transition`, then a text completion, then the destination instruction's turn) and a `declared` selector in `scripts/e2e-dsh.mjs`. Verify `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only declared` passes.
- [x] 8.3 Run `pnpm test:browser` and confirm the plugin-owned browser lane passes, including `tests/browser/declared-transition.spec.ts`, which stores its screenshots under the git-ignored `.verification/`.
