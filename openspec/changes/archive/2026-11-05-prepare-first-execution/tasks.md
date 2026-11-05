# Tasks

## 1. Shared gate and host rule

- [x] 1.1 Add `unresolvedWorktreeBinding(task)` beside `requiresWorktreeDecision` in `src/shared/worktree-decision.ts` and extend `tests/shared/worktree-decision.test.ts`; verify the new cases (ready, preparing, error, no binding) pass with `pnpm vitest run tests/shared/worktree-decision.test.ts`.
- [x] 1.2 Add the pure preparation descriptor `gate.ts` under `src/client/execution-preparation/` returning `null` or `{ worktree: 'ask' | 'blocked' | 'none', model: boolean }`; verify unit tests cover a task with a conversation, a folder project, a recorded base choice, an absent worktree, a preparing/error binding, and model availability.
- [x] 1.3 Narrow the implicit creation in `createConversationNow` (`src/host/app.ts`) with the `WORKTREE_BINDING_UNRESOLVED` invariant and reuse the shared predicate; verify host tests show the stage-instruction path refuses a first conversation while a binding is preparing or in error, and that an absent worktree, a dismissed choice and an existing conversation keep their current behavior.
- [x] 1.4 Verify the automatic advance and the legacy pending-transition dispatch are unaffected by the new invariant; run `pnpm vitest run tests/host/auto-advance-app.test.ts tests/host/legacy-pending.test.ts tests/host/app.test.ts`.

## 2. Move pipeline extraction

- [x] 2.1 Extract drag, move request, optimistic placement, countdown arming and the move dialogs from `src/client/board.tsx` into a `useBoardMoves` module, leaving `BoardView` to render the returned nodes; verify `pnpm vitest run tests/client/board.test.tsx tests/client/move-request.test.tsx` and the browser move-override spec still pass.
- [x] 2.2 Add the `beforeApply` option to `useMoveRequest` and call it immediately before `apply` for permitted moves and after the accepted override confirmation for restricted moves; verify unit tests cover proceed, cancel, and a rejected move after preparation.
- [x] 2.3 Wire the extracted pipeline to the preparation gate so the preparation runs only for a first execution into an instructed stage; verify a permitted uninterested move still applies without a dialog.

## 3. Preparation controller and dialog

- [x] 3.1 Define the preparation ports and the `ExecutionPreparationController` state machine under `src/client/execution-preparation/`; verify unit tests drive worktree ask, blocked binding, provisioning, model, done and cancel.
- [x] 3.2 Implement the `Modal`-based dialog with the two stages, accessible names, Cancel-first focus, Escape handling and an error region; verify client tests cover the stage transitions and that Escape or Cancel resolves the preparation as not moved.
- [x] 3.3 Implement worktree provisioning: send `worktree.create` with `api.worktreeDefault`, send `worktree.dismiss` for the base choice, disable Create with an explanation when no destination can be derived, and keep a create failure in the dialog with retry; verify with fake ports in unit tests.
- [x] 3.4 Implement first-conversation provisioning from the `conversation.create` receipt and retain the session through `ConversationLeaseRegistry`; verify the model stage renders only after the lease is ready and the lease is released when the dialog closes.
- [x] 3.5 Verify cancellation after provisioning keeps the worktree and conversation, leaves the task's stage and position unchanged, and starts no agent.

## 4. Native model seat

- [x] 4.1 Add the `NativeModelSeat` adapter rendering the `conversation.input.model` slot through `NativeSlotHost`, with a live availability subscription and a `renderSlot` fallback for `conversation.input.model.label`; verify with a stub slot entry that the adapter renders the native trigger and submits a change once.
- [x] 4.2 Pass `slots` and `locale` from `src/client.tsx` to `BoardView` as an optional seat environment and omit the model stage when it is absent; verify `pnpm typecheck` and that existing boards render without the environment.
- [x] 4.3 Verify the deployment default is displayed without any `selectModel` submission, and that a user change submits exactly one selection for the created conversation.

## 5. Move and run integration

- [x] 5.1 Board drops and drawer stage changes present the preparation before applying the move for a task without a conversation; verify client tests show the task stays in its source stage during the dialog, moves and arms the countdown after confirmation, and does not move on cancel.
- [x] 5.2 Intercept the card run action with the same preparation through an optional `requestRun` callback on `CardInstructionAction`; verify the play runs immediately after preparation and keeps today's behavior when the task already has a conversation.
- [x] 5.3 Verify a task with a preparing or error binding opens the explanation-only stage, does not move, does not run, and does not offer create or continue; verify a task with a conversation still executes in that state.
- [x] 5.4 Verify the restricted-transition confirmation is presented before the preparation and that canceling the preparation leaves the task in its source stage; extend `tests/browser/move-override.spec.ts`.

## 6. Verification and documentation

- [x] 6.1 Add browser coverage for the preparation dialog in the light and dark host themes, asserting the rendered host tokens, contrast and focus, with screenshots under `.verification/`; verify with `pnpm test:browser`.
- [ ] 6.2 Add a preparation scenario to `scripts/e2e-dsh.mjs` and a replay template, asserting the worktree step, the conversation creation and the countdown after preparation; assert the model stage only when the checkout composes `dsh-client-ui-model-selection`; verify with `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --only prepare`.
  - Blocked on the available checkout: DSH 0.2.2-alpha.2 removed `ctx.sessionController.inspect`, which this plugin pins at 0.2.1-rc.2, so a conversation creation commits and then fails its snapshot. Re-run this task on a checkout compatible with the pin; the base-project half of the scenario already passes there.
- [x] 6.3 Update `README.md` and the `AGENTS.md` smoke checklist where they state that the run action sends without a dialog or that a drop into an instructed stage moves immediately.
- [x] 6.4 Run `pnpm check` and `openspec validate prepare-first-execution --strict`, and confirm no other capability spec needs a delta.
