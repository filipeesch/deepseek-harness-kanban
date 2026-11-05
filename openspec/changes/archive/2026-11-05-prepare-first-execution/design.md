# Design

## Context

See `proposal.md - Why`. This section records only the current state and the constraints that shape the approach.

**Current first-execution path.** A board drop or a drawer stage change reaches `useMoveRequest` from `src/client/board.tsx`, which validates the transition and either applies it or owns the restricted-transition confirmation. After a committed move, `BoardView.armAfterMove` reads the destination's entry instruction and arms `AutoRunController` for five seconds (`src/client/auto-run.ts`). Expiry sends `task.runInstruction`; the host's `admitStageInstruction` resolves the first open conversation or calls `createConversationNow({ allowUndecided: true })`, which today bypasses the worktree decision and creates the first conversation in the task's current effective directory. The card's run action (`CardInstructionAction` in `src/client/auto-run-view.tsx`) calls `AutoRunController.runNow` through the same host admission.

**Constraints discovered during exploration.**

- A DSH session header is immutable. The first conversation must therefore be created after a worktree is ready; creating it earlier freezes the header at the base project. This is the defect the archived `defer-first-task-conversation` change removed for the explicit start.
- `worktree.create` drives the operation synchronously and returns when the binding reaches `ready` while the task has no conversations, because `switchDirectories` has no sessions to migrate. With existing conversations the operation stays `waiting` for idle. The preparation only runs when the task has no conversation, so it can await readiness.
- DSH's composer model seat is the `conversation.input.model` slot, registered by the `dsh-client-ui-model-selection` package. Its `inject(sessionId)` requires `ctx.sessions.scope(sessionId)` and `ctx.sessions.binding(sessionId)`, so only an existing, retained ordinary session can render it. The package states that there is no draft-phase model choice.
- The seat resolves its displayed selection as `projected.next ?? catalog.default`. A conversation without a recorded selection therefore shows the deployment default without submitting anything; only a user change calls `session.selectModel`, which in turn makes the host save the deployment default in the background.
- The plugin already renders native slot components manually through `NativeSlotHost` (`src/client/native-slot-host.tsx`) for the mode seat and session header. That host provides `sessionId`, `t` from the entry's locale, and the entry's inject face.
- The repository pins DSH `0.2.1-rc.2` dev dependencies, while the desktop app currently composes `0.2.1-rc.5`. `dsh-client-ui-model-selection` is composed by the application, not by this plugin, and is absent from the plugin's dependency graph. The adapter must read the slot generically and degrade when it is absent.
- Conversations are retained through `ConversationLeaseRegistry` (`src/client/conversation-leases.ts`), which already refreshes a catalog miss, retries, and releases references.

## Goals / Non-Goals

**Goals:**

- Run the first-execution preparation before the move is applied or the run action is admitted, without duplicating the existing move, confirmation, countdown, or admission logic.
- Keep the native model seat as the only model UI and let DSH own its catalog, default projection, and selection semantics.
- Keep the host authoritative for the worktree rule, so a client bug cannot create a first conversation at an unresolved binding.
- Preserve the current path byte-for-byte when the preparation does not apply.

**Non-Goals:**

- No plugin-owned model picker, catalog cache, or task-level model preference.
- No host-driven pending execution transition (`PendingTransition.mode: 'run'` with `worktreeRequest`); that path adds a second execution pipeline and would replace the countdown.
- No change to the countdown duration, its persistence rules, the composer, auto mode, or the automatic advance.
- No implementation of the refactorings explicitly left out of scope: splitting `useMoveRequest`, unifying worktree creation from drafts, removing `worktreeRequest`, centralizing the blocked predicate.

## Decisions

### Decision 1: Preparation runs in the client, between confirmation and apply

The preparation is a client-owned step that runs inside the move pipeline before `task.move` and inside the run action before the admission. It uses only existing commands: `worktree.create`, `worktree.dismiss`, `conversation.create`, and the native `session.selectModel` submitted by the model seat.

*Alternatives:* a host-owned `mode: 'run'` pending transition (rejected: second execution path, loses the five-second countdown, larger host surface); creating the conversation at admission time and selecting the model afterwards (rejected: the model is chosen after the execution starts, and the seat needs the conversation earlier anyway).

Consequence: the move is not applied while the dialog is open, which matches the "move only after preparing" product decision.

### Decision 2: Extract the board's move pipeline and add one `beforeApply` seam

`BoardView` loses drag, move, optimistic placement, arming, and the move dialogs to a new `useBoardMoves` module. The module composes `useCardDrag`, `useMoveRequest`, the countdown arming, and the preparation, and returns the drag state, the `moveTo` callback, and the dialog nodes for `BoardView` to render. `useMoveRequest` gains one option, `beforeApply(intent: MoveIntent): Promise<boolean>`:

- for an allowed move, it is called immediately before `apply`, and a `false` result resolves the move as not moved;
- for a restricted move, it is called after the override confirmation is accepted and before `apply`.

`MoveIntent` carries the task, destination column, and drop anchor. The extracted module decides whether the preparation applies; when it does not, `beforeApply` resolves `true` immediately, so the current flow is unchanged.

