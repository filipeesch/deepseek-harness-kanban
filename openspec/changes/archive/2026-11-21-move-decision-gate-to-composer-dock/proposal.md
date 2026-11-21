# Proposal

## Why

The decision gate is drawn as a fixed strip at the top of the task drawer, above every section and above the conversation. That is the wrong place for a choice a person answers while reading a conversation: on a short window the strip takes about a third of the window and squeezes the transcript, and on a wide drawer it stretches edge to edge, so question and context text run in very long lines. The strip also shares the composer strip geometry without its bounds, so in short windows the sticky composer seat can push its header outside the visible area.

Every other surface that waits for the person already lives in one place: the host's input-dock strip, directly above the message composer, where a structured question round is presented. The gate belongs there too.

## What Changes

- **BREAKING**: the decision gate moves from the strip fixed above the drawer's sections to the host input-dock strip directly above the composer. It is presented in every conversation of the task, in the task drawer and in the host's main chat, and it is no longer presented in a drawer section that has no composer.
- The gate enters the dock above a structured question round when both are waiting in the same conversation.
- The shared strip geometry bounds each strip by the height the conversation's composer seat can spare after reserving the composer and every other entry, so the header bar, the footer actions, and the composer stay reachable while the strip's content scrolls. When the fixed controls cannot share the seat with the composer, the strip keeps its header as its entry point and scrolls as a whole; when not even the headers fit, it is presented above the visible conversation in a panel outside the composer seat, and collapsing it returns the composer. A strip's box is created once and moved between those presentations, so growing or shrinking the composer never discards an answer in progress.
- The drawer-specific strip styling and the gate's mount inside the task drawer are removed, so the gate uses the composer strip's width and centering unchanged.
- The session-to-task lookup the dock needs becomes one pure helper with tests of its own; surfaces that already hold a task keep their local membership test.
- The decision gate placement requirement, the structured-question panel requirement, and the drawer wording in the user guide are rewritten.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `decision-steps`: the gate is presented above the composer of every conversation of the task instead of a strip above the drawer's sections, it stacks above a structured question round, and it inherits the bounded strip height that keeps its header reachable.
- `structured-questions`: the question panel above the composer bounds its height to a share of the viewport, keeps its header bar and footer actions outside the scrolling body, and scrolls its content.

## Impact

- Client composition: `src/client.tsx` registers the new input-dock entry beside the existing question dock and session diagnosis.
- Client surfaces: `src/client/decision-panel.tsx` loses the drawer styling and gains a presentational split; `src/client/dock-seat.tsx` adds the composer-seat height budget; `src/client/drawer.tsx` loses the gate mount and the `decisionWindow` prop; `src/client/decision-view.ts` stays the single place that derives the gate from a stage.
- Shared code: a session-to-task helper for the new dock, which the drawer navigation coordinator does not need because it re-resolves a task it already holds; `src/client/dock-seat.tsx` measures the composer seat and publishes each strip's height, and `src/questions/styles.ts` uses that height for both surfaces.
- Tests: `tests/bridge/plugin.test.tsx` (registered slot entries), `tests/client/decision-panel.test.tsx` (presentational gate), a new client test for the dock's session-to-task resolution, `tests/browser/decision-panel.spec.ts` and its harness scenario (placement and bounded height), and `tests/e2e-dsh/kanban-decision.e2e.template.ts` (the gate answered from the conversation).
- Documentation: `docs/user/workflows.md` decision gate section.
- No host API, storage, workflow schema, command, or dependency change. The five-second window, the durable `task.decide` route, the history record, and the card attention stay as they are.
