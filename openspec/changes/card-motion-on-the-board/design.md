# Design

## Context

This is a single Host/client DSH plugin. The client is bundled by esbuild into one browser module loaded through `window.__ModuleLoader__`, React is external, and there is no animation dependency or worker runtime of its own. See [proposal.md](proposal.md) for motivation and the `kanban-board` delta for the behavior contract.

Current constraints that shape the approach:

- `BoardView` renders every card from the snapshot it holds ([board.tsx](../../../src/client/board.tsx)). A single `optimistic` move overlay is applied to the rendered lists, so a user move paints before the command returns.
- Every movement source converges on that one render: `useBoardMoves` → `useMoveRequest.apply` ([useMoveRequest.ts](../../../src/client/useMoveRequest.ts)), the drawer's stage control through the same `moveTo` ([drawer.tsx](../../../src/client/drawer.tsx)), automatic advances and team-sync updates through the accepted snapshot ([board.tsx](../../../src/client/board.tsx)), and deletions through the same snapshot.
- Cards are keyed by task id and carry `data-task-id`; each list is `.kb-card-list` inside a `.kb-column` inside the horizontally scrolling `.kb-columns`, which itself sits in the vertically scrolling `.kb-page-body`.
- Per-column order is computed inside the render loop (`tasksForColumn`), so the rendered order is currently never exposed as data.
- The only motion today is the task drawer's 180 ms CSS keyframes ([styles.ts](../../../src/client/styles.ts)) and the pointer-following drag ghost, which is cloned into `document.body` with an inline style string ([useCardDrag.ts](../../../src/client/useCardDrag.ts)).
- The Host already solves keyed-row movement in `packages/client/ui-primitives/src/AnimatedRows.tsx`: pre-commit `getSnapshotBeforeUpdate`, Web Animations, 200 ms glides with 100 ms fades, inert copies for removed rows, `rowKeys`/`ready`/`resetKey`, arming on the first local input, and reduced-motion handling. Host plugin practices forbid importing a Harness Client package into a plugin, so the pattern is copied into a plugin-owned module, not imported.

## Goals / Non-Goals

**Goals:**

- One board-scoped motion pipeline that covers every membership and order change without wiring each cause.
- Pure, unit-testable decision logic; the DOM layer is a small injectable port and the only place that starts animations.
- No new props on the memoized cards, no new dependency, no Host API, no protocol or storage change.
- Motion never affects board data, commands, focus, activation, scroll range, or the drag contract.
- Explicit gates for readiness, reduced motion, view replacement, batch size, and size-only reflow.

**Non-Goals:**

- Animating column height, column headers, counts, hub tabs, or the empty-column note's box.
- Replacing the drag preview; the ghost keeps following the pointer and is not animated by this pipeline.
- A per-board or per-user motion setting.
- Layout observers, polling, scroll-driven motion, or a general-purpose animation library.
- Animating content-only reflow, such as a card growing because a status line appeared.
- Changing card markup, the command protocol, or `BoardState`.

## Decisions

### One board-scoped class frame using `getSnapshotBeforeUpdate`

Add `CardMotionFrame`, one component wrapped around the whole `.kb-columns` grid.

- Previous geometry is only reliable before React mutates the DOM. A keyed card that moves between two lists is unmounted from the old parent and mounted in the new one in the same commit, so a post-commit hook only sees the destination node; `getSnapshotBeforeUpdate` supplies the exact pre-mutation rectangles for both the moved card and its neighbors.
- One frame for the whole grid, rather than one per column, is what makes a cross-column glide possible: the snapshot and the diff cover the same coordinate space.
- Precedent: `AnimatedRows` in the Host. The plugin owns its copy so a Host change cannot reach into the board.

Alternatives considered:

- **A hook measuring in `useLayoutEffect`** — the same data is available, but a commit that interrupts a running animation measures already-transformed rectangles, and a size-only change between two commits leaves stale "before" values. Cancelling first then measuring produces a layout snap that has to be reasoned about per call site.
- **CSS transitions driven by data attributes** — matches the drawer's keyframe style, but restarting a transition on rapid updates needs a forced reflow plus a cleanup timer, and cancellation state lives in the element's inline style.
- **The View Transitions API** — unsupported in part of the Host's renderer set, couples motion to the state flush, and animates the whole page unless every card carries a `view-transition-name`.

