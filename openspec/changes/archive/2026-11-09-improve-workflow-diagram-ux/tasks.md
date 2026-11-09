# Tasks

## 1. Domain and persistence

- [x] 1.1 Add the optional stage size to the shared types and the workflow parser: a finite width and height within the fixed coordinate range and not below the accepted minimum, with an absent key meaning the minimum; verify with parser tests for valid, missing, non-finite, oversized, and below-minimum values.
- [x] 1.2 Extend the persisted workflow schema and its canonical comparison so a stage size is accepted, included in the stored workflow identity, and excluded from the workflow meaning used by sharing; verify with schema tests asserting that a size difference is not a meaning difference.
- [x] 1.3 Move the YAML map-field text helpers out of the position editor into a shared module and add `readStageSizes`/`setStageSizes` on top of them; verify with tests for comments, flow-style columns, a missing key, an existing key, and key removal, plus the existing position tests staying green.
- [x] 1.4 Extend the sharing merge so a stage size merges like a stage placement, including one-sided, both-sided, unchanged, and removed-stage cases; verify with sharing merge and host sharing tests.
- [x] 1.5 Add the pure size policy module (minimum, effective size from stored size and content, dragged-size clamping) and verify with unit tests for the floor, content growth, and clamping.

## 2. Drag lifecycle and gestures

- [x] 2.1 Extract the stage drag into a gesture controller with one dispose path that always releases the gesture, and make the canvas derive its guard from that controller; verify with a unit test that runs two consecutive gestures and a browser test that drags two stages one after another.
- [x] 2.2 Remove the dead drag-latch reference and the node-sync latch that never engages, and keep node synchronization driven by the committed stages; verify with typecheck and the existing stage-drag browser test.
- [x] 2.3 Add the stage resize gesture behind the same controller pattern, active only while the layout is unlocked, committing once on release through the layout save path; verify with unit tests for the clamp and a browser test that resizes a stage and observes one workflow save.

## 3. Viewport and live geometry

- [x] 3.1 Switch the canvas to React Flow's own gestures — wheel zoom at the pointer, background-drag pan, pinch zoom — and delete the Ctrl/Cmd wheel capture listener; verify with browser tests for wheel zoom, modifier zoom, and background-drag pan.
- [x] 3.2 Add the viewport policy module with the zoom bounds and the zoom-at-point math used by the control buttons, and verify it with unit tests.
- [x] 3.3 Replace the cubic connection builder with an orthogonal rounded path builder that also emits the sampled points, keeping the fan-out anchors and the returning gutter; verify with geometry tests for departure and arrival direction, rounded corners, fan-out spacing, and returning clearance below every stage.
- [x] 3.4 Add the live connection module that derives edge geometry from live node rectangles and the connection descriptors, and wire the canvas to recompute edges while a stage is dragged or resized; verify with unit tests and a browser test asserting the edge endpoints follow the drag.
- [x] 3.5 Draw the arrowhead and the hover-only contact circles in the edge component, with a pointer hit area that does not change the edge's accessible surface; verify with a browser hover test.

## 4. Card parity and the board card

- [x] 4.1 Inject the card environment from the board into the workflow view, render the board's card inside the stage region, and delete the reduced card projection and its styles; verify with client tests that a stage card presents the board regions and with a browser test that opens a task from the diagram.
- [x] 4.2 Move the auto-mode control into the card's activity region with the run and advance actions, keep the three on one row in the same pill style and height, remove the background activity chip, and keep the activity row's reserved height; verify with client render tests and with the browser appearance lane in light and dark.
- [x] 4.3 Add the advance action to the card using the next stage and the board's move path, hidden while the task is running and unavailable while busy or in selection mode; verify with client tests for visibility and dispatch and browser tests for a permitted, a restricted, and an instructed destination.
- [x] 4.4 Replace the working badge with the trailing execution accent bar, keep the reduced-motion and theme behavior, and delete the unused badge component and styles while keeping the assistive announcement; verify with updated running-status and appearance browser tests.
- [x] 4.5 Update every test that selects the removed card classes or the working badge to the shared card and the new accent; verify with `pnpm test` and `pnpm test:browser`.

## 5. Presentation preference

- [x] 5.1 Add the board-scoped presentation preference on top of the existing browser storage helpers and resolve the first presentation as the stored choice, then the board's configured default, then the column board; verify with client tests for the stored choice, the fallback, and a board switch.
- [x] 5.2 Stop resetting the presentation when the active board changes and write the choice on switch; verify with a client test that switching boards applies each board's own choice and with a browser reload test.

## 6. Diagram shell: controls, lock, minimap, full-bleed

- [x] 6.1 Add the bottom-left control stack with zoom in, zoom out, fit, undo, redo, organize, and the lock, each with a CSS tooltip and an accessible name, and remove the text toolbars; verify with browser tests for the order, the names, and the tooltips.
- [x] 6.2 Add the session layout lock, on by default, gating stage move, resize, organize, undo, and redo while leaving cards, pan, and zoom available; verify with browser tests for a blocked drag and a successful drag after unlocking, and with a reload test.
- [x] 6.3 Add the themed, always-visible, pannable minimap at the bottom-right and verify with a browser test that dragging inside it pans the diagram without sending a command.
- [x] 6.4 Make the diagram surface full-bleed by removing the page padding and the inner frame only for the flow presentation, keep the header and notices above it, and verify with a browser geometry assertion that the canvas reaches the presentation region's edges.

## 7. Cleanup and documentation

- [x] 7.1 Split the workflow view into its measurement, save-queue, history, travel, and lock hooks, leaving the view as a composition root, with the canvas owning the surface and no domain decisions; verify with typecheck and the full client suite staying green.
- [x] 7.2 Establish one source for the stage's default width and height so the stylesheet and the layout module cannot drift; verify with a unit test or a single exported constant referenced by both.
- [x] 7.3 Remove the now-unused background activity helpers and styles and confirm no dead references remain; verify with a repository search and typecheck.
- [x] 7.4 Update the README workflow and board documentation for the new diagram behavior, the stage size key, the remembered presentation, and the card changes; verify that the documented behavior matches the specs.

## 8. Verification

- [x] 8.1 Run `pnpm check` (host and client typechecks, vitest, build) and confirm it passes.
- [x] 8.2 Run `pnpm test:browser` and confirm every visual and interaction lane passes, including light and dark appearance evidence.
- [x] 8.3 Run the isolated composition lanes without touching the developer's profile: `--only board` passes; `--only auto-mode` fails identically on the base commit c656430 (`llm-replay: fixture not fully consumed`) and is recorded as an accepted baseline exception caused by the installed DSH checkout differing from the plugin's pinned version.
- [x] 8.4 Capture the light and dark screenshots and a short report under `.verification/`, bump the package version for the published artifact, and confirm `pnpm check` still passes.