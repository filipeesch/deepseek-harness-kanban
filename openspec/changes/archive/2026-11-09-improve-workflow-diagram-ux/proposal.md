# Proposal

## Why

The workflow diagram shipped as a first presentation, and this round of review shows the cost of its shortcuts: a stage drag works only once because the gesture never releases its lock, arrows do not follow a stage while it is dragged, zoom needs Ctrl, the diagram is boxed inside the board body's padding, and the stage cards are a reduced copy of the board card — so auto mode, the awaiting-reply and failure indicators, the status strip, the run action, and selection are all missing there. The same review asks for stage sizing, a lock for layout editing, an on-canvas control stack, and a minimap like the React Flow demo, and it also asks the board card to present execution differently. Fixing these one by one would keep two card implementations and a second, drifting drawing model. This change does one coherent pass instead: both presentations render the same card, and the diagram inherits the reference behavior.

## What Changes

- **Navigation without a modifier**: the wheel zooms at the pointer and dragging the background pans; the Ctrl/Cmd wheel workaround is removed.
- **Orthogonal connections**: connections are routed as rounded orthogonal paths, returning connections still run below the stages, and a contact circle at each end is revealed on hover.
- **Live connection geometry**: edges, fan-out points, and returning clearances follow the stage positions while a stage is dragged.
- **Stage drag fixed**: a completed drag releases its gesture, so every later drag works; the dead drag-latch reference is removed.
- **Stage minimum size**: each stage can be resized in the diagram, with a floor of the current 264x140, and the height still grows with its cards. The chosen size is stored per stage in the workflow YAML and shared with the team.
- **Layout lock**: a lock control, on by default, gates stage move, stage resize, Organize, Undo, and Redo. Cards, pan, zoom, and opening tasks stay available while locked.
- **One control stack**: the text toolbars are replaced by a single bottom-left icon stack with zoom in, zoom out, fit, undo, redo, organize, and the lock, each with a tooltip and an accessible name.
- **MiniMap**: an always-visible, drag-navigable minimap sits at the bottom right.
- **Full-bleed surface**: the diagram fills the board tab with no page padding and no inner frame.
- **Remembered presentation**: the Board/Workflow choice is stored per board in the browser; a board's configured default presentation applies until the user chooses for that board.
- **One card for both presentations**: a stage renders the board's task card, so auto mode, the unread/awaiting-reply/failure indicators, the status strip, the run action, and selection behave the same in both presentations.
- **Execution presentation on the card**: the working badge is replaced by a pulsing accent bar on the card's trailing edge, and the background activity chip is removed from the card.
- **Card action row**: auto mode keeps its label and shares the activity region's row with the run action and a new advance-to-next-stage action, all in the same pill style and height. The advance action is hidden while a turn is running and moves through the drawer's move pipeline.
- **Workflow YAML gains an optional per-stage `size`**, validated like `position` and merged by the same sharing path.
- The React Flow attribution stays visible; this change does not hide it.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `workflow-view`: navigation gestures, connection drawing and contact, live geometry during a stage drag, per-stage minimum size, the editing lock, the on-canvas control stack, the minimap, the full-bleed surface, and card parity with the board.
- `kanban-board`: task card regions and controls, execution and background presentation, the advance-to-next-stage action, the remembered presentation preference, and the workflow YAML stage size key.

## Impact

- **Client**: `src/client/workflow-view/` (canvas, stage node, connections, scene, layout, styles, controls, gestures), `src/client/board.tsx`, the board card composition, the auto-mode and run-action presentation, and the style modules.
- **Domain**: `src/shared/types.ts` (`Column.size`), `src/domain/workflow.ts` (parse and validate `size`), `src/domain/schema-parts.ts` (schema and canonical/meaning shapes), `src/domain/workflow-positions.ts` (or a sibling editor) for authoring size, and the sharing merge for the new key.
- **Browser storage**: a per-board presentation preference next to the existing active-hub and active-board keys.
- **Tests**: unit tests for the new pure modules (size policy, live connections, viewport policy, gesture cleanup), client tests for the card and the diagram, and browser tests that currently select `.kb-flow-card` or `.kb-working` and must assert the shared card and the new execution bar.
- **Dependencies**: none added; the minimap and controls come from the already bundled `@xyflow/react`.
- **Documentation**: the workflow YAML reference, the diagram documentation, and the archived design statement about the attribution remaining visible stay true.
