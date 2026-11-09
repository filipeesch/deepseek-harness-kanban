# Design

## Context

See [proposal.md](proposal.md) for the motivation and the delta specs for the behavior contract.

Facts that shape the approach:

- `@xyflow/react` 12.12.1 is already bundled: the client imports its stylesheet as text through an esbuild CSS-text loader, mounts it with the plugin's style tags, and records it in `THIRD-PARTY-NOTICES.md`. `MiniMap`, `Panel`, and the viewport gestures come from the same package, so this change adds no dependency.
- The diagram is split today into a 400-line `workflow-view.tsx` (measurement, frozen automatic placement, manual overrides, placement history, a save queue, card travel, and undo/redo keyboard handling) and a 209-line `canvas.tsx` (node synchronization, a custom stage-header drag, a Ctrl/Cmd wheel capture listener, edges, and the zoom panel). `stage-node.tsx` builds a reduced `FlowCard` projection from `Attention`.
- The board owns the move pipeline (`useBoardMoves` → `useMoveRequest`), the auto-mode toggle, selection mode, and the per-task `Attention` map. The diagram receives only tasks, attention, and the drag callbacks, so it cannot render the board's card.
- `connections.ts` already separates a drawn shape from the polyline the card travel animates; `scene.ts` builds the committed model from placements; `layout.ts` places stages by measured height; `placement.ts` merges automatic, stored, and in-memory placements; `history.ts` keeps a bounded undo stack.
- Authored workflow YAML is edited by text range, not re-serialized: `src/domain/workflow-positions.ts` mutates only existing `position` keys so comments, quoting, and block scalars survive. The parser rejects unknown keys, `schema-parts.ts` validates a strict object, and `canonicalWorkflow`/`workflowMeaning` decide what the sharing merge compares.
- The board storage precedent is `src/client/active-scope.ts`: best-effort `localStorage` reads and writes with a documented key.
- Tests use three lanes: vitest with jsdom (the workflow view accepts a stub canvas through `canvas`), Playwright against the real client components and real React Flow (`tests/browser/workflow-view.spec.ts`), and the isolated `e2e-dsh` composition lane.

## Goals / Non-Goals

**Goals:**

- One card implementation for both presentations, with the board's regions, controls, and states.
- One drawing model: the committed scene and the live edges share the same path function and the same sampled points.
- Layout behavior that is pure and unit-tested (size clamping, orthogonal route, live geometry, viewport math, gesture lifecycle), with the React components reduced to composition and DOM plumbing.
- Explicit ports for everything the diagram does not own (history, lock, save, card environment, controls), so the canvas has no domain knowledge and the view has no layout math.
- Backward-compatible persistence: the new YAML key is optional and the last valid workflow keeps working.

**Non-Goals:**

- Editing the workflow's structure from the diagram (adding, removing, renaming, or reconnecting stages).
- Persisting pan, zoom, or the layout lock.
- A second theme system, a new diagram library, or a new animation abstraction.
- A semantic three-way merge of workflows; the size key joins the existing placement merge.
- Hiding React Flow's attribution.

## Decisions

### Fix the drag lifecycle before adding gestures

The reported "a stage moves once" bug is a lifecycle bug in `canvas.tsx`: the guard ref is set to `{ cleanup: () => finish(false) }` while the comparison in `cleanup` tests `stageDrag.current?.cleanup === cleanup`, so the guard is never released and every later gesture returns early. The `draggingStage` ref is never set, so it is dead code rather than a latch.

The fix is a dedicated `gestures/stage-drag.ts` controller that owns one pointer gesture, exposes a single `dispose()`, and reports completion through callbacks. The controller is created on pointer down and always released by `dispose()`, so the guard is derived state (`controller !== null`) instead of a second flag that can drift. The vendor-neutral part (movement threshold, zoom-corrected delta, commit-on-release policy) is a pure module the controller composes.

Alternatives considered:

- **Use React Flow's node dragging** — rejected: it drags the whole node, including the card area, and the card gesture must stay a card move.
- **Keep the inline listener with a corrected identity check** — minimal, but it leaves the gesture, the zoom correction, and the commit policy inside the canvas, where they cannot be unit-tested.
- **Pointer capture on the header** — works, but it couples the gesture to DOM capture semantics without making the lifecycle testable.

### Live geometry from node rectangles

