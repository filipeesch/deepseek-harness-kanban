# Design

## Context

See [proposal.md](proposal.md) for the motivation and the capability deltas for the behavior contract.

Facts that shape the approach:

- A board owns authored workflow YAML and its parsed form (`Board.workflowYaml` and `Board.workflow`). `parseWorkflow` rejects unknown keys, and `BoardStateSchema` re-parses the YAML and compares it with the canonical workflow, so every new key needs parser, schema, and canonical support.
- Transition semantics already live in `src/domain/transitions.ts`: an omitted `allowed_transitions` allows any stage, an empty list allows none, and `transitionAccess` classifies a move as reorder, allowed, or restricted.
- The board already projects its rendered order as data (`src/client/board-columns.ts`) and animates keyed movement in a single frame (`src/client/card-motion/`), sharing `prefersReducedMotion()` and a `MotionTiming` value. That separation — pure decision, DOM port, thin React frame — is the precedent the diagram follows.
- Moves converge on one pipeline: `useBoardMoves` → `useMoveRequest` applies an optimistic placement and runs the command, and it already covers restricted confirmation, first-execution preparation, and the timed stage instruction.
- The client is one esbuild CJS bundle with React external and no CSS loader; the browser test harness is a second esbuild bundle. Styles are authored as scoped CSS strings.
- The published document stores each board's workflow text verbatim. `compareSharing` compares that text exactly, and `buildUpdatePlan` copies the published text into the apply list.
- The board frame (`.dsh-kanban`) is a flex column with its own scrolling page body; the task drawer is an overlay inside that frame.

## Goals / Non-Goals

**Goals:**

- One pure domain model for what the workflow draws: nodes, connections, and their kinds, derived from the authored configuration.
- A single seam for editing stage positions in authored YAML, reused by the drag save, Organize, undo, and the sharing merge.
- A diagram whose rendering, measurement, and navigation come from one dependency, while every decision that matters (layout, connections, travel, history, merge) stays pure and unit-tested.
- Reuse of the board's move pipeline and motion primitives instead of parallel implementations.

**Non-Goals:**

- Editing the workflow from the diagram (adding, removing, renaming, or reconnecting stages).
- Animating the diagram's own viewport, or per-stage motion beyond card travel.
- Persisting the chosen presentation, pan, or zoom.
- A layout library, a diagram framework beyond React Flow, or a second animation abstraction.
- A three-way semantic merge of workflows; only placement differences merge automatically.

## Decisions

### Workflow configuration carries presentation

`Workflow` gains `defaultView: 'board' | 'workflow'` and `Column` gains `position?: { x: number; y: number }`.

- `parseWorkflow` accepts the root key `default_view` and the column key `position`, validates the enum and finite coordinates within a fixed range, and defaults the view to `board` when the key is absent.
- `schema-parts.ts` extends the persisted workflow schema and `canonicalWorkflow`, so stored data and the editor's normalized comparison keep working.
- Position is optional per stage; absence means automatic placement. Because the position lives on the column, removing a stage removes its position, and the sharing merge only has to touch keys that already exist.

Alternatives considered:

- **A root `layout:` block mapping stage ids to coordinates** — keeps presentation separate from semantics but duplicates the stage list inside one document, can go stale when a stage is removed, and forces the merge to handle two lists.
- **A separate persisted presentation record per board** — cleaner separation in the domain but creates a second thing to save, publish, and migrate, and the user asked for the YAML to own it.
- **Positions only in browser storage** — rejected: the team must see the same diagram.

### One source of truth for authored transitions

Extend `src/domain/transitions.ts` with `authoredTransitions(workflow, columnId)`, returning the configured targets, the implied next stage, or nothing. `transitionAccess` becomes a consumer of that function instead of reading `allowedTransitions` itself, and the new `src/domain/workflow-graph.ts` consumes it too.

`workflow-graph.ts` returns `WorkflowStageNode` values (id, name, index, group id) and `WorkflowConnection` values (`from`, `to`, kind `explicit` | `implicit` | `returning`, and the fan-out index of the source). It ignores a target equal to its own source, because a same-stage move is a reorder rather than a connection.

Alternatives considered:

- **Derive connections inside the diagram component** — the drawing and the move rules would read `allowedTransitions` separately, which is exactly how the two views drift apart.
- **Reuse `transitionDestinations`** — that function answers "may I move there", where an omitted list expands to every stage; the diagram needs the authored connection, not the reachable set.

### React Flow as the diagram surface, with a pure core

`@xyflow/react` 12.x provides the viewport transform, pan/zoom gestures, node dragging, measurement, and edge rendering.

