# Design

## Context

See [proposal.md](proposal.md) for the motivation and the delta spec for the behavior contract.

Facts that shape the approach:

- The diagram's layout edits are already three small, injectable gesture modules: `gestures/stage-drag.ts` (movement threshold, zoom-corrected delta, commit-on-release) with `draggedPosition` and the `PointerEventsPort` seam, `gestures/stage-resize.ts` (outward drag grows the rendered rectangle, inward edits the authored minimum, `clampStageSize` from `domain/stage-size.ts`), and `gestures/connection-drag.ts` (threshold, Escape, pointercancel) shared by the anchor and segment drags.
- `canvas.tsx` starts the stage drag (it owns the React Flow node positions), computes the segment offset as `Math.round(coordinate - line.coordinate)`, and builds the `StageCallbacks` context. `stage-node.tsx` starts the resize gesture from the corner handle and keeps the node data serializable and function-free.
- `workflow-view.tsx` owns the optimistic position and size overrides with their settling effects and baselines, the coalesced saver, the bounded history, and the control-stack slot; it rounds a committed drag and resize to whole units.
- `controls/view-controls.tsx` is the single presentational stack; `controls/tooltip.tsx` derives both the accessible name and the tooltip from one label; `icons.tsx` builds every icon through one glyph factory.
- Browser preferences are best-effort `localStorage` writes through `active-scope.ts`; `view-preference.ts` is the precedent for a small read/write module, and the layout lock (`use/use-flow-lock.ts`) shows a session-only alternative.
- The accepted ranges are already enforced elsewhere: `STAGE_POSITION_LIMIT` in `domain/workflow.ts`, and `STAGE_MIN_SIZE` (264x140) plus `STAGE_SIZE_LIMIT` in `domain/stage-size.ts`. Positions, sizes, and connection offsets are authored as YAML text, so a settled value needs no schema work.
- Three test lanes already exist: pure and jsdom vitest for the gestures and the view (which accepts a stub canvas), Playwright against real React Flow, and the isolated `e2e-dsh` composition lane.

## Goals / Non-Goals

**Goals:**

- One pure snapping rule, expressed as a policy the gestures receive, so the canvas holds no lattice arithmetic and no constant.
- Gestures stay testable without a DOM: the policy is a function, the modifier is read from the pointer event, and the lifecycle stays in the existing gesture modules.
- One control, in the stack that already exists, with the same label/tooltip/pressed conventions as the lock.
- No stored-data change: settled values are ordinary coordinates, so the parser, the YAML text writers, and the sharing merge stay as they are.
- Leave the view and the canvas smaller than they are now: the drag controller, the optimistic overrides, and the placement merge each move to their own module.

**Non-Goals:**

- Drawing the lattice, rulers, guides, or snap indicators.
- Snapping automatic placement, Organize, connection anchors, or card ordering.
- A configurable step, a per-board step, keyboard nudging, or multi-stage alignment.

## Decisions

### Snapping is a pure policy injected into the gestures

`gestures/grid-snap.ts` owns the whole rule: `GRID_STEP = 8`, a `SnapPolicy` interface with `position`, `size`, and `coordinate`, and the two policies the diagram can run. `gridSnapPolicy(step)` rounds to the nearest multiple of the step; `noSnap` is the permissive identity — positions and sizes pass through untouched, and `coordinate` keeps today's `Math.round` for segment offsets.

`beginStageDrag` and `beginStageResize` gain an optional `snap: SnapPolicy` input and apply it inside their own measurement. The canvas receives the policy as a prop and hands it to the drag controller and, through the existing `StageCallbacks` context, to the resize handle; nothing is stored in node data, which must stay serializable and function-free.

`noSnap` instead of `snap: SnapPolicy | null` keeps one call site and no null branch in three gestures. Injecting the policy instead of the step keeps the constant out of the canvas and lets a test pass a policy with a different step without touching the UI.

