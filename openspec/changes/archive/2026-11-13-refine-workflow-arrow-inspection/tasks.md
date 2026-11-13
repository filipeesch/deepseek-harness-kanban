# Tasks

## 1. Connection mode policy

- [x] 1.1 Add `src/client/workflow-view/connection-mode.ts` with the `inspect` and `edit` modes, the derivation from the layout lock, and the predicates the edge, the affordance layer, and the gestures consume; verify `tests/client/connection-mode.test.ts` covers both modes for hover-only, selected-only, and neither.
- [x] 1.2 Replace the `locked` input of `src/client/workflow-view/connection-interaction.ts` with `mode`, and gate every gesture in `use/use-connection-gestures.ts` through the policy; verify `pnpm typecheck` passes and the existing gesture suites (`tests/client/connection-gesture.test.ts`, `tests/client/connection-target.test.ts`) stay green.
- [x] 1.3 Derive the mode once in `workflow-view/canvas.tsx`, publish it in the `ConnectionHandlers` context, pass it to the gestures and the affordance layer, and replace the canvas `data-locked` attribute with `data-mode`; verify a browser assertion reads `data-mode="inspect"` on open and `data-mode="edit"` after unlocking.

## 2. Arrow selection and marks

- [x] 2.1 In `workflow-view/connection-edge.tsx`, select on every press regardless of mode, open the condition editor and draw the condition ring only in the editable mode, and attach the hover handlers only in the editable mode; verify a locked press selects exactly one edge and sends no command, and a locked double press opens no editor.
- [x] 2.2 In `workflow-view/connection-affordances.tsx`, drop the `locked` prop and read the mode from the handlers, reveal a connection's wrapper only when the policy presents its marks, keep the end handles rendered and focusable in both modes, select on focus only while inspecting, and present the ports and the creation preview only while editing; verify hovering a locked arrow reveals no wrapper while its handles stay focusable.
- [x] 2.3 In `workflow-view/workflow-view.tsx` and `workflow-view/canvas.tsx`, keep the selection across a lock toggle and across a press on the control stack or the minimap, gate `openCondition` on the mode, and close an open condition editor (clearing its error) when the lock turns on; verify the editor closes on lock with no command and the selection survives the toggle and a zoom-control press.
- [x] 2.4 In `workflow-view/condition-popover.tsx`, remove the lock prop and its delete gating now that the editor exists only while editing; verify no reference to the removed prop remains and the editor's existing browser cases pass.

## 3. Selected route above the stage regions

- [x] 3.1 Move the creation preview's box computation into `workflow-view/affordance-geometry.ts` as a shared `diagramBox(points, padding)` and use it from the preview; verify a unit test covers a straight route, a returning route, and an empty point list.
- [x] 3.2 Add `workflow-view/selected-route.tsx` that draws the selected connection's path and arrowhead in the affordance layer, keeps the dashed pattern of an implicit connection, uses the selected paint, and stays inert and hidden from assistive technology; verify a browser case presents it for a selected locked connection and removes it when the selection clears.
- [x] 3.3 Compose the selected route in the canvas viewport portal beneath the marks, from the same live edge the edge layer draws; verify it follows a zoom and stays over the drawn path, and that a press through it reaches the stage below and clears the selection.

## 4. Diagram styles

- [x] 4.1 Scope the mark reveal in `workflow-view/styles.ts` to the editable mode and remove the lock rules for handles and grips; verify a focused handle under the lock reveals nothing, while unlocking reveals the selected connection's marks.
- [x] 4.2 Add the hover emphasis for a drawn connection and the selected-route stroke rules; verify the computed stroke changes on hover in both schemes, the selected route matches the selected edge's paint, and the host theme contrast assertion passes.

## 5. Documentation

- [x] 5.1 Update the README's workflow diagram paragraphs to state that marks appear only while the layout is unlocked, that a locked arrow is selected for reading and draws above the stage regions, that hover emphasizes the stroke, and that the lock now refuses condition editing and closes an open editor; verify each statement matches the delta spec.

## 6. Browser coverage and evidence

- [x] 6.1 Rewrite the locked cases of `tests/browser/workflow-view.spec.ts`: hovering a locked arrow presents no mark, pressing a handle position starts no adjustment, and focusing a handle selects the arrow; verify the suite passes and stores its screenshots.
- [x] 6.2 Rewrite `tests/browser/workflow-connections.spec.ts`: a locked press selects for reading, deletion stays refused with the selection kept, and an authored condition no longer opens while locked; verify the suite passes and the former "editable while locked" case is gone.
- [x] 6.3 Add inspection cases for the elevated route over a stage, the implicit dash, the zoom follow, the clear on a stage press, and the keep-on-unlock; verify with Playwright screenshots in `.verification/`.

## 7. Gates and delivery

- [x] 7.1 Bump `version` in `package.json` for the installed artifact; verify `pnpm build` completes and the built bundle reports the new version.
- [x] 7.2 Run `pnpm check`; verify the host and client typechecks, the vitest suites, and the build all pass.
- [x] 7.3 Run `pnpm test:browser`; verify the plugin-owned Playwright lane passes and its appearance screenshots are stored under `.verification/`.
- [x] 7.4 Run `openspec validate refine-workflow-arrow-inspection --strict`; verify it reports the change as valid.
- [x] 7.5 When a built DSH checkout is available, run `node scripts/e2e-dsh.mjs --checkout <checkout> --only board`; verify the diagram renders in the real composition and record the checkout version the runner reports. (Not run: the DSH checkout on this machine has no built packages, and the plugin-owned browser lane is the prescribed acceptance lane.)