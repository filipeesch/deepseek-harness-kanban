# Tasks

## 1. Height policy

- [x] 1.1 Create `src/client/seat-budget.ts` with pure functions: a strip's need from its fixed and content heights, the water-filling distribution by need, and the presentation choice (normal, tight, cramped, compact launcher) from the available height. Add `tests/client/seat-budget.test.ts` covering content shorter than the spare (no scroll), content taller than the spare (scroll at the spare), no fixed ceiling on a large scrollport, two strips sharing by need, a collapsed strip costing only its header, and a short conversation falling back. Verify with `pnpm vitest run tests/client/seat-budget.test.ts`.
- [x] 1.2 Move `seatStripBudget` in `src/client/dock-seat.tsx` onto the pure module, keeping measurement, the portal move, the launcher state machine, and the observed elements. Measure content from the expanded body's `scrollHeight`, not from the clipped box. Verify with `pnpm run typecheck` and `pnpm run test:browser -- tests/browser/decision-dock-placement.spec.ts`.
- [x] 1.3 Remove the fixed 460px ceiling, the 24px body floor, and the equal split from the seat and from the fallback max-height in `src/questions/styles.ts`. Verify no fixed ceiling literal remains in the seat or the styles, and that the browser fit tests still pass.
- [x] 1.4 Keep the panel inside the chat scrollport in every presentation: assert in the seat that the normal and cramped placements never start above the scrollport top. Verify with a browser test that places the strip in an embedded conversation and asserts its top is at or below the scrollport top.

## 2. Stacked question rounds

- [x] 2.1 Replace `selectActiveRound` with a selector that returns every unresolved round of the conversation in arrival order, still honouring the in-flight submitted round and the focused-round preference. Verify with unit tests in `tests/questions` covering order, submission suppression, and dismissal exclusion.
- [x] 2.2 Render one `DockStrip` per unresolved round in `src/client/question-dock.tsx`, with the oldest first. Verify with a client test that mounts two rounds and asserts two blocks in order.
- [x] 2.3 Move the block's expansion state from `QuestionForm` into the dock: the form accepts `collapsed` and `onToggleCollapsed`. Verify with client tests for toggling, for restored drafts, and for the dismissal collapse behavior.
- [x] 2.4 Apply the stack rules in the dock: the oldest unresolved round expanded, a round that arrives while another is unresolved collapsed below it, several blocks open at once, and promotion of the oldest remaining block when a round leaves. Verify with client tests and the browser stack test.
- [x] 2.5 Keep the launcher fallback presentation-only: it must not overwrite the dock's expansion state, and leaving the launcher presentation must restore the person's choice. Verify with the shallow-conversation browser tests and the launcher client tests.
- [x] 2.6 Confirm a new turn's pages never join an earlier round: the projection keeps one round per turn and the dock shows the later turn as a collapsed block. Verify with an indexer test over two turns and a client test asserting two blocks.

## 3. Round life cycle

- [x] 3.1 In `src/questions/indexer.ts`, stop deriving `answered` from any human message and treat a round as no longer answerable only when its turn is recorded as answered or dismissed. Keep `complete` from the turn end and keep `pending` over the unresolved rounds. Verify with indexer tests: an ordinary human message leaves the round unresolved, a recorded turn retires it, and a later page does not resurrect it.
- [x] 3.2 Change `dismissQuestions` in `src/host/app.ts` to mark only the target round's turn, prune only that round's draft, and keep the existing lane and rollback. Verify with host tests covering per-round dismissal, a failed write that restores the round, and the remaining rounds keeping their drafts.
- [x] 3.3 Add the host and remote path the dock calls after a reply admission settles to record a round as answered, reusing the same durable list, lane, and rollback as dismissal. Verify with host and remote tests, including a failed write being reported without un-answering the reply.
- [x] 3.4 Wire `src/client-bridge.ts` and `src/client/question-dock.tsx` so a confirmed submit records the round only after the reply is admitted, and a failed record is reported by the dock. Verify with client and bridge tests.
- [x] 3.5 Verify pending user work per round: submitting or dismissing one round consumes that round's hold while another unresolved round keeps holding auto mode, and an ordinary chat reply consumes neither. Verify with the pending-work tests and the auto-mode host tests.
- [x] 3.6 Verify reload behavior: a submitted round does not reappear, and a dismissed round stays dismissed, with the remaining rounds restored in the stack. Verify with the durable question state tests.

## 4. Model guidance and open-round notice

- [x] 4.1 Update the `decision_request` description in `src/host/tools/questions.ts` with the self-contained-page rule, the prohibition on announcing or previewing later pages, the note that the form reports progress, and the no-re-ask rule; keep the per-call result unchanged. Verify with host tests that assert the new phrases and the unchanged result text.
- [x] 4.2 Add the same self-contained-page rule to the workflow operator preset guidance in `cordis.patch.yml`. Verify with the preset tests and a read of the shipped instruction.
- [x] 4.3 Add `src/host/question-notice.ts` as a pre-step injector that names each open round and its questions, bounded in rounds and characters, and register it in the host composition. Verify with host tests: two open rounds are named, no notice without open rounds, and the notice is not recorded as a human reply.
- [x] 4.4 Verify the notice is recorded only as a host context message: the question projection never counts it as the person's reply, no round is retired by it, and it creates no question page. Verify with a test over a conversation with a steering message and one open round, asserting the notice source and that the projection ignores it.

## 5. Decision gate

- [x] 5.1 Make the gate use the shared content-driven policy and stay expanded and first in the seat, with stacked rounds below it. Verify with a browser test that shows a gate and two rounds sharing the seat by need, every surface answerable, and the gate above the rounds.
- [x] 5.2 Verify the gate still scrolls only when its content exceeds the seat, keeps its header and confirm action visible, and keeps the five-second window cancelable. Verify with the existing decision browser tests.

## 6. Documentation and release

- [x] 6.1 Update `docs/user/conversations.md`: the content-driven height, the stacked rounds with their expansion rules, per-round retirement and dismissal, and the ordinary reply no longer retiring a round.
- [x] 6.2 Update `docs/user/agent-tools.md`: the self-contained-page rule, no announcement of later pages, and the no-re-ask rule.
- [x] 6.3 Update `docs/development/presets.md` if it enumerates the operator's question guidance. Verify with `pnpm run check`.
- [x] 6.4 Bump `version` in `package.json` for the release artifact. Verify the documentation gate accepts the new version claim.

## 7. Verification

- [x] 7.1 Extend `tests/browser/decision-dock-placement.spec.ts` and the question-dock browser coverage: a short strip does not scroll at 1440x900 and 2560x1440, a strip grows past the old 460px cap, a long strip scrolls only beyond the seat, the header and tab row stay uncovered, two strips share by need, and two unresolved rounds stack. Capture screenshots into `.verification/`.
- [x] 7.2 Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:browser`, and `pnpm run check`; fix every failure.
- [x] 7.3 Run `openspec validate question-dock-fit-and-stack --strict` and confirm the change is valid.
