# Design

## Context

See `proposal.md` for motivation and `specs/` for the observable requirements.

The current transition rule is split across surfaces. `src/domain/transitions.ts` exposes `permittedDestinations` for the board and drawer and `canTransition` for the host. The board rejects restricted drops in `canDrop`/`moveTo` and dims those columns to 42% opacity. The drawer's native select is filtered to permitted destinations. The host rejects a restricted transition at admission in `KanbanApp.move`, then checks `canTransition` again when it drains the persisted `PendingTransition` in `KanbanApp.drainPending`. The pending transition is stored in the board state with a strict schema, so the confirmed override has to be carried there for retry, restart, and the existing `operation.retry` path to finish the move.

The move is already organization-only. `placeTask` updates the stage, position, and instructed-stage marker without executing an agent, and the drawer's instruction prefill runs only after `onMove` resolves successfully. Those boundaries stay intact.

Constraints:

- Permitted moves and same-stage reorder remain immediate; the archived `refine-move-card-execution` decision against a move dialog for permitted moves is preserved.
- The workflow's `allowed_transitions` semantics are unchanged: omitted means every existing target is permitted, and `[]` permits none.
- No task field, workflow mutation, or data-version migration is introduced.
- The drawer keeps a native select; a custom listbox is out of scope.

## Goals / Non-Goals

**Goals:**

- Make the transition rule a single shared classification instead of a board filter plus a host predicate.
- Route every move through one client move-request seam that can open a confirmation and still resolve the drawer's existing move promise.
- Persist only the minimum consent needed to finish a confirmed pending transition after retry or restart.
- Keep the confirmation dialog presentational: it knows names and callbacks, not commands, boards, or domain rules.
- Preserve the instruction-prefill and execution boundaries exactly.

**Non-Goals:**

- A custom stage picker, a redesign of the drawer toolbar, or a change to the native select.
- Persistent override history, audit records, or an "overridden" badge on the card.
- A move dialog for permitted transitions, bulk moves, or drag for keyboard users.
- Broad decomposition of `board.tsx`, `destructive-dialogs.tsx`, or the drawer prefill state machine.
- Changes to workflow editing, worktree management, deletion, notes, or agent execution.

## Decisions

### 1. One transition-access classification

`src/domain/transitions.ts` becomes the policy module:

```ts
type TransitionAccess = 'reorder' | 'allowed' | 'restricted';

transitionAccess(workflow, from, to): TransitionAccess | null
transitionDestinations(workflow, from): Array<{ column: Column; access: TransitionAccess | null }>
canTransition(workflow, from, to): boolean // transitionAccess(...) === 'allowed'
```

`reorder` is the current stage, `allowed` is a cross-stage target permitted by `allowed_transitions`, and `restricted` is a cross-stage target that is not. `null` means the source or target is not in the workflow; the existing invalid-target path handles it. `transitionDestinations` keeps `workflow.columns` order, which is also the drawer's required order.

`permittedDestinations` is removed after the board and drawer switch. The host imports `canTransition` from `transitions.ts` directly; if no consumer remains, the re-export in `workflow.ts` is removed so the policy module does not pull YAML parsing into client consumers.

**Alternatives considered:** add an `isRestricted` predicate while keeping `permittedDestinations` (rejected: two helpers express the same rule and can drift); duplicate the rule in the client (rejected: the current duplication is exactly the problem); classify in the host only and let the client guess (rejected: the UI must know whether to open the confirmation before sending a command).

### 2. Persist the confirmed override on the pending transition

`task.move` gains `overrideTransition?: boolean`. `PendingTransition` gains `transitionOverride?: boolean` in `src/shared/types.ts`, the strict board-state schema, and the wire schema.

Admission in `KanbanApp.move`:

- Same-stage move: unchanged; the flag is irrelevant.
- Cross-stage `allowed`: unchanged; no flag is stored.
- Cross-stage `restricted`: accepted only when `overrideTransition === true`; the flag is stored on the pending transition.
- The workflow YAML and task record are never changed.

Drain in `KanbanApp.drainPending`:

- Normal pending transition: keep the current `canTransition` recheck.
- Override pending transition: skip the workflow recheck. The existing from/target invariant already binds the source, and a move from a third column is rejected before placement; this prevents a confirmation for A -> C from being applied from a different source after an external move or restart.
- The existing `placeTask` marker and mode behavior are unchanged.

