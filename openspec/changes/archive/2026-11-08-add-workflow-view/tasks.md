# Tasks

## 1. Workflow configuration fields

- [x] 1.1 Extract the YAML field helpers (`record`, `keys`, `text`, `id`, `ids`) from `src/domain/workflow.ts` into `src/domain/yaml-fields.ts` and verify the existing workflow tests stay green.
- [x] 1.2 Accept `default_view` on the workflow root and `position` on each column in `parseWorkflow`, validating the enum and finite coordinates within the accepted range, and verify with `tests/domain/workflow.test.ts` covering absent, valid, and invalid values.
- [x] 1.3 Extend the persisted workflow schema and `canonicalWorkflow` in `src/domain/schema-parts.ts`, and verify `tests/domain/schema.test.ts` accepts old YAML without the new keys and rejects an invalid view or position.
- [x] 1.4 Update the workflow editor hint and the diagnostics path for the new keys, and verify a workflow with an invalid view or position shows a validation issue and cannot be saved.

## 2. Transition source of truth and graph

- [x] 2.1 Add `authoredTransitions` to `src/domain/transitions.ts` and implement `transitionAccess` through it, verifying `tests/domain/transitions.test.ts` covers omitted, explicit, empty, self, and unknown targets.
- [x] 2.2 Add `src/domain/workflow-graph.ts` producing stage nodes and connections with their kinds, fan-out indexes, and returning flag, and verify `tests/domain/workflow-graph.test.ts` covers explicit, implicit-next, empty list, self target, returning target, grouped stages, and a single stage.

## 3. Stage placement editing and sharing merge

- [x] 3.1 Add `src/domain/workflow-positions.ts` with `readStagePositions` and `setStagePositions` using the `yaml` Document API, and verify `tests/domain/workflow-positions.test.ts` preserves comments, quoted keys, block scalars, flow-style columns, missing positions, and position removal.
- [x] 3.2 Add `src/domain/sharing/workflow-merge.ts` with the meaning comparison and per-stage merge, and verify `tests/domain/sharing-workflow-merge.test.ts` covers meaning-equal, one-side-meaning, both-meanings, placement-only, same-stage conflict, and authored-text selection.
- [x] 3.3 Integrate the merge into `compareSharing` and `buildUpdatePlan` so a merged board is `updates-available` with a resolved workflow text, and verify the new `tests/domain/sharing-plan.test.ts` covers classification, resolved text, and `nextBase`.
- [x] 3.4 Verify the host applies a merged update through `tests/host/sharing-placement-merge.test.ts`: the merged text is stored, the board becomes a draft, the published document stays the base, and orphan-column blockers still refuse the whole application.

## 4. Build plumbing for the diagram dependency

- [x] 4.1 Add `@xyflow/react` to `package.json` and install it, verifying the lockfile and `pnpm install` succeed.
- [x] 4.2 Add an esbuild CSS-text loader to `scripts/build.mjs` and `scripts/build-browser-harness.mjs` plus a `*.css` module declaration for the typecheck, and verify `pnpm typecheck` and `pnpm build` succeed.
- [x] 4.3 Mount the diagram stylesheet with the plugin styles and record the package in `THIRD-PARTY-NOTICES.md`, and verify the built client loads with the diagram styled and React Flow's attribution still visible.
- [x] 4.4 Measure the client bundle before and after the dependency and record the result in the verification notes under `.verification/`.

## 5. Structural adjustments

- [x] 5.1 Split `src/client/board.tsx` into a composition root, `board-header`, `board-notices`, `board-columns-view`, and the existing dialogs module, and verify `tests/client/board.test.tsx` and `tests/browser/board-layout.spec.ts` stay green.
- [x] 5.2 Split `src/client/hub-view.ts` into active-scope storage, snapshot normalization, command scoping, and board projection, and verify `tests/client/hub-view.test.ts` and `tests/client/hub-navigation.test.tsx` stay green.
- [x] 5.3 Move the style modules under `src/client/styles/` with one aggregator and verify the style contract tests and `tests/browser/appearance.spec.ts` stay green.
- [x] 5.4 Replace the repeated scans in `columnLayout` with column and group indexes, and verify `tests/client/board-columns.test.ts` keeps its grouping and order cases.

