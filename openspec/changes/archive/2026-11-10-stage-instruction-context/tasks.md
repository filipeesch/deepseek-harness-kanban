# Tasks

## 1. Stage message value

- [x] 1.1 Declare the `stage-instruction` message source (kind, notice form, summary, delivery identity) next to its producer and export the type; verify `pnpm typecheck` accepts the declaration and the client import graph stays unchanged.
- [x] 1.2 Add `src/host/stage-message.ts` with a pure builder that composes the model-facing text (instruction, then the briefing when the stage configures two or more targets), the notice summary naming the stage and the applicable destination, and the delivery identity; verify `tests/host/stage-message.test.ts` covers two-or-more targets, exactly one target, no transitions, a recorded transition, and a summary bounded below the host limit.
- [x] 1.3 Route the existing briefing composition through the builder so `admitStageInstruction` no longer concatenates text; verify `tests/host/stage-briefing.test.ts` and `tests/host/stage-instruction.test.ts` pass with the new message shape.

## 2. Delivery

- [x] 2.1 Add `src/host/stage-delivery.ts` with an injected resolve port, an in-memory join for concurrent duplicates, and a durable skip when the resolved inbox or the conversation log already holds the delivery identity; verify `tests/host/stage-delivery.test.ts` covers fresh delivery, a cold conversation whose restored inbox still holds the identity, an already recorded identity, the recheck after the durable read, the concurrent duplicate, and a delivery failure.
- [x] 2.2 Implement the host adapter behind those ports: resolve the conversation through `sessionController.resolveAgent` and deliver with `agent.followup`, keeping the existing prompt port for schedules; verify `pnpm typecheck` and the native adapter unit tests pass.
- [x] 2.3 Change `admitStageInstruction` to depend on a `deliver(sessionId, message)` port instead of a free-text send, and wire it once in `app.ts` so the card run action, the timed instruction, the confirmed-transition drain, the automatic advance, and the agent-created first execution all use it; verify `tests/host/stage-instruction.test.ts`, `tests/host/first-execution.test.ts`, `tests/host/auto-advance-app.test.ts`, and `tests/host/transition-briefing-send.test.ts` pass.

## 3. Host projections

- [x] 3.1 Narrow `PluginPromptLedger` and its documentation to the schedule prompts that still use the human-prompt port; verify `tests/host/queued-prompts.test.ts` and the schedule host tests pass.
- [x] 3.2 Prove pending user work ignores a delivered stage instruction because of its source rather than because of a plugin record; verify a `tests/host/queued-prompts.test.ts` case with a queued `stage-instruction` message and no ledger entry.

## 4. Client and presentation

- [x] 4.1 Add the shared context-row module and claim the `stage-instruction` message with an exclusive Chat Definition that delegates to the host's native context-injection renderer and keeps an inline fallback; register the Definition and its `conversation.chat.node` slot and dispose both, reusing the same presentation as the task-context row. Verify `pnpm exec tsc -p tsconfig.client.json --noEmit`, `tests/client/task-context-definition.test.ts`, `tests/bridge/plugin.test.tsx`, and `tests/bridge/cordis.test.ts` pass.

## 5. Acceptance lanes

- [x] 5.1 Update `tests/e2e-dsh/kanban-auto-run.e2e.template.ts`, `kanban-create-start.e2e.template.ts`, and `kanban-prepare.e2e.template.ts` to locate the instruction in the context-injection row and to assert no user bubble records it; verify with `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only auto-run`, `--only prepare`, and the create-start lane. (Lane passed: 1 file, 1 test, after the row registration and the single-session draft phase.)
- [x] 5.2 Update the committed replay fixtures only if the recorded request changes; verify by running the same lanes without `--check` and confirming the instruction still drives the recorded turn. (No fixture edit needed: the existing order-based override passed unchanged, proving the model-facing request is identical.)
- [x] 5.3 Run `pnpm check` (host and client typechecks, vitest, build) and confirm it passes.
- [ ] 5.4 Run the isolated web smoke for the changed behavior: an instruction delivered after a move shows one context row that expands to the instruction, a later instruction adds no second task-context row, and the model-facing request in `$SMOKE_HOME/sessions` contains the same text as before the change; store the report under `.verification/`. (Blocked on this machine: the bundled desktop CLI is not installed. The report at `.verification/stage-instruction-context.md` records the gates that did run.)

## 6. Documentation and release

- [x] 6.1 Update the project smoke checklist to assert the stage-instruction context row (collapsed, expandable, summary naming the stage) alongside the existing task-context row assertion.
- [x] 6.2 Bump `version` in `package.json` in the same pull request; verify `pnpm check` still passes and the version differs from the released one.