- Wired as a controlled canvas: `nodes` come from the scene, `zoomOnScroll` is off, `panOnScroll` is on, `zoomOnPinch` is on, background drag pans, `nodesConnectable` is off, and `fitView` runs on demand rather than on every render.
- React Flow's stylesheet is imported as text (an esbuild `.css` text loader in both build scripts), declared through a small `*.css` module declaration, mounted with the plugin's existing style tags, and recorded in `THIRD-PARTY-NOTICES.md`. React Flow's own attribution stays visible; hiding it is not available under its license without a subscription.
- Custom node and edge components keep every visual decision in the plugin. Node components render the stage title and the card list; edge components receive the connection and render the path.

Everything that can be decided without the DOM stays pure: `layout.ts` (layered placement), `connections.ts` (path string plus a sampled polyline), `scene.ts` (nodes, connections, bounds, and per-stage card lists), `placement.ts` (position map editing), `history.ts` (undo stack), and `travel-plan.ts` (which cards move and along which polyline).

Alternatives considered:

- **A hand-rolled viewport and SVG scene** — full control and no dependency, but it reintroduces the gesture matrix, measurement, and culling that React Flow already provides; the user chose React Flow.
- **Layout from dagre or elkjs** — better at dense graphs, but the domain is a mostly linear workflow with occasional fan-outs and back edges; a layered pass of about a hundred lines is testable and has no dependency cost.
- **React Flow's built-in default node and bezier edges** — fewer custom pieces, but no card list inside a node, no fan-out anchors, and no shared path function for the travel animation.

### Placement is authored text editing

New `src/domain/workflow-positions.ts` provides `readStagePositions(workflow)` and `setStagePositions(text, positions)`. The setter parses the authored text with the `yaml` `Document` API and mutates only each column's `position` key, preserving every other character, comment, quoting style, and block scalar. Removing a position deletes the key.

The workflow view saves through the existing `board.workflow.save` command. A completed drag schedules one save after a 400 ms debounce, so dragging across the diagram produces one stored change; Organize produces one save for every stage. Edits compose against the text the view intends to persist, and a per-board queue serializes the writes: a save in flight coalesces the next, an Undo that lands mid-flight queues a compensating save against the acknowledged revision, and a rejected save rolls the intended text, visual placement, and history back to the acknowledged workflow. The queue uses the latest known Hub revision (updated from each response), and a stale revision surfaces through the existing command-failure path.

Alternatives considered:

- **Re-serializing the whole workflow with `stringify`** — simple, but normalizes formatting and drops comments, contradicting the promise that authored text is preserved.
- **An explicit Save layout button** — fewer writes, but a hidden dirty state that a view switch or reload silently loses.
- **`applyWorkflowEdits`** — literal replacement needs unique old text per stage and breaks when a stage has no position yet; the Document API expresses the change directly.

### Automatic placement is layered, measured, and frozen

`layout.ts` places stages in columns by longest-path layering over forward connections: a returning connection does not move its source backwards, a stage with no incoming connection starts in the first column, stages in one column are ordered by workflow index, and grouped stages stay adjacent. Node heights come from measurement, because a bubble grows with its cards.

First paint is two-phase: the canvas renders stage nodes hidden, React Flow measures them, the scene is placed once, and the canvas is revealed. Automatic placements are frozen for the session per workflow revision, so cards entering or leaving a stage never move a stage region. Organize recomputes and stores placements for every stage.

Alternatives considered:

- **Fixed-size nodes with an internal scroll area** — removes measurement from layout, but introduces nested scrolling inside a pan/zoom surface and hides cards that must travel the connections.
- **Re-layout on every card change** — the diagram would move on its own while the user is reading it.
- **Estimated heights only** — a cheap first paint, but the edges and columns visibly drift whenever a title wraps to a different number of lines.

### Connections, fan-out, and travel share one path function

`connections.ts` builds a cubic bezier from the source node's right edge to the target node's left edge. Multiple outgoing connections leave at evenly spaced offsets along the right edge, which is what makes two lines leave the same stage. A returning connection leaves from the bottom edge of the source, runs below the column, and enters the target from the bottom. Besides the path string, the function returns the same curve sampled into points at a fixed step.

The travel animation consumes those points: a card copy is translated through them with the Web Animations port the board already uses, with a 450 ms glide and a short fade at each end. When the diagram draws no connection between the two stages, travel uses the straight line between the stage regions. Because the points come from the drawing function, the card follows exactly what the user sees.

Alternatives considered:

- **CSS `offset-path` with the same path string** — elegant, but it puts the animation in CSS, cannot be exercised by the injected animation port, and has narrower support in the harness.
- **A straight line between node centers** — cheaper, but the card would cross bubbles and ignore the drawn connection.

