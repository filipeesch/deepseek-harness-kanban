# Design

## Context

See `proposal.md` for motivation and `specs/workflow-view/spec.md` for the required behavior.

- The diagram derives every drawn edge from the live stage rectangles in `canvas.tsx`, and the committed scene used by the card travel derives its own edges from the stored placements in `scene.ts`. Both compose a route through `routing/route.ts`, and both currently pass `lowestStageBottom()` — one number computed over every stage — as the route's clearance. `routing/automatic.ts` turns that number into `floor = max(start.y, end.y, clearance) + RETURNING_DEPTH` for a returning or reversed route.
- Connection layouts are stored as anchors plus per-axis displacements relative to the automatic route; the parser, the writers, the sharing merge, and the undo history already handle them. This change does not alter any of that.
- React Flow paints the edge SVG below the stage nodes, and a stage clips its own overflow. The current handles live inside the edge group: an end handle draws a 7px circle with a 20px invisible hit circle, and the target handle sits under the 10x9px arrowhead polygon, which is painted after it and still receives pointer events. The browser suite compensates by pressing 4px outside the stage box.
- Interaction state is currently implicit: hover is CSS `:hover` on the edge, and selection is a prop the view already owns. The edge component both draws and hosts the gesture targets.
- Overlays already render inside the viewport through `ViewportPortal`: the card travel is an absolutely positioned `div` with `z-index: 8`, and the canvas publishes a mark scale custom property for zoom-independent marks.
- The creation preview exists but never paints: `canvas.tsx` portals an SVG `<g>` into the viewport's HTML `div`, so React creates it in the HTML namespace and the browser renders nothing.
- Verification is split: pure geometry and policy run under vitest, and rendered behavior runs in the plugin-owned Playwright harness against the theme fixture and the isolated real-composition lane.

## Goals / Non-Goals

**Goals:**

- One owner for the clearance rule, used by both the live drawing and the committed scene, so the drawn path and the card travel cannot disagree.
- One owner for the connection affordances, separate from the edge drawing, painting and hit-testing above the stage regions while the path stays below them.
- An explicit hover/selection model that survives the pointer moving between the line and its handles, without changing the lock, history, keyboard, or write contracts.
- A creation preview that shows the gesture truthfully, including the route a release would author.
- Keep the persisted document, its parser, and the sharing merge untouched.

**Non-Goals:**

- New gestures: dragging the line itself, smart guides, keyboard nudging of segments, visible anchor dots, a contextual toolbar, and a reset-route action are out of scope.
- Storing absolute route geometry; displacements stay relative to the automatic route.
- Unifying the whole route composition between `edge-model.ts` and `scene.ts`; only the clearance rule becomes shared.
- Splitting `use-connection-gestures.ts` per gesture, splitting the connection handler interfaces, or replacing React Flow.
- Multi-select of connections, and any change to how connections are authored, re-pointed, re-owned, deleted, or conditioned.

## Decisions

### D1. Clearance is computed from the route's own corridor

`routing/route.ts` stops accepting a numeric `clearance` and accepts the stage rectangles the route could clear (`clearanceStages`). `bottomPoints` derives the corridor from the departure and arrival points it already computes — `[min(start.x, end.x), max(start.x, end.x)]` — and asks a new pure module, `routing/clearance.ts`, for the floor:

- a stage counts when its horizontal range intersects the corridor (`stage.x < maxX && stage.x + stage.width > minX`);
- the floor is `max(start.y, end.y, bottom of every counted stage) + RETURNING_DEPTH`;
- the two vertical legs are covered by the same test, because each leg sits at a corridor endpoint and any stage containing that endpoint overlaps the corridor;
- an authored horizontal displacement moves the route's legs, so the corridor is the horizontal extent of the displaced polyline, not the automatic one. The router rebuilds from that corridor (a fixed point after at most a couple of passes, since a new floor moves the horizontal runs and never the displaced legs), so a stage beside the automatic gutter that the drawn route no longer reaches cannot move it;
- a segment drag starts from the drawn line's coordinate minus the displacement it would replace (`baselineCoordinateOf`), not from a route rebuilt without offsets. Otherwise a displacement on the other axis that moves the floor would make the dragged line jump by the floor difference.

`edge-model.connectionRouteFor` and `scene.buildWorkflowScene` pass the live and stored stage rectangles respectively and stop computing `lowestStageBottom()`. Both keep their current composition; only the clearance rule becomes shared. The corridor is a pure function of the two end rectangles, the stage rectangles, the fan-out, and the authored displacements, so the live path, the committed path, and the drag baseline keep agreeing.

