# Tasks

## 1. One source of truth for the rendered order

- [x] 1.1 Add `src/client/board-columns.ts` with a pure `planColumns(workflow, tasks, optimistic)` and `cardLayoutKeys(plan)`, which prefixes each rendered card with its column, moving today's grouping and `tasksForColumn` placement logic out of `board.tsx`; verify with `tests/client/board-columns.test.ts` covering grouped workflows, search and project filtering, optimistic placement before a card, after the last card, and at the top, and a stage change whose flat task order is identical
- [x] 1.2 Switch `board.tsx` to render from the plan and pass the flattened ids onward, deleting the local `tasksForColumn`; verify `pnpm vitest run tests/client/board.test.tsx tests/client/move-request.test.tsx` passes and the rendered per-column order is unchanged

## 2. Pure motion planning

- [x] 2.1 Add `src/client/card-motion/layout.ts` with `CardRect`, `sameRowKeys(previous, next)`, `movementFor(before, after)`, `intersectsViewport(rect, viewport)`, and the exit-copy placement helper; verify `tests/client/card-motion-layout.test.ts` covers equal keys, reorder, entry, exit, zero delta, and cards outside the viewport
- [x] 2.2 Add the fixed motion constants (200 ms glide, 100 ms fades, `ease-out`, eight-card batch cap) behind an exported `MotionTiming`/config object; verify the layout and animator tests read the config instead of literals

## 3. Animation port and shared preference

- [x] 3.1 Add `src/client/card-motion/preference.ts` with `prefersReducedMotion()` and switch the task drawer's call sites in `board.tsx` to it, removing the local helper; verify `tests/client/drawer-animation.test.tsx` still passes and the reduced-motion path no longer has a duplicate implementation
- [x] 3.2 Add `src/client/card-motion/animator.ts` with an injectable `animate` port and `glide`, `fadeIn`, `fadeOut`, `cancelAll`, and exit-copy tracking; verify `tests/client/card-motion-animator.test.ts` asserts the emitted keyframes and options, that completion cancels the animation, that a second call cancels the first, and that a finished exit copy is removed
- [x] 3.3 Guard the animator against a missing `Element.animate` so a host without Web Animations settles immediately instead of throwing; verify a unit test with the port absent performs no writes and reports no animation

## 4. The motion frame

- [x] 4.1 Add `src/client/card-motion/frame.tsx` as the board-scoped class frame: read geometry in `getSnapshotBeforeUpdate`, decide in `componentDidUpdate` from the column-aware layout keys, render the wrapper and an `aria-hidden` overlay, and clear animations and exit copies on unmount; verify with a jsdom render that a keyed reorder calls the animator once per moved card, a same-key re-render calls no animation, and a stage change with an identical flat task order still animates
- [x] 4.2 Implement the gates in the frame: `resetKey`, the eight-card membership cap (entries and exits only), size-only commits, `prefers-reduced-motion`, a zero-size board, and cards outside the viewport all settle and cancel, and both lifecycle methods catch their own failures; verify each gate has a jsdom test with stubbed geometry and a fake animator
- [x] 4.3 Make exit copies inert and identity-free — strip `data-task-id`, set `inert`, place them at overlay-relative coordinates, and remove them on finish — verify `tests/client/card-motion-frame.test.tsx` shows no `[data-task-id]` copy remains, the overlay is `aria-hidden`, and the copy cannot be focused

## 5. Board wiring

- [x] 5.1 Wrap the workflow grid in `board.tsx` with the frame, passing the plan's `layoutKeys` and `resetKey` (Hub, board, search, project filter); verify `tests/client/board.test.tsx` still passes and a new assertion finds the frame wrapper and the hidden overlay around the columns
- [x] 5.2 Add the motion styles — `.kb-columns{position:relative}`, the clipped `pointer-events:none` overlay, and the temporary stacking index used while a card glides; verify `tests/client/styles.test.ts` covers the overlay, the positioned grid, and a reduced-motion block that disables the motion

## 6. Selected cleanups

- [x] 6.1 Move the drag ghost's floating-card styling from the inline `cssText` in `useCardDrag.ts` to a `.kb-drag-ghost` class, keeping only position and size inline; verify `tests/browser/move-placement.spec.ts` still passes and the style contract test asserts the class
- [x] 6.2 Replace the instant empty-column pop with a short fade-in that runs after an exiting card is gone, keeping the conditional render; verify with a browser check that the note is absent while a card fades out and appears with an animation afterwards

## 7. Browser and system verification

- [x] 7.1 Add `tests/browser/card-motion.spec.ts` covering a real drag between stages (the card and its neighbors report active animations, a mid-flight transform is not zero, focus stays available, and the board frame keeps its position), a same-stage reorder, the drawer stage control including a column's last card, a host-driven move with no command, an appearing card, an exit copy that disappears and stays visible after horizontal scrolling without growing the scroll area, reduced motion, search and project-filter replacement, and a Hub switch; verify `pnpm test:browser` passes
- [x] 7.2 Confirm every scenario in the `kanban-board` delta maps to a fast or browser test, adding coverage for any scenario left without one; verify the mapping is listed in the change summary and `pnpm vitest run` plus `pnpm test:browser` pass
- [x] 7.3 Run the full gates `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm check` and resolve every failure without weakening the motion gates

## 8. Documentation and release

- [x] 8.1 Update the README board behavior note to describe animated card movement, entry and exit fades, the immediate settling on view replacement and large batches, and reduced-motion handling; verify the new paragraph matches the implemented behavior and mentions no new setting
- [x] 8.2 Bump `package.json` to the next patch version for the published artifact and verify `pnpm build` reports the same version and `openspec validate card-motion-on-the-board` passes
