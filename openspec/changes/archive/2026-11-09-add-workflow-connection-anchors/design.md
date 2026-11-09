# Design

## Context

See proposal.md for motivation. The relevant current state:

- The diagram derives its model twice. `buildWorkflowScene` builds one node per stage and one edge per connection with a drawn shape, from committed placements; `LiveConnections` recomputes the same shapes from live stage rectangles while a stage is dragged or resized. `Travel` uses the scene's shape so a card travels along the committed path; `CanvasInner` uses the live shapes for drawing.
- `connectionShape` in `src/client/workflow-view/connections.ts` (194 lines) owns three concerns at once: the departure and arrival policy (right edge to left edge, bottom gutter for a returning connection, side gutter for two overlapping stages), the polyline to rounded-path conversion with fixed sampling for the card travel, and the arrow tip angle.
- A stage node carries one hidden `Handle` on the left and one on the right, made non-interactive by CSS. Edges are drawn with a fully computed path, so those handles supply no coordinates.
- The two contact circles are drawn inside the custom edge and appear only on hover; the spec calls them decorative. Edges are neither focusable nor selectable, and `elementsSelectable` is off so a stage is never selected by a click.
- Layout is authored per stage in the workflow YAML (`columns[].position`, `columns[].size`), written by text-range edits that preserve comments and formatting, saved through one coalesced 400 ms command with an optimistic revision, and merged per stage during team sharing. `workflowMeaning` excludes layout so a layout-only difference never requires a per-board choice.
- `usePlacementSaver` (182 lines) holds the whole layout save cycle: intended text, intended values, rebase onto a concurrent acknowledged workflow, reset on rejection, flush on unmount.
- `PlacementStep` carries positions, sizes, and visual snapshots for undo and redo; the history is bounded, per board, and in memory.
- The layout lock starts on every session and gates dragging, resizing, Organize, Undo, and Redo.

## Goals / Non-Goals

**Goals:**

- One authored connection layout that is additive to the existing save, history, and lock rather than a parallel mechanism.
- One router used by both the live drawing and the committed travel path, so a card never travels a different route from the arrow it is drawn on.
- Keep each module small: routing split by concern, the edge model out of the canvas, the saver generalized by a field port, and a dedicated text writer for the new sequence.

**Non-Goals:**

- Any change to transition policy. `allowed_transitions` keeps its meaning and its parser.
- Creating, removing, or re-targeting a connection from the diagram.
- Adding bends that the automatic route does not already produce.
- Detecting a collision between an adjusted route and a stage region.
- Extracting `useWorkflowLayout` from `workflow-view.tsx`, and generalizing `yaml-map-fields.ts`. Both were deliberately excluded from this change and remain candidates for a later one.

## Decisions

### D1. The connection layout is an authored top-level sequence keyed by source and target

The workflow document gains one optional `connections` sequence. Each entry names `from` and `to` and may carry `source`, `target`, and `segments`. The pair is the identity: `workflowGraph` already deduplicates transition targets, so a source and target pair identifies at most one drawn connection.

Rejected alternatives: a map inside the source column keeps presentation next to transition policy in the same node and makes the pair key implicit; a field on the `allowed_transitions` entry cannot express the dashed connection a stage without configured transitions receives, and materializing that connection would turn "allows any other stage" into an explicit list, which changes what a stage permits.

An entry that identifies no drawn connection is ignored, mirroring how a position for a removed stage is ignored today. The document is never rejected for a stale entry, so reordering stages cannot break a save.

### D2. An anchor is a side plus one of five points along it

`{side, at}` with `side` in `top|right|bottom|left` and `at` in `0..4` resolving to 10, 30, 50, 70, and 90 percent of that side. Twenty points per stage, all four sides included.

Rejected alternatives: a continuous fraction leaves an unbounded validation surface and makes keyboard stepping arbitrary; a side alone cannot separate two connections that must leave the same side, which is the case that motivates the change.

The anchor also supplies the outward normal, which is what makes a departure perpendicular to its side. This replaces the current special case where a connection to an earlier stage must leave and enter the bottom: a bottom departure becomes one choice among four rather than a rule.

### D3. The route is a departure stub, free lines, and an arrival stub; only the free lines are adjustable

The router projects each anchor along its normal by a fixed stub length, then joins the two stub ends with an orthogonal path whose free segments are the vertical and horizontal "gutter" lines. A free line is any segment that is not collinear with an anchored stub.

An adjustable segment is therefore a free line, and the user gets a handle on every one the route produces — one for a simple forward route, more for a route that wraps below the stages or around an overlap. This is what "all bends" means in an orthogonal route: a bend is not independent of its neighbours, but a gutter line is.

Rejected alternatives: free waypoints allow diagonal and self-crossing shapes and grow the stored document by two numbers per point; per-corner offsets cannot be applied independently without bending the adjoining segment out of its axis.

### D4. An offset is stored relative to the automatic line and identified by axis and order

A stored `{axis, offset}` applies to the automatic free line of that axis at the same position along the route. Moving a stage recomputes the automatic lines from live geometry and adds the offsets, so the drawn shape follows the stage without waiting for a save.

When the route produces fewer lines of an axis than the entry carries, the surplus is not applied to a different line and is not removed from the document. This is the same policy as an orphaned entry: geometry never destroys authored data, and the adjustment reappears if the shape returns.

Rejected alternatives: a positional list without an axis can apply a horizontal displacement to a vertical line after the shape changes; a stored shape signature avoids that but discards the adjustment completely whenever the shape differs, which is a worse surprise than a dormant one.

