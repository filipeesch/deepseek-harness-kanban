# Tasks

## 1. Authored connection layout in the workflow document

- [x] 1.1 Add `ConnectionAnchor`, `ConnectionSegment`, and `ConnectionLayout` to `src/shared/types.ts` and an optional `connections` array to `Workflow`; verify `pnpm typecheck` passes.
- [x] 1.2 Parse `connections` in `src/domain/workflow.ts`: add the document key, strict per-entry keys, `side` and `axis` enums, `at` as an integer in `0..4`, finite offsets within `STAGE_POSITION_LIMIT`, and rejection of a duplicated `from`/`to` pair; verify with new cases in `tests/domain/workflow.test.ts`, including an entry naming a stage the workflow does not contain still parsing.
- [x] 1.3 Add `readConnections` and `setConnections` in a new `src/domain/workflow-connections.ts`, keyed by source and target, mirroring `workflow-positions.ts`; verify with `tests/domain/connection-layout.test.ts` covering read, round-trip, and removal of an empty entry.
- [x] 1.4 Add a new sequence text-editing module that inserts, updates, and removes `connections` items while preserving comments, quoting, and key order, leaving `yaml-map-fields.ts` untouched; verify with a test asserting an authored document keeps its comments and its column block byte-for-byte outside the edited entry.
- [x] 1.5 Teach the writer to add the `connections` key when the document has none and to remove it when the last entry disappears; verify both transitions in the same test file.
- [x] 1.6 Include `connections` in `canonicalWorkflow` and exclude it from `workflowMeaning` in `src/domain/schema-parts.ts`; verify with `tests/domain/schema.test.ts` cases asserting two workflows differing only in connection layout share a meaning.
- [x] 1.7 Merge connection layout per pair in `src/domain/sharing/workflow-merge.ts`, generalizing the single-field merge over a key set instead of columns; verify with new cases in `tests/domain/sharing-workflow-merge.test.ts` for a team-only adjustment, a local-only adjustment, both sides on the same connection, and each side on a different connection.

## 2. Routing modules

- [x] 2.1 Add `src/client/workflow-view/routing/ports.ts` resolving an anchor to a point and an outward normal on a stage rectangle, plus the fan-out departure point for an automatic source; verify with `tests/client/routing-ports.test.ts` covering all four sides and every anchor index.
- [x] 2.2 Move the polyline-to-rounded-path conversion, the fixed path sampling, and the tip angle from `connections.ts` into `src/client/workflow-view/routing/orthogonal.ts` without changing the drawn output; verify the existing geometry expectations still pass in `tests/client/workflow-connections.test.ts`.
- [x] 2.3 Add `src/client/workflow-view/routing/route.ts` composing one connection from its anchors, its departure and arrival stubs, its free lines, and its authored offsets, and expose both the drawn shape and the ordered free lines; verify with `tests/client/routing-route.test.ts` for a forward route, a return below the stages, a route between overlapping stages, a mixed horizontal and vertical pair, and an authored anchor on each side.
- [x] 2.4 Apply an authored offset to the free line of the same axis and position, leaving a surplus offset dormant; verify with a test that changes the number of lines and asserts the surplus is neither applied nor dropped.
- [x] 2.5 Route `buildWorkflowScene` through `routing/route.ts` so the scene edge carries the authored shape; verify the scene test asserts the drawn path of an adjusted connection.
- [x] 2.6 Route the canvas's live edge computation through the same function; verify a test asserting that the committed shape and the live shape of one adjusted connection sample the same points while a stage is dragged.

## 3. Edge model extraction

- [x] 3.1 Add an edge-model module that computes the edge descriptors and their live geometry from stages, the connection layout, and the connection descriptors, and have `CanvasInner` consume it instead of computing edges inline; verify `tests/client/workflow-edge-model.test.ts` covers an empty diagram, an automatic connection, and an adjusted connection, and that `pnpm test:browser` still shows the connections.
- [x] 3.2 Keep stage dragging, resizing, panning, zooming, and the card drop indicator in the canvas and confirm nothing from the edge model is duplicated there; verify by reading the resulting `canvas.tsx` and running `pnpm typecheck`.

