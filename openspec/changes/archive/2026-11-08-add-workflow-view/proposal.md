# Proposal

## Why

The board presents a workflow as columns, so the configured shape — which stage leads where, and how many ways leave a stage — is visible only by opening a stage control or reading the YAML. A card's stage change also reads as a jump between lists rather than movement through a process. Add a second presentation of the same workflow: a node diagram with steps as rounded bubbles, configured transitions as connections, pan and zoom for a diagram larger than the board, and cards that travel the connection when they change stage.

## What Changes

- Add a **workflow view** for the active board: steps as rounded bubbles in a left-to-right layered diagram, connections derived from the configured transitions (solid for `allowed_transitions`, dashed for the implied next stage, none for an empty list), automatic layered layout, and manual node placement on top of it.
- Each bubble shows the stage title and a compact list of its cards, growing with its content. A card opens the existing task drawer when activated.
- Navigation follows a Figma-like model: wheel or two-finger scrolling pans, ctrl/cmd+wheel and pinch zoom at the pointer, dragging the background pans, and zoom buttons, fit-to-view, and keyboard shortcuts support the same surface.
- Node positions are board data: each column can carry `position: {x, y}` in the workflow YAML, saved at the end of a drag with a short debounce and by an explicit **Organize** action. A column without a position is placed automatically and stays stable for the session.
- Undo and redo cover node placement only — each drag and each Organize is one step — through Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, and buttons. Card movement is excluded because its effects, such as a created conversation, a worktree, or a sent instruction, cannot be reverted.
- Cards can be dragged between bubbles. The move follows exactly the board's rules: restricted-transition confirmation, first-execution preparation, and the timed stage instruction.
- With the workflow view open, a card that changes stage travels along the connection curve with a short fade at each end. A large batch and the reduced-motion preference settle immediately.
- A board's workflow YAML gains `default_view: board | workflow`. The view control in the board header switches the view for the session only; the YAML default applies on every reload.
- Publishing merges node positions automatically. A position-only difference never requires review, while a semantic change on both sides still does, and the authored workflow text of the side that changed the semantics survives the merge.
- Adopt React Flow (`@xyflow/react`) for the diagram surface and bundle its stylesheet into the plugin client.
- Include the structural adjustments the new surface depends on: split `board.tsx` into composed views, one source of truth for configured transitions, split `hub-view.ts` by responsibility, group the style modules, extract the workflow YAML parsing helpers, and index column grouping instead of scanning per column.

Existing workflow YAML without `default_view` or `position` stays valid and means "board view, automatically placed nodes". No persisted task data, command, or published-document shape becomes invalid, and the board view keeps its current behavior.

## Capabilities

### New Capabilities

- `workflow-view`: the diagram presentation of an active board's workflow — connection derivation, layered layout and manual placement, navigation, bubble contents, card interaction, movement animation, and placement undo.

### Modified Capabilities

- `kanban-board`: adds the `default_view` workflow setting and the board header's view control with its session-only lifetime.
- `hub-sharing`: team updates merge node positions automatically, and a position-only difference no longer counts as a change that requires review.

## Impact

- Domain: `src/domain/workflow.ts` (parse and validate `default_view` and per-column `position`), `src/domain/schema-parts.ts` (persisted schema and canonical form), a new `src/domain/workflow-graph.ts`, a new `src/domain/workflow-positions.ts`, a new `src/domain/sharing/workflow-merge.ts`, and `src/domain/sharing/plan.ts` (comparison and update plan).
- Client: a new `src/client/workflow-view/` module (layout, connections, scene, measurement, navigation, position history, card drag, travel motion, canvas, styles), `src/client/board.tsx` split into composed views, `src/client/page-state.ts` for the active view, `src/client/hub-view.ts` split by responsibility, and the style modules grouped.
- Build and dependencies: `@xyflow/react` becomes a runtime dependency, an esbuild CSS-text loader is added to `scripts/build.mjs` and `scripts/build-browser-harness.mjs`, a style-module declaration is added, `THIRD-PARTY-NOTICES.md` records the new package, and `package.json` receives the version bump for the published artifact.
- Sharing: the published document keeps the authored workflow text, now carrying positions; applying a merge writes the merged text locally and leaves the board as a draft until the next publication.
- Tools and storage: `get_board_summary`, `update_board`, and `edit_board_yaml` accept and expose the new keys through the authored YAML. No tool signature changes and no stored-state migration.
- Tests: pure unit coverage for the graph, layout, position editing, and merge; jsdom coverage for the view gates and the placement history; Playwright coverage for navigation, node placement, card drag, travel motion, and restored positions; host coverage for the sharing merge; README and workflow reference updates.
