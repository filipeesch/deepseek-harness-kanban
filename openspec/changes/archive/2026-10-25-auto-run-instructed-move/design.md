# Design

## Context

See `proposal.md` — Why. The observable contract is in `specs/kanban-board/spec.md` and `specs/task-conversations/spec.md`.

The current entry lifecycle already has the durable signal this design needs. A move into an instructed stage creates `Task.instructionPending { columnId, enteredAt }` in `placeTask` (`src/host/app.ts`), the card renders its play action only while that marker matches, and any successful user prompt or `task.runInstruction` clears it. The command already validates the stage, busy state, and exact instruction text before resolving the target to the first open conversation (`src/host/app.ts`). The drawer currently runs a separate prefill pipeline over `InstructionDraftPort`, which is the behavior being retired.

Two seams shape the implementation. Board drops and drawer stage changes both funnel through `applyMove` in `src/client/board.tsx`, and every command response goes through the board's `accept`/snapshot path. The timer is not persisted, the data schema does not change, and the command wire schema is versioned together with the client.

## Goals / Non-Goals

**Goals:**

- One cancelable five-second window for instructed moves, presented on the card and in the drawer, with a single execution path for timed and manual runs.
- Keep timer ownership out of `BoardView` and the drawer; both remain composition and presentation points.
- Make a stale or duplicated timed send impossible after the entry is resolved, without adding persisted state.
- Retire the drawer draft port and the unused run-creation surface of `task.move` while keeping persisted legacy transitions readable and retryable.
- Share one stage-entry rule between the host marker, store creation, card action, and the countdown.

**Non-Goals:**

- A configurable delay, per-stage delay, or board setting.
- A persisted deadline, cross-tab countdown, or countdown that survives reload.
- A board-level notice stack or a global error surface for timed sends.
- Auto-run on task creation, same-stage reorder, or any move not entering an instructed stage.
- General decomposition of `BoardView`, the destructive dialogs, or the bulk-deletion flow.
- Changing worktrees, attention, task context injection, or native conversation ownership.
- Refreshing stale scenario-evidence references unrelated to this behavior.

## Decisions

### 1. A client-local auto-run controller with injected time and command runner

A new `src/client/auto-run.ts` exposes a small controller (a store plus timer) that owns one record per task:

```text
AutoRunEntry {
  taskId, columnId, enteredAt, instruction,
  deadline, status: 'counting' | 'sending' | 'failed', error?
}
```

The controller receives, by injection, a clock/scheduler (`now`, `setTimeout`, `clearTimeout`), a command runner with the board's `run` signature, and nothing else. It exposes `arm(entry)`, `cancel(taskId)`, `runNow(entry)`, `reconcile(tasks)`, `subscribe`, and `getSnapshot`, with immutable snapshot updates so `useSyncExternalStore` is safe. `arm` replaces any record for the same task, clears its timer, and schedules one expiry. `cancel` clears the timer and the record only. `dispose` clears every timer when the client generation unloads. The plugin composition creates the controller once per injected client generation, above `Main`/`BoardView`; hiding the Kanban panel or unmounting the page does not dispose it, and a lifetime snapshot subscription reconciles while hidden. `BoardView` uses a fallback standalone controller for tests and the browser harness.

The injected clock is also the test seam: the controller can be exercised with a fake scheduler without React, fake timers, or a real host.

