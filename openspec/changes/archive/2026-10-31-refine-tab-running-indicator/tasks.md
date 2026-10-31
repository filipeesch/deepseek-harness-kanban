# Tasks

## 1. Scope projection

- [x] 1.1 Add `src/client/scope-activity.ts` with the `ScopeActivity` shape and `projectScopeActivity(tasks, attention)`, counting each task once when it has a running turn, an owned subagent, or non-empty background work, and collecting titles in task order; verify `pnpm run typecheck` accepts the new module.
- [x] 1.2 Replace `ScopeAttention`/`scopeAttention` in `src/client/hub-view.ts` and update its only consumer; verify `grep -rn "scopeAttention" src tests` returns no stale references.
- [x] 1.3 Add focused unit tests for the projection covering count-once, subagent-only, background-only, empty scope, title order, and unread/failure folding; verify `pnpm exec vitest run tests/client/scope-activity.test.ts` passes.

## 2. Running-task indicator presentation

- [x] 2.1 Add `src/client/running-tasks-badge.tsx` exporting `RunningTasksBadge`, rendering the pulsing ring plus numeral as one labeled `role="img"` group with a title listing the running task titles and nothing when the count is zero; verify a client test renders the count and accessible name.
- [x] 2.2 Move tab activity styles into `src/client/activity-styles.ts` using the host accent token and the existing pulse keyframes, add the reduced-motion rule, and delete `.kb-dot.kb-activity` from `src/client/styles.ts`; verify no `kb-activity` remains and the dot's `#38a169` rule is gone (the unrelated Git-ready and YAML-valid green tones stay).
- [x] 2.3 Extract both tab rows into `src/client/hub-nav.tsx` as a prop-driven `HubNav` that renders hubs, boards, active state, activity maps, and select/create callbacks; verify it imports no snapshot or command module and the existing Hub/board navigation tests still pass.

## 3. Board wiring

- [x] 3.1 Precompute Hub and board activity maps once per snapshot in `BoardView`, render `HubNav`, and delete `attentionForHub`, `attentionForBoard`, and the inline tab JSX; verify the page typechecks and Hub/board switching still works in the client tests.
- [x] 3.2 Confirm the unread and failure dots keep their current labels and positions beside the new indicator; verify the existing unread-aggregation and failure scenarios still pass unchanged.
- [x] 3.3 Verify the indicator clears without a reload when the last running task settles, and that an inactive Hub or board tab keeps its count; verify with a client test that publishes a settled snapshot.

## 4. Appearance and accessibility verification

- [x] 4.1 Update `tests/client/hub-navigation.test.tsx` and any other client assertions for the new tab accessible names and the running count; verify `pnpm test` passes.
- [x] 4.2 Update `tests/browser/hub-navigation.spec.ts` and `tests/browser/hub-tabs-appearance.spec.ts` to target the ring and numeral instead of `.kb-dot.kb-activity`, asserting the count, hover title, and presence in both host appearances; verify `pnpm test:browser` passes and stores screenshots under `.verification/`.
- [x] 4.3 Verify the reduced-motion rule keeps the ring visible with no animation, and that the light and dark accent contrast is at least 4.5:1 in the browser lane.
- [x] 4.4 Run `pnpm check` and confirm host/client typechecks, vitest, and the build all pass.

## 5. Spec reconciliation

- [x] 5.1 Re-read the delta specs against the implemented behavior (counted unit, numeral presence at one, tooltip, accessible name, reduced motion) and confirm `openspec validate "refine-tab-running-indicator" --strict` passes.

## 6. Attention parity and ordering

- [x] 6.1 Fold awaiting-reply attention in `projectScopeActivity` and extend its unit tests; verify `pnpm exec vitest run tests/client/scope-activity.test.ts` passes.
- [x] 6.2 Render the orange awaiting-reply dot in `HubNav` before the failure dot and place `RunningTasksBadge` last; verify the client test asserts `blue, orange, red, running` order and the awaiting-reply labels.
- [x] 6.3 Update the delta specs, design, and proposal for the awaiting-reply indicator and the trailing running indicator; verify `openspec validate "refine-tab-running-indicator" --strict` passes.
- [x] 6.4 Update the browser tab appearance assertion for the three-dot order and rerun `pnpm test:browser`, then `pnpm check`.

## 7. Review follow-ups

- [x] 7.1 Preserve the board tab row, including its Create board action, for a Hub without boards; verify a client test covers the empty-Hub row.
- [x] 7.2 Consolidate both tab rows into one `ScopeTab` so dot order, labels, and the running mark have a single source; verify `HubNav` imports no snapshot or command module and the client tests pass.
- [x] 7.3 Assert the tab accessible name includes the running count and cover board-tab dots, order, tooltip, clearing, and an inactive board; verify the client and browser tests pass.
- [x] 7.4 Assert the numeral uses tabular figures and measure the running mark on an inactive tab in the appearance lane; verify `pnpm test:browser` passes.
- [x] 7.5 Add `awaitingReply` to the design's `ScopeActivity` snippet and rename the subagent projection test to match what it proves; verify strict validation and the full gates.