The field is optional. Existing pending transitions without it keep their current behavior, and no data-version bump is required. The host rejects the flag for the legacy `run` mode, so its semantics stay unchanged; the UI only sends it for `move`.

**Alternatives considered:** keep consent only in client memory (rejected: `drainPending`, retry, and restart would reject the confirmed move); create a separate `task.overrideMove` command (rejected: duplicates validation, placement, and pending handling); store the override on the task (rejected: it is consent for one transition, not durable task state); bypass the pending transition for restricted moves (rejected: loses the existing placement and recovery semantics).

### 3. One client move-request hook with injected dependencies

Add `useMoveRequest` in `src/client/useMoveRequest.ts`. It is the only place that decides between an immediate move and a confirmation. Its dependencies are injected:

- `run(command)`: the board's existing command runner, which also applies the returned snapshot.
- `state`: the latest board state, kept in a ref for decisions made from callbacks.
- `onImmediateError(error)`: the board's existing `actionError` surface.

It returns:

- `optimistic`: the current optimistic placement for `tasksForColumn`.
- `move(task, column, beforeTaskId?)`: classifies against the latest state. `reorder`/`allowed` apply immediately; `restricted` opens the confirmation and returns a promise that resolves after confirm or cancel.
- `confirmation`: the dialog view model (task id/title, source and destination ids/names, workflow name).
- `pending`, `error`, `canRetry`: the confirmation's submission state.
- `confirm()`, `cancel()`.

The deferred promise is deliberate: the drawer's `moveTo` already awaits `onMove` and only then runs the instruction-prefill flow. Resolving `true` after a confirmed move preserves that behavior without teaching the drawer about confirmation. Resolving `false` on cancel leaves the drawer's `movingTo` state to clear normally.

The hook owns the lifecycle:

- Immediate failures call `onImmediateError`; confirmation failures stay in the dialog.
- `apply` sets the optimistic placement, awaits `run`, and clears the optimistic state in `finally`.
- Double submit is guarded; a concurrent restricted request is refused, and an unmount resolves the outstanding promise as not confirmed.
- A single-settle guard prevents a cancel after success from resolving the drawer promise twice.
- Confirmation revalidates the latest task, destination, source stage, drop anchor, and busy state before sending. Stale context is reported with `canRetry = false`; a transient host rejection is retryable.

Hook state:

```text
idle --restricted move--> confirming --confirm--> submitting --ok--------> idle
                              |                        |
                              +--cancel--> idle        +--transient error--> failed (retryable)
                                                       +--stale context-----> failed (close only)
```

