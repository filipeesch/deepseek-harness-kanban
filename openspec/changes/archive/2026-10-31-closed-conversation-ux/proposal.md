# Proposal

## Why

The Conversations section currently renders a collapsible "Closed conversations" block between the tab strip and the native transcript. That secondary history competes with the chat for vertical space, and the close action lives in the tab toolbar rather than with the conversation it closes. The result is a noisy conversation surface and an ambiguous close target.

## What Changes

- Replace the inline closed-conversations block with a compact chip at the end of the open-tab strip, shown only when the task has closed conversations. The chip uses a small history icon and the closed count, and opens an anchored popover.
- Present closed conversations in that popover as clickable rows using the native DSH session title or the existing `Agent N` fallback. Selecting a row reopens the conversation and selects it; reopen failures are reported inside the popover without closing it. Dismiss on Escape or an outside click, and restore focus.
- Move the close-conversation action from the tab toolbar to the end of the active conversation's native session header. It closes the active root conversation, is unavailable during a subagent peek, and is disabled while a conversation command is pending. It remains reachable when the native body is loading or failed.
- Keep the empty state short and point to the closed-conversations chip; do not duplicate the closed list or add a second reopen trigger.
- Preserve closing semantics: closing a tab only hides it, the session and history remain, and reopening returns the same session. No new host command, archive, or deletion behavior.
- Consolidate the section's notice presentation and replace duplicated open/closed session filters with shared pure helpers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-conversations`: the closed-conversation presentation, the close action location and availability, and the empty-state behavior change. Closed entries continue to use the native title or `Agent N` fallback, and session/history retention is unchanged.

## Impact

- Client UI: `src/client/drawer-conversations.tsx`, `src/client/conversation-surface.tsx`, `src/client/native-session-header.tsx`, `src/client/client.tsx`, `src/client/page-state.ts`, `src/client/auto-run-view.tsx`, `src/client/styles.ts`, `src/client/icons.tsx`.
- Shared/host: a new pure `src/shared/conversations.ts` helper module consumed by the client and by `src/host/app.ts` for first-open-conversation selection.
- No changes to the Kanban schema, command contract, native DSH session lifecycle, or host behavior.
- Tests are planned for the implementation phase; this proposal does not define the test plan.