## 6. Diagram decision modules

- [x] 6.1 Add `src/client/workflow-view/layout.ts` with layered placement over forward connections, ordering by workflow index, and grouped adjacency, and verify `tests/client/workflow-layout.test.ts`.
- [x] 6.2 Add `src/client/workflow-view/connections.ts` producing a path string and a sampled polyline with fan-out offsets and a returning route, and verify `tests/client/workflow-connections.test.ts`.
- [x] 6.3 Add `src/client/workflow-view/scene.ts` building nodes, connections, visible cards, and bounds from the workflow, tasks, placements, and measurements, and verify `tests/client/workflow-scene.test.ts` including search and project filtering.
- [x] 6.4 Add `src/client/workflow-view/placement.ts` for position maps, stage skipping, and frozen automatic placement, and verify `tests/client/workflow-placement.test.ts`.

## 7. Diagram canvas, navigation, and placement

- [x] 7.1 Add the canvas with controlled nodes, a custom stage node listing its cards, and a custom connection edge, and verify `tests/client/workflow-view.test.tsx` renders stages, cards, and the empty and single-stage cases.
- [x] 7.2 Implement the two-phase first paint and verify the browser test observes one revealed placement with no stage jump.
- [x] 7.3 Wire wheel pan, ctrl/cmd zoom, pinch zoom, background drag, zoom buttons, fit-to-view, and the zoom bounds, and verify `tests/browser/workflow-view.spec.ts` covers each gesture and that a pan or zoom sends no command.
- [x] 7.4 Bind stage movement to the stage header and save the position with the 400 ms debounce, and verify a browser drag produces exactly one workflow save, restores the position after reload, and changes no other stage.
- [x] 7.5 Implement Organize writing every stage's placement and verify a browser Organize stores all positions and reorders the diagram.
- [x] 7.6 Add the presentation switch to the board header reading `default_view`, and verify `tests/client/board.test.tsx` covers the default, the switch, the reload reset, a board switch, and no data change.
- [x] 7.7 Make stage regions labelled, cards keyboard reachable and activatable, and the controls named, and verify the browser lane asserts the tab order, the labels, and leaving the diagram by keyboard.

## 8. Card drag, travel, and placement history

- [x] 8.1 Generalize `src/client/useCardDrag.ts` with an injected drop-target resolver, keep the board resolver, and verify the existing drag tests stay green plus a resolver unit test.
- [x] 8.2 Add the diagram card drag through the same move pipeline and verify `tests/client/card-drag.test.ts` and the browser lane cover a permitted drop, a restricted confirmation, a first-execution preparation, an instructed stage, a same-stage reorder, the optimistic placement, and a revert on failure.
- [x] 8.3 Add the travel plan and travel layer using the connection polyline with the shared animation port, and verify `tests/client/workflow-travel.test.ts` covers along-connection, direct path, same-stage, batch, and reduced motion plus the browser travel scenario.
- [x] 8.4 Add the placement history with Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, and buttons, and verify `tests/client/workflow-history.test.ts` and the browser lane cover drag undo, Organize as one step, redo, exclusions, reload clearing, board isolation, pending-save cancellation, and disabled controls.

## 9. Documentation, release, and verification

- [x] 9.1 Update the README behavior section and the workflow YAML reference with `default_view`, `position`, the diagram, navigation, undo, and the sharing merge, and verify the documented keys match the parser.
- [x] 9.2 Bump `package.json` for the published artifact and verify the version is unused by an existing tag.
- [x] 9.3 Run `pnpm check` (host and client typechecks, vitest, build) and record the result.
- [x] 9.4 Run `pnpm test:browser` and record the result with light and dark screenshots under `.verification/`.
- [x] 9.5 Run the isolated real-composition board lane (`node scripts/e2e-dsh.mjs --only board`) and confirm the presentation switch and the board presentation are unaffected.