Rejected alternatives: keeping the global floor and only skipping stages that do not overlap (equivalent to this fix, but expressed inside the caller and duplicated); routing around an encountered stage instead of below it, which adds obstacle search to a diagram whose idiom is a gutter below the crossed stages; and clearing only the connection's own two stages, which lets a returning route cross a third stage's cards and contradicts the spec's guarantee.

### D2. The affordances move to a layer above the stage regions

A new `connection-affordances.tsx` renders inside `ViewportPortal`, above the React Flow nodes and below the travel overlay, as one absolutely positioned `svg` in diagram coordinates with `overflow: visible`, `pointer-events: none`, and per-shape `pointer-events: all`. It draws:

- one handle per end, and one grip per adjustable segment, each with a visible mark scaled by `1/zoom` and a transparent hittable shape sized in screen pixels;
- the creation preview described in D5;
- the four creation ports of the stage the pointer is on, each drawn at a stage boundary point;
- the selected connection's focus ring, if the path's own selected style is not enough at low zoom.

`connection-edge.tsx` keeps the path, the arrowhead, the condition mark, and the exit label, and loses the end circles, the hit circles, and the segment rectangles. It still owns the press that selects a connection and the double press that edits its condition, because the line remains the press target below the stages. The arrowhead gains `pointer-events: none`, so the target handle is never blocked by it.

The marks exist in the DOM for every drawn connection at all times, hidden and inert unless the connection is pointed at, selected, or focused; that is what keeps both ends reachable by keyboard without pointing at the line first. The layer's interactive groups carry `data-connection-mark` (and `data-end` or `data-line`), which the canvas's "press outside a connection clears the selection" check also accepts; a locked diagram presents the marks but makes them inert.

Rejected alternatives: raising the edge SVG above the nodes, which would paint every path over the card lists; enlarging the hit circles in place, which cannot fix the half of each target covered by the stage; and drawing the handles in a fixed overlay in screen coordinates, which would have to re-project on every pan and zoom frame.

### D3. Handle targets are sized in screen pixels

`affordance-geometry.ts` owns the numbers: a 10px visible mark, a 24px pointer target for handles, grips, and ports, and the hover linger. Shapes are scaled by `1/zoom` inside the viewport (the same technique the existing marks use), so a target keeps its size at every zoom level the diagram allows.

The visible mark is authored in screen pixels and counter-scaled as a whole, so its border, shadow, and focus ring render at the same screen thickness as its size at every zoom level; only the transparent pointer target is sized separately.

The creation ports also move into the layer, at the middle of each side of the hovered stage. Inside the stage node a 24px target cannot be both complete and clear of the header's drag surface: the stage clips its overflow, so a target centred on the boundary loses half of itself, and one moved fully inside overlaps the header a drag starts from. In the layer the target is complete above the stage and only reaches 12px into it, below the header's centre. The stage reports `pointerenter`/`pointerleave` so the layer knows which stage to present, and the same linger keeps the ports presented while the pointer crosses from the stage onto a port.

Rejected alternatives: keeping the ports inside the stage, which forces the target under the header or clipped; revealing every stage's ports at once, which pollutes the diagram and adds hit targets under every card; and scaling targets with the diagram, which is what makes them unusable when zoomed out.

### D4. Hover is explicit state with a short linger; selection persists

The canvas owns `hoveredConnectionId` next to the selection it already owns, and publishes it through the connection handler context. The edge group reports `pointerenter`/`pointerleave` instead of relying on CSS `:hover`; the affordance layer reports the same for its own shapes. Marks are presented while a connection is pointed at or selected.

Moving from the line to a handle crosses a DOM boundary: the edge's `pointerleave` fires before the handle's `pointerenter`. A small pure policy (in `affordance-geometry.ts` or a sibling module) delays clearing the hover by roughly 180ms, and an entering handle cancels the pending clear. The policy is a pure function over "hover started", "hover left", and "affinity regained", so it is asserted without a browser; the browser lane asserts that the marks do not flicker along a pointer path from the line to a handle.

A press on a handle starts the gesture immediately. The existing `connection-drag` controller already tells a completed gesture from a press that never passed the movement threshold; the anchor and segment gestures use that distinction to select the connection when the press did not move, and to keep the current "press without moving stores nothing" behavior otherwise. Selection is still cleared by a press on a stage or the empty surface.

Rejected alternatives: keeping hover in CSS and making the handles always hit-testable while invisible, which would block presses on the stage boundary; and requiring a selection before any handle is operable, which adds a step to the gesture the user is trying to make easier.

### D5. The creation preview is drawn in the layer and becomes truthful

