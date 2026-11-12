# Design

## Context

See `proposal.md` - Why for the motivation. The current state that shapes the approach:

- The diagram already owns the geometry a transit needs. `buildShape` (src/client/workflow-view/routing/orthogonal.ts) turns an orthogonal route into an SVG path string with rounded corners plus 33 points sampled by arc length, and `edgeModel` (src/client/workflow-view/edge-model.ts) keeps one `ConnectionShape` per drawn connection. The drawn path, the travel path, and the drag baseline already come from the same route.
- The travel is planned from the authoritative task list (`useTravel` keys off `props.state.tasks`) and fires after the commit, while the optimistic override has already placed the card in the destination (`applyOptimistic`, src/client/workflow-view/workflow-view.tsx). The two representations coexist for the whole animation.
- The travel animation is a Web Animations call owned by a React effect whose dependency array includes `animate`, a default parameter that calls `webAnimations()` per render. Any re-render inside the window cancels the animation and replays it from the source; `fill: 'forwards'` plus `cancel()` is what makes the copy snap back rather than resume.
- The transit overlay renders inside `ViewportPortal`, so a particle element's coordinates are flow coordinates and its DOM ancestors carry the ReactFlow transform and the diagram's published `--kb-affordance-scale` (set on `.kb-flow-canvas` by `publishMarkScale`).
- The deterministic exit label is a button in `EdgeLabelRenderer` that opens the stage editor, and it also feeds `hasCondition` in the edge data, which is what currently suppresses the "no condition" mark on those connections.
- jsdom has no Web Animations API, which is why the existing travel tests cannot observe the animation at all.

## Goals / Non-Goals

**Goals:**

- One transit per committed stage change, always, regardless of how many times React renders during it.
- No second representation of a task card at any point of the movement.
- A transit whose timing is deterministic and testable without a real animation: geometry and duration are pure functions, and the animation itself is declarative.
- Remove the label plumbing without losing the ability to reach the deterministic stage editor from its connection.

**Non-Goals:**

- The column board's card motion (`CardMotionFrame`) and its exit-copy duplication. Untouched.
- Any new general animation framework: the change adds one transit surface, not a motion system.
- Changing transition semantics, validation, optimistic ordering, or the layout lock's authority.
- Animating movement inside a stage (reorder), or between stages the diagram draws no connection for.

## Decisions

### D1. The transit is CSS over `offset-path`, not Web Animations

Each transit renders a keyed element whose `offset-path` is the connection's SVG path and whose animation moves `offset-distance` from `0%` to `100%`. React only mounts and unmounts that element; CSS owns the timing.

- **Why**: a CSS animation cannot be cancelled or replayed by a React render, so the reported defect becomes impossible rather than fixed by memoization. It also removes the animation lifetime bookkeeping (the `movements`/`exits` maps, `cancelMovements`, `fill` cleanup) from the transit surface.
- **Why not keep WAAPI with a memoized port**: it fixes the restart but keeps the imperative lifetime, the `fill` state, and a test seam that jsdom cannot exercise.
- **Why not SMIL `animateMotion` inside the edge SVG**: it would put transient state into the memoized edge list, is deprecated in spirit, and is harder to assert in the browser lane.
- **Why not animate `stroke-dashoffset` on the drawn wire**: cheap, but it reads as the wire lighting up, not as a particle on it, and it cannot carry a core, a halo, and a trail.
- **Coordinate and size contract**: the element lives in flow coordinates (the portal), and its diameter is expressed through the diagram's published `--kb-affordance-scale` so it stays legible at any zoom, clamped so it cannot dwarf the wire when zoomed far out.
- **Capability fallback**: when `CSS.supports('offset-path', 'path("M 0 0 L 1 1")')` is false the layer renders nothing and the arrangement settles exactly as it does under reduced motion. The rule lives behind one injectable port so a harness can drive either branch.

### D2. Plan from the presentation the user sees, deduplicated per transition

`planTransit` takes the stage of every presented card before and after the commit (the same cards the diagram draws, optimistic override included), the committed scene, and a cap. It returns one transit per task whose stage differs and whose two stages the scene draws a connection for, carrying the drawn path and its length. There is no direct-path fallback: a move with no drawn connection produces no transit.

- **Why from the presented cards**: the transit then begins when the card actually moves on screen, and a move that never moves the card never animates.
- **A move with no drawn connection still arrives**: the plan reports those tasks separately, and the view starts that card's arrival pulse without a flight, which is why the plan returns transits and immediate arrivals rather than one list.
- **Why generations, not keys alone**: the optimistic presentation and the authoritative snapshot can both report the same stage change, so one movement must yield one transit. The hook keeps the flights still running and, before planning, invalidates the flight of every task whose stage changed again in this commit. That covers a second move with no drawn connection, a rollback to the source stage, and a batch or reduced-motion settle; an arrival is honoured only while its own flight is still live, so a superseded flight can never pulse a card twice. A failure that returns the card to its source yields the reverse transit, which is the honest signal that it moved back.
- **Alternative rejected**: planning from the authoritative list only. It fixes the duplicate trigger but leaves the transit starting after a round trip, disconnected from the card's own appearance.

