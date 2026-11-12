# Proposal

## Why

Moving a task between workflow stages currently clones the card and glides that clone along the drawn connection. The real card is already in the destination — the optimistic move lands first — so for the whole animation one task has two representations on screen. The clone's animation is also owned by a React effect whose animation port is recreated on every render, so any re-render inside the animation window cancels the animation and replays it from the source. A single move therefore reads as a card that multiplies and travels several times.

The owner asked for a different signal in that situation — an electron travelling the wire — and asked for one unrelated piece of diagram clutter to go: the exit-name labels that deterministic stages render on their arrows.

## What Changes

- A stage change is signalled by an energy transit instead of a card clone: one electron per moved task, with a bright core, a halo, and a short trail, travelling the connection the diagram already draws for that transition — the solid arrow of an authored transition and the dashed arrow of a workflow-order default alike.
- The card is never cloned. It appears in the destination immediately, as it does today, and pulses once when the transit arrives, so the pulse — not a flying copy — carries the identity of the task that moved.
- A move whose two stages have no drawn arrow (a restricted move accepted through the confirmation override) presents no transit: the card appears in the destination and pulses. There is no wire to travel.
- The transit keeps the rules travel had: it follows the drawn path including a route the user adjusted, no transit is presented for a same-stage reorder, at most eight tasks move with a transit in one change, and reduced motion settles with neither transit nor pulse.
- The transit is restart-proof by construction: its timing is expressed in CSS over the path the diagram already produces, so a re-render neither cancels nor replays it, and the arrival is reported by an animation event rather than a timer.
- Deterministic stages stop rendering exit names on their arrows. The names and the destination each exit resolves to remain presented and editable in the stage editor, and several exits that resolve to one destination still present one arrow. Double-clicking that arrow still opens the deterministic stage's editor while the diagram is unlocked.
- The machinery the transit replaces is removed rather than left behind: the clone element and its styles, the fade hold time and endpoint opacity constants, the Web Animations bookkeeping, and the exit-label plumbing and CSS. The two independent batch caps become one motion policy.

## Capabilities

### New Capabilities

None. Both capabilities this change touches already exist.

### Modified Capabilities

- `workflow-view`: the requirement "Card movement along the diagram" changes from a travelling card to an energy transit along the drawn connection with an arrival pulse, and from a direct path between stage regions to no transit at all when the diagram draws no connection.
- `kanban-board`: the requirement "YAML workflow configuration" stops presenting deterministic exit names on the diagram's arrows and presents them in the stage editor instead, keeping one destination per set of exits.

## Impact

- Code: `src/client/workflow-view/` (transit planning, timing, layer, hook, edge drawing, styles), `src/client/styles/deterministic.ts` (the exit-label rule), `src/client/card-motion/` (one shared motion policy), `src/client/workflow-view/canvas.tsx` and the edge data it publishes.
- Tests: new unit tests for transit planning, duration, and the layer's one-animation-per-transit contract; browser specs for a solid-arrow transit, a dashed-arrow transit, no transit without an arrow, reduced motion, the arrival pulse, the absence of a card clone across a forced re-render, and a deterministic arrow without a label that still opens its stage editor.
- Data: no migration; no persisted workflow, layout, or board document changes.
- Compatibility: none. A build without this change reads and writes the same documents and sends the same commands.
- Out of scope: the column board's own card motion, which duplicates a leaving card through its exit copy, keeps its behavior and its specification.
