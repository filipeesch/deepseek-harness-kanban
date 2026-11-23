# Design

## Context

See `proposal.md` for the motivation. The surface to change is the composer dock and the state behind it:

- `src/client/dock-seat.tsx` (`DockStrip`) measures the conversation scrollport, publishes the spare height as `--kb-dock-budget`, moves the strip between the seat and `document.body`, and runs the launcher fallback. `seatStripBudget` holds one fixed ceiling (460px), a fixed floor per strip (header + footer + 24px), and an equal split of the leftover.
- `src/questions/styles.ts` applies the published budget as `.kq-strip` `max-height`; `.kq-panel` and `.kq-scroll` flex inside it, so the body scrolls whenever the content exceeds the budget.
- `src/client/question-dock.tsx` renders one `DockStrip` for the single round returned by `selectActiveRound` (`src/questions/submission.ts`).
- `src/questions/indexer.ts` projects rounds from canonical transcript events, keyed by turn. A round is `answered` today when any human message follows its first page result; dismissal is a durable `dismissedTurns` list; drafts are persisted per round id.
- `src/host/tools/questions.ts` holds the model-facing description; `cordis.patch.yml` holds the workflow operator preset guidance; `src/host/pre-step-injection.ts` is the existing hook for a message injected before an agent step (`stage-notice.ts` and `task-context.ts` use it).

Measured on a Playwright harness that reproduces the host seat: a solo strip stops at 460px on 1280x800, 1440x900, 1920x1080, and 2560x1440; a short decision needs 349px and a decision with 12 options needs 769px; with a gate and a question round open at 1440x900 each strip receives 395px, the shorter one still scrolls 36px, and the strips plus the composer consume the whole 900px of the scrollport.

## Goals / Non-Goals

**Goals:**

- Size every waiting strip from its content, bounded by the conversation's chat scrollport only.
- Share the seat height by need across the strips, including collapsed blocks.
- Present every unresolved question round as its own block with an independent life cycle.
- Keep the model from announcing future pages or re-asking settled questions.
- Make the height policy a pure unit that can be tested without a DOM.
- Keep the existing fallbacks (fixed-controls tight, cramped panel, compact launcher) unchanged in behavior.

**Non-Goals:**

- Redesigning the panel's intrinsic content (option description pane, observation field, option list) or adding an expand control.
- Merging pages from different turns into one round, or de-duplicating questions by text.
- Capping the number of stacked blocks.
- Changing the five-second decision window, the gate's routing semantics, or the streaming behavior of pages inside one turn.
- Adding a new host API or dependency.

## Decisions

### Content-driven height with the chat scrollport as the only ceiling

The policy receives the scrollport's client height, the heights of the non-strip seat entries, the row gaps, and for each strip its fixed height (header and footer) and its content height. It returns a budget per strip, plus whether the strip is tight or must be presented as a cramped panel or a compact launcher. The ceiling is the scrollport itself: a strip never grows above it, so the conversation header and its tab row stay uncovered. No transcript height is reserved; the strip may cover the chat, and collapsing it from the header reveals the conversation.

Alternative: keep a fixed ceiling (rejected: always leaves space unused and forces scrolling on a large screen) or a percentage of the window (rejected: ignores the conversation the strip actually lives in).

### Water-filling distribution by need

Each strip's need is its fixed height plus its content height, or only its header when collapsed. While space remains, every strip whose need is not met receives up to that need; the leftover then goes to the strips that still want more, and only when their needs together exceed the space is the remaining height split in proportion to need. This replaces the equal split and the fixed 24px body floor.

Alternative: equal split (rejected: a short strip wastes height that the long one needs) and fixed priority (rejected: it starves the other surface).

### State per block, stack rules owned by the dock

`QuestionDock` renders one `DockStrip` per unresolved round, ordered by turn and then page sequence. The expansion state moves from `QuestionForm`'s internal surface into the dock: the form receives `collapsed` and `onToggleCollapsed`, and the dock keeps the set of collapsed block ids. The dock initializes the newest round collapsed when another round is unresolved, expands the oldest unresolved round when a round leaves the stack, and lets several blocks stay expanded.

Alternative: keep the expansion state inside the form and remount the next block with a new key to force expansion (rejected: remount discards transient submission state and focus, and the dock would not own the stack rule).