### Card drag reuses the board gesture and the board move pipeline

`useCardDrag` gains an injected drop-target resolver instead of hard-coded board selectors; the board supplies its column resolver and the diagram supplies a stage-region resolver. The gesture core — movement threshold, ghost clone, pointer capture, click suppression — stays one implementation.

The resolved drop is handed to the same `moveTo` the board uses, so restricted confirmation, first-execution preparation, and the timed instruction are inherited rather than reimplemented. The diagram paints the optimistic placement from `useBoardMoves` and reverts on failure through the same accepted snapshots.

Inside a React Flow node, the card area carries React Flow's `nodrag` class and node movement is bound to the stage header, so a pointer gesture on a card can never move the stage.

Alternatives considered:

- **A second drag hook for the diagram** — duplicated gesture handling and a second place for click suppression to break.
- **React Flow connection dragging** — connects nodes, not tasks, and does not express a card move.

### Presentation state is session-only

`BoardPageState` gains `view`. `BoardView` reads the active board's `defaultView` when the active board changes, and the header control sets the field. Nothing is stored, so a reload returns to the configured default. Switching boards therefore applies the other board's default. The workflow view owns its own pan, zoom, and frozen placements and discards them on unmount.

### Placement history

`history.ts` keeps a bounded stack (50 entries) of `{ before, after }` position maps per board id, in memory, cleared by construction on reload. Undo and redo apply the map to the current authored text through `setStagePositions`, so an unrelated workflow edit made elsewhere is never reverted: stages that no longer exist are skipped. Each drag and each Organize pushes one entry. Card moves, navigation, and the presentation switch never push.

Keyboard handling is scoped to the mounted workflow view and ignores events from text inputs, the code editor, and dialogs, so the YAML editor keeps its own undo. The history lives with the mounted diagram: a board switch remounts it, so returning to a board starts empty, which is within the per-board, in-memory, reload-cleared contract.

### Sharing merges placement and keeps the winning meaning

New `src/domain/sharing/workflow-merge.ts`:

- `workflowMeaning(workflow)` is the canonical workflow with every stage position removed. The default view is configuration, so it stays part of the meaning; positions are the only excluded field.
- `mergePlacements({ base, local, published })` computes the meaning of all three, then decides: when the local meaning equals the published meaning, the result is that meaning with merged placements; when one side changed the meaning and the other did not, the changed side's meaning wins and placements merge; when both changed the meaning, no merge is possible.
- Per stage, a placement that only one side changed wins; when both changed it differently, the local placement wins; when neither changed it, the value is kept.
- The merged text starts from the authored text of the side whose meaning changed — the published text when the team changed it, the local text when the local side did — and applies the merged placements through `setStagePositions`.
- `compareSharing` uses the meaning comparison to classify a board as `updates-available` with a resolved text, instead of `needs-review`. `buildUpdatePlan` carries that resolved text in place of the published text, and `nextBase` records the published document, so the merged board becomes a draft and is published on the next synchronization.

Alternatives considered:

- **Treating placement differences as ordinary workflow changes** — rejected by the user: moving a stage would put the board into review whenever a teammate edits the workflow.
- **A general semantic three-way merge** — parses and merges any workflow shape; a whole subsystem of its own, and the specs only ask for placement.
- **Merging by re-serializing the winning side** — loses comments, so the authored-text promise in the sharing spec would be broken.

### Included structural adjustments

- `board.tsx` splits into a composition root plus `board-header`, `board-notices`, `board-columns-view`, and the existing dialogs, so the two presentations share the frame without a 500-line component.
- `hub-view.ts` splits into active-scope storage, snapshot normalization, command scoping, and board projection.
- Style modules move under `src/client/styles/` with one aggregator; the workflow view owns its own style module.
- Workflow YAML field helpers move to `src/domain/yaml-fields.ts` and are shared by the workflow parser and the new position parsing.
- `columnLayout` indexes columns and groups instead of scanning them inside loops.

## Risks / Trade-offs