### Module seams: pure planning, DOM port, frame, preference

`src/client/card-motion/layout.ts` — pure. `CardRect`, `CardSnapshot`, `sameRowKeys`, `movementFor`, `intersectsViewport`, and the exit-copy placement math. No DOM and no React, which is what the fast test lane can prove.

`src/client/card-motion/animator.ts` — the DOM port. A `CardAnimator` that receives the timing values and an `animate` function, exposes `glide`, `fadeIn`, `fadeOut`, `cancelAll`, and tracks in-flight animations and exit copies. Every animation uses `element.animate` and is cancelled on finish so no transform survives.

`src/client/card-motion/frame.tsx` — the React frame. Reads geometry through a small reader, builds the plan from `rowKeys` plus the two geometry maps, delegates every animation to the animator, and renders the wrapper plus an `aria-hidden` overlay for exit copies. It owns no board state and never inspects task data.

`src/client/card-motion/preference.ts` — `prefersReducedMotion()`, shared with the drawer so the two motion paths agree on the system preference.

Keeping the diff in a pure module satisfies the single-responsibility goal, and keeping every animation call behind the animator lets tests substitute a fake and lets the frame stay small.

### Rendered order gets one source of truth

Extract `src/client/board-columns.ts`: `planColumns(workflow, tasks, optimistic)` returns the ordered slots and columns with their tasks, and `cardRowKeys(plan)` flattens them in DOM order. `board.tsx` renders from the plan and passes the flattened ids to the frame.

Alternatives considered:

- **Derive order from the DOM after the commit** — workable, but it duplicates the projection anyway and makes the "membership or order changed" decision read the DOM it is about to animate, which is harder to test and to reason about.
- **Pass per-column task lists** — more props and a second ordering convention at the boundary; the flattened key list is exactly what the frame compares.

### Motion model

- One key comparison decides the commit: equal `rowKeys` means no membership or order change, and the frame reads nothing and animates nothing. A changed commit reads the pre-mutation geometry before React moves the nodes, so the origins are exact and no stored geometry can go stale.
- On a changed commit, every id present before and after with a non-zero rectangle delta glides from its old offset to zero. The card receives a temporary stacking index while gliding so it paints above the columns it crosses.
- Ids that appear fade in; ids that disappear leave an inert copy in the overlay that fades out. The copy loses `data-task-id` so identity queries, hit testing, and focus restoration cannot reach it.
- The next commit cancels in-flight animations before measuring, so starts are layout-true; a rapid second move restarts from the new positions instead of blending.
- Cards outside the frame's viewport before or after the commit are skipped, matching the Host animator and avoiding off-screen work.

### Gates: readiness, arming, view reset, batch, reduced motion

- Mount never animates: there is no previous commit.
- `ready` is whether a board state is being rendered; a board that is not ready settles and clears.
- The frame arms on the first pointer or keyboard input inside it, like the Host. A board that appears from a cached snapshot therefore does not animate at a user who is not interacting with it.
- `resetKey` combines the active Hub id, board id, text search, and project filter. A change settles immediately and cancels running animations, so a view replacement never produces a cascade.
- A batch above the fixed cap — more than eight cards entering or leaving the board in one commit — settles immediately. Cards that stay and only shift do not count, so a normal move in a long stage still animates while bulk deletion or a large team update settles. The cap also covers a large membership change that does not change `resetKey`.
- Reduced motion is read per commit and skips the whole pipeline, exit copies included. No listener is required because every decision happens on a commit; an animation already running when the preference flips finishes, and the next commit cancels it. That edge is acceptable and documented.

### Exit copies and the overlay

The wrapper gains a positioned, `aria-hidden` overlay: `position:absolute`, `inset:0`, `pointer-events:none`, `overflow:hidden`, with `.kb-columns` becoming `position:relative`. Placing a copy at `rect - overlayRect` is scroll-invariant because both rectangles move with the scroller, and the clipped overlay keeps the copy out of the scroll range. The copy keeps its dimensions, is `inert`, and is removed when its fade finishes or when the frame unmounts.

