# Design

## Context

See `proposal.md` — Why, and the delta specs for the behavior contract.

The card is one memoized component, `BoardCard`, rendered by two hosts:

- the column board, which paints it at zoom 1 in a 240px column;
- the workflow diagram, which paints it inside a React Flow node in a canvas whose zoom ranges from 0.2 to 2.5 and which fits the whole workflow on demand.

Attention is already projected without React: `attention-projection.ts` folds one conversation's durable facts with the client-owned read acknowledgment, and `kanban-attention.ts` aggregates per task while preserving object identity so a memoized card only re-renders when its own attention changed. Read state is client-owned and durable (`read-acknowledgments.ts`), and the bridge already holds every conversation's facts in its merged host snapshot.

The attention colors are hex literals repeated in `styles/base.ts`, `styles/cards.ts`, and `styles/sharing.ts`. The card's status-entry projection lives inside the card component. The `.kb-legend` rule has no consumer.

## Goals / Non-Goals

**Goals:**

- Make a card's dominant state readable as area, at a glance, on both hosts.
- Keep every coexisting state readable as a mark without letting the controls shrink below legibility in the diagram.
- Give the board a single action that clears recorded unread and failure state for the whole board.
- Leave the card presentational and the policy testable without React.

**Non-Goals:**

- No change to how attention is derived, persisted, or published.
- No new host API, remote method, or persisted record.
- No shape vocabulary for the marks; they stay circles distinguished by color and order.
- No card-level presentation for background activity.
- No rework of the drawer's attention surfaces beyond reading the shared color tokens.

## Decisions

### D1. The dominance policy is a pure domain projection

Add `src/domain/card-presence.ts` exporting a function from attention facts to a presentation-free value: the dominant state (`error`, `attention`, `running`, `unread`, or `none`). The fixed priority list is exported as the policy it encodes. The attention marks keep their own fixed order in the component that already owned it, so the policy is not duplicated.

Alternatives considered:

- Deriving inside `TaskCard`: puts a product policy in JSX, where it can only be tested through rendering.
- Deriving in the bridge: leaks card presentation into the transport layer and makes the ordering depend on snapshot shape.

The projection runs inside the card component from the attention it already receives, so no new prop reaches the card and memo equality, and therefore the "only the card whose attention changed re-renders" behavior, is untouched.

### D2. The presence is additive to the existing working attribute

The card gains `data-presence` carrying the dominant state, and keeps `data-working`. Renaming `data-working` would churn six or more browser assertions for a cosmetic gain, and the two attributes answer different questions: one is execution, the other is the surface.

### D3. Attention colors become CSS custom properties

Declare `--kb-state-unread`, `--kb-state-attention`, `--kb-state-error`, and `--kb-state-running` once on `.dsh-kanban`, with a dark-appearance override keyed off the host theme attribute, plus a `--kb-state-tint` share token.

The tint is composed, not authored per state:

```
background: color-mix(in srgb, var(--kb-state-<state>) var(--kb-state-tint), var(--kb-surface));
```

Alternatives considered:

- A TypeScript color map: cannot participate in the host's appearance switch without JavaScript, and forces a re-render on theme change.
- Inline styles from the component: loses the cascade and the reduced-motion media query.

The share starts at 12% for the light appearance and 14% for the dark one; the exact value is tuned against the contrast test, which is the authority.

### D4. The diagram publishes its zoom as a CSS custom property

The canvas writes `--kb-mark-scale` onto its own element as the viewport changes. The value is the already-bounded inverse zoom, computed by one pure function the unit tests cover:

```
transform: scale(var(--kb-mark-scale, 1));
```

Precomputing the bound keeps the arithmetic out of CSS, where a division by a custom property is poorly supported, and makes the 3.5x limit directly testable.

Alternatives considered:

- A `zoom` prop threaded to the card: re-renders every card on every zoom step, and puts a diagram concept into the card's contract.
- Reading React Flow's store inside the card: couples the card to the diagram library.

The custom property is the coupling boundary: the card stays unaware of the diagram, the column board inherits the fallback of 1, and no re-render happens while zooming. The transform does not participate in layout, so the card's height and the context row stay stable.

The marks stay in the context row's flow, anchored at its trailing edge with `transform-origin: right center`, so scaling never pushes the project name or the title: a transform does not participate in layout. At the smallest zoom the scaled mark can reach past the card's padding; the card does not clip overflow and the stage pads its own content, so the mark stays visible — which is the point of the change.

### D5. Running is carried by the accent, never by a mark

`data-working` already drives the trailing accent bar. The border joins it: the border takes the accent color while running, and a pseudo-element ring pulses its opacity over it, so nothing reflows and the card element itself carries no animation — which keeps the board's motion bookkeeping and its tests unaffected.

Alternatives considered:

- A fourth mark for running: two identical blue circles, and under reduced motion the pair becomes indistinguishable from a single unread card.
- Pulsing the whole surface: a large animated area is tiring and antagonizes reduced motion.

The border is also the reduced-motion discriminator: with the pulse removed, a running card still differs from an unread card by its accent-colored border.

### D6. Bulk acknowledgment reuses the existing read collaborators

Add one method per existing layer, no new abstraction:

- `ConversationReadTracker.markRead(sessionId)` acknowledges the settled turn already recorded in the tracker's fact map.
- `ConversationReadState.markRead(sessionId)` delegates, matching the existing `view` and `close` shape.
- `ClientBridge.markAllRead(sessionIds)` looks each id up in the merged host snapshot, marks it, flushes the record once, and publishes, so the board paints the cleared state without a host round trip.

The board receives the capability as an optional `BoardView` prop supplied by `client.tsx`, following the same dependency-injection pattern the board already uses for `picker`, `autoRun`, and `onOpenSession`. The prop carries session ids, so the bridge gains no board concept and the board decides what "this board" means.

Enablement reuses `projectScopeActivity`, which already folds `unread` and `failed` across a board's tasks; no new enablement projection is introduced.

### D7. The status-entry projection moves out of the card component

`cardStatusEntries` and `CardStatusEntry` move to `src/client/card-status-entries.ts` with no behavior change. The card file already holds five components; adding the presence derivation would make it the sixth concern. The exported function keeps its name so existing tests and call sites read the same.

### D8. The dead legend rule is removed

`.kb-legend` has no consumer in the codebase. It is removed with the token change rather than carried forward.

## Risks / Trade-offs

- A tinted board can read as noisy → the share stays low, the tint never replaces a mark, and the contrast test enforces text legibility in both appearances.
- A pulsing border on top of a pulsing trailing bar can read as busy → one color, low amplitude, and both stop under reduced motion.
- At the diagram's minimum zoom the bounded scale makes a mark proportionally large next to a tiny card → the bound keeps it proportional, and at that zoom the marks are deliberately the most prominent thing on the card; the alternative, shrinking them with the card, is what made the state unreadable in the first place.
- A scaled mark can extend past the card's padding at low zoom → the card does not clip overflow and the stage pads its content, so the mark stays visible by design.
- Bulk acknowledgment cannot be undone → it clears only recorded state and never a live awaiting-reply state, and it is scoped to the active board.
- `color-mix` is a modern-CSS dependency → the codebase already relies on it throughout, so no new baseline is introduced.
- The tint must not be the only signal → the marks, the accessible names, and the announced working state all remain.

## Migration Plan

Single change, no data migration: the stored read-acknowledgment record keeps its version and its `{sessionId: seq}` shape, and the bulk path writes the same entries. Rollback is a revert; stored acknowledgments stay valid.

## Open Questions

- The exact tint shares per appearance are a starting value tuned against the contrast test; this changes no requirement and no task.
