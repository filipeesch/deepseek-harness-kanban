# Design

## Context

This is a single Host/client DSH plugin. The client is bundled by esbuild into one browser module loaded through `window.__ModuleLoader__`, React is external, and there is no animation dependency or worker runtime of its own. See [proposal.md](proposal.md) for motivation and the `kanban-board` delta for the behavior contract.

Current constraints that shape the approach:

- `BoardView` renders every card from the snapshot it holds ([board.tsx](../../../src/client/board.tsx)). A single `optimistic` move overlay is applied to the rendered lists, so a user move paints before the command returns.
- Every movement source converges on that one render: `useBoardMoves` → `useMoveRequest.apply` ([useMoveRequest.ts](../../../src/client/useMoveRequest.ts)), the drawer's stage control through the same `moveTo` ([drawer.tsx](../../../src/client/drawer.tsx)), automatic advances and team-sync updates through the accepted snapshot ([board.tsx](../../../src/client/board.tsx)), and deletions through the same snapshot.
- Cards are keyed by task id and carry `data-task-id`; each list is `.kb-card-list` inside a `.kb-column` inside the horizontally scrolling `.kb-columns`, which itself sits in the vertically scrolling `.kb-page-body`.
- Per-column order is computed inside the render loop (`tasksForColumn`), so the rendered order is currently never exposed as data.
- The only motion today is the task drawer's 180 ms CSS keyframes ([styles.ts](../../../src/client/styles.ts)) and the pointer-following drag ghost, which is cloned with an inline style string ([useCardDrag.ts](../../../src/client/useCardDrag.ts)); this change moves its styling into the plugin's CSS.
- The Host already solves keyed-row movement in `packages/client/ui-primitives/src/AnimatedRows.tsx`: pre-commit `getSnapshotBeforeUpdate`, Web Animations, 200 ms glides with 100 ms fades, inert copies for removed rows, a keyed-row signature, and reduced-motion handling. Host plugin practices forbid importing a Harness Client package into a plugin, so the pattern is copied into a plugin-owned module, not imported. The board keeps the pre-commit snapshot and the fades, and replaces the Host's interaction arming with a column-aware signature (below).

## Goals / Non-Goals

**Goals:**

- One board-scoped motion pipeline that covers every membership and order change without wiring each cause.
- Pure, unit-testable decision logic; the DOM layer is a small injectable port and the only place that starts animations.
- No new props on the memoized cards, no new dependency, no Host API, no protocol or storage change.
- Motion never affects board data, commands, focus, activation, scroll range, or the drag contract.
- Explicit gates for reduced motion, view replacement, batch membership, viewport, and size-only reflow.

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

`src/client/card-motion/frame.tsx` — the React frame. Reads geometry through a small reader, decides from `layoutKeys` plus the two geometry maps, delegates every animation to the animator, and renders the wrapper plus an `aria-hidden` overlay for exit copies. It owns no board state and never inspects task data.

`src/client/card-motion/preference.ts` — `prefersReducedMotion()`, shared with the drawer so the two motion paths agree on the system preference.

Keeping the diff in a pure module satisfies the single-responsibility goal, and keeping every animation call behind the animator lets tests substitute a fake and lets the frame stay small.

### Rendered order gets one source of truth

Extract `src/client/board-columns.ts`: `planColumns(workflow, tasks, optimistic)` returns the ordered slots and columns with their tasks, and `cardLayoutKeys(plan)` flattens them in DOM order with each card prefixed by its column id. `board.tsx` renders from the plan and passes those keys to the frame.

The column prefix is required: a flat sequence of task ids is identical when a column's last card moves to the top of the next column, which is exactly how a drawer stage change and an automatic advance place a card. The frame must still animate that commit, so the compared key carries the stage.

Alternatives considered:

- **Derive order from the DOM after the commit** — workable, but it duplicates the projection anyway and makes the "membership or order changed" decision read the DOM it is about to animate, which is harder to test and to reason about.
- **Pass per-column task lists** — more props and a second ordering convention at the boundary; the flattened key list is exactly what the frame compares.

### Motion model

