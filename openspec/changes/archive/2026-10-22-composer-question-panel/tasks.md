# Tasks

## 1. Baseline and Storage Gate

- [x] 1.1 Run `pnpm run check` on the current checkout and record the typecheck, test, and build baseline so later failures are attributable to this change.
- [x] 1.2 Declare the `kanban_questions` storage domain (version 1, `layout: 'per-record'`, table `sessions` keyed by session id) with a record schema reusing the question projection events; verify a host test round-trips one session record and rejects a malformed event.
- [x] 1.3 Open the domain from the plugin composition root and pass it to `KanbanApp`; verify the plugin still starts when the domain is empty and fails loud when the configured backend cannot open the domain.

## 2. Host Persistence

- [x] 2.1 Load a session's stored projection into the question index before replaying canonical history, keeping replay idempotent by sequence; verify a host test restores pages and the answered state when history returns nothing.
- [x] 2.2 Persist accepted events per session on a debounced write and flush on dispose; verify a test with several rapid events writes once per window and a dispose flush keeps the last event.
- [x] 2.3 Report a persistence write failure without dropping the in-memory round, and retry on the next accepted event; verify a failing store still answers `kanban/questions` and reports once per failure.
- [x] 2.4 Confirm `kanban/questions` and the board snapshot keep their current shapes and session scoping; verify the existing bridge and host tests still pass.

## 3. Client Bridge and Transcript Cleanup

- [x] 3.1 Remove the client-only `dismissed`/`requested` state and the `dismiss`, `reopen`, and `reopenCall` methods; verify no question view or bridge test references them and the client typecheck passes.
- [x] 3.2 Make the dock select the most recent unresolved round for its session; verify a bridge test with two unresolved rounds selects the latest and an answered round renders no dock entry.
- [x] 3.3 Replace `DecisionSummary` with a null-returning `decision_request` tool-view registration and delete the violet-stripe CSS; verify the plugin slot test renders no question text, choices, or open/review action, and that no transcript summary styles remain.

## 4. Question Strip and Slides

- [x] 4.1 Build the fixed strip chrome (header button with glyph, title, counter, and chevron; capped scrollable body; footer outside the scroll) and mount it in the existing composer dock; verify a component test toggles collapse, asserts `aria-expanded`/`aria-controls`, and keeps the header when collapsed.
- [x] 4.2 Replace the single-form layout with slides derived from round pages plus a final notes slide, tracking the active slide by call id and a notes sentinel; verify tests for one question, several questions, returning from notes, and an added page reordering the slides without losing the active one.
- [x] 4.3 Gate navigation: Next requires a valid current answer, Back is always available after the first slide, Submit exists only on the notes slide and requires a complete round with valid answers; verify each disabled and enabled transition.
- [x] 4.4 Aggregate per-answer notes and the Additional Notes field into the existing textual submission; verify the test asserts both appear in the submitted text.
- [x] 4.5 Render nothing once the round is answered, whether by Submit or by an ordinary chat message; verify both paths remove the strip and neither infers an answer.
- [x] 4.6 Render weight values as readable pills and adopt the strip copy ("Questions from the agent", "Next", "Back", "Submit", "Notes for this answer", "Additional Notes"); verify the tests assert the new copy and no "Importance: critical" text.

## 5. Theme and Accessibility

- [x] 5.1 Replace every hardcoded question color with host theme tokens for surface, borders, hover/focus states, weight pills, inputs, buttons, and errors; verify no `#fff`, `#d4d4d8`, `#7c3aed`, or `#b91c1c` remains in question styles and a stylesheet test asserts the token usage.
- [x] 5.2 Verify keyboard order and a visible focus indicator on the header, options, notes, and footer controls using the host focus token; add a component test for focus-visible styling hooks.
- [x] 5.3 Announce slide and counter changes politely and keep slide headings programmatically associated; verify the accessibility assertions in the strip test.

## 6. Documentation and Verification

- [x] 6.1 Update the README question section to describe the fixed strip, the slide order, removal on answer, conversation-scoped durability, and that drafts still do not survive reload.
- [x] 6.2 Run `pnpm run check` and `openspec validate composer-question-panel --strict`; verify both pass with no new warnings.
- [x] 6.3 Rebuild the plugin and verify in the existing GUI without starting a replacement server: the strip sits above the composer while the chat scrolls, collapses and re-expands, shows the notes slide for a single question, submits one textual reply, disappears after submit and after a plain reply, survives reload while unanswered, and follows the dark appearance; capture evidence.