### Timing and easing

The Host values: 200 ms glide, 100 ms entry and exit fades, `ease-out`. No `fill: forwards`; completion cancels the animation, so the element returns to its untransformed layout.

### Cleanups included with this change

- The drawer and the card frame share `prefersReducedMotion()`; the local helper in `board.tsx` goes away.
- The drag ghost's floating-card styling moves to a `.kb-drag-ghost` class; only position and size stay inline, and the clone stays in `document.body` while a drag is active.
- The empty-column note fades in after the exiting card is gone instead of replacing it in one frame. It keeps its conditional render; no hidden node is kept mounted.

### Verification approach

- **Node unit tests** for `layout.ts` and `board-columns.ts`: same keys, reorder, entry, exit, deltas, viewport intersection, optimistic placement, grouping and DOM order.
- **jsdom component tests** for the gates with a fake animator and stubbed geometry: no animation before arming, none when `ready` is false, none for a size-only commit, none for a `resetKey` change, none above the batch cap, none with reduced motion, and inert id-stripped exit copies.
- **Playwright browser tests** for what jsdom cannot compute: a real drag produces glides whose mid-flight transforms are non-zero, neighbors move, an exit copy appears and disappears, reduced motion clears everything, a board switch settles, and `scrollWidth`/`scrollHeight` are unchanged by an exit copy.
- **Style contract test** in `tests/client/styles.test.ts` for the overlay, the positioned grid, the drag-ghost class, and a reduced-motion block.
- No model traffic. The browser lane uses the plugin-owned harness as it does for the drawer animation.

## Risks / Trade-offs

- **Click and hover land on a moving card** → Keep cards interactive as the spec requires; the exit copy is inert, identity attributes are stripped, and the stacking index lives only for the glide. The click target is the card's current visual position, which is what the user sees.
- **A commit interrupts a running animation** → Cancel before measuring, which snaps to layout, then restart from the new geometry. Short durations keep the snap small; the alternative (blending) costs more state than the board needs.
- **Geometry reads add layout work** → One batched read before and one after a commit that changes membership or order, with no interleaved writes; a commit that changes nothing reads nothing. Off-viewport cards are skipped.
- **The overlay inside a scroll container could extend the scroll range** → `inset:0` plus `overflow:hidden`; the browser test compares `scrollWidth`/`scrollHeight` across an exit.
- **A cascade on bulk deletion or a filter change not covered by `resetKey`** → The batch cap settles it; the cap is a constant, so tuning it does not change the spec.
- **Column height still changes in one step** → Accepted: columns are content-sized by requirement, and animating height would fight the page scroll. The card, not the column, is what moves.
- **jsdom cannot prove motion** → The fast lane asserts planning and gating; real geometry and animation presence stay in Playwright.
- **Reduced motion flipped mid-animation** → The running animation finishes; the next commit cancels it. Documented as an acceptable edge.
- **The frame could hide a card if it throws** → The frame does not render card content, catches nothing from the board, and clears its overlay on unmount, so a failure can only remove motion, not cards. Board error handling stays where it is.

## Migration Plan

1. Land the pure modules and their tests (`card-motion/layout.ts`, `board-columns.ts`).
2. Land the animator with a fake-`animate` test, then the frame with the jsdom gate tests.
3. Wire `board.tsx`: render from the column plan, pass `rowKeys`, `resetKey`, `ready`, and the armed frame.
4. Add the overlay and drag-ghost styles, and the empty-column note transition.
5. Add the Playwright scenario and extend the style contract test.
6. Update the README behavior note and bump `package.json` for the published artifact.
7. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check`, and `pnpm test:browser`.

No data migration. Rollback is removing the frame wrapper and the plan-based rendering: the board returns to instant reflow, and no persisted state depends on the motion. The frame removes its overlay and cancels animations on unmount, so a reload never leaves motion artifacts.

## Open Questions

- The exact stacking index used while a card glides is a visual check during implementation; it does not change the approach or the specs.
- Whether the eight-card batch cap still feels right on a real long board is an observation after implementation; it is a constant, not a spec or design change.
- Whether the empty-column note's fade should reuse the motion timing constants or keep its own CSS duration is cosmetic and settled during implementation.