**Alternatives considered:** keep the confirmation state in `board.tsx` (rejected by the chosen refactor scope: it mixes a deferred async lifecycle with unrelated board state); let the drawer own the confirmation for its select and the board own drag (rejected: duplicated dialog and revalidation); make the drawer consume a callback instead of a promise (rejected: it would duplicate the prefill trigger and race the drawer's `movingTo` state).

### 4. Board drag accepts every column and warns on restricted hover

`canDrop` keeps its current guards (state loaded, not selection mode, task and column exist, task has no operation or pending transition) but no longer rejects a restricted transition. `useCardDrag` needs no change.

For the hovered destination, the board computes `transitionAccess(workflow, drag.sourceColumnId, drag.overColumnId)`. When it is `restricted`:

- The column gets a `kb-drop-restricted` class with a dashed warning outline.
- The existing drop indicator gets `kb-drop-indicator-restricted`, a dashed warning-colored line rather than the normal accent line.

All other columns keep their normal appearance. `.kb-drop-disabled` and its 42% opacity are removed. The warning is a pre-drop signal only; the confirmation remains the gate.

**Alternatives considered:** identical columns with only the post-drop dialog (rejected by the chosen UX: the modal should not be a surprise); keep restricted columns dimmed but droppable (rejected: they look disabled and hide the override affordance).

### 5. Native select with muted restricted options

`TaskDrawer` replaces `permittedDestinations` with `transitionDestinations` and renders every column in `workflow.columns` order, including the current one. Restricted options get `className="kb-stage-option-restricted"` and remain enabled. Selecting the current stage remains a no-op.

Visual treatment:

- `.kb-stage-option-restricted` uses the host's `--dsw-alias-label-secondary` token (with `CanvasText` as a fallback), a theme-aware muted color that keeps normal text contrast in both host appearances.
- The visible option label stays the stage name.
- The select carries a visually hidden hint via `aria-describedby` explaining that restricted stages require confirmation; restricted options also expose "requires confirmation" in their accessible name. This keeps the restriction available to assistive technology without adding the visible text cue that was rejected.
- No `disabled` attribute is used, because restricted options must remain selectable.

The select stays controlled by `movingTo ?? task.columnId`. While the confirmation is open, `movingTo` disables the select and shows the pending target; cancel restores the current stage. The existing `blocked` guard and the drawer's instruction prefill are unchanged.

The platform limitation is accepted: macOS may render the native option popup with its own styling. The implementation still applies the muted class and accessibility hint; the confirmation is the functional guard, and the design records the limitation rather than adding a custom control.

**Alternatives considered:** custom listbox (rejected by the user's choice); native select with a visible "requires confirmation" suffix (rejected: more visual noise); native select with restricted options disabled (rejected: defeats the feature).

### 6. Presentational confirmation dialog

Add `TransitionOverrideDialog` in `src/client/transition-override-dialog.tsx`. It is not part of `destructive-dialogs.tsx` because the action is reversible and non-destructive.

It uses the existing `Modal` with `initialFocus="cancel"` and `busy={pending}`. Props are presentation-only: task title, workflow name, source and destination names, pending, problem, `canRetry`, `onCancel`, `onConfirm`. The board renders it from the hook's confirmation model, so the dialog has no command or board knowledge.

Copy:

- Title: "Move to {destination}?"
- Body: "The {workflow} workflow does not allow moving this card from {source} to {destination}."
- Body: "Moving anyway affects only this card. The workflow configuration is unchanged."
- Problem notice on failure with a title such as "The move needs attention."
- Actions: Cancel (initial focus) and a neutral primary. The primary reads "Move anyway", "Moving…" while pending, and "Try again" after a retryable failure. After a non-retryable stale-context failure, the primary becomes Close (which cancels) so the dialog does not offer a retry that cannot succeed.

The neutral primary follows the chosen treatment: the override is a policy exception, not a destructive action. The dialog stays open on failure, in line with the delete/discard dialogs.

**Alternatives considered:** reuse `DeleteTaskDialog` or a generic confirmation primitive (rejected: the content and retry semantics are specific); a toast with undo (rejected: does not capture consent before the move); danger styling (rejected: implies irreversible data loss).

### 7. Preserve the instruction and execution boundary

No changes are made to `placeTask`, `instructionPending`, `RunInstructionButton`, or the drawer's `InstructionDraftPort` flow. A confirmed restricted move into an instructed stage creates the same marker as a permitted move, and the drawer's prefill runs after the confirmed move exactly as it does today. The move command never calls `task.runInstruction`, never sends a prompt, and never starts a turn.

If the command is accepted and the pending transition later fails, the existing `PendingTransitionStatus` and operation retry surface remains the recovery path. The new dialog only owns synchronous admission failures.

## Test Strategy

Verification is layered: the cheapest in-memory modules prove the policy and the async state machine, the real browser proves appearance and pointer behavior, and one focused real-composition scenario proves the actual remote/host/client wiring. The expensive layer does not repeat retry races or native composer behavior that cheaper seams already cover.

**Cheap module tests (`pnpm test`):**

- `tests/domain/transitions.test.ts` — access classification, omitted versus `[]` restrictions, grouped workflow order, parser parity, and `canTransition` equivalence.
- `tests/host/move-override.test.ts` — real `KanbanApp` + `BoardStore` + in-memory sessions and Git; restricted rejection/acceptance, pending flag capture, allowed and same-stage no-flag behavior, retry, restart, normal pending recheck, source changed, placement, instructed no-send, busy, and no workflow mutation.
- `tests/client/move-request.test.tsx` — `useMoveRequest` with a fake runner and mutable state: immediate/reorder, confirmation open/cancel/confirm, host failure and retry, stale source/destination, busy, now-allowed, unmount, double confirm, optimistic cleanup, and no agent command.
- `tests/client/transition-override-dialog.test.tsx` — copy, Cancel focus, pending/problem states, retry label, and close-only stale state.
- `tests/client/board.test.tsx`, `tests/client/drawer-prefill.test.tsx`, `tests/client/styles.test.ts` — real `BoardView`/`TaskDrawer` with `fakeApi`: full stage list and order, muted enabled option, accessible hint, select/dialog/cancel/confirm, drag warning and drop, failure/retry/stale, prefill on confirm and no prefill on cancel, and style selectors.

**Plugin-owned browser lane (`pnpm test:browser`):**

- `tests/browser/move-override.spec.ts` with a dedicated `scenario=move` and the theme fixture.
- Assert option order, muted computed styling, and contrast in light and dark; dialog focus, copy, and neutral primary; real pointer drag warning and cancel/confirm.
- Store screenshots under `.verification/`.
- Add the primary-button tokens to `tests/browser/theme-fixture.ts` before asserting primary contrast.
- The open native select popup is OS-rendered; the browser asserts the option element's style and accessibility, not the popup pixels. A one-off manual popup check remains.

**Focused real-composition e2e (release-only):**

- `tests/e2e-dsh/kanban-move-override.e2e.template.ts` and the runner's `--only override` entry.
- Isolated scaffold, restricted workflow, task, cancel path, and confirm path; no model call.
- The native composer prefill is deliberately not asserted here: the confirmation-to-prefill trigger is covered by the fake draft port, and the native draft path itself is unchanged from the archived change.
- This lane is not part of `pnpm check`; it runs against the pinned DSH checkout before release.

**Deliberately not duplicated:**

- Retry/restart races in the real-composition lane; the host tests reconstruct the app and inspect the persisted pending flag.
- Error/retry UI in the browser; the hook and dialog module tests own the state machine.
- Native popup pixels and native composer prefill in the e2e.
- Real model calls or a personal DSH profile.

**Verification commands:**

- `pnpm exec vitest run tests/domain/transitions.test.ts tests/host/move-override.test.ts tests/client/move-request.test.tsx tests/client/transition-override-dialog.test.tsx tests/client/board.test.tsx tests/client/drawer-prefill.test.tsx`
- `pnpm run typecheck`, `pnpm test`, `pnpm run build`
- `pnpm test:browser`
- `node scripts/e2e-dsh.mjs --checkout <pinned-dsh-checkout> --check`
- `node scripts/e2e-dsh.mjs --checkout <pinned-dsh-checkout> --only override`
- `openspec validate allow-card-move-override --strict`

## Risks / Trade-offs

- **macOS native option popup may ignore the muted color** -> The restriction remains functional through the confirmation, and the accessibility hint is independent of color. The limitation is documented; no custom control is introduced.
- **Color remains the only visual distinction in the select** -> Restricted options also carry an accessible name and the visually hidden hint, so assistive technology is not dependent on color. Sighted color-blind users still get the confirmation before any move.
- **A persisted pending field is read by older plugin versions** -> The field is optional and pending transitions are transient. Old data remains readable; a downgrade while a restricted pending move exists is not supported, consistent with the plugin's versioned data contract.
- **Deferred promise lifecycle can leak or double-resolve** -> The hook is the only owner, uses a single-settle guard, resolves on unmount/replacement, and clears optimistic state in `finally`.
- **The confirmation's context can go stale while it is open** -> Confirm always revalidates the latest task, source stage, destination, and busy state. Stale context is reported and does not offer a retry; transient failures do.
- **The host's workflow can change between admission and drain** -> Normal transitions keep the existing recheck. Override transitions remain bound to the confirmed source and destination; the persisted flag is the user's consent for that specific pending move.
- **Accepted commands do not guarantee the pending placement completed** -> Existing `PendingTransitionStatus` and retry/return semantics remain the recovery path; this change does not alter them.
- **The selected native option styling cannot be browser-tested through the OS popup** -> Verification asserts the rendered option's class, computed color, and accessibility, while a one-off manual popup check covers the OS-rendered surface. The limitation is documented rather than hidden.
- **The focused real-composition lane is release-only and does not assert native composer prefill** -> The fake draft port covers the confirmation-to-prefill trigger, and the native draft path is unchanged from the archived change. The release lane stays deterministic and small.
- **Existing tests assert prohibited transitions/options are rejected/omitted** -> Those expectations are intentionally replaced; the tasks cover the replacements without treating them as regressions.

## Migration Plan

- No data migration and no data-version bump. `transitionOverride` is optional; existing board states and pending transitions parse unchanged.
- Deploy the host and client as the normal plugin pair. Existing permitted moves, reorder, instruction prefill, and legacy pending transitions keep their behavior.
- Roll back by restoring the previous plugin build. Pending restricted moves created by the new build should be completed or canceled before a downgrade, because the old strict pending schema does not know the new field.
- Update the `kanban-board` and `task-conversations` specs, `README.md`, and `docs/operations.md` with the new confirmation, full-workflow select, and drag warning. No configuration setting is added.