`live-connections.ts` derives the drawn edges from the live node rectangles: node id, position, and measured size, plus the connection descriptors (from, to, kind, returning, fan-out index, fan-out count). It returns, per edge, the same `ConnectionShape` the committed scene produces, plus both contact points. The canvas keeps React Flow's node positions as the single live source and recomputes edges when a node changes, so a dragged or resized stage drags its edges with it.

`connections.ts` gains an orthogonal route builder that emits a rounded path and samples the same segments for travel: horizontal departure, right-angle turns, horizontal arrival, with the fan-out offset applied to the departure point and the returning route still passing below the lowest stage. The arrowhead keeps using the last sampled points, so the drawn direction and the travel agree.

Alternatives considered:

- **`useInternalNode` per edge** — each edge would re-render and re-measure independently, and the fan-out and returning clearance need every node rectangle at once. One computation for the whole edge set is cheaper and testable.
- **React Flow's `getSmoothStepPath` per edge** — loses the fan-out anchors and the returning gutter, which are the two visible behaviors the diagram already promises.
- **Recompute only on drag end** — simplest, but the request is explicitly to see the arrows follow the movement.

### Viewport policy as configuration, not a capture listener

The current Ctrl/Cmd workaround exists because `panOnScroll` was chosen and `zoomOnScroll` was off. The new policy is React Flow's own: `zoomOnScroll` on, `panOnScroll` off, `zoomOnPinch` on, `panOnDrag` on. `gestures/viewport-policy.ts` holds the bounds and the zoom-at-point math used by the control buttons and the tests, so the behavior is asserted without simulating a browser gesture.

Alternatives considered:

- **Keep the capture listener and invert it** — duplicates what the library already does and keeps a handler that must fight React Flow's own wheel logic.
- **Wheel zooms only with a modifier, pan otherwise** — the reported request is the opposite.

### Stage size is authored YAML text, next to position

`Column` gains an optional `size: { width, height }`. The parser bounds it like a position (finite, inside a fixed range) and additionally rejects a value below the documented minimum, so `open` accepts old documents unchanged. `schema-parts.ts` extends the strict column schema, `canonicalWorkflow` includes the size, and `workflowMeaning` excludes it exactly as it excludes `position`, so a size difference is a layout difference rather than a workflow conflict. The sharing merge treats sizes like placements: per-stage, the side that changed it wins, and both sides changing it differently keeps the local value.

Authoring reuses the existing text-range approach. The low-level YAML map helpers currently private to `workflow-positions.ts` move to `src/domain/yaml-map-fields.ts`; `workflow-positions.ts` keeps its position functions and a new `src/domain/workflow-sizes.ts` exposes `readStageSizes` and `setStageSizes`. Two thin modules over one field writer keep the file names honest instead of growing a general-purpose YAML editor.

`src/domain/stage-size.ts` owns the policy, because the parser and the diagram both need the accepted minimum: the minimum, the clamping of a dragged size, and the effective size of a stage. The stage renders `width` and `min-height` from that value and keeps reporting its measured size, so automatic placement and fit-to-view keep using the real box.

The resize gesture is a corner handle in the stage node, active only while unlocked, backed by `gestures/stage-resize.ts` and the pure `size.ts` policy. It commits once on release through the same layout-save path a drag uses, so one resize is one history entry and one coalesced save.

Alternatives considered:

- **React Flow's `NodeResizer`** — it writes width and height into React Flow's node state, but this canvas replaces node state from props on every change, so the two sources of truth would fight.
- **A single board-wide minimum in the settings** — simpler domain change, but the request is to change individual boxes in the UI.
- **Sizes only in browser storage** — keeps the YAML untouched, but the team would see different diagrams.

### Lock as a view-level gate

The lock is view state, on by default, and it only gates layout editing. `use/use-flow-lock.ts` exposes the flag and a toggle; the view passes `locked` to the stage node (drag and resize disabled) and to the control stack (organize, undo, and redo unavailable). Card activation, card drag, selection, the run action, the advance action, pan, and zoom never read the lock.

Alternatives considered:

- **A lock owned by the canvas** — the canvas would then need to know about Organize and the history, which it deliberately does not.
- **A persisted lock** — the request is "on by default", so a reload starts locked.

### Controls and minimap are presentational components

