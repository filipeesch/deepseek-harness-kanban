# Design

## Context

See `proposal.md` — Why. The current interaction layer is what shapes every decision below.

- The lock is one boolean. `useFlowLock` owns it, `WorkflowView` passes it to `WorkflowCanvas`, and the canvas spreads it into node data, the stage drag, the connection gestures, the `ConnectionHandlers` context, the affordance layer props, and the canvas DOM (`data-locked`). Every consumer tests it on its own.
- The marks that move a connection live in one affordance layer portaled into the viewport above the stage nodes: one wrapper per connection with two end handles and one grip per adjustable segment. The wrapper is always in the document; CSS reveals it from `data-active` (pointed at or selected) or from `:focus-within`, and CSS disables its pointer targets while `data-locked` is true.
- The drawn connection lives in React Flow's edge layer, below the stage nodes. A selected connection is a view state (`selectedConnectionId`), and the selected paint is a CSS class on the edge group.
- The condition editor is a popover anchored to the connection. It receives the lock as a boolean only to disable its delete action, and it closes on an outside press, Escape, or cancel.
- The project already extracts presentation rules into small modules (`gestures/viewport-policy.ts`, `affordance-hover.ts`) and into pure geometry (`affordance-geometry.ts`); the creation preview in the affordance layer is the precedent for drawing diagram-space geometry above the stages.

## Goals / Non-Goals

**Goals:**

- One authority for "can this connection be changed", consumed by the edge, the affordance layer, and the gestures, so the lock is projected once instead of tested in four places.
- Reading a connection does not require unlocking, and reading never offers an edit.
- The selected route is readable when a stage region hides part of it.
- The keyboard keeps a way to read a connection while locked without gaining an edit path.
- Removing the state that becomes unreachable: the lock CSS for marks, and the condition editor's lock input.

**Non-Goals:**

- Splitting `ConnectionAffordances` into separate port, mark, and preview components.
- Clearing a selection whose connection disappears after a workflow change.
- Any change to stage drag, stage resize, the stage edit action, connection ports, or the stage editor.
- Persisting the selection or the lock; both remain session state.

## Decisions

### One derived connection mode, published instead of the lock

`connection-mode.ts` owns a two-value mode, `inspect` and `edit`, derived from the lock once at the canvas boundary. The canvas publishes it in the `ConnectionHandlers` context (replacing `locked`), passes it to the connection gestures, and mirrors it on the canvas element as `data-mode`. The stage drag keeps the lock boolean because it has no inspecting behavior.

Alternatives: keep the boolean and let each consumer derive its own rule (current, four places); pass both values (two sources that can drift). One derived value keeps the vocabulary equal to the intent and gives the CSS a selector that is not the negation of a lock.

### Marks stay in the document and are only revealed while editing

The affordance layer keeps rendering every wrapper, so the two ends of every connection remain focusable controls, as the accessible-surface requirement asks. While inspecting, nothing ever sets the reveal attribute, and the reveal selector is scoped to the editable mode, because `:focus-within` would otherwise reveal the marks as soon as the keyboard reaches a handle.

Alternatives: unmount the marks while locked (simpler document, but the handles would leave the tab order and the diagram would lose the accessible names of the connection ends, contradicting the accessibility requirement); keep the current reveal and rely on the disabled pointer targets (that is the reported defect).

### Focus selects a connection only while inspecting

The pointer and the keyboard need different rules. While inspecting, focus on an end is the only way to read a connection without a pointer, so focusing selects that connection and the elevated route becomes the focus indication. While editing, focus keeps its current meaning — the marks appear — because selecting on focus would expose Delete and Backspace over whatever arrow the keyboard happens to be on.

Alternatives: selection follows focus in both modes (uniform, but turns tabbing through handles into a destructive-ready state); no keyboard selection at all (loses the reading path, requires weakening the accessibility requirement).

### The selected route is a copy in the affordance layer, not a raised edge

