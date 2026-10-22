# Design

## Context

See `proposal.md` for motivation and the `structured-questions` delta for required behavior.

- The client plugin is an esbuild CJS bundle; styles are string constants because the build has no CSS loader ([`scripts/build.mjs`](../../../scripts/build.mjs)).
- The composer dock is the list slot `conversation.input.dock`, rendered inside the sticky `.composerSeat` of the conversation shell, so a dock entry stays fixed above the input while the transcript scrolls. Host Todo and Goal bars occupy the same slot.
- Today the question UI is a card rendered by `Dock` ([`src/client.tsx`](../../../src/client.tsx)) plus a second `DecisionSummary` row registered at `tool.call.toolview` for `decision_request`. That registration replaces the host's generic tool row, so the summary is the whole transcript row.
- Question state lives in the host `QuestionIndex` ([`src/questions/indexer.ts`](../../../src/questions/indexer.ts)): in-memory per session, rebuilt from `options.history(sessionId)`. The client bridge ([`src/client-bridge.ts`](../../../src/client-bridge.ts)) adds client-only `dismissed`/`requested` state; `reopenCall` powers the transcript button.
- Persistence is one `kanban` storage domain in `single` layout holding only `BoardState` ([`src/host/storage.ts`](../../../src/host/storage.ts)).
- Host theming exposes `--dsw-alias-*` tokens (surface `--dsw-specific-menu`, borders `l1`-`l4`, `interactive-bg-hover`, state `business`/`warn`/`success`, `button-primary-fill`, focus ring, radii) that rebind on `body[data-ds-dark-theme]`.

## Goals / Non-Goals

**Goals:**

- One fixed, host-themed question strip above the composer for both task and ordinary conversations.
- A deterministic slide order that always ends in Additional Notes and Submit.
- Durable per-conversation question state independent of task records.
- Remove the duplicate transcript surface and the client-only dismissal lifecycle without changing how an answer becomes a normal chat message.

**Non-Goals:**

- Decision ledger, approval/cancellation lifecycle, or "Record as decisions".
- Persisting draft answers or the collapsed state across reload; they stay session-local UI state.
- A queue UI for older unanswered rounds.
- Injecting a new chat node or touching DSH core.

## Decisions

### 1. Keep the composer dock as the seat

Use the already-registered `conversation.input.dock` entry (order 20) and restyle the card into a strip. The dock sits in the sticky composer seat, so the chat scrolls under it and the panel never leaves the viewport.

Alternatives considered:

- *Turn tail* (`conversation.chat.turnTail`): fold-independent, but it only exists once the turn closes and it scrolls with the transcript, so it is not fixed.
- *Tool-call row*: lives inside the turn process block, which DSH folds for completed turns in `compact`/`standard`; also duplicates the surface.

### 2. Strip anatomy and collapse

The strip is a `section` with a header button and a body:

- header: inline SVG glyph, title "Questions from the agent", `n / m` counter, and a chevron; `aria-expanded` + `aria-controls`;
- body: the active slide with `max-height: min(52vh, 520px)` and its own scroll;
- footer (Back / Next / Submit) is outside the scroll area so it is always reachable;
- expanded by default when a round id first appears; collapse is local state keyed by round id and does not remove the strip.

No close/dismiss action exists; collapsing is the escape hatch while the composer stays usable.

### 3. Slide model

Slides are derived as: every round page in `sequence` order, then one Additional Notes slide. The active slide is identified as `{ kind: 'page', callId }` or `{ kind: 'notes' }`, not by index, so a page reordering does not move the user away from the page they are answering. If a new page arrives while the user is on the notes slide, they stay on notes and Submit remains disabled until the round is complete; Back reaches the newly added page.

The counter counts every slide, including notes (`1 / 4` for three questions). This matches the "always a final slide" behavior and keeps Next/Submit placement unambiguous.

### 4. Validity gating

- `Next` is enabled only when the current page's answer is valid, reusing `isAnswerValid`.
- `Back` is always enabled except on the first slide.
- `Submit` exists only on the notes slide and is enabled only when the round is complete, every page is valid, and no submission is in flight.
- Per-answer notes stay optional and never affect validity.

### 5. Remove the second surface

Keep the keyed `tool.call.toolview` registration for `decision_request` but render `null`, so DSH never falls back to its generic JSON card. Delete `DecisionSummary`, its violet-stripe CSS, and the `reopenCall` path; the strip is the only question surface.