`controls/view-controls.tsx` receives callbacks and availability flags and renders the bottom-left icon stack; `controls/tooltip.tsx` is a CSS tooltip driven by `aria-label` and a data attribute, so no portal, no timing state, and the accessible name stays the source of truth. `controls/minimap.tsx` wraps React Flow's `MiniMap` with the plugin's theme tokens and makes it pannable.

The canvas accepts a `controls` slot, and the view supplies it, because the view owns the history, the lock, and the fit request. This keeps the canvas a surface and the controls a leaf.

Alternatives considered:

- **React Flow's `Controls` component** — its styling and button set do not match the requested stack (undo, redo, organize, lock), so we would override almost all of it.
- **Native `title` tooltips** — no delay control and unstyled; the request asks for a tooltip on each icon.

### One card, injected environment

The `FlowCard` projection and its reduced attention mapping are deleted. `workflow-view.tsx` receives a `CardEnvironment` from `BoardView` and publishes it through a context that the stage node consumes; the stage renders the board's `BoardCard` with the task, its column, the project name, and the environment's handlers. Selection mode, the auto-mode toggle, the run action, and the advance action therefore behave identically in both presentations, and a future card change cannot silently miss the diagram.

`BoardCard` stays memoized: the environment is stable by construction (it is created once per render of `BoardView` from stable callbacks), and each card still receives scalar or stable props.

The travelling card copy stays a compact label. It is a motion artifact, not a card, and rendering the full card would animate a duplicate of every control.

Alternatives considered:

- **A shared presentational card composition** (extracting the context, activity, and status subcomponents and reassembling them for the diagram) — reuses the visuals but keeps a second composition that can drift, which is the bug being fixed.
- **Passing every card prop through the node data** — node data must stay serializable and stable; callbacks and controllers belong in a context.

### The advance action reuses the drawer's move path

`TaskCard` gains `next` (the next `TransitionDestination`) and `onMove`. `BoardCard` derives `next` from `nextStage(workflow, task.columnId)`, and `BoardView` supplies the same `moveTo` the drawer uses, so a restricted next stage asks for confirmation, a first execution presents the execution preparation, and an instructed destination arms the timed instruction without new code. The card owns a local moving flag and derives blocked from its task, mirroring the drawer.

### Execution accent and the removed background chip

The working presentation becomes one trailing-edge bar rendered as a pseudo-element with an opacity-only pulse, so it does not distort the card's radius and costs no layout. The reduced-motion preference keeps the bar visible and still. `WorkingBadge`, its styles, and the card's background chip are deleted; `WorkingAnnouncement` stays so assistive technology still hears the state, and the activity row keeps its reserved height so a turn starting or ending does not resize the card.

Removing the background chip removes the only visible background summary on the board. The information stays reachable through the drawer's Conversations section entry, whose accessible name and tooltip already include the count and labels; that is the accepted trade-off recorded below.

### Presentation preference is a board-scoped browser preference

`src/client/view-preference.ts` stores a JSON map of board id to presentation next to the existing active-hub and active-board keys. `BoardView` resolves the first presentation as the stored choice, then the board's configured default, then the column board, and no longer resets the field when the active board changes. Switching writes the choice. Nothing about it reaches the host, so the board's configured default and team sharing are untouched.

Alternatives considered:

- **One global preference** — ignores boards that intentionally open as a diagram.
- **Persisting in the board's YAML** — would publish a personal choice to the team.

### Full-bleed surface

The flow body modifier owns the layout: the shared page body keeps its padding for the columns presentation, and the flow variant removes padding, border, radius, and inner background. The stage styles keep their own surface, so the diagram does not need the frame it currently sits in.

### Target module layout

```text
src/client/workflow-view/
  workflow-view.tsx             composition root: receives ports, renders the frame
  use/use-stage-measurements.ts measured sizes, reveal gate
  use/use-placement-saver.ts    intended text, revision, coalesced save queue
  use/use-placement-history.ts  bounded undo/redo over placement + size
  use/use-flow-lock.ts          session lock
  use/use-travel.ts             travel plan for committed stage changes
  canvas.tsx                    React Flow surface: nodes, live edges, viewport, slots
  stage-node.tsx                stage region: header, resize handle, card list
  card-environment.tsx          context carrying the board card port
  gestures/stage-drag.ts        one pointer gesture with a single dispose
  gestures/stage-resize.ts      one resize gesture with a single dispose
  gestures/viewport-policy.ts   bounds and zoom-at-point math
  connection-edge.tsx           draws one edge, its arrow, and its contact circles
  connections.ts                rounded orthogonal path and sampled points
  live-connections.ts           live rectangles to edge geometry
  scene.ts, layout.ts, placement.ts, history.ts, travel.ts, size.ts
  controls/view-controls.tsx    bottom-left icon stack
  controls/tooltip.tsx          CSS tooltip
  controls/minimap.tsx          themed minimap
  styles.ts
src/domain/
  workflow-sizes.ts             read and author stage sizes
  yaml-map-fields.ts            shared text-range helpers for map fields
  stage-size.ts                 accepted minimum, clamping, effective size
```

