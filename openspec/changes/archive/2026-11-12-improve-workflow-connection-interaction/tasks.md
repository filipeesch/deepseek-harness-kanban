# Tasks

## 1. Corridor clearance

- [x] 1.1 Add `routing/clearance.ts` with the corridor and floor functions from design D1, and verify with vitest that a stage outside the corridor is ignored, a stage intersecting it raises the floor, and a stage containing either leg is counted
- [x] 1.2 Change `routing/route.ts` and `routing/automatic.ts` to accept the stage rectangles instead of a numeric clearance and derive the corridor floor from the departure and arrival points, and verify the routing suites pass with the returning, reversed, and anchored cases
- [x] 1.3 Pass the live stage rectangles from `edge-model.connectionRouteFor` and the stored rectangles from `scene.buildWorkflowScene`, remove `lowestStageBottom` when it is unused, and verify a vitest case proves both compositions draw the same route
- [x] 1.4 Replace the shared-clearance test with corridor tests: moving, resizing, or adding a stage the corridor does not cross leaves the drawn path, the clearance, and the authored displacements unchanged, and verify with `pnpm vitest run tests/client/routing-automatic.test.ts tests/client/workflow-connections.test.ts tests/client/workflow-edge-model.test.ts`

## 2. Affordance layer and targets

- [x] 2.1 Add `affordance-geometry.ts` with the visible mark size, the 24 screen-pixel pointer target, the port target, the hover linger, and the zoom scale helper, and verify a vitest case covers the scale at the minimum, default, and maximum zoom
- [x] 2.2 Extract `connection-affordances.tsx` from `connection-edge.tsx`, leaving the edge drawing only the path, arrowhead, condition mark, and exit label, and verify the edge group renders no handle while the layer renders one handle per end and one grip per adjustable segment
- [x] 2.3 Mount the layer in `canvas.tsx` inside `ViewportPortal` above the nodes and feed it the live edge model and the connection handlers, and verify in the browser harness that `document.elementFromPoint` at a handle centre returns the handle at the minimum, default, and maximum zoom
- [x] 2.4 Give the arrowhead `pointer-events: none` and add the layer, handle, grip, and port styles, and verify a browser case starts an adjustment from a press on the arrow tip while the arrowhead is still painted
- [x] 2.5 Keep both ends focusable with their accessible names in the layer, and verify the existing keyboard and focus cases still pass with focus able to leave the diagram

## 3. Hover, selection, and press semantics

- [x] 3.1 Add `use/use-connection-hover.ts` with a pure linger policy and its timer, and verify a vitest case covers a leave followed by an enter inside the linger, and a leave with no return
- [x] 3.2 Publish hover from the edge group and from the layer's shapes through the connection handler context, and verify the marks are presented while pointed at and absent while neither pointed at nor selected
- [x] 3.3 Make a press that never moves select the connection in both the end and segment gestures while still storing nothing, and verify the press-without-move case reports the selection and adds no history entry
- [x] 3.4 Keep a selected connection's marks presented and operable and clear them on a press on a stage or the empty surface, and verify the browser selection and clear-elsewhere cases
- [x] 3.5 Mark the layer's interactive groups with `data-connection-mark` so the canvas's press-outside check does not clear the selection the same press is starting, and verify pressing a handle keeps the connection selected

## 4. Candidate destination marking

- [x] 4.1 Generalize the gesture candidate so the end gesture reports the stage a release would re-point or re-own, resolved through `candidateStageFor` over `decideEndDrop`, and verify a vitest case asserts the marked stage and the unmarked ones
- [x] 4.2 Clear the candidate when the pointer leaves that stage or the gesture ends, and verify the browser case shows the stage highlighted during the drag and unhighlighted after moving off it

## 5. Creation preview and ports

- [x] 5.1 Remove the broken `CreationPreview` portal and compute the creation preview in the gesture controller — a straight line to the pointer, and the real route with its arrowhead over a candidate stage — and verify a vitest case covers a forward and a returning candidate
- [x] 5.2 Draw the preview in the affordance layer together with the candidate highlight, and verify the browser cases show the line during the drag and the route preview over a candidate
- [x] 5.3 Draw the creation ports in the affordance layer just outside the stage boundary with a 24 screen-pixel pointer target, and verify a browser test shows each target and that a press on a nearby card still opens the card

## 6. Documentation and verification

- [x] 6.1 Update the README's workflow diagram section to describe the corridor clearance, the affordance layer, selection, the candidate mark, and the creation preview, and verify each statement against the spec delta
- [x] 6.2 Run `pnpm check` and fix every typecheck, vitest, and build regression it reports
- [x] 6.3 Run `pnpm test:browser` and capture the hand and preview evidence under `.verification/` in both host appearances, and verify every connection case passes and the handles paint above the stages in the screenshots
- [x] 6.4 Run the isolated real-composition lane when end-to-end evidence is needed, verify it uses a throwaway `DSH_HOME`, and remove that home and stop the background instance afterwards
