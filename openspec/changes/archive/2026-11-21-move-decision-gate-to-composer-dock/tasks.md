# Tasks

## 1. Shared foundations

- [x] 1.1 Add a pure `taskForSession` lookup in `src/client/task-lookup.ts` that resolves the task, its Hub, and its board from a Session id over a snapshot, and verify it with unit tests covering a task conversation, a closed conversation, a Session of no task, and a Session that several tasks do not share.
- [x] 1.2 Bound the shared strip geometry in `src/questions/styles.ts` and `src/client/dock-seat.tsx`: header and footer `flex: none`, the body flexing with `min-height: 0` and its own overflow, and each strip capped by the height its composer seat can spare after reserving the composer and the other entries, with the viewport as the fallback before the seat is measured; remove the `@media(max-width:760px)` body override that conflicts with the bound. Verify the question strip's existing client and browser tests still pass.
- [x] 1.3 Add a browser assertion that a strip whose content exceeds the bound keeps its header and footer inside the viewport and scrolls its body, at a short viewport height; verify the new assertion passes against the question strip fixture.

## 2. Gate presentation

- [x] 2.1 Extract a presentational gate from `src/client/decision-panel.tsx` that takes the decision, the selected option, the observation, the collapsed state, the busy and error states, and callbacks, and keeps `kb-decision` as its root class; verify the client tests render it with no controller and no board.
- [x] 2.2 Reduce the remaining container to wiring: read the task's gate from the stage, arm the shared window, and pass the callbacks; verify the existing `tests/client/decision-panel.test.tsx` scenarios (confirm disabled without a selection, countdown, cancel, refusal keeps the selection and observation) pass against it.
- [x] 2.3 Delete the gate's local stylesheet so the strip uses the composer width and centering unchanged; verify no `max-width` override for `.kb-decision` remains and the strip renders at the composer width in the browser fixture.

## 3. Dock registration

- [x] 3.1 Register a `conversation.input.dock` entry in `src/client.tsx` with an order smaller than the question dock's 20, passing the client command port and the shared `DecisionWindowController`; verify `tests/bridge/plugin.test.tsx` expects the new entry beside the question dock and the session diagnosis.
- [x] 3.2 Implement the dock container: subscribe to the snapshot the way the board does (replayed subscription plus one reconcile call), resolve the task with `taskForSession`, derive the columns and local stage identities from the task's own board, and render nothing for a Session of no task or a task outside a decision stage; verify with a new client test for both the gate case and the foreign-Session case.
- [x] 3.3 Verify the gate is presented for a conversation opened in the host's main chat, where the board page is unmounted, and that answering from either surface yields one window per task; verify with a client test asserting the dock renders without a board page and with a browser scenario asserting one strip.

## 4. Remove the drawer placement

- [x] 4.1 Remove the gate mount and the `decisionWindow` prop from `src/client/drawer.tsx` and stop passing it from `src/client/board.tsx`, keeping the plugin-level reconcile subscription; verify `pnpm run typecheck` reports no unused prop and the drawer tests pass.
- [x] 4.2 Update the tests that assumed the drawer strip (`tests/client/decision-panel.test.tsx`, `tests/browser/decision-panel.spec.ts`, and any drawer harness scenario) so the gate is asserted through the dock; verify they pass.

## 5. Placement evidence

- [x] 5.1 Add a browser harness scenario that draws a host-like conversation with a composer and the input-dock entries, render the gate above the question strip, and assert the gate's, the question's, and the composer's bounding boxes are ordered and inside the viewport at a short height; verify the scenario's assertions pass.
- [x] 5.2 Update `tests/e2e-dsh/kanban-decision.e2e.template.ts` so the gate is located above the drawer's composer rather than at the drawer's top, and so the collapse and answer flow still passes end to end.
- [x] 5.3 Capture the UI screenshots into `.verification/` for the gate in the conversation dock (expanded, collapsed, counting down, and refused, in both appearances) and verify the image evidence exists and is not committed.

## 6. Documentation and gates