Each module has one reason to change: the view composes state and ports, the canvas owns the surface and gestures, the stage node renders one region, the controls render one stack, the pure modules decide geometry and policy, and the domain owns the authored text.

### Test seams

The existing stub-canvas seam stays: `WorkflowCanvasProps` grows a `controls` slot, `cardEnvironment`, and the live-edge inputs, so jsdom tests can assert lock gating, history availability, and card parity without React Flow. Pure modules are unit-tested directly. The browser lane keeps covering what jsdom cannot: two consecutive stage drags, wheel zoom, edge following, resize persistence, minimap panning, and the full-bleed geometry.

## Risks / Trade-offs

- **The board card inside a transformed surface** → the card's overlay click target, shadows, and text scale with the viewport like any node content; a browser test drags a card, opens it, and activates an action at a zoomed level, and the card keeps the board's DOM so no new hit-testing code is introduced.
- **Recomputing every edge on each pointer move** → edges are computed once per node change in the canvas, not per edge, and the edge component only draws; a browser test measures a drag on the reference diagram and the implementation keeps the per-frame work proportional to the edge count.
- **A resized stage changes the automatic placement inputs** → automatic placement keeps using measured sizes, and a resize never moves a stage; Organize remains the only action that reflows.
- **Text-range authoring of a second field can damage YAML** → `setStageSizes` shares the proven position writer and is covered for comments, flow-style columns, missing keys, and removal.
- **The sharing merge gains a second layout field** → size is excluded from `workflowMeaning` exactly like position, and the merge tests cover one-sided, both-sided, and unchanged sizes.
- **Removing the background chip hides information from sighted users** → the drawer's Conversations section entry keeps the count and labels on hover and to assistive technology; the card is intentionally quieter, and this is recorded as an accepted trade-off.
- **The advance action is hidden while a turn runs** → the action reappears when execution settles, so a card never offers a move that would race the run; the rule is derived from attention, not from a timer.
- **Orthogonal returning routes can cross a tall neighbour** → the returning clearances reuse the lowest-bottom gutter, and geometry tests assert the route stays below every stage's bottom.
- **Hover contact circles are pointer-only** → they are decorative reinforcements of the arrowhead, not the only indication of direction, and they do not change the edge's accessible surface.
- **The lock can hide the way to rearrange** → the control stack always shows the locked toggle with its tooltip, and unlocking is one click.

## Migration Plan

1. Domain first: `Column.size`, parser, schema, canonical/meaning, size authoring, and the sharing merge, all optional and backward compatible, with their unit tests. A released client can then read and merge a board that carries sizes.
2. Fix the drag lifecycle and extract the gesture modules; add the two-consecutive-drags regression to the browser lane.
3. Viewport policy and the React Flow configuration; update the navigation tests.
4. Live connections, orthogonal routing, and the hover contact circles.
5. Card parity: inject the card environment, delete the `FlowCard` projection, then the execution accent, the advance action, and the remembered presentation.
6. The control stack, the lock, the minimap, and the full-bleed surface.
7. Stage resizing last, because it depends on the layout saver and the history that the earlier steps stabilize.

Rollback: every step is independently revertible. A reverted UI leaves `size` as an inert authored key that the renderer ignores, and a reverted preference read ignores the stored key. No stored state needs conversion in either direction.

## Open Questions

- The exact pulse cadence, bar width, and control spacing are visual tuning during implementation; they do not change the approach or the specs.
- Whether the live edge recomputation needs a frame budget on very large diagrams is measurable during implementation; the spec only requires that edges follow a dragged stage, and the fallback of a cheaper live transform is an implementation detail.