### D3. Duration follows path length at a constant speed

`durationFor(length)` clamps `length * MS_PER_FLOW_UNIT` into 300-700 ms, and `offset-distance` animates with a linear timing function. Long wires do not blur past and short ones do not blink.

- **Alternative rejected**: the current fixed 450 ms, which makes a long returning route a smear.

### D4. The arrival pulse is a keyed child of the card, not a re-render of the card

The transit layer reports arrival through a callback; the view keeps a map of task id to an incrementing arrival token, and the diagram's `renderCard` passes that token to the card. The card renders a keyed overlay element when a token is present and removes it on its own animation end.

- **Why a keyed child**: mounting a fresh element restarts a CSS animation without re-keying the card, so focus, drag, and click activation survive the pulse.
- **Why it is cheap**: `BoardCard` is memoized, the token is a scalar, and the card's move handler is passed through unchanged, so an arrival re-renders only the card that arrived; the other cards bail out of rendering even though `renderCard` is recreated.
- **Token lifecycle**: the completion handler receives the token it presented, so a stale completion cannot clear a newer pulse; pulses are pruned when a card leaves the presented cards or when the arrangement starts settling, so a hidden, deleted, or motion-suppressed card never replays an old arrival.
- **Alternative rejected**: pulsing the destination stage. The identity of the task that moved is the information the pulse carries.

### D5. Module shape

```
workflow-view/
  transit/plan.ts        pure: stage maps + scene -> Transit[]  (drawn connections only, cap applied)
  transit/timing.ts      pure: path length -> duration, clamped
  transit/policy.ts      one motion policy: cap, duration range, speed, trail size
  transit/port.ts        the capability port (supports the path animation)
  transit/layer.tsx      presentational: one keyed particle group per transit, onArrived callback
  use/use-transit.ts     orchestration: detect, dedupe, retain, finish
```

The layer takes its policy, its capability port, and its arrival callback as props; the hook owns state and calls the pure functions. `plan.ts` and `timing.ts` have no DOM and no React, which is where the behavior is asserted.

### D6. The label leaves the diagram; the routing stays reachable

- `exitLabels` is removed from `CanvasConnection`, the edge data, and `LiveEdge`; the canvas stops folding it into `hasCondition` and publishes a plain `deterministic` flag instead, which the condition mark excludes so no hollow mark appears in the label's place.
- `EdgeLabelRenderer` use for that button, its styles in src/client/styles/deterministic.ts, and the `aria-label` that named the exits disappear with it.
- Double-press on a deterministic connection still routes to the stage editor through `openCondition`, and the existing lock gate in the edge component now behaves correctly for those connections: a locked diagram opens nothing, an unlocked one opens the stage editor.

## Risks / Trade-offs

- [`offset-path` unsupported on an older host renderer] -> the capability port returns false and the change settles without transit, exactly like reduced motion; no error surface, no broken element.
- [A particle in flow coordinates looks wrong at extreme zoom] -> the size uses the diagram's published affordance scale with a clamp, and the trail is expressed relative to the core.
- [A failed move shows a reverse transit] -> accepted and documented: the card really does return, and the spec already requires the diagram to present that return.
- [Four DOM nodes per transit] -> bounded by the batch cap of eight, all `pointer-events: none` and `aria-hidden`.
- [Removing the label removes a visible affordance for the deterministic editor] -> the double-press path and the stage editor remain, and the browser lane keeps a test for it; this is the behavior the owner asked for.
- [The arrival token changes `renderCard`'s identity] -> memoized cards bail out; verified by a browser assertion that a card which did not move does not flash.

## Migration Plan

- No persisted format, command, or host contract changes: the workflow document, layout document, sharing merge, and task projections are untouched.
- Ship as one change. Rollback is a revert; nothing written by this change outlives it.
- Dead code is deleted, not deprecated: the clone element and its styles, the fade hold constant, the endpoint opacity constants, the direct-path shape in the transit path, the exit-label plumbing and CSS. There are no external consumers of any of them.

## Open Questions

- The exact speed constant and trail length are tuning values, bounded by the 300-700 ms policy. They do not change the specs or the task breakdown.
- Whether a future column presentation should reuse the same transit surface is deferred; the column board is explicitly out of scope.