### D5. Routing splits into three modules and becomes the single source of geometry

- `routing/ports.ts`: resolves an anchor to a point and normal, and allocates the fan-out departure point for an automatic source.
- `routing/orthogonal.ts`: polyline to rounded path, path sampling for the card travel, and the tip angle.
- `routing/route.ts`: composes one connection from its anchors, its automatic lines, and its authored offsets, and exposes both the drawn shape and the ordered free lines the handles bind to.

`buildWorkflowScene` and the live edge computation both call `routing/route.ts`, with committed and live stage rectangles respectively. That closes the risk that a card travels a different path from the arrow it is drawn on: there is one geometry function and both callers feed it the same connection layout.

### D6. The edge model leaves the canvas

A new module computes the edge descriptors and their live geometry from (stages, connection layout, connection descriptors). `CanvasInner` keeps the React Flow surface, the stage drag, the viewport, and the edge type registration, and stops owning the edge `useMemo`. The extracted module is pure, so its output can be asserted without mounting the diagram.

### D7. The saver is generalized by a layout-field port

`usePlacementSaver` gains a field port: each authored layout field provides its read of a parsed workflow, its values, and a function that writes those values into authored text. Position, size, and connection layout are three instances; the hook keeps one intended text, one queue, one rebase, and one reset path.

The hook's exported names and its delay constant stay as they are, because renaming them was not part of the scope that was approved.

### D8. History carries the connection layout

`PlacementStep` gains optional before and after connection layouts. Undo and redo restore positions, sizes, and connections together, in the order the gestures happened, through the same single save. A connection adjustment is one step; a keyboard change is one step only when confirmed.

### D9. The gesture reuses the existing pointer vocabulary

A new `gestures/connection-drag.ts` takes the same `PointerEventsPort`, the same drag threshold, and the same zoom-corrected position helper as the stage drag. It owns the difference between an anchor drag and a segment drag, projects the pointer onto the stage rectangle perimeter for an anchor drag, and resolves the nearest of the twenty points. A press that never passes the threshold commits nothing; Escape and `pointercancel` revert; a completed gesture commits exactly once.

Dragging the existing contact circle was chosen over a selection inspector because the circle already marks exactly the two points the user wants to move, and over real React Flow handles because the drawn path is computed by the router, not by handle coordinates.

### D10. Keyboard: both ends of every connection are focusable, cycling follows the perimeter

Each contact circle becomes a focusable element with a role and an accessible name identifying the connection and the end. Arrow keys move that end to the next or previous anchor in perimeter order — top left to right, right top to bottom, bottom right to left, left bottom to top — so the sequence matches what the user sees. Enter commits and adds one history step; Escape and focus loss revert. Movement is preview only until committed.

React Flow's own edge focusability stays off; the handles carry their own tab index. Because the edges layer renders before the nodes, focus reaches the connection ends first, then the cards in stage order, then out of the diagram.

### D11. The lock gates connection layout exactly as it gates stage layout

With the lock on, the marks are still drawn when a connection is pointed at, but neither the gesture nor the keyboard path can start. The lock already starts on for every session, so an accidental nudge of an arrow is not possible until the user unlocks.

### D12. Merge keeps layout semantics and gains a per-connection field

`workflowMeaning` ignores `connections`, so adjusting an arrow never changes the workflow's identity. `mergeWorkflowPlacements` merges a fourth field, keyed by source and target, using the same winner, per-key change detection, and local precedence for the same key that positions already use. The function that merges one layout field is generalized over a key set instead of iterating columns.

### D13. Validation reuses the existing bounds and vocabulary

`connections` is registered where every other authored field is: the document's allowed keys, a strict shape, and the workflow identity. An offset is bounded by the existing stage position limit; `at` is an integer in `0..4`; `side` and `axis` are enums; `segments` is a sequence of strict mappings. A duplicated pair is rejected, the way duplicated transition targets already are.

## Risks / Trade-offs

- **A free line disappears when the route changes shape** → the offset stays stored and is not applied; the alternative of discarding it loses authored work, and shifting it to another line silently moves the arrow.
- **An older installation cannot read a document that contains `connections`, because unknown document keys are rejected** → this is inherent to the strict parser. Team sharing is only interoperable between installations on this version or later; the README and the release note must say so. It is also why the field is only written for a connection the user actually adjusted.
- **Twenty marks per stage are visually dense** → the marks are shown for the stage being pointed at during a gesture only, not for the whole diagram.
- **Two connections anchored at the same point overlap exactly** → accepted; the fan-out distribution only applies to automatic ends, and no collision is resolved.
- **Per-connection merge grows the sharing merge** → covered by two new hub-sharing scenarios, including the case where each side adjusted a different connection.
- **SVG elements as focus targets can vary across browsers** → the browser lane asserts reachability, announcement, and Escape behavior rather than trusting the platform.
- **The generalized saver gains a third field with its own rebase rule** → the rebase stays per field and keeps the existing rule of adopting only the values this view changed, so a concurrent rename is still preserved.

## Migration Plan

The document change is additive and every existing workflow parses unchanged. There is no data migration. Archiving syncs the two delta specs and the README section. Rolling back is a revert of the change itself; a board adjusted during the change keeps a `connections` entry that a rolled-back build would reject, so a rollback also removes those entries from affected boards.

## Open Questions

- Whether Organize should prune dormant offsets and orphaned entries. It can be decided later without changing the specs or the approach; the current answer is that authored data is never pruned automatically.
