# Tasks

## 1. Shared contracts and rules

- [x] 1.1 Add `task.runInstruction` to the command union, remote schema, and client API types; verify `pnpm run typecheck` passes and `CommandSchema` accepts the new variant.
- [x] 1.2 Extract the stage-transition rule into a pure shared module with `canTransition` and `permittedDestinations`; switch the board's `allowedDestination`, the drawer's permitted list, and the host's `canTransition` to it; verify the existing transition tests still pass.
- [x] 1.3 Add the runtime `@deepseek-ai/dsh-llm` dependency and update the lockfile; verify `pnpm install --frozen-lockfile` and `pnpm run typecheck` succeed.

## 2. Host first-turn task context

- [x] 2.1 Create `src/host/task-context.ts` with the `kanban-task` source augmentation, the task-context text/message builder, and the `agent/pre-step` injector; verify the host typecheck and that the source is accepted by `createUserMessage`.
- [x] 2.2 Implement the first-step decision: call `next()`, skip rejections, empty steps, non-task agents, and already-checked agents; inspect durable history once; prepend the context only when no `user/message` exists; verify with host tests for first step, later step, resume with history, and a non-task agent.
- [x] 2.3 Handle inspection failure and `clear` resets: report without failing the turn, leave the agent unmarked on failure, and re-evaluate after a clear; verify with a failing history read and a cleared agent.
- [x] 2.4 Register the injector in `src/index.ts` and dispose it with the plugin lifetime; verify no listener remains after plugin disposal.

## 3. Host card run command

- [x] 3.1 Implement `task.runInstruction` in `KanbanApp`: validate the task is in the requested stage, has no unresolved operation or confirmed transition, and the exact `expectedInstruction` matches; verify rejection cases with host tests.
- [x] 3.2 Resolve the target as the first open conversation, or create a new conversation when none is open; run `assertExecutionContext` and send only the instruction; verify first-open, all-closed, and busy-task tests, and confirm the stage/position do not change.
- [x] 3.3 Build the legacy `task.move` run text from the instruction only and remove the envelope builder from that path; verify the sent text is instruction-only and the exact-instruction guard still rejects a changed instruction.

## 4. Client card action and card structure

- [x] 4.1 Restructure the card into a container with an inner stretched open button and sibling actions; preserve the whole-card click, keyboard activation, drag start, selection mode, and accessible name; verify existing board interaction tests and a keyboard/drag smoke.
- [x] 4.2 Add `PlayIcon`, `RunInstructionButton`, and card action styles; render it only for instructed stages, stop click/keydown propagation, hide it in selection mode, and disable it while the task is busy; verify the card action is absent without an instruction and never opens the drawer.
- [x] 4.3 Wire the action to `task.runInstruction` with the current stage's exact instruction and inline error state; verify success, first-open/created conversation, admission failure, changed-instruction rejection, and repeated runs.

## 5. Client move and drawer prefill

- [x] 5.1 Remove `src/client/move.tsx`, the `MoveDialog` import, the `move` request state, and the instruction branch in `requestMove`; make the board apply every move immediately; verify instructed and uninstructed drops both move without a dialog.
- [x] 5.2 Make the drawer's stage move asynchronous and expose its result; keep a local pending destination while the command runs; verify the select updates after the move and a failed move does not prefill.
- [x] 5.3 Implement the `InstructionDraftPort` in `src/client.tsx` with `requestDraftInitialization`, focus, pending attach, abort on task/drawer change, and `applied`/`preserved`/`blocked` reporting; verify with a fake port and a real retained-binding smoke.
- [x] 5.4 Wire the drawer prefill: switch to Conversations for instructed destinations, target the active conversation or first open, preserve existing text/attachments with an explicit Replace, clear both on Replace, and report the no-open-conversation case; verify each drawer scenario.
- [x] 5.5 Render the visible task-context row in the Kanban Conversations panel from the retained session event window; the native Chat hides ordinary context nodes, so the plugin row is the visible surface; verify the bridge fixture and the fresh isolated-web smoke.

## 6. Task creation default

- [x] 6.1 Change the New task project state to start empty while keeping the disabled placeholder, `required`, and disabled Create button; verify no project is preselected with one project, several projects, or an active project filter.

## 7. Documentation

- [x] 7.1 Update the README move/execution section, the first-use flow, and the prompt contract; verify no remaining "Move and run / Move only / Cancel" description.
- [x] 7.2 Update `docs/operations.md` for the card run action, drawer prefill, first-turn context row, and legacy pending behavior; verify the documented recovery and retry boundaries match the implementation.
- [x] 7.3 Run `openspec validate refine-move-card-execution --strict` and verify the change and both deltas validate.

## 8. Automated test coverage

- [x] 8.1 Add the test seams: extract the task-context decision from the `agent/pre-step` registration (or inject `inspect`/`report`), define a narrow `DraftSession` adapter for the draft port, and add a pure `runInstruction` command factory; verify the modules import without a host or GUI and `pnpm run typecheck` passes.
- [x] 8.2 Add task-context unit tests for the message role/source/content and the first-step decision: first step, later step, resume with history, non-task agent, rejection, empty step, inspect failure, and clear/new agent; verify `tests/host/task-context.test.ts` passes and asserts the context precedes the existing messages.
- [x] 8.3 Add one Cordis listener test using a real `Context` and `ctx.waterfall('agent/pre-step', ...)` for registration, prepend order, and disposal; verify no listener remains after dispose.
- [x] 8.4 Extend `tests/host/app.test.ts` for `task.runInstruction`: first open, created conversation, exact instruction-only text, no stage/position change, busy/moved/changed/cwd errors, and wire-schema acceptance; verify zero sends on every rejection and no pending transition is created.
- [x] 8.5 Update the legacy `task.move` run assertions in `tests/host/app.test.ts` and `tests/host/product-walkthrough.test.ts` to instruction-only text; verify the pending/retry and changed-instruction cases still pass.
- [x] 8.6 Add a draft-port unit suite with a fake `DraftSession`: queue-before-attach, applied/preserved/blocked, Replace removing attachments with `clearPreviousDraft`, focus, abort, and single consumption; verify every result and that a blocked request writes nothing.
- [x] 8.7 Add client tests for the card-link open button, keyboard activation, drag from the open button, selection mode, and the card action's presence/payload/disabled/selection/error behavior; verify the action never opens the drawer and never changes the stage.
- [x] 8.8 Add client tests for the drawer move-and-prefill: switch to Conversations, active/first/no-open target, preserve/Replace, abort on task switch, instruction-only text, and the empty/required project select with and without a filter; verify each scenario.
- [x] 8.9 Extend the bridge fixture with `conversation.input` and verify the real adapter calls `requestDraftInitialization` with the retained binding and prompt, focuses, and never submits or calls a host command.
- [x] 8.10 Replace the existing MoveDialog coverage: delete `tests/client/approval.test.tsx`, rewrite the instructed-move tests in `tests/client/board.test.tsx`, update the drag test in `tests/client/refinement.test.tsx` for the open button, and add any fake-API/helper support; verify no Move and run / Run in conversation references remain and the card-link drag passes.
- [x] 8.11 Run one owner-authorized GUI smoke on a fresh isolated web instance: first-message task-context row, later instruction without a repeat, card action without a dialog, drawer preserve/Replace, a new conversation's own context, and the empty project select; capture the evidence under `.verification/`.
- [x] 8.12 Run `pnpm run typecheck`, `pnpm test`, `pnpm run build`, and `openspec validate refine-move-card-execution --strict`; verify all pass and the cheap suite makes no real-model or native Chat call.

