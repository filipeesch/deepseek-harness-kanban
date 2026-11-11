# Design

## Context

See `proposal.md` for motivation. The current state that shapes the approach:

- A task persists `autoMode = { enabled, pause? }`. The `pause` record is diagnostic: `AutoAdvanceCoordinator.observe` only reads `enabled`, and neither `resolveAdvanceDecision` (domain) nor `admitAutoAdvance.blocked()` (host) reads `pause`. A pause therefore never blocks an advance, and the admission transaction deletes it after a successful advance.
- The same blocking triple — an unresolved context operation, an unresolved confirmed transition, and an unresolved entry for the current stage — is written twice: in `resolveAdvanceDecision` and in the admission's `blocked()` helper. They must agree for the advance path to be correct.
- Every move is applied by one drained `pendingTransition`. A user move and an automatic advance both end in `operations.placeTask`, which clears `autoMode.pause` unconditionally. The transition carries `origin: 'auto'` for the automatic case.
- The auto-mode control is one toggle used by the card and the drawer header. It sends `!enabled` on activation, so a paused-but-enabled task currently turns auto mode off when the control is activated.
- The Hub document is validated with strict Zod objects, so a persisted field an older build does not know makes that build reject the document.

## Goals / Non-Goals

**Goals:**

- One rule that decides whether a task may advance, owned by one module and read by both the decision and the admission.
- A pause that survives reloads and restarts, keeps auto mode enabled, and cannot be erased by a turn ending or by an automatic advance draining.
- A pause whose reason is required, presented, and never silently truncated.
- Resume paths that never move the task and never advance a turn that already ended.

**Non-Goals:**

- Retracting an automatic advance that was already admitted; it drains as usual.
- Any tool that enables or disables auto mode. The agent surface exposes pause and resume only.
- Changing the held state, the pending-user-work projection, or the `transition-stale` rule.
- Implementing a hold expiration or a per-conversation pause: the pause belongs to the task.
- Extracting the whole command switch out of `KanbanApp`. This change adds two one-line cases and leaves that refactor as separate work.

## Decisions

### D1. The agent pause is a separate persisted record

`autoMode` gains `hold?: { reason: string; at: string }` beside the existing `pause`.

The alternative was a new `AutoModePauseReason` value in the existing `pause` record, which needs no schema shape change. It was rejected for three reasons: `pauseAutoMode` overwrites the record, so a turn that ends in `error` would destroy the agent's required reason; the admission transaction deletes `pause` unconditionally, so an admitted advance would erase it; and every reader would have to special-case one reason value to know whether it blocks, which turns a record into a flag by value.

With two records the diagnostic pause keeps its current lifecycle and the hold keeps its own, and the card can present both. `AutoModeHold` and the task type live in `src/shared/types.ts`.

### D2. One blocking rule in a new domain module

New `src/domain/auto-mode-hold.ts`:

- `activeHold(task): AutoModeHold | undefined`
- `blocksAdvance(task): boolean` — `task.operation !== null || task.pendingTransition !== undefined || hasUnresolvedEntry(task) || activeHold(task) !== undefined`
- `normalizePauseReason(value): string` — trims and enforces the required length
- `applyHold(task, reason, at)` and `clearAutoModeState(task)` — the one mutator that drops `hold` and `pause`

`resolveAdvanceDecision` replaces its inline triple with `blocksAdvance` and keeps returning `{ kind: 'busy' }` for it. The admission's `blocked()` becomes a thin wrapper over `blocksAdvance`, or is deleted in favor of it.

The hold folds into the existing `busy` decision rather than a new decision kind: both are skipped silently with no pause recorded and no retry, and they re-evaluate on the next completed turn. A distinct kind would be new vocabulary with identical handling.

`AutoAdvanceCoordinator.observe` is deliberately left reading only `enabled`. A paused task still queues a settle and is then skipped by the decision, so the rule stays in one place instead of two.