*Alternatives:* embedding the preparation in `useMoveRequest` (rejected: that hook already mixes access checks, the confirmation state machine, optimistic placement, and error handling, and would become the god object the product asked to avoid); duplicating the move entry points (rejected: two paths to maintain).

### Decision 3: A preparation controller, a presentational dialog, and ports

The preparation is split into three pieces under `src/client/execution-preparation/`:

- `gate.ts` — a pure predicate that, given the task, its project, and the destination, returns `null` (no preparation) or a preparation descriptor `{ worktree: 'ask' | 'blocked' | 'none', model: boolean }`. It reuses the shared worktree predicates and the shared conversation helpers, and it is unit-tested without React.
- `controller.ts` — `ExecutionPreparationController`, a state machine with `subscribe`/`getSnapshot` in the same style as `ModeSeatController` and `AutoRunController`. It owns the stages (`worktree` → `blocked` → `provisioning` → `model` → `done`/`cancelled`), the command sequencing, the lease, and the error state. It receives ports, so tests drive every branch with fakes.
- `dialog.tsx` — a `Modal`-based presentational component that renders the controller's snapshot and forwards the two worktree answers, cancel, retry, and the model-seat slot.

Ports (injected, no direct API or native access inside the controller):

```text
worktreeDefaults(taskId)          -> { branchName, path }        // api.worktreeDefault
createWorktree(taskId, draft)     -> void                        // api.command('worktree.create')
dismissWorktree(taskId)           -> void                        // api.command('worktree.dismiss')
createConversation(taskId)        -> { sessionId }               // api.command('conversation.create') + receipt
modelSeat                         -> ModelSeatPort | null        // slots, locale, sessions, lease-ready
```

*Alternatives:* a single large hook (rejected: hard to unit-test every failure branch and to keep the view dumb); a reducer inside the dialog (rejected: command sequencing and cancellation would leak into the view).

### Decision 4: The gate belongs to the shared module and the host enforces the binding rule

`src/shared/worktree-decision.ts` gains a second predicate beside `requiresWorktreeDecision`:

- `worktreeDecisionPending(task, project)` — the existing "Git-backed, no worktree, no recorded base choice, no conversation" condition, reused as-is where it already exists.
- `unresolvedWorktreeBinding(task)` — the task has a worktree binding whose status is not `ready`.

The client gate uses both; the host uses `unresolvedWorktreeBinding` in `createConversationNow`:

```text
invariant(
  !(options.allowUndecided === true && unresolvedWorktreeBinding(before)),
  'WORKTREE_BINDING_UNRESOLVED',
  'Resolve the worktree binding in the Git section before starting the first conversation.',
);
```

The existing `WORKTREE_DECISION_REQUIRED` gate stays for every explicit creation. The new rule only narrows the implicit `allowUndecided` exemption used by the stage-instruction and automatic-advance paths.

*Alternatives:* enforcing the block only in the client (rejected: a stale client or another surface could still create the conversation); broadening the block to every execution (rejected by the product decision: only the first execution is blocked).

### Decision 5: The worktree question uses host-derived defaults and records the base choice

The dialog asks a plain Yes/No. "Create" sends `worktree.create` with `api.worktreeDefault(taskId)`, the same host-derived branch, destination, and source that the missing-worktree notice and the Git section start from. "Continue in base" sends `worktree.dismiss`, which records and persists `worktreeDismissed`. When the derived destination is empty or invalid, "Create" is disabled with an explanation naming the destination requirement; the dialog does not navigate away. A create failure stays in the dialog with a retry; the move and the run action do not proceed.

*Alternatives:* embedding the editable Git fields in the dialog (rejected: duplicates the Git form); navigating to the Git section on a missing destination (rejected by product decision); creating with a path chosen outside the derived defaults (rejected: invents a destination rule).

Consequence: an unsaved draft edited in the Git section is not used by the dialog, which always creates from the host-derived defaults. That is accepted because the dialog is a plain Yes/No and the Git draft remains authoritative only for the notice and Git surfaces.

### Decision 6: The preparation creates the first conversation and retains it

When the task already has no worktree question, the dialog opens with the conversation already being created; when a worktree question applies, the conversation is created after `worktree.create` resolves or `worktree.dismiss` completes. The controller reads the conversation identity from the command receipt (`creationReceiptId(result, 'conversation')`) rather than from a snapshot difference.

The created session is retained through `ConversationLeaseRegistry` so `ctx.sessions.scope` and `binding` exist before the native model seat is mounted. The controller renders the model stage only when the lease reaches `ready`; it releases the lease when the dialog closes without applying the move. The conversation itself is kept on cancel, as the specs require.

*Alternatives:* relying on the drawer to retain the session (rejected: the board can be used with the drawer closed); rendering the seat before retention settles (rejected: `directoryFor` throws, and the slot host would silently fall back to nothing).

### Decision 7: The model seat is the native slot, rendered through the existing host adapter

The model stage mounts a small `NativeModelSeat` adapter:

