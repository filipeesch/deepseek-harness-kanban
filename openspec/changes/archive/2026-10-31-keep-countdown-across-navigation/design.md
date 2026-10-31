# Design

## Context

See `proposal.md` — Why. The observable contract is in `specs/kanban-board/spec.md`.

The auto-run controller is already owned above the board: `initializeClient` creates it once per client plugin generation, next to a lifetime bridge subscription that reconciles every task of every Hub. Two implementation seams defeat that ownership:

- `BoardView` reconciles the same controller on each accepted snapshot with `state.tasks`, which `boardView` filters to the active board. Switching board or Hub therefore removes the armed task from the reconciliation input and `AutoRunController.reconcile` cancels a legitimate window.
- The controller's command port is `autoRunRunner`, a mutable binding that only `BoardView` fills through the `onRunReady` callback. The last mounted board therefore owns the execution path: the closure survives an unmount, but nothing guarantees it, and the send is coupled to React mount order.

A real-composition reproduction of the current build showed the split: an instructed move sent normally while the Kanban panel was hidden, and the same move never sent after switching boards (the host still held the entry marker). The hidden-panel path only works because the stale closure happens to remain valid.

## Goals / Non-Goals

**Goals:**

- Make reconciliation a single global liveness policy, independent of the visible board.
- Make the armed window and its send independent of the board being mounted or visible.
- Remove the two-owner reconciliation and the `onRunReady`/`autoRunRunner` temporal coupling.
- Preserve every other auto-run rule: five seconds, first open conversation target, no automatic retry, failure surfaces, no persistence.

**Non-Goals:**

- A host-owned or persisted deadline; reload and plugin restart still send nothing.
- Cross-tab countdowns or a global indicator for windows armed on another screen.
- Splitting `AutoRunController` or decomposing `BoardView`.
- Host command, wire schema, persisted data, or migration changes.

## Decisions

### 1. The client generation is the single reconciliation owner

The lifetime subscription in `initializeClient` stays the only reconciler for the shared controller and keeps its global scope: `snapshot.state.hubs.flatMap(hub => hub.tasks)`. `BoardView` stops reconciling a provided controller.

`reconcile` is a liveness policy over the whole board state: an entry must end when its task disappears or its marker changes, regardless of what the user is looking at. The visible board is a presentation scope, not an ownership scope, so it must not narrow that input.

**Alternatives considered:** reconcile all tasks from `BoardView` (keeps two owners and stops working whenever the board is unmounted); reconcile only when the task belongs to the active board (still cancels off-screen windows); derive the countdown from the persisted marker (restarts windows on reload and every snapshot, contradicting the spec).

**Ordering:** `ClientBridge` accepts and publishes the command snapshot through its own sequence and epoch guards, so an older frame cannot cancel a newer arm. A reconciliation that runs before `BoardView` arms the entry is a no-op because no entry exists yet.

### 2. The command port is created at the composition root

`initializeClient` constructs the controller with `run: command => bridge.api.command(command)`. `ClientBridge.unarySnapshot` already accepts the command response and publishes the merged snapshot to every subscriber, so the board, drawer, and cards update from the same path even when the timer fires while another board or screen is active. The extra local `accept(result)` that `BoardView.run` performs is not needed for this command.

`task.runInstruction` is hub-agnostic on the host: `runInstruction` locates the task by id and never reads `hubId`. The root port therefore needs no active Hub or board and cannot target the wrong Hub after a switch. `scopedCommand` preserves the same task-scoped shape for the standalone fallback, so it cannot attach the active Hub after a switch either.

Deleting `autoRunRunner` and the `onRunReady` prop removes the `client.tsx -> Main -> BoardPage -> BoardView` plumbing that existed only to hand the board's `run` closure back to the root.

**Alternatives considered:** keep the board runner and rebind it on each mount (preserves the temporal coupling; rebinding after a board switch would carry the new board's `run` closure); capture the Hub on the input and forward `hubId` (adds plumbing to the card and drawer for a field the host ignores); add a Hub lookup service to the bridge (unneeded while the command is task-scoped).

### 3. Fallback ownership is explicit

`BoardView` keeps its standalone fallback controller for the browser harness and jsdom tests, disposes it on unmount, and reconciles it from the full normalized snapshot (`allTasks(snapshot)`) only while it owns it. A provided controller is reconciled by its provider.

This keeps the test seam without duplicating the production policy, and prevents a future embedder from inheriting a silently board-scoped reconciliation.

**Alternatives considered:** remove the fallback and require every render to inject a controller (breaks standalone rendering and the existing harness); keep the fallback board-scoped (harness behavior would drift from production).

### 4. The controller API is unchanged

`arm`, `cancel`, `runNow`, `reconcile`, `subscribe`, `getSnapshot`, and `dispose` keep their shapes and semantics; only the composition and the reconciliation caller change. The controller is already cohesive and receives time and command execution by injection, so it is not split into a scheduler/store/executor trio.

**Alternatives considered:** split the controller (more indirection for one consumer); fold execution into the board (the regression being fixed).

## Risks / Trade-offs

- **A provided controller from a custom embedder has no reconciler.** → The only provided-controller composition is the plugin root, and the `autoRun` prop comment documents that the provider owns reconciliation.
- **Fallback and root paths could drift.** → Both call the same `reconcile` over a full task list; the difference is only who invokes it.
- **An older snapshot could cancel a newer arm.** → The bridge's sequence/epoch guard decides which snapshot is accepted; reconciliation only acts on an accepted snapshot.
- **Hidden timers can fire late.** → Unchanged best-effort behavior; the window may send later than five seconds, never earlier, and the spec makes no wall-clock precision promise.
- **No cancel surface while another board or Hub is visible.** → Accepted by the hidden-window rule; the window is five seconds and the card presents the remaining state on return.
- **The auto-run path no longer goes through `BoardView.run`.** → It therefore skips that path's failure advice and local `accept`; for `task.runInstruction` the advice is empty, and `bridge.api.command` already publishes the accepted snapshot to all subscribers. Failures stay owned by the controller and surface on the card and drawer.

## Migration Plan

- Client-only change: rebuild the plugin and refresh the running GUI. No host restart or data migration.
- Rollback is a code revert; the countdown returns to the previous board-scoped behavior and no board data is rewritten.
- The delta specs archive into `kanban-board`; `task-conversations` and the host wire remain unchanged.

## Open Questions

None.