### D3. Two domain operations, two repository methods, two commands

- `operations.pauseTask(hub, taskId, reason, deps)`: requires the task, normalizes the reason, and records the hold only when `autoMode.enabled` is true. When auto mode is disabled it returns the task unchanged, which is how the tool reports its informative success without a second rule.
- `operations.resumeTask(hub, taskId, deps)`: clears the hold and the diagnostic pause through `clearAutoModeState`. It returns the task unchanged when nothing was recorded.
- `HubStore` gains `pauseTask` and `resumeTask`, mirroring `setAutoMode` and `recordTransition`.
- `Command` gains `task.pause` and `task.resume`; `KanbanApp.execute` handles each in one line like `task.autoMode`. Both call `this.autoAdvance.forget(taskId)` (D4).

`resumeTask` is its own operation and does not route through `setAutoMode(true)`, because resuming a task whose auto mode is disabled must not enable it. The opposite direction is fine: enabling auto mode on a paused task is a resume, so `setAutoMode(true)` clears the hold and the diagnostic pause, and the early return gains the `hold === undefined` condition.

### D4. Every pause, resume, and movement forgets a queued settle, and the admission re-checks it

`AutoAdvanceCoordinator` keeps a task's completed turn in `queued` between the turn end and the settle timer. A resume that arrived after a turn ended must not advance for that turn, so `forget(taskId)` drops the queued entry and bumps the task's generation. Three places call it: `task.pause`, `task.resume`, and any change to the setting through `task.autoMode`; and the drain calls it for a placement that is not an automatic advance, because a user movement or a confirmed transition resumes the task by clearing its pause.

Forgetting the entry is not enough on its own. The settle enqueues its admission in the same serialization lane as commands, so a pause or resume queued ahead of that admission runs first and the admission would still advance the turn it no longer owns. The admission port therefore takes `isCurrent: () => boolean`, which the coordinator builds from the settle's own generation, and the serialized adapter re-reads it immediately before the durable decision. An admission whose settle was superseded returns without writing anything.

### D5. The reason is required, trimmed, and rejected when too long

One exported constant, `PAUSE_REASON_LIMIT = 280`, and `normalizePauseReason` rejects an empty value and a longer one with a distinct `KanbanError` code. Nothing truncates: a truncated reason would present a request the agent did not make. The tool declares the reason as a required parameter so a missing value fails before the command runs.

### D6. A new tool module behind a narrow port

New `src/host/tools/auto-mode.ts` exporting `autoModeTools(port)`, registered by `productToolDefinitions` in `src/host/tools/index.ts`. It does not take `KanbanApp`: it takes a two-method port.

```ts
interface TaskPausePort {
  pause(taskId: string, reason: string): Promise<LocatedTask>;
  resume(taskId: string): Promise<LocatedTask>;
}
```

`KanbanApp` provides the implementation by running the command and re-reading the task. The port keeps the tool module dependent on the two operations it needs rather than on the whole application, and it is trivial to fake in a tool test.

Both tools resolve the task with the existing `requireTask`, which already accepts the calling task conversation or an explicit `task_id`. That is what lets one conversation resume another task, and it is the same scope `set_next_transition` uses.

`transitions.ts` keeps routing only. Pause and routing are different responsibilities and the existing requirement says trading one never changes the other.

### D7. Clearing the hold depends on how the task moved

`operations.placeTask` clears the diagnostic pause on every placement, which is correct: an advance that completes resolves the turn it came from. The hold is different — a pause recorded after an advance was admitted must survive that advance draining.

`placeTask` gains an options argument, `{ retainAgentPause?: boolean }`, and the drain passes `retainAgentPause: pending.origin === 'auto'`. A user move and a same-stage reorder therefore resume the task, an automatic advance does not, and the rule is visible at the single call site instead of hidden in the placement code.

The admission transaction also stops deleting `autoMode.pause` blindly: it asserts no hold is present when it commits, so a pause recorded between the settle decision and the transaction fails the admission with the existing revision-conflict behaviour instead of advancing a paused task.