- One key comparison decides the commit: equal `layoutKeys` means no stage, membership, or order change, and the frame reads nothing and animates nothing. A changed commit reads the pre-mutation geometry before React moves the nodes, so the origins are exact and no stored geometry can go stale.
- On a changed commit, every id present before and after with a non-zero rectangle delta glides from its old offset to zero. The card receives a temporary stacking index while gliding so it paints above the columns it crosses.
- Ids that appear fade in; ids that disappear leave an inert copy in the overlay that fades out. The copy loses `data-task-id` so identity queries, hit testing, and focus restoration cannot reach it.
- The pre-mutation read happens while an earlier glide may still run, so the origin is the card's visual position; the frame then cancels running glides so the target measurement is layout-true. A rapid second move therefore starts from what the user sees and ends at the new layout instead of blending.
- Cards outside the frame's viewport before or after the commit are skipped, matching the Host animator and avoiding off-screen work.

### Gates: view reset, batch, viewport, reduced motion

- Mount never animates: there is no previous commit. Every post-mount change animates, including an automatic advance or a team-sync update that arrives before the user has touched the board; the board's first paint cannot animate, so no arming gate is needed.
- `resetKey` combines the active Hub id, board id, text search, and project filter. A change settles immediately and cancels running animations, so a view replacement never produces a cascade.
- A batch above the fixed cap — more than eight cards entering or leaving the board in one commit — settles immediately. Cards that stay and only shift do not count, so a normal move in a long stage still animates while bulk deletion or a large team update settles. The cap also covers a large membership change that does not change `resetKey`.
- Cards that do not intersect the visible board before or after the commit are skipped. A zero-size board (hidden layout) skips every card instead of animating an invisible surface.
- Both lifecycle methods are guarded: a motion failure settles and clears the overlay rather than propagating into the board render.
- Reduced motion is read per commit and skips the whole pipeline, exit copies included. No listener is required because every decision happens on a commit; an animation already running when the preference flips finishes, and the next commit cancels it. That edge is acceptable and documented.

### Exit copies and the overlay

The wrapper gains a positioned, `aria-hidden` overlay: `position:absolute`, `left:0`, `top:0`, `pointer-events:none`, `overflow:hidden`, with `.kb-columns` becoming `position:relative`. Before placing copies, the frame sizes the overlay to the visible scrollport in the scroller's content coordinates (`scrollLeft`/`scrollTop` plus `clientWidth`/`clientHeight`); otherwise a horizontally scrolled board would clip the fades of cards near the end of the content. Placing a copy at `rect - overlayRect` is then correct in both position and clip region, and the clipped overlay keeps the copy out of the scroll range. The copy keeps its dimensions, is `inert`, and is removed when its fade finishes or when the frame unmounts.

### Timing and easing

The Host values: 200 ms glide, 100 ms entry and exit fades, `ease-out`. No `fill: forwards`; completion cancels the animation, so the element returns to its untransformed layout.

### Cleanups included with this change

- The drawer and the card frame share `prefersReducedMotion()`; the local helper in `board.tsx` goes away.
- The drag ghost's floating-card styling moves to a `.kb-drag-ghost` class; only position and size stay inline, and the clone is appended to the plugin root so the board's scoped card styles and theme tokens apply to it (the previous `document.body` clone rendered unstyled).
- The empty-column note fades in after the exiting card is gone instead of replacing it in one frame. It keeps its conditional render; no hidden node is kept mounted.

### Verification approach

- **Node unit tests** for `layout.ts` and `board-columns.ts`: same keys, reorder, entry, exit, deltas, viewport intersection, optimistic placement, grouping and DOM order.
- **jsdom component tests** for the gates with a fake animator and stubbed geometry: a stage change whose flat task order is identical, order changes, size-only commits, `resetKey` replacement, membership batches at the eight/ nine boundary and a large exit batch, an empty board's first card, the viewport gate, reduced motion for movement/entry/exit, unmount cleanup, an animator-disabled host, and inert id-stripped exit copies.
- **Playwright browser tests** for what jsdom cannot compute: a real drag produces glides whose mid-flight transforms are non-zero and whose neighbors move, a stage change on a column's last card animates even though the flat order is unchanged, the drawer's stage control animates, host-driven changes animate with no command, an exit copy appears, disappears, and stays visible after horizontal scrolling without growing the scroll area, reduced motion clears everything, search and project filter replacements settle, a Hub switch settles, focus stays available during motion, and the board frame keeps its position and height.
- **Style contract test** in `tests/client/styles.test.ts` for the overlay, the positioned grid, the drag-ghost class, and a reduced-motion block.
- No model traffic. The browser lane uses the plugin-owned harness as it does for the drawer animation.

### Scenario coverage