**Alternatives considered:** a host-owned timer with a persisted deadline (rejected: the selected reload behavior is "send nothing", and it would add durable state, commands, and cross-tab ambiguity for no user-visible gain); `useState`/`useEffect` timer logic inside `BoardView` (rejected: it deepens the god component and cannot be unit-tested without rendering the board); the native schedule or reminder services (rejected: they fire outside the board's move context and cannot enforce the entry-identity guard).

### 2. One execution path for the play action and the timed send

The controller also owns manual execution. `runNow` cancels any countdown, marks the record `sending`, calls the same `task.runInstruction` command, and either removes the record on success or leaves a `failed` record with the problem. The card action and the drawer notice both render from the controller record, so pending state and admission errors have one owner. The existing per-button `useAction` in the retired `run-instruction.tsx` module is replaced for this action.

The card exposes the run action only when no record exists and the entry is unresolved; a `sending` record disables the action; a `failed` record shows the play action plus the error. The drawer notice renders `counting`, `sending`, and `failed` for the selected task. A manual run that fails therefore appears in the same two places as a timed failure.

**Alternatives considered:** keep `useAction` for manual runs and the controller only for timed runs (rejected: two pending/error sources for one entry, with inconsistent failure surfaces); execute the timed send from an effect in the card component (rejected: cards unmount when filtered, so the timer and its cancellation would be tied to presentation).

### 3. Card and drawer presentation, no board-level notice

- **Card.** The play slot becomes a compact cancel control while `counting`: a stable accessible name (`Cancel automatic <stage> instruction`) with the remaining whole seconds visible. Activating it cancels. The control does not expose "run now"; the run action returns after cancel or failure. Reduced-motion preferences keep the seconds text and skip any animated progress ring. The error line stays in the card's existing error area.
- **Drawer.** A `DrawerAutoRunNotice` replaces the removed `.kb-prefill` region above the section panel. It shows the stage, the remaining seconds, the resolved target label when one exists, and Cancel while counting; `Sending…` while sending; the failure text when failed. It is visible in every drawer section, and the drawer does not change section on a stage change. The notice is a polite status at arm and an alert at failure.
- **Ticking.** Only the mounted card and drawer notice subscribe to a `useCountdown(deadline)` hook that re-renders on a short interval (about 250 ms) to derive whole seconds. The controller itself does not tick, so an idle board does not re-render every 250 ms. The authoritative expiry remains the controller's single timer.

**Alternatives considered:** a global toast stack (rejected by the selected placement); a passive progress ring with cancel only in the drawer (rejected: a board move with the drawer closed would have no cancel surface); replacing the card play button with "run now" and a second cancel control (rejected: two controls in a 26 px card slot and a redundant run path while the timer is already armed).

### 4. Arm from the shared move path and reconcile against the marker

`applyMove` in `BoardView` receives the command response after the host has placed the task and created the marker. On success it finds the moved task in the response and, when `stageEntry` reports an unresolved entry for the destination and an instruction exists, calls `controller.arm` with the marker's `columnId`, `enteredAt`, and the raw instruction. This single call covers board drops and drawer moves because the drawer's stage control calls the same `applyMove`. No countdown is armed for a rejected, uninstructed, same-stage, or creation path.

A subscription effect calls `controller.reconcile(tasks)` on every accepted snapshot. Reconciliation removes a record when the task no longer exists or when the marker is gone or has a different column or timestamp. That is the automatic cancellation for manual prompts, new entries, and deletions. A changed column instruction is deliberately not a cancellation: the timer still fires, admission rejects `INSTRUCTION_CHANGED`, and the failure follows the normal failure path with the play action restored. A new instructed move arms the replacement record before or after the reconcile; both paths converge on the new marker.

A timed expiry that is admitted clears the marker in the host response, and the success path removes the record. A resolved-entry rejection is treated as a silent cancellation (decision 5); other failures keep the record as `failed` so the card and drawer can present them.

**Alternatives considered:** arm from each surface separately (rejected: two integration points and a likely drift in the instructed-entry rule); arm optimistically at drop (rejected: a rejected move could start a timer for a stage the task never entered); derive a countdown from the persisted marker on every snapshot (rejected: it would restart a window on reload and on every unrelated snapshot, contradicting the client-local and reload rules).

### 5. Entry-identity guard in the host command

`task.runInstruction` gains a required `expectedEnteredAt` alongside `columnId` and `expectedInstruction`. Before resolving a target, the host requires `task.instructionPending` to match both the column and the timestamp; otherwise it throws `INSTRUCTION_ALREADY_RESOLVED`. The client sends the identity it armed for, so a timer or a stale card cannot send a second instruction after a manual prompt or after leaving and re-entering the stage. The controller treats that specific rejection as a silent end: the manual action won, so no failure is shown. `INSTRUCTION_CHANGED` and every other admission failure remain visible errors.

Entry timestamps come from the shared `nextEnteredAt` helper, which is strictly increasing even when two entries land in the same clock tick, so distinct entries never share an identity. The guard is additive to the existing stage, busy, and exact-instruction checks; it does not persist anything new.

**Alternatives considered:** rely on the client reconcile only (rejected: a manual send and the timer can race between snapshots); replace the marker with a one-shot token (rejected: a longer-lived and less legible identity than the existing `enteredAt`); make the field optional for compatibility (rejected: the only caller is the plugin client, shipped with the host, and a required field keeps the invariant explicit).

### 6. Shared stage-entry policy

A small pure module, `src/domain/stage-entry.ts`, owns two rules:

- `entryInstruction(column)` — the raw `onEnterPrompt` when it has non-whitespace content, otherwise `undefined`.
- `hasUnresolvedEntry(task, columnId)` — `task.instructionPending` exists and matches the task's current or given stage.

`placeTask`, `store.createTask`, the card action, `runInstruction`'s instruction lookup, and `BoardView`'s arming decision use it. The host keeps its existing exact-text comparison for admission; this module only centralizes eligibility and lookup. Schema validation stays separate.

**Alternatives considered:** keep the repeated `?.trim()` and marker comparisons (rejected: this change adds a third and fourth caller, and the selected cleanup is to stop the drift); put the helper in `shared/types` (rejected: types must stay declarative and importable without behavior).

### 7. Retire the drawer prefill pipeline

`src/client/instruction-draft.ts`, the `draftPort` prop and its `client.tsx` binding/attach effect, the drawer `prefill` state, its 8-second readiness timer, the Replace draft action, `.kb-prefill*` styles, and the prefill/draft-port tests are removed. Stage changes no longer focus or write into a composer, so existing drafts and attachments are untouched.

`applyMove` remaining in the board is the only move integration; the drawer's `moveTo` becomes a thin call to `onMove` plus the existing busy guard.

**Alternatives considered:** keep the port and prefill as a fallback when the countdown is canceled (rejected: it reintroduces the manual review path the feature replaces and keeps the native draft coupling); keep the port only for inspecting unsent drafts (rejected by the selected "send anyway" rule, so it would be dead code).

### 8. Move-only `task.move`, with legacy records retained

The command type and wire schema for `task.move` become `{ taskId, columnId, beforeTaskId? }`. `KanbanApp.move` creates a plain move pending transition only; the run-mode approval, conversation selection, worktree request, and expected-instruction branches are removed from that path. `requireReviewedInstruction` remains for `task.runInstruction`.

`PendingTransition` keeps its optional `mode`, `sessionId`, `text`, and `worktreeRequest` fields in the strict schema, and `drainPending`, `initialize`, and the drawer's legacy status/retry actions keep handling already-persisted records. New records set `mode: 'move'`. No data-version migration is needed, and old boards remain readable.

**Alternatives considered:** full removal with a data-version migration (rejected: the strict schema would reject existing data unless legacy records are rewritten, a destructive and larger change for a UI that cannot create them); deferring the cleanup (rejected by the selected scope).

### 9. Fixed five seconds, transient state, no new configuration

`AUTO_RUN_DELAY_MS = 5_000` is a client constant. There is no board setting, workflow field, or data field. The countdown is not persisted and is not shared across tabs; a reload or plugin restart leaves the marker unresolved, so the card shows the play action again. Timer throttling in a hidden tab can make the send later than five seconds; the window is best effort, not a durable deadline.

**Alternatives considered:** a board setting or per-stage YAML value (rejected by the selected fixed delay); persisting `autoRunAt` on the marker (rejected by the selected reload behavior and to avoid a data change).

### 10. Cancellation and failure semantics

- Cancel removes the record and timer only. No command is sent; the marker and the card play action remain.
- A manual prompt, new entry, deletion, or marker removal drops the pending countdown. A manual run also drops it, but sends its own request; there is never a second timer.
- A changed instruction is not a cancel: the timer fires, admission rejects it, and the normal failure path applies.
- A failed timed send stops the timer, keeps the marker, records the problem, and exposes the play action for an explicit retry. No automatic retry.
- `INSTRUCTION_ALREADY_RESOLVED` ends silently; other problems surface on the card and in the drawer notice.
- A successful manual or timed run removes the record; the marker clears through the normal host path.

## Risks / Trade-offs

- **[Timer race with a manual prompt or another tab]** → The host entry-identity guard rejects the loser, and the client treats an already-resolved rejection as a silent cancel. No duplicate instruction is sent.
- **[Hidden card makes Cancel unreachable]** → Accepted by the selected "keep running" rule. The window is five seconds, the move was just performed, and the card control reappears with the remaining time if the card returns; the drawer notice covers the selected task.
- **[Throttled timers send late]** → The countdown is a local best-effort timer, not a durable deadline. No spec promise about wall-clock precision beyond the five-second window.
- **[Removing prefill removes the review/edit step]** → A cancel leaves the entry unresolved and the play action available; the user can also send from the composer. The stage instruction remains editable through the workflow configuration.
- **[Two clients on the same board]** → Only the tab that performed the move arms a countdown; another tab sees the play action. The guard makes the outcome deterministic if both act.
- **[Drawer notice crowds every section]** → It is a single compact line above the panel, replaces the old prefill region, and only exists while an entry is counting, sending, or failed.
- **[The legacy run/worktree branch remains as dead-looking code]** → It is the compatibility path for persisted records. Mark it as legacy in code, keep its existing retry tests, and stop creating new records; removing it later needs an explicit migration.
- **[`BoardView` still mixes many concerns]** → This change adds only arming and a subscription effect; the timer, policy, presentation, and execution live in their own modules. A general decomposition remains a separate change.
- **[A failed timed run leaves the task blocked while the user is away]** → The card and drawer expose the failure and the play action; the conversation remains available. This matches the existing explicit-run failure behavior.
- **[Playwright clock freezes unrelated DSH timers]** → Install it after boot and after the board renders, scope it to the countdown window, resume after each flow, and reinstall only after a reload has settled; never install it before login. The e2e template does not pin the host clock, so the scaffold's clock warning does not apply.
- **[The shared test contract drifts from host admission]** → Host tests remain authoritative; the shared in-memory board rejects the same stage and timestamp identity, and both the jsdom and browser fakes wrap it rather than reimplementing the rule.

## Test Strategy

Every scenario in the deltas is assigned to the cheapest lane that can observe it; the real-composition lane carries only what native composition alone can prove.

| Behavior family | Cheapest lane |
|---|---|
| Instruction lookup, verbatim text, unresolved-entry policy | `tests/domain/stage-entry.test.ts` |
| Countdown lifecycle, cancel, replacement, reconciliation | `tests/client/auto-run.test.ts` |
| Entry guard, target resolution, move-only command, wire | `tests/host/app.test.ts`, `tests/domain/schema.test.ts` |
| Retained legacy pending execution and retry | `tests/host/legacy-pending.test.ts` |
| Card and drawer states, cancel, reload, reorder, creation, hidden card | `tests/client/auto-run-ui.test.tsx` |
| Play action with a pre-existing marker | `tests/client/instruction.test.tsx` |
| Rendered countdown, cancel, contrast, reduced motion | `tests/browser/auto-run.spec.ts` |
| Real send, cancel, reload, unsent draft, task-context row | `tests/e2e-dsh/kanban-auto-run.e2e.template.ts` |

**Cheap in-memory lanes.**

- *Domain policy* covers raw instruction bytes, empty or whitespace-only instructions, matching/stale/missing markers, and strictly increasing entry identities.
- *Controller module* uses the injected fake scheduler and command runner: arm, expiry, cancel, replacement, independent tasks, and disposal; reconciliation for a deleted task or a removed or replaced marker; stale in-flight outcomes ignored in favor of a newer entry; a failure kept without retry; `INSTRUCTION_ALREADY_RESOLVED` silent; single-flight `runNow`. No DOM, host, or real time.
- *Host module* uses `MemoryStorage`, `TestSessions`, and `TestGit`: the entry guard before target resolution (zero sends and no new conversation on rejection), first-open/create, no stage or position change, exact instruction-only text, changed-instruction rejection, marker retention on failure, observed user-prompt clearing, re-entry and re-run, move-only `task.move`, and the wire schema. A focused seeded-legacy suite covers `initialize` recovery, explicit retry, worktree waiting, and `DELIVERY_UNCERTAIN` from persisted records; the old command-shape tests are deleted.
- *Client board and drawer* use jsdom with a fake API and Vitest fake timers: arm via board drop and via drawer, card countdown and drawer banner, section retention, cancel from both surfaces, focus retention on the stable control, manual prompt, replacement, active and idle same-stage reorder, creation in an instructed initial stage, hidden card and hidden panel, unmount/remount, sending/failure states, a new-conversation target, changed and removed instructions, silent resolution, play-action restore, and stable accessible names/live roles. The prefill suites are deleted; the bridge test asserts that a stage change never writes to the composer.
- *Play action regression* keeps the existing marker-based action test and adds the entry identity to its expected command; no countdown is armed for a pre-existing marker.

**Shared test contract.**

`tests/support/in-memory-board.ts` owns the move, marker, and run behavior for both `tests/client/helpers.ts` and `tests/browser/fake-api.ts`: it sets `instructionPending` with a deterministic `enteredAt`, enforces the stage and timestamp identity on runs, sends only the current stage instruction, clears the marker, and mirrors the host's busy and context-operation rejections. The browser harness adds a run-failure flag; jsdom tests inject command rejections. The host tests remain the authority for admission, and the shared contract rejects the same codes so a jsdom or browser test cannot pass against a fake the host would refuse. Host tests read the marker identity directly and seed legacy records inline.

**Real rendering.**

`tests/browser/auto-run.spec.ts` uses Playwright's `page.clock` after the board has rendered, never before login or boot: install before the move, `runFor(5000)` to fire the countdown and its ticker, then `resume()` so native streaming and animations return to real time. Its reload flow persists the fake board in session storage, resumes before the reload, and asserts that no command is issued against the restored entry; no second clock installation is needed because the window is client-local. `tests/browser/auto-run.spec.ts` also probes the card countdown and drawer notice contrast in light and dark, checks reduced motion, and writes `.verification/` screenshots.

**Real composition.**

A new `tests/e2e-dsh/kanban-auto-run.e2e.template.ts` boots the real web composition with an override-only replay script and an absent base fixture, matching the DSH lane's proven pattern for live-prompt scenarios. One boot exercises four flows: send (the native transcript carries only the instruction, and the plugin's visible task-context row precedes it), cancel (no message), reload (no message and the play action returns), and unsent draft (the instruction is sent and the draft is preserved). The send, cancel, and draft flows share one `page.clock` installation made after the board settles and before the first move, advance it to each deadline, and resume it afterward; the reload flow resumes before the reload and does not reinstall. The template does not pin the host clock, so the scaffold's clock warning does not apply. The runner gains `--only auto-run`, the e2e README and `AGENTS.md` document the option, and the lane stays manual before release with `DSH_SNAPSHOT=replay`, no real model, and no owner profile.

