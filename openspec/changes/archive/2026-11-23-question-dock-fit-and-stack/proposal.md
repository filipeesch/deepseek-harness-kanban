# Proposal

## Why

The question dock and the decision gate share one composer strip that stops growing at a fixed 460px and that assumes a single waiting round. On any screen, including a 2560px monitor, a decision with a few options fills that cap and scrolls while the conversation has hundreds of pixels free; and a question round that arrives while an unanswered one is open replaces it, hiding the earlier questions and orphaning their draft. The model guidance that feeds the same surface also lets an agent spend a page announcing the pages it is about to ask instead of asking self-contained questions.

## What Changes

- Replace the fixed strip ceiling with content-driven sizing. A strip grows to its content up to the space the composer seat can spare inside the conversation, never past the chat scrollport, so the conversation header and its tab row are never covered. It scrolls only when its content exceeds that space. No transcript is reserved: the panel may cover the chat, and collapsing it from its header reveals the conversation again.
- Distribute the shared seat height across the waiting strips by need: each strip takes up to its own content, the leftover goes to the others, and a proportional split applies only when their needs together exceed the space.
- Stack every unresolved question round above the composer as one block per round, oldest first, with the oldest block expanded and any round that arrives while another is unresolved collapsed below it. Several blocks may be open at once, and a collapsed block costs only its header.
- Promote the next round: answering or dismissing the expanded block opens the oldest remaining block.
- Retire only the round that is answered or dismissed. **BREAKING**: an ordinary chat message no longer retires the conversation's open question rounds, and dismissing one block no longer discards the other unresolved rounds.
- Persist round retirement per conversation, so a reload does not resurrect an answered round.
- Make the model guidance require self-contained questions: each page stands on its own, never announcing, previewing, or summarizing later pages, and never re-asking a question the conversation already settled unless the person asks to revisit it. The shipped preset carries the same rule.
- Tell the agent, at the start of its next step, which question rounds are still open in the conversation, so it can avoid repeating them. The notice is informational and never blocks a tool call.
- Move the seat height policy into a pure module with unit tests; the seat module keeps measurement, portal placement, and the existing launcher fallbacks.
- Leave the panel's intrinsic content unchanged: the option description pane, the observation field, and the option list keep their current design, and no expand control is added.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `structured-questions`: the fixed panel's height bound and the stacked presentation of unresolved rounds; per-round retirement, dismissal, and pending work; the model guidance and the open-round notice; the restored-draft rule for a stack.
- `decision-steps`: the gate inherits the content-driven bound and the by-need distribution beside the stacked question rounds.

## Impact

- Client: `src/client/dock-seat.tsx` (measurement and placement stay, the policy leaves), a new pure height-policy module, `src/client/question-dock.tsx` (one block per unresolved round), `src/questions/submission.ts` (the ordered stack selection).
- Host and projection: `src/questions/indexer.ts` (retirement, dismissal, pending work), `src/host/app.ts`, `src/host/question-storage.ts`, `src/remote.ts`, `src/client-bridge.ts` (durable retirement and per-round dismissal), `src/host/tools/questions.ts` (tool description), a new pre-step injector for the open-round notice, and the shipped preset guidance in `cordis.patch.yml`.
- Specs: `structured-questions` and `decision-steps`.
- Docs: `docs/user/conversations.md` (question rounds), `docs/user/agent-tools.md` (`decision_request` guidance), and the preset maintenance notes in `docs/development/presets.md` if they enumerate the question guidance.
- Tests: unit tests for the height policy and the round life cycle, client tests for the stack, browser tests for the fit and the stack, and host tests for the description and the notice.
- No new dependency and no host API change.