The affordance layer already paints above the stage nodes and already renders diagram-space SVG for the creation preview. The selected route reuses that layer: one SVG sized to the path's bounding box, containing the same path string and the same arrowhead polygon, with the selected paint, the dashed pattern for an implicit connection, `pointer-events: none`, and `aria-hidden`. It is rendered only while a connection is selected, from the same live edge the edge layer draws, so it follows a gesture preview, a zoom, or a stage move at each end.

Alternatives: raise the edge above the nodes in React Flow (there is no supported per-edge stacking above nodes, and it would change every edge); draw the whole route only in the affordance layer and hide the edge (splits the single source of the path). The copy is cheap, disposable, and cannot drift because it uses the path the edge already draws.

The box computation that the creation preview keeps private moves to `affordance-geometry.ts`, so both copies of an above-the-stages route share one geometry rule.

### Hover emphasis is CSS, not interaction state

While inspecting there is no mark to reveal, so the pointer-enter and pointer-leave handlers are not attached and the hover state is not written. The stroke emphasis is a `:hover` rule on the edge group, which React Flow's interaction path already triggers through its ancestors. The editable mode keeps the hover state because the linger between the line and a handle depends on it, and it gains the same emphasis.

Alternatives: keep writing the hover state in both modes and style from an attribute (one rule, but re-renders the canvas on every pointer move for no visible mark); drop the emphasis in the editable mode (inconsistent vocabulary between modes).

### The lock owns the condition editor, including an open one

The edge opens the editor only in the editable mode, and the view closes an open editor when the lock turns on, discarding its draft without storing. The popover loses its lock input entirely, because there is no state in which it is open and locked.

Alternatives: keep the editor open and disable its field and actions (a dialog that looks editable and is not, plus the lock duplicated inside the popover); let it save while locked (the opposite of the requirement).

### Unreachable state is removed, not left guarded

With marks never revealed while inspecting, the locked reveal and cursor rules have no reachable state. They are removed, and `data-locked` on the canvas becomes `data-mode`, so the CSS and the components read the same value. The defensive checks inside the gesture hook stay, so a pointer that reaches a handler the layer did not present still changes nothing.

## Risks / Trade-offs

- **Invisible focus targets** → The focused handle paints nothing, so the only indication is the selected route. It is visible in every mode the diagram allows, and the accessibility requirement records it as the focus indication. The two ends of the same connection do not change the picture when focus moves between them; the connection is the unit being read.
- **The elevated route paints over cards** → Only a selected connection is copied above the stages, with no fill and no press target, so a card stays operable through it. The copy is removed as soon as the selection is cleared.
- **The elevated route is not a press target** → Pressing the highlighted segment over a stage falls through to the stage and clears the selection, as a press on a stage always has. Making the copy pressable would block the cards beneath it, which is worse than the inconsistency.
- **Double paint on visible segments** → The copy uses exactly the selected paint, so where the edge is already visible the two paths coincide and no change is perceptible. Any antialiasing difference is invisible at the stroke's weight.
- **Locking discards an open draft** → The editor already discards its text on an outside press, Escape, and cancel, so the behavior is consistent; the change adds one more dismissal path, and no completion is stored or queued.
- **The hover emphasis drops when the pointer crosses onto a mark** → In the editable mode the mark is a sibling subtree, so the group's `:hover` ends while the pointer is on a handle. The marks themselves are the stronger cue, and the inspecting mode has no marks to cross onto.
- **Existing tests read the locked marks** → The browser cases that drag a locked handle position or assert that a locked press selects nothing need rewriting; the tasks record them explicitly.

## Migration Plan

No data migration. The workflow document, the parser, the stored connection layouts, the sharing merge, and every host command keep their form, so an installation without this change reads and writes the same workflows. Rollback is a code revert, and no persisted state is left behind.

## Open Questions

- The exact hover emphasis value (a stroke-width step, a mixed ink, or both) is tuned during implementation against the browser theme fixture in both schemes and asserted for contrast; it does not change the specifications or the approach.
