# Proposal: Composer Question Panel

## Why

The rich question experience works, but its presentation is temporary and unthemed. The form is a bare card in the composer dock that falls back to `#fff`/`#d4d4d8` because the DSH host defines no `--background-color` token, so it renders as a white island in both schemes. The same question is also duplicated in the transcript as a violet-striped summary row with an "Open questions" button. Neither surface survives reload: rounds are an in-memory projection rebuilt from history, and dismissal is client-only, so an unanswered round has no stable home.

The questions deserve the same persistent, host-native treatment as the Todo and Goal bars: a fixed strip above the composer that stays put while the chat scrolls, a predictable slide order that always ends in Additional Notes and Submit, and conversation-scoped durable state.

## What Changes

- **Fixed question strip above the composer.** The active round is presented as a strip docked directly above the message composer, in the same seat the host uses for its Todo and Goal bars. The chat continues to scroll behind it; the strip stays fixed while the user answers.
- **Host bar anatomy, expanded by default.** A header bar carries an icon, the title, a progress indicator, and a collapse toggle. The body shows the active slide, with a capped height and internal scroll so the header and footer stay visible.
- **Slide order ends in Additional Notes.** Every question page is its own slide: context, question text, weight, recommendation, options, the focused option's description panel, optional per-answer Notes, and Next. The final slide is Additional Notes - a free-text field with Back and Submit. It is always present, including rounds with a single question. Submit exists only on that slide and is enabled once the round is complete and every answer is valid.
- **Questions stack into the strip.** Each `decision_request` call appends its page to the active round's strip. Answers, the active slide, and the collapsed state are retained while further pages arrive.
- **No transcript duplicate.** `decision_request` tool-call rows render no custom summary. The strip is the single question surface.
- **Removal on response.** When the round is answered - by Submit or by an ordinary chat reply - the strip leaves the composer dock.
- **Collapse, not dismiss. BREAKING.** The form no longer offers a Close/dismiss action and there is no dismissed state. Closing the panel means collapsing it; the round stays answerable from the strip or by a normal chat message.
- **Conversation-scoped durable state.** Question rounds are persisted per conversation (`sessionId`) in plugin storage: pages, completion, and answered/submitted state. Reload restores the strip without depending on history replay alone. No task or board record owns this state; draft answers and the collapsed state remain session-local UI state.
- **DSH theming only.** The strip and form consume host theme tokens (`--dsw-alias-*`, radius, focus ring) in both light and dark schemes. The Railyin palette, the hardcoded white card, and the violet stripe are removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `structured-questions`: presentation moves to a fixed composer-dock strip whose slide order always ends in Additional Notes and Submit; the close/dismiss action and the transcript summary are removed; answered rounds leave the dock; question state becomes durable per conversation.

## Impact

- **Client:** `src/client.tsx` (dock registration, strip styles, suppression of the transcript summary), `src/questions/QuestionForm.tsx` (slide model, strip chrome, accessibility), and a new strip/styles module. The `tool.call.toolview` entry for `decision_request` stops rendering a summary.
- **Host:** persistence of the question projection in a storage-domain table keyed by session; `QuestionIndex` load/save wiring; `kanban/questions` responses rebuilt from durable state plus canonical history.
- **Tests:** question-form slide order and copy, plugin slot registration, persistence/reload behavior, theme-token and focus assertions.
- **Docs and specs:** README question section and the `structured-questions` delta.
- **Dependencies:** none added; no DSH core change.
- **Out of scope:** decision ledger, Record as decisions, approval or cancellation lifecycle, task-scoped question state, and real-model acceptance.