Alternatives considered:

- **React Flow's `snapToGrid` / `snapGrid`** — rejected: stage nodes are `draggable: false` and the header drag is custom, so the library's node dragging never runs.
- **Round in `moveStage` in the view** — rejected: the view sees only the committed value, cannot show the lattice while the pointer moves, and would round a second time.
- **Snap only on release** — rejected: the stage would visibly sit between lattice points and then jump when stored.

### The lattice is absolute and resolved on every pointer move

`draggedPosition` keeps producing the zoom-corrected absolute position; the policy then maps it to the nearest lattice point on each move, so the rendered stage, its edges, and the drop indicator already show the settled position. Absolute means the settled value is independent of where the gesture started, which is what lets two stages edited at different times share a line.

Consequence, accepted and pinned by the "Present a stored off-lattice placement" scenario: a stage whose stored position is off the lattice moves by up to half a step on its first edit.

Alternatives considered:

- **Delta snapping** (settle = origin + whole steps) — rejected: it preserves the existing offset, so two stages edited separately never align to each other.
- **Snapping the automatic layout too** — excluded by the proposal; the spec keeps Organize's geometry unchanged.

### Size snapping raises the minimum instead of lowering the lattice

`snapSize` snaps each axis to the nearest multiple of the step and then raises it to the smallest lattice point at or above the accepted minimum (264 stays 264 because it is a multiple of 8; 140 becomes 144). `clampStageSize` still runs afterwards for the maximum and the integer rounding, so the pipeline is `snapSize` then `clampStageSize`.

Snapping after the clamp would store 140, which is off the lattice and breaks the contract; clamping after a plain snap without raising would do the same. Raising keeps every stored size a lattice point while never storing a size below the minimum.

Alternatives considered:

- **Treat the minimum as the lattice origin for sizes** — rejected: relative sizes contradict the absolute lattice the request chose and would let two stages share a width only by luck.
- **Skip snapping below a certain size** — rejected: an exception nobody can predict from the UI.

### The bypass modifier is read from the pointer event, not a key listener

`PointerPosition` gains an optional `altKey`. A gesture engages the bypass when the press carries the modifier, and also samples every move — including the moves below the drag threshold — so a modifier pressed and released inside the first few pixels still counts. Once engaged, the gesture stays free for its whole life, which is why releasing the key never snaps the stage, the size, or the segment back under the pointer. The existing ports already type their listeners as `(event: PointerPosition) => void` and real DOM events satisfy the wider shape, so no listener and no lifecycle is added; `beginConnectionDrag` gains one `onSample` callback for the below-threshold moves the canvas needs to see.

A keydown listener would need its own lifetime, would race the pointer stream, and would behave differently when the window loses focus.

Alternatives considered:

- **A keyboard session in the view** — rejected: the modifier only matters while a gesture runs, and the gesture already receives every move.
- **Releasing the constraint by leaving a dead zone** — rejected: unpredictable and untestable.

### A segment settles on the lattice line, not on a lattice offset

The canvas computes `offset = snap.coordinate(coordinate) - line.coordinate`, so the segment's absolute line lands on the lattice point nearest the pointer and the stored offset describes that line. That arithmetic is a pure `segmentOffset` helper in `grid-snap.ts`, so the canvas keeps one call and the rule is unit-tested. Connection ends are untouched: an anchor already resolves to one of five points per side, and the added spec sentence says so explicitly.

A snapped offset could equal the offset the connection already has; the commit path compares the previewed layout with the current one through `sameConnectionLayout` and cancels instead of storing an identical entry.

Alternatives considered:

- **Snapping the offset value itself** — rejected: an offset is relative to the automatic route, so two segments would land on different absolute lines.
- **Snapping the segment when the route is automatic** — rejected: the route is derived, not authored, and snapping it would move arrows the user never touched.

### A gesture that settles where it started is a cancel