- availability is read from `slots.entriesOfSlot('conversation.input.model')` and kept live through `slots.subscribe('conversation.input.model', …)`;
- the entry is rendered through `NativeSlotHost` with `kind: 'single'`, `standard: { sessionId, locked: false, renderSlot }`, where the `renderSlot` shim returns the native fallback (`options.fallback`, the catalog name) for the `conversation.input.model.label` child slot, exactly as the package documents for an absent contribution;
- `t` and the inject face (`available`, `directory`, `load`, `select`) come from the entry itself.

No plugin picker, catalog cache, provider ordering, search, or reasoning-effort UI is implemented. When the slot is absent, the preparation omits the model stage and the conversation uses the deployment default. A seat that cannot be retained is treated as unavailable: the execution is not blocked and the conversation keeps the deployment default. The controller never calls `selectModel` itself: with no recorded selection the seat already displays `catalog.default`, and only a user change submits a selection.

*Alternatives:* a plugin-owned flat model select fed by `modelCatalog` (rejected by the product decision to reuse the native selector); rendering the native composer's slot host (rejected: it requires a mounted conversation surface).

### Decision 8: The run action is intercepted by the same preparation

`CardInstructionAction` accepts an optional `requestRun(input)` callback. `BoardView` passes one that runs the gate and, when the preparation applies, opens the same controller; otherwise it calls `controller.runNow(input)` as today. The drawer has no run action, so no other surface changes. On completion, the run path calls `runNow` (immediate send, no countdown) and the move path resolves `beforeApply(true)`.

*Alternatives:* duplicating the run action in the board (rejected); routing the play through a fake move (rejected: the task's stage and position must not change).

### Decision 9: Ordering, cancellation, and persistence

The controller exposes one promise per preparation. It resolves `proceed` only after the model stage is confirmed and `cancel` for every other exit. Order: restricted-transition confirmation (outside the controller) → worktree question/block → provisioning → model → `proceed`. Nothing is persisted: a reload closes the dialog, keeps whatever was already created, and the next attempt re-runs the gate — which no longer applies once the task has a conversation. Errors are shown in the dialog with the action that can retry them; the controller never retries automatically.

### Decision 10: Verification lanes

- Unit tests cover the gate predicate and every controller branch with fake ports.
- Client tests mount `BoardView` with the fake API and, for the model stage, a stub seat source plus a fake lease environment: the preparation blocks the move, creates the worktree from the derived defaults, creates and retains the conversation, confirms the model stage, keeps the conversation when the model stage is cancelled, omits the model stage when no seat is registered, and applies the run action immediately after preparation. A dialog-level test covers the worktree, blocked, provisioning, error, and model phases, including the accessible description and the copy for a run-triggered preparation.
- Browser tests cover the dialog's appearance in light and dark, the two stages, focus, Escape, an actual board drop, and the restricted-confirmation ordering with the host theme fixture.
- The real-composition lane extends the existing `board`/`auto-run` scenarios with a preparation case that asserts the worktree step, the conversation creation, and the restricted-confirmation ordering. The model stage is asserted only when the checkout composes `dsh-client-ui-model-selection`, because an isolated profile may not.
- `AGENTS.md`'s smoke checklist is updated where it states that the play action sends without a dialog.

## Risks / Trade-offs

- **DSH version skew (`rc.2` dev types, `rc.5` app)** → the adapter never imports the model-selection package, reads only the documented slot name and standard props, and degrades to no model stage; the real-composition lane reports the checkout version and asserts the stage only when composed.
- **Slot registration race at startup** → availability is a live subscription, and the gate is evaluated when the user starts the move/run rather than at mount; a slot that appears later applies to later executions.
- **Modal versus the seat's menu** → the seat is mounted inside the dialog; Escape and focus must leave the menu before closing the dialog. `Modal` already ignores `defaultPrevented` Escape events. The adapter is verified with a client adapter test and a dialog-level test using a stub slot entry; the isolated browser harness does not compose the native selector, and the real-composition lane asserts the native trigger only when the checkout composes it.
- **The conversation is created before the move is applied** → if the move is rejected afterwards, the conversation (and any created worktree) remain. This is the accepted cancel semantics and is recorded in the specs.
- **The label extension slot is not rendered inside the dialog** → the adapter returns the catalog-name fallback; the selector's own trigger and menu remain native, but a plugin that decorates model names will not decorate the dialog. Accepted and documented.
- **Two enforcement points (client gate and host rule)** → both consume the same shared predicate, and a host test asserts the implicit creation is refused with `WORKTREE_BINDING_UNRESOLVED`.
- **The dialog ignores an unsaved Git-section draft** → accepted; the derived defaults stay identical across the notice, the Git form, and the dialog.
- **Conversation creation is a side effect of opening the model-only stage** → the product decision accepts the kept conversation on cancel; the next execution skips the preparation because the task now has a conversation.

## Migration Plan

Additive. No schema change, no persisted field, and no command shape change. Existing tasks keep their current behavior because the preparation is gated on "no conversation". The only behavioral change for existing flows is the host's narrowed implicit-creation rule, which only rejects a first conversation while a worktree binding is not ready. Rollback is a revert of the client preparation module and the host invariant; conversations and worktrees created by the preparation remain valid task state and need no cleanup.