Alternatives considered:

- *Unregister*: DSH renders the generic tool card with the raw page JSON. Rejected.
- *Keep a compact summary*: duplicates the question and reintroduces two entry points. Rejected.

### 6. Removal instead of dismissal

The strip renders only while the session has an unresolved round. When a round is answered - by Submit or by any ordinary human message in that session, as the index already detects - the dock entry returns nothing. The client-only `dismissed`/`requested` maps and `dismiss`/`reopen` methods are deleted; "close" no longer exists as a state.

### 7. Multiple unresolved rounds

The strip shows the most recent unresolved round (highest turn, then latest result sequence). Earlier unresolved rounds remain in durable storage but are not reachable from the strip. This is accepted for now: an agent that asks a new round while one is open supersedes the older one visually. A queue affordance is a follow-up, not part of this change.

### 8. Durable store: a per-record question domain

Add a second domain, `kanban_questions` (version 1, `layout: 'per-record'`), with one table `sessions` keyed by `sessionId`. Each record reuses the existing projection vocabulary: `{ version: 1, sessionId, events: ProjectionEvent[] }`, validated with the same `copyEvent` rules.

- On `prepareQuestions(sessionId)`, load the record into the question index first, then replay canonical history (replay is idempotent by `seq`).
- After each accepted event, schedule a debounced write for that session (250 ms) and flush on dispose.
- A write failure is reported through the plugin's existing error channel and does not break the round; the next event retries.

Why per-record instead of a table in the existing `kanban` domain: the board domain uses `single` layout, so every write replaces the whole board document; per-record writes only the affected session and allows independent growth.

Alternatives considered:

- *Store only derived rounds*: duplicates `buildRounds` and its answered/completion rules; rejected.
- *No persistence*: relies on history replay, which the request explicitly replaces.

### 9. Host-theme token mapping

| Element | Token |
|---|---|
| Strip surface / border | `--dsw-specific-menu`, `--dsw-alias-border-l1` |
| Header hover, option hover | `--dsw-alias-interactive-bg-hover` |
| Focused option | `--dsw-alias-state-business-tertiary` / `--dsw-alias-state-business-primary` |
| Weight pills | `state-warn-*`, `state-business-*`, `state-success-*` |
| Inputs, description panel | `--dsw-alias-bg-base`, `--dsw-alias-border-l2`/`l3` |
| Text | `--dsw-alias-label-primary`/`secondary`/`tertiary` |
| Primary action | `--dsw-alias-button-primary-fill`, `--dsw-alias-label-primary-foreground` |
| Errors | `--dsw-alias-state-error-primary` |
| Radii, focus | `--dsw-radius-lg`/`md`/`sm`, `--dsw-focus-ring-*` |

No `body[data-ds-dark-theme]` block is needed because the alias tokens rebind. Icons are inline SVG; the plugin does not depend on host primitives.

### 10. Copy and accessibility

Keep existing accessible names where tests rely on them, change the close control into collapse, and add the Additional Notes label. Weight values render as human-readable pills ("Hard to change later", "Can change with effort", "Easy to revisit") rather than `Importance: critical`. The counter is announced politely on slide change; focus follows the slide heading.

## Risks / Trade-offs

- [Older unresolved rounds become unreachable] -> Persist every round; add a queue affordance later if needed.
- [Question records grow for archived sessions] -> Records are small and session-keyed; retention is a follow-up and stays outside task ownership.
- [Debounced write loses the last event on a crash] -> Flush on dispose and treat history replay as a recovery source.
- [Tall panel on small viewports] -> Body capped by `vh` with internal scroll; footer outside the scroll area.
- [Streaming page arrives while on notes] -> Notes stays selected, Submit stays disabled, Back reaches the new page.
- [Removing dismissal leaves a stale round visible] -> Any ordinary reply retires it; collapse frees the composer.
- [Existing tests assert the old copy and the transcript summary] -> Update the question-form and plugin tests in the same change.

## Migration Plan

- The new domain starts empty; existing rounds are rebuilt from canonical history on first prepare.
- Remove the client dismissal/requested state; it was never durable.
- No `kanban` schema change and no data rewrite. Rollback restores the previous dock card and can ignore the new domain.

## Open Questions

- Retention policy for question records whose sessions were archived (deferred; no task coupling).
- Whether older unresolved rounds should get a queue affordance.