The stage drag compares the whole-unit position the workflow would store with the position the gesture started at, so a drag that returns to within half a unit at a fractional zoom is still a cancel. The resize keeps its existing `moved` flag, computed on the snapped size against the clamped authored size, never against the snapped starting size: an off-lattice authored size that moves onto the lattice is a real edit. The segment drag compares the displacement it settled on with the displacement the connection's authored layout already applies to that line — never the whole layout, because a preview pads earlier positions of the same axis with zero offsets that are not an edit. The commit path also keeps the whole-layout comparison as a backstop for a re-anchoring that returns to the anchor it started on.

Because the guard lives in the gesture, the view's `moveStage`, the history, and the coalesced save never see an edit that changed nothing, so no phantom history entry and no workflow write can be produced. With snapping off the live preview stays fractional, but the gesture commits the whole-unit position the workflow stores and compares that value with the origin, so a drag that returns to within half a unit is still a cancel.

Alternatives considered:

- **Compare in `moveStage` before pushing history** — rejected: the view does not know the gesture's starting value and would need new state for a rule the gesture already owns.
- **Compare the stored YAML before saving** — rejected: it would still pollute the in-memory history.

### One global browser preference, owned by a hook

`src/client/grid-preference.ts` mirrors `view-preference.ts`: `GRID_SNAP_KEY = 'dsh.kanban.gridSnap'`, a read that treats a missing or malformed value as on, and a best-effort write. `use/use-grid-snap.ts` reads once, exposes `enabled`, `toggle`, and the resolved `snap` policy, and writes on toggle.

A global key matches the request (an editing style, not board content) and avoids per-board churn when a board is created, removed, or shared. Nothing about the preference reaches the workflow YAML, so sharing and the client's parsing are untouched.

Alternatives considered:

- **Per-board map** — rejected by the decision, and it would add board lifecycle cases for no behavior the user asked for.
- **Session-only like the lock** — rejected: the user asked for the choice to be remembered.

### The toggle sits in the existing control stack and ignores the lock

`ViewControls` gains `snapping` and `onToggleSnap` and renders the control in the group with the layout lock, which is also a preference rather than an edit. It is never disabled; Organize, Undo, and Redo keep their lock gating. The label follows the lock's convention: the accessible name and the tooltip describe the action (`Turn off grid snapping` / `Turn on grid snapping`), and `aria-pressed` exposes the state. A new glyph joins `icons.tsx` through the existing factory so the control matches the stack.

Alternatives considered:

- **A settings-panel toggle** — rejected: it is far from the gesture it changes and would need a new surface for one boolean.
- **Disabling it while locked for group consistency** — rejected: it does not edit the layout, and the lock itself stays available.
- **A popover with step choices** — out of scope: the step is fixed at 8.

### The layout-editing modules get smaller, not bigger

Adding the toggle, the policy, and the bypass to the current files would grow `canvas.tsx` (437 lines) and `workflow-view.tsx` (490 lines) further, so the change pays for itself with four extractions:

- `use/use-stage-drag.ts` owns the gesture's lifetime, the node preview, and the commit/cancel policy; the canvas keeps only the wiring and its node state.
- `use/use-placement-overrides.ts` owns the optimistic position and size overrides, their baselines, the two settling effects, the resize preview, and the reset; `workflow-view.tsx` keeps the save and history orchestration.
- `placement.ts` splits into `auto-layout.ts` (`graphKey`, `freezeAutoLayout`, `computeAutoLayout`) and `placement-merge.ts` (`mergePlacements`, `samePlacements`), because automatic layout and merge change for different reasons.
- `samePosition` moves to `src/domain/stage-position.ts` and replaces the local copies in `placement-merge.ts`, `use-placement-saver.ts`, and `domain/sharing/workflow-merge.ts`, so the three layers that compare a stored stage position share one definition.

Alternatives considered:

- **Leave the duplicates and the oversized files** — rejected by the accepted scope: this change is where the duplication is in the way.
- **Split the canvas wholesale** — rejected as too much churn for this change; only the drag controller is extracted.

### Target module layout

```text
src/client/
  grid-preference.ts                 browser-wide snapping preference
src/client/workflow-view/
  gestures/grid-snap.ts              GRID_STEP, SnapPolicy, gridSnapPolicy, noSnap
  gestures/stage-drag.ts             accepts a SnapPolicy and reads altKey
  gestures/stage-resize.ts           accepts a SnapPolicy
  use/use-grid-snap.ts               enabled + preference + resolved policy
  use/use-stage-drag.ts              drag lifetime, preview, commit/cancel
  use/use-placement-overrides.ts     optimistic placement/size settlement
  auto-layout.ts                     graphKey, freezeAutoLayout, computeAutoLayout
  placement-merge.ts                 mergePlacements, samePlacements
  canvas.tsx                         passes the policy, snaps segment offsets
  controls/view-controls.tsx         snapping toggle
src/client/
  icons.tsx                          snapping glyph
src/domain/
  stage-position.ts                  shared samePosition comparison
```

### Test seams

The pure policy is unit-tested directly, including the minimum-size raise and the off policy. Gesture tests pass a fake policy and a pointer port that can emit `altKey`, so the bypass and the commit/cancel rule are asserted without a DOM. The view's jsdom test keeps using the stub canvas to assert that the toggle reaches the canvas and that it is available while locked. The Playwright lane covers what jsdom cannot: a real stage dragged onto the lattice, a real resize stored as a lattice size, a real segment stored on a lattice line, the Alt bypass, and the preference surviving a reload.

## Risks / Trade-offs

- **Organize produces off-lattice positions** → the added scenario pins the behavior, and the jump on the first edit is at most half a step (4 units). Snapping automatic layout would change positions the user did not edit, so it stays out.
- **An arrow offset is relative to the automatic route** → moving a stage after adjusting a segment can take that line off the lattice. The spec promises the settled line at adjustment time, not permanence; storing absolute segment coordinates would be a separate change.
- **The lattice is invisible** → the step is only felt while dragging. A small step keeps the correction imperceptible, and the toggle's tooltip names the state so it can be turned off.
- **A no-op guard could swallow a real edit** → the guard compares the settled value with the gesture's origin, so with snapping off a fractional drag still commits and only an exactly unchanged value cancels. Browser tests cover both a real drag and a click without movement.
- **Alt is intercepted by some window managers** → the control stack always turns snapping off, so the bypass is a convenience rather than the only way out.
- **A browser preference can differ between two people on the same board** → stored positions remain absolute, so the diagrams agree; only the editing feel differs.
- **The existing browser assertions use pixel deltas** → the drag and resize tests assert inequalities rather than exact positions, so snapped values keep them valid; the place where an exact value matters is the new snapped assertion, which the change adds explicitly.

## Migration Plan

1. Policy module and `domain/stage-position.ts` first: pure, additive, covered by unit tests, with no behavior wired yet.
2. Gestures accept the policy and the modifier; wire the canvas, the resize callbacks, and the segment offset; add the commit/cancel guards.
3. Preference module, `use/use-grid-snap.ts`, the control-stack toggle, and the icon.
4. The refactorings: the drag-controller hook, the overrides hook, the placement split, and the shared comparison; each is behavior-preserving and covered by the existing tests with updated import paths.
5. Documentation and the version bump in the same pull request.

Rollback is a preference default: shipping the toggle off (or `GRID_STEP = 1`) restores today's free-form edits, and no stored workflow needs conversion in either direction because snapped values are ordinary coordinates.

## Open Questions

- Whether snapping should later extend to automatic placement is deferred; the spec pins today's behavior and Organize keeps its geometry.
- Whether a later change should store absolute segment coordinates, so an adjusted arrow stays on the lattice after a stage moves, is deferred; the current layout format keeps offsets.
