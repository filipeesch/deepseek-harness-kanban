# Proposal

## Why

The diagram derives every connection from the workflow's configured transitions alone: a forward connection always leaves the source's right edge and enters the target's left edge, and the route is recomputed from scratch on every change. A board whose stages are arranged for its own reasons therefore ends up with arrows that cross cards, stack on one edge, or land exactly where another arrow leaves. Stage placement and stage size became authorable and persisted; the connection, the third piece of the diagram's layout, still cannot be adjusted at all.

## What Changes

- Each connection acquires an authored layout: an anchor for each end and an offset for each adjustable orthogonal segment of its route.
- An anchor is one of 20 points on the stage boundary: five along each of the four sides, at 10, 30, 50, 70, and 90 percent. A release always resolves to one of them, so a connection can leave from the top or the bottom, not only the right.
- The anchor decides the side a connection leaves and enters, and the departure is perpendicular to that side. Two connections of the same stage can share a side without overlapping.
- Dragging the contact circle the diagram already reveals on hover re-anchors that end. Dragging a route segment moves that segment perpendicular to itself.
- Both ends of every drawn connection are manipulable, including the dashed implicit connection that a stage without configured transitions receives.
- The layout is stored in the board's workflow YAML as a top-level `connections` sequence keyed by source and target stage. An entry whose connection is not drawn is ignored, never rejected.
- Connection layout joins the existing coalesced workflow save and the existing undo and redo history: one completed gesture is one history entry and one stored workflow change.
- A connection is reachable by keyboard: each end is focusable, the arrow keys cycle its anchor point, Enter confirms, and Escape cancels.
- Team sharing treats a difference limited to connection layout as layout, merged per connection, the way stage placement and stage size are merged today.
- The route computation moves into its own modules, the edge model leaves the canvas component, and a new text-editing module writes the `connections` sequence without generalizing the existing column-field editor.

## Non-goals

- Creating or removing a connection from the diagram. A connection is transition policy, so that is an edit of `allowed_transitions`, not of layout.
- Adding bends beyond the ones the automatic route already produces.
- Detecting or preventing a manual route from crossing a stage region.

## Capabilities

### New Capabilities

None. The behaviour belongs to the workflow diagram that already exists.

### Modified Capabilities

- `workflow-view`: an authored connection layout overrides the derived geometry; the contact circles become interactive handles; connection layout is persisted, undone and redone within the same history, frozen by the layout lock, and reachable by keyboard.
- `hub-sharing`: a difference limited to connection layout is merged per connection and does not require a per-board choice.

## Impact

- Code: `src/shared/types.ts` and `src/domain/schema-parts.ts` (the authored shape and the workflow identity), `src/domain/workflow.ts` (parsing), a new connection-layout module, a new sequence text-editing module, `src/domain/sharing/workflow-merge.ts` (per-connection merge), and the workflow view: the routing split into modules, the edge model extracted from the canvas, the placement saver generalized, the stage node's side handles, and the edge view's drag targets.
- Specs: `workflow-view` and `hub-sharing`.
- Docs: the README's workflow diagram section.
- Dependencies: none added; `@xyflow/react` is already a dependency.
- Compatibility: a workflow without a `connections` entry renders exactly as today, and every existing workflow YAML keeps parsing.