**Migration and gaps.**

All `task.move` and `task.runInstruction` test payloads move to the new shapes; the obsolete legacy command tests and prefill suites are removed; the schema and store legacy fixtures stay and grow. Screen-reader speech, hidden-tab timer throttling, cross-tab behavior, and real model output remain outside automated verification; the native composer draft rule is covered by the e2e rather than a cheaper lane. Gates are `pnpm run typecheck`, `pnpm test`, `pnpm run build`, `pnpm test:browser`, the manual `--only auto-run` lane, and `openspec validate auto-run-instructed-move --strict`.

## Migration Plan

- No data migration. The schema version and persisted shape are unchanged; existing pending run/worktree transitions keep their schema and retry path.
- Existing unresolved entry markers show only the play action, because no countdown was armed for them and the countdown is not derived from persisted state.
- Deploy by rebuilding the plugin and refreshing the existing GUI. Rollback is a code revert: in-memory countdowns disappear, no board data is rewritten, and markers remain valid.
- The test suite migrates in the same change: command payloads are updated, the prefill and draft suites and the obsolete legacy command tests are deleted, the shared fake and seeded-legacy suite land, and the browser and e2e lanes are added. The real-composition lane remains manual before release.
- Update the README and operations guide in the same change. The stale scenario-evidence refresh is a separate cleanup.

## Open Questions

None.