The launcher fallback stays a presentation-only override written by the seat to the block's DOM; it never changes the dock's expansion state, so leaving the launcher presentation restores the person's own choice.

### One durable "no longer answerable" fact for both retirement triggers

The two triggers — a submitted round and a dismissed round — need the same durable effect: the block leaves the stack, its draft is pruned, and its payloads are removed. Their difference is only the trigger the person used, which the transcript already records as the reply itself.

The projection therefore keeps one list of turns that are no longer answerable, reusing the existing `dismissedTurns` field and its pruning, undismiss rollback, and lane serialization. `QuestionForm`'s submit path, after the reply admission settles, calls the same host command the dismissal path uses; the host marks the turn, prunes the draft, and returns the remaining rounds. The transcript-derived `answered` rule (any human message after the first page) is removed, because it cannot tell an answer from a steering message and it would retire every other open round.

Alternative: a separate `retiredTurns` field. Rejected because the stored question record is strict: an older plugin would reject a record carrying an unknown field during a rollback, and the same durable effect would be implemented twice.

A failed retirement write after an admitted reply is reported by the dock and keeps the block hidden for the session; the round may reappear after a reload, where the person can dismiss it. The reply itself is already durable, so no answer is ever lost.

### Per-round dismissal

`dismissQuestions(sessionId, roundId)` marks only that round's turn instead of every unresolved round, and prunes only that round's draft. The confirmation copy speaks about one round.

### Open-round notice as a pre-step injection

A new host injector reads the conversation's unresolved rounds from `QuestionIndex` and prepends one user-role message before the step's own messages, naming each open round with its question texts and page counts and reminding the agent not to repeat them. The message comes from the host, so the question projection does not count it as a human reply. The stage-notice injector already proves this pattern.

The notice is capped in size (a bounded number of rounds and characters) so a long stack cannot flood the context.

### Tool description and preset guidance

The `decision_request` description gains the self-contained-page rule, the prohibition on announcing later pages, the note that the form already reports progress, and the no-re-ask rule. The per-call result stays as it is, because the spec keeps that result to the turn-ending rule. The workflow operator preset guidance in `cordis.patch.yml` gains the same self-contained-page rule.

### Pure policy module, DOM adapter kept in the seat

The new module (`src/client/seat-budget.ts`) exports pure functions: a strip's need from its fixed and content heights, the water-filling distribution, and the choice among normal, tight, and cramped presentations from the available height and the fixed controls. `dock-seat.tsx` keeps measuring the DOM (scrollport, seat entries, fixed controls, content height), moving the box, and the launcher state machine, and calls the pure functions with numbers.

Alternative: test the current function through the browser harness only (rejected: the policy is the part most likely to regress, and browser tests are slow and indirect).

The content height is read from the expanded body's `scrollHeight` while the strip is laid out, not from the clipped box, and the observed elements stay limited to the strip, its layer, and the scrollport, so a re-measure is stable.

## Risks / Trade-offs

- Measurement feedback loop between the budget and the measured content height → the policy is a pure function of numbers with a stable equality check already in place (`sameSeat`); the content probe reads the unclipped body, and only the strip, its layer, and the scrollport are observed.
- A tall single strip hides the conversation → accepted: the header always stays visible and collapsing reveals the chat.
- An ordinary chat reply no longer retires rounds → the open-round notice tells the agent the round is open, and the person can dismiss it; documented in `docs/user/conversations.md`.
- The durable retirement write can fail after the reply was admitted → the block stays hidden for the session and the dock reports the problem; a reload can resurrect the round for dismissal, never the answer.
- A stack of many blocks may exhaust the seat → the existing fallbacks keep every block reachable; a stack-specific cap is deliberately not added.
- Reusing the dismissal record for retirement means the stored marker cannot tell the two triggers apart → the projection never needs that distinction after the fact, because the reply in the transcript is the answer's record.
- The gate and the rounds compete for the same seat → allocation is by need, the gate stays expanded and first, and the fallbacks apply when nothing fits.

## Migration Plan

- No data migration: the durable record shape is unchanged, and the projection recomputes the same rounds from the transcript.
- Existing dismissed turns keep excluding their rounds; existing submitted rounds are already backed by their reply in the transcript.
- Rollback: revert the plugin release. The stored records remain readable by the previous version because no field was added.
