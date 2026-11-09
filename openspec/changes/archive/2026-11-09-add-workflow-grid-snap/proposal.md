# Proposal

## Why

Every layout edit in the workflow diagram is free-form: a dragged stage lands on an arbitrary pixel, a resized stage keeps whatever width the pointer produced, and an arrow segment is moved to the nearest whole coordinate. Stages that should line up therefore end up a few pixels apart, the spacing looks improvised after two or three edits, and the only way back is Organize, which discards the arrangement the user made on purpose. The diagram already has a layout lock, a control stack, a coalesced workflow save, and a bounded history; what it lacks is a lattice the edits respect.

## What Changes

- **Grid snapping for layout edits**: moving a stage, resizing a stage, and adjusting an arrow segment all resolve to a lattice instead of the raw pointer position.
- **Absolute lattice**: the settled value is the nearest multiple of the step, so stages edited at different times share the same lines instead of keeping their own offset.
- **Fixed step of 8 diagram units**: the step is applied in flow coordinates, so panning and zooming never change the feel of a drag.
- **On by default, with a toggle**: a new button in the existing bottom-left control stack turns snapping off and on. It sits beside the layout lock and stays available while the layout is locked, because it is a preference, not an edit.
- **Remembered for the browser**: the choice is one global preference next to the existing view preference, so it survives a reload and is never published to the board's workflow or to the team.
- **Free movement with a modifier**: holding Alt while dragging ignores the lattice for that gesture, without releasing the pointer.
- **No visual grid**: the lattice is not drawn; the stage and the arrow already show where the edit landed.
- **Unchanged automatic layout**: Organize and automatic placement keep their current geometry and are not snapped, so a stored placement that is off the lattice is only brought onto it when the user edits that stage.
- **No workflow schema change**: settled values are ordinary integers inside the ranges the parser already accepts, so `position`, `size`, and `connections` keep their current shape and the sharing merge is untouched.
- **No empty edits**: a drag or resize whose snapped result equals its starting value stores nothing and adds no history entry.
- **Layout editing modules**: the snapping rule becomes a pure policy module, the stage-drag controller leaves the canvas, the client placement module splits into automatic layout and merge, and the layout overrides leave the view for their own hook.
- **One duplicated comparison collapses**: `samePosition` moves to the domain and the three local copies disappear.

## Non-goals

- Alignment guides against other stages' edges or centers; snapping is a lattice, not proximity detection.
- A visible grid, dot pattern, or ruler on the canvas.
- Snapping automatic placement, Organize, or the positions produced by either.
- Snapping the connection ends: an anchor already resolves to one of five points per side.
- Keyboard nudging, a configurable step, or a per-board step.
- Changing the workflow YAML schema, the parser, or the sharing merge.

## Capabilities

### New Capabilities

None. Snapping changes how an existing capability's layout edits behave, not a new capability.

### Modified Capabilities

- `workflow-view`: a stage move, a stage resize, and an arrow-segment adjustment settle on the grid; the control stack gains a snapping toggle that stays available while the layout is locked; the preference is remembered for the browser; holding Alt performs an unsnapped edit; and an edit that settles where it started stores nothing.

## Impact

- **Client**: `src/client/workflow-view/` — a new snapping policy module, the stage-drag and stage-resize gestures, the canvas segment drag, the drag controller extracted from the canvas, a new snapping preference hook, the control stack, and a new icon. The layout override effects move out of `workflow-view.tsx` into a hook, and `placement.ts` splits into automatic layout and merge modules.
- **Domain**: a small `stage-position` module for the shared `samePosition` comparison; `workflow.ts`, `schema-parts.ts`, `workflow-positions.ts`, `workflow-sizes.ts`, and `sharing/workflow-merge.ts` keep their behavior and only import the shared comparison.
- **Browser storage**: one new global preference key beside `dsh.kanban.views`.
- **Tests**: unit tests for the snapping policy and the gestures, client tests for the toggle and the extracted hooks, and browser tests for a snapped drag, a snapped resize, a snapped arrow segment, a no-op drag, the Alt bypass, and the remembered preference.
- **Dependencies**: none added.
