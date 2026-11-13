# Proposal

## Why

A saved deterministic result can be retained indefinitely with no way to tell why. Card `f904d71b` (board "3P Execution", stage `team_review_wait`) finished its script with `approved` at 10:51, but delivery was refused because the card's conversation still owned a background `find` promoted to a job at 10:20 in the previous agent turn. The card has shown only "Script result awaiting delivery" for over 50 minutes: the state carries no reason, the interface offers no action, and pressing Play discards the saved result and runs the script again, producing the same refusal.

The delivery gate itself is correct — a card must not move while its conversation is still working. What is missing is (a) the reason being durable and visible, (b) a way to act on the blocker from the drawer, (c) a delivery attempt when the blocker clears, and (d) Play honoring the already-saved result instead of re-running the program.

## What Changes

- Persist a bounded **hold reason** on the deterministic entry whenever a saved result is refused: a stable code, a bounded detail (blocking job/schedule labels and kinds, pending work kinds, operation and binding facts), and when it was observed. Project it to the client summary and show it on the card and drawer. A diagnostic is reported only when the reason changes, never per retry.
- Present the hold as a **highlighted notice at the top of the drawer**, above the section content and the script panel, naming the reason in plain language and listing what blocks delivery. When the blocker is a background job, the notice offers **Cancel job**.
- Add a **cancel-job command** the drawer uses: it accepts only a job owned by one of the task's conversations, cancels it through the native job registry, and wakes the task so delivery is attempted again without waiting for another event.
- **Re-deliver a held result on the events that clear its blockers** (turn end, job settlement, subagent end, schedule change, answered question, approval decision, task resume, context-admission release), waking only the tasks whose conversations changed, plus one coalesced re-check shortly after a hold to close the race where the clearing event arrived while delivery was being refused. The set of conditions that refuse delivery does not change.
- Turn a conversation-read failure into a named hold (`conversation-unreadable`) instead of the current silent refusal, so an unavailable projection is visible and retryable rather than invisible.
- **Play delivers the saved result** when one already exists and its delivery is pending or failed; a new explicit **Run again** action is the only path that captures and executes the script again.
- Extract the delivery gate into a domain module (`evaluateDeterministicHold`) with the authorization and context checks, so refusal evaluation is pure and testable; the native adapter computes its readiness report once internally and both `isIdle` and the new explanation read delegate to it, without changing the public session-port contract.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deterministic-steps`: the saved-result delivery contract gains a durable, bounded hold reason and a delivery-honest Play; the entry and run identity requirements gain the cancel-job action; truthful execution controls and diagnostics gain the held-result explanation and the recovery path.

## Impact

- Host: `src/host/deterministic-routing.ts` (gate evaluation and held outcome), `src/host/deterministic-supervisor.ts` (persist/clear the hold, re-check, deliver-on-Play), `src/host/app.ts` (command wiring, affected-task wake, cancel-job), `src/host/native.ts` (single readiness report, job cancellation), `src/host/automation`-adjacent helpers left untouched.
- Domain and shared: new `src/domain/deterministic-hold.ts`; `src/shared/deterministic.ts` (hold types and summary field); `src/domain/deterministic-state.ts` (stored schema); `src/remote.ts` (wire schema and command).
- Client: new hold notice component, drawer composition, `src/client/deterministic-view.ts` and `deterministic-actions.tsx` (labels and actions).
- Specification: delta for `openspec/specs/deterministic-steps/spec.md`; the kanban workflow-architect preset is reviewed in the same change because stage execution semantics change, and is updated only if its guidance becomes wrong.
- Tests: domain hold evaluation, host application delivery/re-entry/cancel, browser notice and actions; no new dependency and no host API deprecation involved (`ctx.jobs` is the public job-registry service).

## Non-goals

- Changing which conditions refuse delivery, or auto-delivering a result into a conversation that is still mid-turn or awaiting the user.
- The native lifetime-guard cleanup (`NATIVE_LIFETIME_GUARD_V1`) and the board-revision history gap, which have their own cards.
- Splitting `DeterministicSupervisor.drive()`, reusing one conversation-facts read per attempt, or deduplicating the script labels: recorded as separate debt.