## 4. Generalized layout saver

- [x] 4.1 Introduce the layout-field port (read from a parsed workflow, hold values, write into authored text) and register position, size, and connection layout as three fields without changing the hook's exported names; verify `pnpm typecheck` and the existing placement-saving browser cases.
- [x] 4.2 Keep the concurrent-rebase rule per field so a pending connection adjustment survives an acknowledged rename or a position change from elsewhere; verify with a test asserting the rebased text keeps both the external change and the pending connection adjustment.
- [x] 4.3 Keep the rejection path resetting every field to the acknowledged workflow; verify with a test that a rejected save clears a pending connection adjustment and reports the error.
- [x] 4.4 Confirm one completed adjustment produces one `board.workflow.save` and that the flush on unmount sends a completed edit; verify in the browser lane by counting commands after a single gesture.

## 5. Layout history

- [x] 5.1 Extend the history step with optional before and after connection layouts and restore them together with positions and sizes; verify `tests/client/workflow-history.test.ts` for undo and redo of an adjustment and for a step that changes only connections.
- [x] 5.2 Keep card movement, navigation, an unconfirmed keyboard change, and a press without movement out of the history; verify with the existing exclusion cases plus an unconfirmed keyboard case.

## 6. Connection interaction

- [x] 6.1 Add `src/client/workflow-view/gestures/connection-drag.ts` reusing the existing pointer-events port, drag threshold, and zoom-corrected position helper, and covering an anchor drag and a segment drag; verify with `tests/client/connection-gesture.test.ts` for commit once, threshold, Escape, and `pointercancel`.
- [x] 6.2 Project a dragged anchor onto the stage rectangle perimeter and resolve the nearest of the twenty points; verify with a test asserting the resolution from points inside, outside, near a corner, and equidistant between two anchors.
- [x] 6.3 Move a dragged free line perpendicular to itself and keep the rest of the path orthogonal; verify with a test asserting the resulting polyline stays axis-aligned and that only that line's coordinate changed.
- [x] 6.4 Render a handle at each end and on each free line, revealed while the connection is pointed at or focused, and drawn only for the pointed stage while a gesture runs; verify in `tests/browser/workflow-view.spec.ts` that the marks appear on hover and are absent otherwise.
- [x] 6.5 Gate both gestures by the layout lock and show the marks without making them operable while locked; verify a browser case asserting no command is sent when an end is dragged while locked.

## 7. Keyboard and accessibility

- [x] 7.1 Make both ends of every connection focusable with a role and an accessible name naming the connection and the end, keeping React Flow's own edge focusability off; verify a browser case reaching an end by Tab and asserting its announced name.
- [x] 7.2 Move the focused end to the next or previous anchor in perimeter order with the arrow keys, commit on Enter, and revert on Escape or focus loss without storing; verify a browser case asserting no command until Enter and one command after it.
- [x] 7.3 Confirm focus leaves the diagram after the last card and the last connection end; verify the existing keyboard case is extended rather than duplicated.

## 8. Documentation and gates

- [x] 8.1 Extend the README's workflow diagram section with the authored `connections` entry, the twenty anchor points, the adjustable segments, the keyboard path, and the compatibility note that an older installation rejects a document containing the new key; verify the rendered section reads correctly.
- [x] 8.2 Cover each connection scenario where it is observable: the browser lane proves persisting one adjustment and coalescing it into one save, the locked diagram refusing an adjustment, keyboard confirm and cancel, restoring a stored layout on open, and ignoring an orphan entry; the domain lane proves the share-by-YAML merge, the rejection of a duplicated or invalid entry, and dormant offsets. Verify `pnpm test:browser` passes.
- [x] 8.3 Run `pnpm check` and `pnpm test:browser`; verify both pass, and that no acceptance check touched the developer's profile or board data.
- [x] 8.4 Bump `version` in `package.json` for the published artifact; verify the version is one that has not been released.