- [x] 6.1 Rewrite the decision gate paragraph in `docs/user/workflows.md` to state that the gate is answered above the composer of the task's conversation, that no conversation means no gate, and that a waiting question round sits below it; verify the page names the interface labels the product shows.
- [x] 6.2 Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:browser`, and `pnpm run check`, and verify every gate passes.

## 7. Review findings

- [x] 7.1 Budget the composer seat: reserve the composer's footprint in each strip's bound and halve the question strip's bound when a gate precedes it, so the two strips and the composer fit together; verify with the short-window browser test that measures a 420px-tall window with a 150px composer and asserts every header, every footer action, and the composer inside the viewport.
- [x] 7.2 Keep the answer-file list on one scrolling row inside the question footer, so a long list can never grow the footer past the strip's bound and clip the attach, navigation, dismiss, and submit actions; verify the files case of the short-window browser test.
- [x] 7.3 Retire the task-surface requirement in the delta instead of leaving its "available without a conversation" clause in the archived spec; verify `openspec validate` passes and the delta records the reason and the migration.
- [x] 7.4 Present the refusal in the fixed footer beside the confirm action and assert it is inside the strip and inside the viewport at a short height, with the option and the observation retained; verify the refusal browser test.
- [x] 7.5 Adopt the one shared answer in every conversation of the task and key the draft by stage entry; verify with the two-dock sharing test, the two-dock five-second command test, and the new-entry draft test.
- [x] 7.6 Read the snapshot once per open conversation and derive the columns and stage identities from the task's own board instead of projecting a board view; verify with the dock client tests and `pnpm run typecheck`.
- [x] 7.7 Drive the browser harness through the registered dock entry inside a host-like sticky seat with one composer footprint; verify the placement assertions cover exactly one gate, seat ancestry, ordering, composer width and centering, and a board-free page scope.
- [x] 7.8 Bump the artifact version and update the pinned compatibility expectation; verify `pnpm run check` passes.

## 8. Second review findings

- [x] 8.1 Budget each docked strip from the conversation's own scrollport (`DockStrip` and `seatStripBudget` in `src/client/dock-seat.tsx`): find the layer that holds both the strips and the composer, reserve every non-strip box there, the seat gaps, and any chrome outside that layer, then reserve each strip's fixed header and footer and split only the remainder; mark the strips tight and let them scroll as a whole when the fixed controls cannot all fit. A hidden box takes neither a gap nor a share. Verify with the embedded-conversation browser test at both transcript scroll extremes, the tall-draft case, the tight two-strip case at 360x420 with a 250px composer, and the hidden-round budget comparison.
- [x] 8.2 Keep the question footer in one row at narrow widths: the attachment bar flexes from zero (its own minimum cannot exceed the footer row) and a file token never shrinks its name; verify at 360x420 by scrolling the file row to its last token, removing it, and submitting the round, and at 900x420 by removing a file and reaching Next and Submit.
- [x] 8.3 Show the option and observation the shared window holds while a choice counts or sends, so an identical retry is visible in every conversation; verify the identical-retry client test with two panels.
- [x] 8.4 Bound the refusal band inside the footer so it scrolls in its own space and never pushes the confirm action out of the strip; verify the 360x420 refused-gate test asserts the alert and the action inside the strip.
- [x] 8.5 Answer both strips in the crowded browser case instead of only enabling them: submit the question and assert its reply, then confirm the gate and assert exactly one `task.decide`; verify the short-window browser test.
- [x] 8.6 Assert the gate and the native composer share a seat ancestor, and that collapsing preserves an entered option and observation, in the pinned template; verify by inspection, since the pinned DSH web lane does not run here.

## 9. Third review findings

- [x] 9.1 Measure the strips where the pinned host nests them: the budget finds the layer that holds both the strips and the composer card inside the sticky seat, reserves that layer's non-strip boxes, and reserves any seat chrome outside it; the browser harness now mirrors the host nesting (seat > stack > entries + composer). Verify the embedded-conversation test (a 530px conversation in a 900px window) and the composer-nesting measurement.
- [x] 9.2 Reserve each strip's fixed header and footer before splitting, and opt both strips into scrolling as a whole (`data-kb-dock-tight`) when the fixed controls cannot all fit; verify at 360x420 with a 250px composer that both strips are tight and that Confirm and Next are reachable by scrolling the strip itself.
- [x] 9.3 Mount a seat box only for a visible strip: each dock owns its box, returns nothing when it has no content, and a submitted question round keeps its form mounted inside a hidden box that takes neither a gap nor a share; verify the hidden-round budget equals the no-question budget.
- [x] 9.4 Let the attachment row shrink inside its bar and keep a readable token; verify at 360x420 by scrolling the file row to its last token, removing it, and submitting the round.
- [x] 9.5 Follow the applied option for the description while a choice counts, and identify each attempt so an identical retry is adopted again after its own refusal; verify the extended two-dock test through the second refusal.
- [x] 9.6 Assert the gate and the native input share their nearest composer seat, and that a restored draft leaves the confirm action enabled, in the pinned template; verify by inspection, since the pinned DSH lane does not run here.
- [x] 9.7 Update the artifacts to the final height policy, the layer-based measurement, the session-first lookup, and the narrow-width evidence; capture the crowded shield state before either answer lands.

## 10. Fourth review findings

- [x] 10.1 Observe the fixed bands that determine the bound (header, footer, collapsed status, refusal band, layer, scrollport) and watch the strip's subtree for mounted or removed controls, so a wrapping countdown footer re-measures even when the seat's own height is stable; verify the countdown-cancel browser test: at 360x420 with a 190px composer, a pointer click on Cancel without scrolling the strip cancels, and no command is sent after the window would have expired.
- [x] 10.2 Add the cramped fallback: when not even the header bars fit beside the composer, each strip is presented as a fixed panel sized from the conversation's own box, stacked for several strips and scrolling as a whole, so it stays answerable and the composer returns once it is collapsed; verify at 360x420 with a 400px composer that both panels stack inside the conversation and that a choice is confirmed and cancelled and a question is answered and submitted.
- [x] 10.3 Document both fallbacks, and the difference between a control that stays visible and one that is reachable by scrolling, in the decision-steps and structured-questions deltas and in the design; verify `openspec validate` passes.
- [x] 10.4 Declare the confirm action before its first use in the pinned template, assert it disabled before a choice is made, and assert only that it is enabled after a restored draft; verify by inspection, since the pinned DSH lane does not run here and the template imports the checkout's scaffold.
- [x] 10.5 Capture the countdown and cramped states in the browser evidence so the fallback is visible, not only measured.
- [x] 10.6 Measure the seat in a layout effect, before the first paint, so a strip never appears at the fallback height and then jumps; verify the placement suite waits for the measurement and that the height comparison between a full and an embedded conversation passes.

## 11. Fifth review findings

- [x] 11.1 Present the cramped panels outside the composer seat: portal each one to the document body, because the host's dock contract requires fixed overlays there and its sticky seat sets `will-change: transform`, making the seat a fixed descendant's containing block. Size the strip from the panel, since the portaled subtree no longer inherits the composer's custom properties. Verify with the harness mirroring the containment style and a nonzero conversation offset (a 40px page offset) that both panels land inside the conversation and the question is answered and submitted with the pointer.
- [x] 11.2 Give every cramped panel a disjoint slot sized from the conversation, so expanded panels never cover each other's controls, and keep a collapsed strip to its own header slot. Verify that collapsing both panels leaves the composer clickable and typeable through the launchers.
- [x] 11.3 Keep the countdown cancel action visible while a strip is tight: the action moves into the pinned header band, and the header and footer stick to the strip's scrollport while the body scrolls. Verify a pointer click on Cancel with both strips waiting, without scrolling, sends no command.
- [x] 11.4 Scope the seat-fit and fixed-action guarantees in both deltas to the normal presentation, leaving the fallbacks with reachability and pointer-access requirements; verify `openspec validate` passes.
- [x] 11.5 Give the harness a real composer input and a text area, so a test can assert pointer focus and typing rather than only geometry.

## 12. Sixth review findings

- [x] 12.1 Keep one strip box created once and moved between the seat and the document body, so crossing the presentation threshold never remounts a form, never discards a draft, and never drops focus; verify a browser test that answers both surfaces, grows the composer from 150px to 400px, checks both drafts, shrinks it back to 150px, checks them again, and then applies both answers.
- [x] 12.2 Stop pinning the footer when the pinned bands would consume the strip: in tight mode only the header stays pinned, the panel keeps its natural height, and the strip scrolls as a whole with `scroll-padding-top` clearing the pinned header; verify selection and submission at 360x420 with 270px, 290px, and 310px composers, where the previous layout intercepted the first answer radio with the sticky footer.
- [x] 12.3 Place and size the cramped panel inside the visible intersection of the conversation and the viewport, not only inside the conversation; verify the cramped test asserts both panels and their action rows sit inside the viewport, with the conversation's scroller untouched.
- [x] 12.4 Observe only the strip's own box, its layer, and its scrollport with sizes, watch the box's subtree for mounted controls, listen to page scroll passively, and skip the state update when the measurement is unchanged; verify the placement and panel browser suites still pass.
- [x] 12.5 Qualify the file-row and footer guarantee in the structured-question delta and the shared-geometry bullet in the proposal to the normal presentation, leaving the fallbacks with reachability; verify `openspec validate`.
- [x] 12.6 Give the harness a composer that can grow at runtime, so a test can cross the presentation threshold in both directions.

## 13. Seventh review findings

- [x] 13.1 Pin the entire decision header row in tight mode, so the countdown Cancel next to the toggle cannot scroll away; verify at 360x420 with a 270px composer by scrolling the gate, confirming a choice, asserting Cancel is inside the viewport without resetting the scroll, and clicking it without dispatching a command.
- [x] 13.2 Restore focus after moving the strip's box between the seat and the body, and remove the box on unmount so a closed cramped conversation leaves no body-level node; verify both: focus stays on the observation field while typing across the threshold in both directions, and closing the dock removes the portaled panels.
- [x] 13.3 Add compact launchers for a too-shallow conversation: one open slot below the launchers, opening a launcher neither toggles the form's collapse nor covers another launcher, and the launcher group re-measures when the open strip changes; verify a 200px-tall visible conversation with both strips, answering each by pointer.
- [x] 13.4 Document the launcher fallback in both deltas and the design.

## 14. Eighth review findings

- [x] 14.1 Choose the open launcher only among the visible strips: a stored id whose strip is gone is replaced by the first visible one, and unmounting clears the group's open id; verify closing and reopening a shallow conversation opens the gate again and that its panel is visible.
- [x] 14.2 Make the launcher a real disclosure: the header reports whether its body is visible, focus alone does not open it, the first activation opens the panel instead of collapsing it, and a second activation is the ordinary collapse; verify with keyboard focus and Enter on an inactive launcher.
- [x] 14.3 Document the launcher behavior in both deltas and the design.

## 15. Ninth review findings

- [x] 15.1 Selecting a launcher expands it in one action, including a panel the person collapsed before: when the open strip transitions from inactive to active, its collapsed body is expanded once. Verify collapse, switch to the other launcher, and reactivate the first: its body is visible and its header reports expanded.
- [x] 15.2 Leaving the launcher presentation restores the form's own disclosure value from whether its body is on screen instead of dropping the attribute. Verify returning to an ordinary layout without touching the header keeps the open gate's header reporting expanded.
- [x] 15.3 Document both behaviors in the deltas, the design, and this record.

## 16. Tenth review findings

- [x] 16.1 Intercept only the disclosure button on an inactive launcher, so the other controls that stay visible in its header row keep working; verify cancelling a running countdown from an inactive gate by pointer and by keyboard, with no command dispatched after the deadline.
- [x] 16.2 Document the rule in both deltas and the design.