### D8. One derivation for the presented state

`autoModeView` in `src/client/auto-mode.tsx` separates the state precedence from the presentation: `presentationOf` picks the state (a pending advance still comes first), and one composer folds the recorded pauses into every presentation. A state that comes first therefore never hides the agent's reason: the view exposes the state's own `status` plus `secondaryStatuses` for the pauses, and it joins every presented label into `stateLabel` and `title` so the drawer chip's tooltip and accessible name carry both. The view also gains `pressed`, so the control stops deriving its own semantics.

- `pressed` is `enabled && !paused`; a paused task is presented as not pressed so the pressed state keeps describing the action activation performs.
- The control treats `paused` and `paused-by-agent` alike for styling, and activation sends `true` for both: enabling a paused task is its resume, because `setAutoMode(true)` clears the record.
- The client keeps sending `task.autoMode`; the agent surface uses `task.resume` (D3). One is the user's switch, the other is the agent's operation, and only the latter refuses to enable a disabled task.

The client's `AutoModeState` type is renamed to `AutoModeViewState` in the same change. It currently collides with the persisted `AutoModeState` interface in `src/shared/types.ts`, which made both names mean different things.

### D9. The pause-reason enum gets one source

`src/shared/types.ts` exports `AUTO_MODE_PAUSE_REASONS` as a const tuple and derives the union from it; `autoModePause` in `src/domain/schema-parts.ts` uses `z.enum(AUTO_MODE_PAUSE_REASONS)`. Adding a reason becomes a one-line change instead of edits in the type union, the schema, and whichever switch forgets it.

## Risks / Trade-offs

- **A persisted field an older build rejects** → the Hub schema is strict, so a downgrade of this installation cannot read its own stored Hub while a task carries a pause. Tasks are never published, so no other installation is affected; the docs state the resume-before-downgrade step and the package version moves with the feature.
- **An agent can freeze a user's automation** → the paused state carries the agent's reason in the status strip, resumes in one activation, and cannot retract an admitted advance. The tool cannot enable or disable auto mode, so it can only suspend a setting the user already chose.
- **Two pause records presented at once** → the status region already stacks facts, and the labels differ in tone and wording. A card can show "the agent asked to wait" and "the turn failed" together, which is the truthful reading.
- **A paused task still queues and settles a completed turn** → a wasted settle round trip per turn. Accepted over duplicating the rule inside `observe`.
- **The activation semantics change for existing diagnostic pauses** → the browser lane asserts the old behaviour today, so the change must update those expectations, and the accessibility name must state the resume before the action so the control does not promise a toggle it no longer performs.
- **A hold on a task whose stage leaves the workflow** → the hold is task-level and stage-independent; a move already resumes it, so a stale stage cannot strand it.
- **Resume after a queued settle** → handled by `forget` (D4); without it, resume would advance a turn that already ended, which the spec forbids.
- **The real-composition lane cannot drive the agent pause** → its replay fixture is an ordered list of text-only model turns, so no scripted turn can call `pause_task`, and recording a real tool call against a personal profile is not allowed. The pause state and its resume activation are therefore covered by the real client browser lane against the actual components, plus the host and domain suites; the composition lane covers the advance and instruction delivery it was written for.

## Migration Plan

1. Ship the persisted field with the schema update and the version bump. No data migration is needed: an absent `hold` means not paused, and existing documents parse unchanged.
2. Update `README.md` and `docs/operations.md` in the same change, and state that the field lives in the local Hub document, that tasks are never published, and that a paused task must be resumed before downgrading.
3. Rollback: a build without the feature cannot read a document that contains a hold, so rolling back requires clearing the pause first (resume or move). Document that in the release note rather than writing a down-migration.

## Open Questions

None that change the specs or the task breakdown. The exact status-strip wording for the pause is copy, settled during implementation against the existing labels.