The broken `<g>`-in-a-`div` preview is deleted. The creation gesture keeps its existing state (`from`, pointer `to`, candidate stage) and gains a second representation for the candidate:

- with no candidate stage under the pointer, the layer draws a dashed straight line from the port to the pointer;
- with a candidate stage, it draws the route the created connection would be drawn with, using the same `connectionRoute` as the committed drawing: source rectangle, candidate rectangle, `returning` from workflow order, the source anchor for the drawn side when that side differs from the automatic departure, and a fan-out that approximates the destination set after creation (the current outgoing count, plus one when the source already authors a destination list). The layer also draws that route's arrowhead, and the candidate stage keeps the existing `data-connect-candidate` highlight.

The candidate mark, the preview, and the release share one eligibility rule (`creationCandidateFor`): another stage the source does not already author as an exact destination. A stage that already authors the destination is not a candidate, so the gesture keeps the plain pointer line and never promises an edit the release refuses; the default dashed path, which is drawn but authored nowhere, remains a candidate because the release turns it into an authored destination.

The preview can differ from the settled route by a fan-out slot; the authored connection is presented immediately through the existing transition override, so the real route replaces the preview when the gesture completes. The browser lane asserts the preview is present during the drag and that its path equals the settled route's path for a single-destination case on a diagram whose stages have stored placements, so the structural edit cannot re-lay-out the diagram and move the stages out from under the comparison.

Rejected alternatives: rendering the preview as a DOM line, which cannot show the orthogonal route or the arrowhead; and deferring the preview until release, which leaves the gesture with no feedback.

### D6. Candidate marking is one state shared by both connection gestures

`use-connection-gestures` already returns the `candidateStageId` the stage node consumes. That value becomes "the stage the active connection gesture would act on": the creation gesture keeps its current rule, and the end gesture sets it when the pointer is over a stage the release would re-point or re-own, resolved through the existing `decideEndDrop` so a stage where the release means nothing is never marked. `stage-node.tsx` and the existing highlight style stay unchanged.

### D7. One small owner per new concern

- `routing/clearance.ts`: corridor and floor, pure.
- `connection-affordances.tsx`: the layer, a renderer over a model.
- `affordance-geometry.ts`: sizes, linger, and scaling helpers shared by the layer, the ports, and the styles.
- `use/use-connection-hover.ts`: the hover state and the linger timer, with the policy pure and separate.
- `use-connection-gestures.ts`: unchanged in shape; it gains the preview route, the candidate from the end gesture, and the select-on-press-without-move branch.
- `canvas.tsx`: mounts the layer, owns the hover state, and drops the broken preview.

The broader extractions discussed during exploration (splitting the gesture hook, splitting the handler interfaces, unifying the route composition) are deliberately not part of this change.

### D8. Verification follows the existing two lanes

- vitest: corridor clearance geometry (a stage outside the corridor does not move the route; a stage inside it raises the floor), the shared live/committed clearance, the hover policy, the affordance geometry, and the creation-preview route.
- Playwright harness: handle targets at minimum/default/maximum zoom via `elementFromPoint` at the handle centre; a press on the boundary and on the arrow tip starting the adjustment; marks persisting after selection and clearing outside it; the candidate highlight during an end drag; the creation line and route preview; screenshots in both host appearances.
- The isolated real-composition lane is used only if the appearance change needs end-to-end evidence; it never touches the owner's profile.

## Risks / Trade-offs

- **Different returning routes can sit at different depths** → arrows that share a corridor still share a floor, and the spec now states the corridor rule; screenshots in the browser lane record the result.
- **The affordance layer could swallow presses meant for cards** → only the marks and the hovered stage's ports are hit-testable, never a band along a path; browser tests press a card near a port and a line crossing a stage.
- **Hover flicker when the pointer crosses from the line to a handle** → the linger policy plus a browser test that traces the pointer path and asserts the marks stay presented.
- **The layer can drift from the drawn path** → both read the same edge model, and a browser test asserts handle centres equal the drawn path's endpoints and line midpoints.
- **The preview can differ from the settled route** → the preview approximates the fan-out only; the created connection replaces it immediately, and the browser lane asserts the single-destination case matches exactly.
- **Accessibility order changes because the marks move to the layer** → the marks keep their roles, labels, and focus behavior, and the existing keyboard and focus tests are kept green.
- **Ports take a 24px target straddling the stage boundary** → they are only present while the layout is unlocked and the stage is pointed at, and only 12px of the target reaches into the stage; a browser test confirms the four targets and a card press next to one.

## Migration Plan

No data migration and no stored-format change. Deployment is a client build; rollback is a revert of the change, and a board drawn by either build stores the same document. The only persistent difference is where a returning route is drawn.