- **React Flow grows the client bundle and needs its stylesheet** → a text loader in both esbuild builds, a module declaration, and a notices entry; the build reports the new size, and the diagram is the only importer, so removing the view restores the previous bundle.
- **The merge could misread meaning and auto-apply a real conflict** → the comparison is canonical and excludes exactly one field; tests cover semantics-equal, semantics-on-one-side, semantics-on-both, placement-only, and same-stage conflicts, and a wrong classification degrades to today's review path only if the comparison is wrong, which the tests pin.
- **Text stitching could damage authored YAML** → mutations go through the `yaml` Document API on existing column nodes only, with tests for comments, quoted keys, block scalars, flow-style columns, and missing positions; a failure rejects the save instead of writing a guessed document.
- **Every drag is a workflow save** → one debounced save per completed drag, no save on navigation, and the existing stale-revision error path; the trade-off is accepted because positions are team data.
- **Height measurement can cause a visible first-paint jump** → nodes render hidden until measured, then one placement, then reveal; the reveal is a single commit and the frozen placement prevents later drift.
- **Pan/scroll can fight the page** → the diagram owns the remaining frame height, `zoomOnScroll` is off, and panning is limited to the diagram surface; outside it the page scrolls normally.
- **jsdom cannot exercise real geometry or React Flow interaction** → every decision is pure and unit-tested; jsdom covers the gates, history, and scene with a stub canvas; Playwright covers navigation, dragging, travel, and restored placements.
- **A transformed surface can hide content from assistive technology** → React Flow renders real DOM, so stages stay labelled regions and cards stay controls; the tab order and accessible names are asserted in the browser lane.
- **Card drag and node drag collide** → node movement is bound to the header and the card area is marked `nodrag`; a browser test drags a card and asserts the stage did not move.
- **Auto placement frozen per session can disorient after a workflow edit** → adding a stage places only the new stage, and Organize is always one click away.
- **React Flow attribution must stay visible** → documented here and asserted as a visible element in the browser lane so nobody hides it later.

## Migration Plan

1. Domain first: workflow configuration fields, transitions helper, graph, positions, and their unit tests. Existing YAML stays valid because both keys are optional.
2. Sharing merge and its host tests, so a released client can never publish positions it cannot merge.
3. Build plumbing: React Flow dependency, CSS loader, module declaration, notices, and a bundle-size check.
4. Structural adjustments from `board.tsx`, `hub-view.ts`, styles, and YAML helpers, with the existing suites kept green before the view lands.
5. Diagram modules and their pure tests, then the canvas, then the presentation switch.
6. Card drag, travel, and placement history, each behind its own tests.
7. Documentation, the workflow YAML reference, and the `package.json` version bump.

Rollback: removing the presentation switch hides the diagram while positions remain inert authored keys that the board ignores; removing the merge reverts sharing to review on any difference. No stored state needs conversion in either direction.

## Open Questions

- The exact stacking and fade values for the travel layer are visual tuning during implementation; they do not change the approach or the specs.
- Whether React Flow's measurement pass needs one or two frames before the reveal is an implementation observation, covered by the Playwright first-paint assertion.
- The final bundle delta is measured at build time and reported; it does not change the decision to use React Flow.

## Scenario coverage

Each delta scenario is covered by at least one test in the listed files; the browser lane covers what jsdom cannot compute.

| Capability requirement | Covering tests |
| --- | --- |
| Workflow diagram of the active board | `tests/client/workflow-scene.test.ts`, `tests/client/workflow-view.test.tsx`, `tests/browser/workflow-view.spec.ts` |
| Connections derived from configured transitions | `tests/domain/workflow-graph.test.ts`, `tests/client/workflow-connections.test.ts`, `tests/browser/workflow-view.spec.ts` |
| Automatic layered placement | `tests/client/workflow-layout.test.ts`, `tests/client/workflow-scene.test.ts`, `tests/browser/workflow-view.spec.ts` |
| Persisted stage placement | `tests/domain/workflow-positions.test.ts`, `tests/domain/workflow.test.ts`, `tests/client/workflow-view.test.tsx`, `tests/browser/workflow-view.spec.ts` |
| Diagram navigation | `tests/client/workflow-view.test.tsx`, `tests/browser/workflow-view.spec.ts` |
| Card movement along the diagram | `tests/client/workflow-travel.test.ts`, `tests/browser/workflow-travel.spec.ts` |
| Card drag between stages in the diagram | `tests/client/card-drag.test.ts`, `tests/client/workflow-view.test.tsx`, `tests/browser/workflow-view.spec.ts` |
| Placement history | `tests/client/workflow-history.test.ts`, `tests/client/workflow-view.test.tsx`, `tests/browser/workflow-view.spec.ts` |
| Shared search and project filter | `tests/client/workflow-scene.test.ts`, `tests/browser/workflow-view.spec.ts` |
| Accessible diagram surface | `tests/browser/workflow-view.spec.ts` |
| Board presentation selection | `tests/client/board.test.tsx`, `tests/browser/workflow-view.spec.ts` |
| YAML workflow configuration (delta) | `tests/domain/workflow.test.ts`, `tests/domain/schema.test.ts` |
| Team updates and three-way application (delta) | `tests/domain/sharing-workflow-merge.test.ts`, `tests/host/sharing-placement-merge.test.ts`, `tests/host/sharing-state.test.ts`, `tests/host/sharing-sync.test.ts` |