| Delta scenario | Covering test |
| --- | --- |
| Move a card between stages | `tests/browser/card-motion.spec.ts` "a drop glides…"; `tests/client/card-motion-frame.test.tsx` "glides every card whose order changed" |
| Reorder within the current stage | `tests/browser/card-motion.spec.ts` "a same-stage reorder…"; the frame order test |
| Move a card from the drawer | `tests/browser/card-motion.spec.ts` "a drawer stage change…" and "a drawer change on a column's last card still glides" |
| An automatic advance moves a card | `tests/browser/card-motion.spec.ts` "a host-driven move glides the card and sends no command" (same accepted-snapshot path) |
| A team-sync update moves a card | The same host-driven browser test |
| A new card enters | `tests/browser/card-motion.spec.ts` "an appearing card fades in"; the frame "fades the first card of an empty board" |
| A removed card leaves | `tests/browser/card-motion.spec.ts` "a leaving card fades…"; the frame exit-copy test |
| A size-only change settles | `tests/client/card-motion-frame.test.tsx` "settles a commit that only changed a card size" |
| Replace the presented view | `tests/browser/card-motion.spec.ts` search, project filter, and Hub switch tests; the frame `resetKey` test |
| Settle a large batch | Frame tests at the eight/nine entry boundary, the large exit batch, and the board-columns key test |
| Move a card in a long stage | The browser drop test (12-card column) and the frame long-reorder test |
| Reduced motion | The browser reduced-motion test and the frame movement/entry/exit test |
| Keep interaction available during motion | The browser drop test focuses the moving card's open button during the glide, then activates it after the settle, and asserts the board frame position and height |
| Motion changes no board data | The browser drop test asserts exactly one `task.move`; the host-driven tests assert zero commands |

## Risks / Trade-offs

- **Click and hover land on a moving card** → Keep cards interactive as the spec requires; the exit copy is inert, identity attributes are stripped, and the stacking index lives only for the glide. The click target is the card's current visual position, which is what the user sees.
- **A commit interrupts a running animation** → Cancel before measuring, which snaps to layout, then restart from the new geometry. Short durations keep the snap small; the alternative (blending) costs more state than the board needs.
- **Geometry reads add layout work** → One batched read before and one after a commit that changes membership or order, with no interleaved writes; a commit that changes nothing reads nothing. Off-viewport cards are skipped.
- **The overlay inside a scroll container could extend the scroll range or clip a scrolled exit** → The overlay is sized to the visible scrollport and clipped with `overflow:hidden`; browser tests compare `scrollWidth`/`scrollHeight` across an exit and assert a scrolled copy stays inside the board.
- **A cascade on bulk deletion or a filter change not covered by `resetKey`** → The batch cap settles it; the cap is a constant, so tuning it does not change the spec.
- **Column height still changes in one step** → Accepted: columns are content-sized by requirement, and animating height would fight the page scroll. The card, not the column, is what moves.
- **jsdom cannot prove motion** → The fast lane asserts planning and gating; real geometry and animation presence stay in Playwright.
- **Reduced motion flipped mid-animation** → The running animation finishes; the next commit cancels it. Documented as an acceptable edge.
- **The frame could hide a card if it throws** → Both lifecycle methods catch their own failures and settle the animation, and the frame never renders card content, so a motion failure cannot unmount the board. The browser and jsdom lanes keep the behavior covered.

## Migration Plan

1. Land the pure modules and their tests (`card-motion/layout.ts`, `board-columns.ts`).
2. Land the animator with a fake-`animate` test, then the frame with the jsdom gate tests.
3. Wire `board.tsx`: render from the column plan, then pass `layoutKeys` and `resetKey` to the frame.
4. Add the overlay and drag-ghost styles, and the empty-column note transition.
5. Add the Playwright scenario and extend the style contract test.
6. Update the README behavior note and bump `package.json` for the published artifact.
7. Run `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check`, and `pnpm test:browser`.

No data migration. Rollback is removing the frame wrapper and the plan-based rendering: the board returns to instant reflow, and no persisted state depends on the motion. The frame removes its overlay and cancels animations on unmount, so a reload never leaves motion artifacts.

## Open Questions

- The exact stacking index used while a card glides is a visual check during implementation; it does not change the approach or the specs.
- Whether the eight-card batch cap still feels right on a real long board is an observation after implementation; it is a constant, not a spec or design change.
- Whether the empty-column note's fade should reuse the motion timing constants or keep its own CSS duration is cosmetic and settled during implementation.
