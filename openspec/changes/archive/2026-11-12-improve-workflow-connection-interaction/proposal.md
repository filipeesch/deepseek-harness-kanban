# Proposal

## Why

Moving a stage sometimes drags connections that do not belong to it: every returning connection is routed below the lowest stage of the whole diagram, so lowering any stage shifts all of them, including routes the user already adjusted. The gestures that move a connection are also the least reliable in the diagram: the handles are painted under the stage regions, so half of each target is unreachable, the arrowhead covers the target handle, and the preview line a creation drag should draw never renders because it is an SVG group portaled into an HTML container.

## What Changes

- A returning or detouring connection is cleared only against the stages its own corridor crosses, so moving, resizing, or adding a stage outside that corridor no longer changes its drawn path or the displacements the user authored for it.
- The marks that move a connection move to an affordance layer that paints and hit-tests above the stage regions: about 24 screen pixels per target, no stage occlusion, and an arrowhead that no longer intercepts a press.
- Pointing at a connection reveals its marks; pressing one and dragging starts the gesture in one step; a press that never moves selects the connection, and a selected connection keeps its marks visible until another press clears the selection.
- Dragging an end over another stage marks that stage as the candidate destination with the same highlight the creation gesture already uses, before the release decides whether it re-points, re-owns, or re-anchors the connection.
- The preview of a connection being created is drawn again, in the affordance layer: a straight dashed line to the pointer, replaced by the real orthogonal route and its arrowhead while a candidate stage is under the pointer.
- The connection ports a stage reveals get a larger hit target and an adjusted appearance, so starting a connection is as easy as adjusting one.
- The edge component stops owning interaction: the affordance layer becomes its own module, and the edge draws the path, the arrowhead, the condition mark, and the exit labels only.

## Capabilities

### New Capabilities

None. The diagram, its gestures, and its connections already exist; this change alters their behavior.

### Modified Capabilities

- `workflow-view`: a returning connection's clearance follows the stages it crosses instead of every stage in the diagram; the affordance layer that carries the end handles, segment grips, hover, selection, candidate marking, and creation preview; and the creation ports' target size.

## Impact

- Code: `src/client/workflow-view/routing/` (corridor clearance and the single route composition), `edge-model.ts` and `scene.ts` (one shared composition), `connection-edge.tsx` (drawing only), a new affordance-layer component, `use/use-connection-gestures.ts` (hover, selection, candidate state), `stage-node.tsx` and `styles.ts` (ports and affordance styling).
- Specs: `workflow-view`.
- Docs: the README's workflow diagram section.
- Tests: the shared-clearance routing test changes thesis; the browser specs stop compensating for the occluded handles and gain target-size, paint-order, selection, candidate, and creation-preview cases.
- Data: no migration. The workflow document, its parser, the sharing merge, and every stored connection layout keep their current form; only where the diagram draws a returning route changes.
- Compatibility: none. A build without this change reads and writes the same documents.
- Dependencies: none added.
