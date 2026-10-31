# Design

## Context

See `proposal.md` for motivation and the delta specs for required behavior.

Current shape of the affected code:

```
board.tsx:83-84        attentionForHub / attentionForBoard  -> boolean scope projection
board.tsx:323-329      Hub and board tab rows, inline JSX, green <span class="kb-dot kb-activity">
hub-view.ts:52-55      scopeAttention(tasks, attention) -> { unread, running, failed }
styles.ts:8            .kb-dot.kb-activity{background:#38a169}
activity-styles.ts:5   .kb-working-dot + kb-working-pulse (the card working pattern)
```

Constraints that shape the approach:

- The client already receives every fact needed: `KanbanSnapshot.attention[taskId]` carries `running`, `background[]`, `unread`, `awaitingReply`, and `failed`. No host or command change is required.
- Hub and board tabs share one aggregation shape but different scopes: all tasks of a Hub versus the tasks of one board.
- The tab label and the indicators live inside one `<button role="tab">`, so the indicator must not introduce its own focus target or live region.
- The card and drawer already define the visual language for working state: a pulsing dot using the host accent and no hard-coded color.

## Goals / Non-Goals

**Goals:**

- One projection function that turns task attention into a scope-level running count, so both tab rows and any future scope use the same rule.
- One presentational indicator that both tab rows render, keeping the tab markup and aggregation logic out of the board orchestrator.
- Visual and accessibility parity with the existing working indicator in the host's light and dark appearances.

**Non-Goals:**

- Changing the card or drawer working presentation.
- Changing the attention dot colors or their semantics; the tab rows reuse the card's blue unread, orange awaiting-reply, and red failure marks.
- Changing the host API, snapshot shape, commands, or persistence.
- Changing aggregation latency; the existing snapshot subscription already refreshes the tabs.

## Decisions

### Decision: Merge agent execution and background work into one running-task count

A task counts once when it has a running turn, an owned subagent, or unsettled background work. This keeps the tab indicator to one number and one visual mark, matches the user's final choice, and avoids a second quieter badge that would compete with the tab label.

Alternatives considered:

- Separate working and background indicators: more faithful to the card, but doubles the marks per tab and was explicitly rejected after review.
- Working only, ignoring background: hides work that is still in flight.

### Decision: New pure projection module `scope-activity.ts`

```
ScopeActivity { runningTasks, runningTaskTitles, unread, awaitingReply, failed }
projectScopeActivity(tasks, attention): ScopeActivity
```

It replaces `ScopeAttention`/`scopeAttention` in `hub-view.ts`. Rules:

- Iterate the given task array in order; a task is running when `attention[id].running` is true or its `background` array is non-empty.
- Count distinct tasks; collect titles in task order for the hover detail.
- OR-fold `unread`, `awaitingReply`, and `failed` exactly as today.

Why: the projection is pure, testable without the DOM, and free of snapshot/board concerns. `hub-view.ts` already mixes storage preferences, view builders, snapshot normalization, and command scoping; keeping a new concern out of it works toward single responsibility without a broad, risky split.

Alternatives considered:

- Extend `scopeAttention` with counts: keeps a misnamed boolean projection alive and still couples counting to the board view module.
- Compute counts inline in `BoardView`: shortest diff, but untestable and duplicated between Hub and board scopes.

### Decision: Extract `HubNav` and `RunningTasksBadge`

- `RunningTasksBadge({ activity })` in `running-tasks-badge.tsx` renders the pulsing ring and the numeral, only when `runningTasks > 0`. It owns the accessibility wrapping and the tooltip. The component file is named separately from the `scope-activity.ts` projection so the TypeScript module resolution does not collide.
- `HubNav` renders both tab rows from props: hubs, boards, active ids, precomputed activity maps, and select/create callbacks. One `ScopeTab` renders every tab, so the attention dot order and labels and the trailing running mark have a single source. `HubNav` has no snapshot or command knowledge.

`BoardView` precomputes `hubActivity` and `boardActivity` maps once per snapshot and passes them plus existing callbacks. This removes the duplicated `attentionForHub`/`attentionForBoard` helpers and the two very long inline JSX rows.

Why: board.tsx is the page orchestrator and already carries loading, selection, command, dialog, and drawer concerns. Tabs are a presentational concern with a clean prop boundary; dependency injection via props keeps the component testable and closed to modification.

Alternatives considered:

- Keep the markup inline and only swap the dot: smallest diff, but leaves duplicated scope helpers and unreadable JSX.
- Have `HubNav` read the snapshot itself: fewer props, but couples presentation to the page state and makes the component harder to exercise.

### Decision: Host accent token and the existing pulse

The ring uses `currentColor` driven by `--dsw-alias-label-deep-diving`, falling back to `--dsw-alias-state-business-primary`, matching the card's working indicator. It reuses the existing `kb-working-pulse` keyframes and the existing reduced-motion rule pattern.

Why: the current `#38a169` is the only hard-coded status color in the tab header and ignores dark appearance. Reusing the card token and animation makes "running" read the same everywhere.

Alternative considered: keep green but theme it. Rejected because green conflicts with the existing semantic palette where working is the host's deep-diving accent.

### Decision: Numeral beside the ring, always shown while active

The numeral is rendered at the indicator's font size with `font-variant-numeric: tabular-nums`, separated from the ring by a small gap, and shown even when the count is 1. No cap is applied.

Why: a stable presence avoids tab width jumping between 1 and N, and tabular figures avoid jitter as the number changes. A ring with an inset number would need a larger badge than the current 9px mark.

Alternative considered: numeral only above 1; rejected because the indicator width would change as tasks start and finish.

### Decision: Attention indicators first, running count last

Both tab rows render the same blue unread, orange awaiting-reply, and red failure marks as cards, in that order, followed by the running ring and numeral. The awaiting-reply mark is new on the headers; the running mark previously interrupted the attention group.

Why: a card that needs the user's reply must be visible from the header, and keeping the running count in one trailing position makes it easy to scan across tabs and keeps the attention group contiguous.

Alternative considered: preserving the previous unread/running/failure order. Rejected because the running mark split the attention indicators and the awaiting-reply state stayed invisible in the header.

### Decision: Accessibility contract

- The ring and numeral are wrapped in one `role="img"` group whose `aria-label` is the count sentence, for example `2 tasks running`; the inner ring is decorative.
- The group carries a `title` that appends the running task titles.
- The tab's accessible name therefore includes the count while the attention dots keep their own labels.
- Reduced motion stops the animation but keeps the ring visible.

Alternative considered: separate labels for ring and numeral; rejected because it doubles the announcement inside an already-labeled tab.

## Risks / Trade-offs

- Merged counting diverges from the previous spec wording that listed background activity as "execution" -> the delta specs state the counted unit and scenarios explicitly.
- Large counts (for example 12 running tasks) widen the tab -> tabular figures keep it stable; a compact cap can be added later without changing the projection.
- The `title` hover detail is not reachable by keyboard -> the accessible name already conveys the count, and the task-level detail remains available in cards and the drawer.
- Host accent contrast may differ from the old green -> verify in the existing browser appearance lane for light and dark.
- Existing tests assert the green dot and the old tab labels -> update client and browser assertions as part of the change.

## Migration Plan

None. This is a plugin UI change with no data, storage, or command migration. Rollback is reverting the change commit; the previous indicator requires no data restoration.

## Open Questions

None that affect the specs or approach. Whether to compact counts beyond a threshold can be decided after real usage.
