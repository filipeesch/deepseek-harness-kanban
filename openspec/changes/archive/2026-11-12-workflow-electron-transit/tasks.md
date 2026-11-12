# Tasks

## 1. Transit core (pure policy, timing, planning, capability)

- [x] 1.1 Add `src/client/workflow-view/transit/policy.ts` holding one motion policy: the batch cap, the 300-700 ms duration range, the speed constant, and the trail size; make `card-motion/config.ts` consume that shared cap instead of its own literal. Verify `grep -rn "batchLimit" src/client` finds a single definition and `pnpm vitest run tests/client/card-motion-animator.test.ts tests/client/card-motion-frame.test.tsx` passes.
- [x] 1.2 Add `src/client/workflow-view/transit/timing.ts` with `durationFor(length)` clamped to the policy range. Verify a new unit test covers a short, a mid, and a long path plus both clamp boundaries.
- [x] 1.3 Add `src/client/workflow-view/transit/plan.ts` returning one transit per task whose stage changed and whose two stages the committed scene connects, carrying the drawn path and its length, applying the cap and the reduced-motion gate through injected inputs. Verify a unit test covers: solid connection, dashed implicit connection, adjusted route, no drawn connection (empty), same-stage reorder (empty), batch above the cap (empty), and a stage the scene does not show (empty).
- [x] 1.4 Add `src/client/workflow-view/transit/port.ts` exposing whether the host can animate an element along an SVG path, with an injectable override for tests and harnesses. Verify a unit test covers the supported and unsupported branches without touching a real renderer.
- [x] 1.5 Retire the direct-path fallback: with no caller left, remove the `directShape` export from `routing/orthogonal.ts` and its assertions in `tests/client/workflow-connections.test.ts`. Verify `grep -rn directShape src tests` returns nothing and `pnpm vitest run tests/client/workflow-connections.test.ts` passes.

## 2. Electron layer and transit orchestration

- [x] 2.1 Add `src/client/workflow-view/transit/layer.tsx` rendering one keyed group per transit: a bright core, a halo, and a short trail as staggered siblings sharing the connection's SVG path, all `aria-hidden` and non-interactive, reporting arrival from the last-ending animation. Verify a jsdom unit test asserts one group per transit, the exact path and duration on each particle, that a re-render with the same transits keeps the same DOM nodes, and that a dispatched animation end reports arrival once and removes the group.
- [x] 2.2 Add `src/client/workflow-view/use/use-transit.ts` planning from the stage map of the presented cards, deduplicating an identical `(taskId, from, to)` still in flight, retaining a transit until its arrival, dropping transits when the presented view is replaced, and gating on reduced motion and on the capability port. Verify a `renderHook` unit test asserts: one transit per movement, one transit across an optimistic plus authoritative pair, no clearing on an unrelated filter change, none under reduced motion, and none without a drawn connection.
- [x] 2.3 Wire the transit into `workflow-view.tsx` in place of the travel wiring and delete `travel.ts`, `travel-layer.tsx`, and `use/use-travel.ts` together with their unit tests. Verify `pnpm typecheck` passes and `grep -rn "TravelLayer\|useTravel\|planTravel" src tests` returns nothing.
- [x] 2.4 Move the transit styles into `workflow-view/styles.ts`: remove the `.kb-flow-travel*` rules and add the core, halo, and trail rules plus a `prefers-reduced-motion` rule that presents nothing. Verify `pnpm vitest run tests/client/styles.test.ts` passes and a new assertion covers the reduced-motion rule.
- [x] 2.5 Extend `tests/browser/workflow-view.spec.ts`: a transit is presented on a solid authored connection and on the dashed workflow-order connection, no transit and no temporary connection are presented for a restricted move between unconnected stages, and reduced motion presents none. Verify `pnpm test:browser -- workflow-view` passes.
- [x] 2.6 Add the regression case: while a transit is running, force a re-render that leaves the presented cards unchanged, then assert exactly one electron element and one running animation exist for that movement and that the animation's `currentTime` never decreases. Verify the test passes and fails against the pre-change travel layer.

## 3. Arrival pulse

- [x] 3.1 Thread an arrival token per task from the transit hook through the diagram's `renderCard` into `BoardCard` and `TaskCard`, rendering a keyed arrival element only while a token is present and removing it on its own animation end. Verify a unit test asserts the element renders once for a token, disappears after the animation end, and does not re-key the card.
- [x] 3.2 Style the pulse as a ring over the card that changes no layout, adds no scrollable area, and is absent under reduced motion. Verify `tests/client/styles.test.ts` and a browser assertion that the destination card's box does not change size while the pulse runs.
- [x] 3.3 Verify the arrival pulse also happens for a move with no drawn connection, which presents no transit. Verify in `tests/browser/workflow-view.spec.ts` for the restricted-move case.

## 4. Deterministic exit labels leave the diagram

- [x] 4.1 Remove `exitLabels` from `CanvasConnection`, the edge data, `LiveEdge`, `edge-model.ts`, and the `hasCondition` fold in `canvas.tsx`, publishing a plain deterministic flag instead; exclude that flag from the "no condition" mark. Verify a unit test asserts the mark is absent on a deterministic connection, absent on the dashed default path, and present on a plain explicit connection with no condition.
- [x] 4.2 Remove the label button from `connection-edge.tsx` and the `.kb-flow-exit-label` rule from `src/client/styles/deterministic.ts`. Verify `grep -rn "exit-label\|exitLabels" src` returns nothing and the styles test passes.
- [x] 4.3 Confirm the double-press path: a deterministic connection opens the stage editor while the layout lock is off and opens nothing while it is on, and it never opens the condition editor. Verify in `tests/browser/deterministic.spec.ts`, replacing the label click that test uses today with a double-click while unlocked plus a locked assertion.
- [x] 4.4 Review the accessible names the diagram publishes for connections so none still announces exit names. Verify by asserting the rendered accessible names in the browser lane.

## 5. Cleanup, docs, and release metadata

- [x] 5.1 Remove the constants and styles the transit replaces: the fade hold value, the endpoint opacity constants, and any leftover `.kb-flow-travel` rule. Verify `grep -rn "fadeMs\|kb-flow-travel" src tests` returns nothing and `pnpm check` passes.
- [x] 5.2 Update the README paragraph that describes a card travelling along the drawn connection, so it describes the transit, the arrival pulse, and the no-connection case. Verify `grep -n -i "travel\|electron\|transit" README.md` shows the new wording and no stale claim.
- [x] 5.3 Confirm the workflow architect preset and its skills need no edit: they document YAML, exits, and stage execution, not diagram labels or travel. Verify `grep -rn -i "exit label\|travel" presets` returns nothing and record the result in the change.
- [x] 5.4 Bump `version` in `package.json` for the installed artifact. Verify the built profile reports the new version.

## 6. Verification

- [x] 6.1 Run `pnpm check` (host and client typechecks, vitest, build) and confirm it passes with no new failures.
- [x] 6.2 Run `pnpm test:browser` and confirm the light and dark runs pass, with screenshots written under `.verification/`.
- [x] 6.3 Run the isolated real-composition lane from `AGENTS.md` with a throwaway `DSH_HOME` and a profile cloned from the shipped web template, never the owner profile; exercise a card moved between connected stages and a restricted move between unconnected stages. Verify the transit, the pulse, the absence of a duplicated card, and the label-free deterministic arrow, and keep the token URL out of every screenshot and log.
- [x] 6.4 `openspec validate workflow-electron-transit --strict` passes and the change reports every artifact done.
