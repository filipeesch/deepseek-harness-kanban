# Proposal

## Why

Moving a card into an instructed stage currently stops at an unresolved entry: the user must click the card's play action, or wait for the drawer to prefill the composer and press Send. These are two manual paths for the same intent, and the instruction is easy to leave unrun. A short, cancelable window keeps the intent of the move while removing the extra step.

## What Changes

- **Instructed moves arm a five-second countdown.** A board drop or a drawer stage change into a stage with an entry instruction schedules that stage's exact instruction. When the window elapses, the instruction is sent automatically; Cancel stops only the automatic send, so the move stays and the entry remains unresolved.
- **Card and drawer surfaces.** During the window the card's play slot becomes a compact countdown that cancels when clicked, and the drawer shows a matching countdown banner above its panel in every section. There is no board-level notice. After cancel, failure, reload, or plugin restart the play action returns.
- **BREAKING — the drawer no longer prefills the composer.** The prefill and Replace draft flow are removed, along with the draft port. The drawer moves immediately and stays in the current section; it does not insert, submit, or switch to Conversations.
- **One target rule.** The timed send uses the same host command and target as the play action: the task's first open conversation, creating one when none is open. The submitted message contains only the stage instruction.
- **Cancellation is automatic when the entry is resolved.** A manual play, a manual message, a new entry, task deletion, or any change to the entry marker cancels a pending countdown. The same behavior applies when the rejection race is detected at admission: an already-resolved entry is treated as a silent cancel, not an error.
- **Fixed and client-local.** The delay is a product constant of five seconds and lives in the board UI. Reloading or closing the page drops the countdown. A card hidden by search, filter, selection mode, or another panel keeps running, and unsent composer text or attachments in the target conversation do not block the send.
- **Failure is explicit and not retried.** A failed timed send stops the countdown, reports inline on the card and in the drawer banner, and restores the play action. Only an explicit retry runs again.
- **BREAKING — the run command is bound to the entry.** `task.runInstruction` carries the entry identity (stage plus entry timestamp) and rejects an entry that was already resolved or replaced, so a stale countdown cannot send a second instruction.
- **Cleanup.** `task.move` becomes move-only; its unused run-mode, conversation, worktree, and expected-instruction creation surface is removed. Persisted legacy run/worktree transitions remain readable and retryable without a data migration. A shared stage-entry policy and a dedicated auto-run controller keep this rule out of `BoardView` and the drawer, and the retired draft port is deleted.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: moves into an instructed stage arm a cancelable timed instruction; the card action is guarded by the entry identity; the movement-only execution rule is narrowed to "movement alone never executes".
- `task-conversations`: drawer stage changes arm the timed instruction instead of prefilling the composer; the drawer no longer switches to Conversations.

## Impact

- **Client:** `board.tsx` (arming and standalone controller fallback), new `auto-run` controller and `auto-run-view` (card play/countdown/failure and drawer notice), `drawer.tsx` (prefill removal, banner), `client.tsx` (lifetime controller, draft binding removal), `ui.tsx`/`problem.ts`, `styles.ts`; delete `instruction-draft.ts` and `run-instruction.tsx`.
- **Host:** `app.ts` (entry guard, monotonic entry timestamps, move-only `move`), `remote.ts`, `shared/types.ts`; new `domain/stage-entry.ts`; `domain/store.ts` reuses the policy for marker creation; `domain/schema.ts` retains legacy record validation.
- **Docs and specs:** `kanban-board`, `task-conversations`, the README, and the operations guide. The stale scenario-evidence refresh is out of scope.
- **Tests:** a layered plan maps every behavior to its cheapest lane — domain policy, injected-clock controller, in-memory host, jsdom board/drawer, Playwright with `page.clock`, and a replay-backed real-composition template. Drawer prefill and the obsolete legacy command-shape coverage are replaced by a focused seeded-legacy suite. No data-version change.
- **Test infrastructure:** a shared in-memory board contract for both fakes, a browser auto-run spec, a dedicated e2e template with a replay fixture and `--only auto-run`, and the corresponding lane documentation.
- **Behavior:** no new persisted state or migration. The countdown is transient; existing unresolved markers from before this change show only the play action because no window was armed for them.
