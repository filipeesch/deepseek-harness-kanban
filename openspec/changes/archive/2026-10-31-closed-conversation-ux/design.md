# Design

## Context

See `proposal.md` for motivation. The current drawer renders closed conversations as a `<details>` block between the conversation tab strip and the native transcript, and the close action lives in the tab toolbar. The native session header, transcript, and composer are hosted from the pinned DSH release through the `kanban.session.header` slot inside `RetainedConversation`; the drawer cannot access the host's native header internals beyond that slot. No popover primitive exists in the plugin. The open/closed session rule is duplicated across the drawer, page state, auto-run view, and the host command layer.

## Goals / Non-Goals

**Goals:**

- Remove closed conversations and their explanatory copy from the conversation body without losing reopen access.
- Make the close action belong to the conversation it closes, at the end of the native session header row.
- Preserve the existing close/reopen semantics and native session identity.
- Keep the solution dependency-injected and loosely coupled: the header slot must not receive drawer callbacks through the generic `renderConversation` seam.
- Encode the open/closed session rule once and reuse it in client and host code.
- Consolidate the section's notice presentation without hiding contextual errors.
- Keep the change UI-only, with no host command, schema, or native lifecycle changes.

**Non-Goals:**

- A generic popover/menu primitive or a broader UI component library.
- A full decomposition of `DrawerConversations` into creation, rename, and selection hooks.
- Renaming or removing closed conversations, archive-on-close, or any new command.
- Reimplementing the native session header, its actions, or its popovers.
- A detailed test plan; tests are planned for the implementation phase.
- Changing the order in which closed conversations are listed.

## Decisions

### Closed history is an on-demand popover, not an inline block

`ClosedConversationsMenu` owns a compact chip and a local, non-modal popover. The chip lives in the tab toolbar after the tablist and before the new-conversation action, and is rendered only when closed conversations exist. Keeping the popover local avoids inventing a generic primitive for one use; a modal was rejected because reopening is a lightweight in-place navigation, and a generic popover was rejected as premature abstraction in this scope.

The chip is deliberately outside the `role="tablist"` element. A non-tab button inside a tablist would violate its interaction model, so the tablist remains tabs-only while the chip is a sibling in the toolbar. The popover owns its Escape handling and prevents the drawer's Escape close while it is open. While a reopen is pending, dismissal is suppressed so the failure can be rendered inside the popover; rows use `aria-disabled` and keep focus instead of native `disabled` so a failed attempt does not drop keyboard focus.

### The header close action is injected through a conversation-actions context

`DrawerConversations` provides a `ConversationActions` context with the active root id, a label lookup, availability, pending state, and a close callback. `ConversationCloseAction` is rendered by the plugin-owned `SessionHeader` slot component and consumes that context with a safe no-op default. This keeps the action out of `renderConversation`, which stays a generic session-surface factory, and avoids threading task or drawer state through the native slot boundary.

Alternatives considered: extending the `renderConversation` signature (prop drilling and a wider public seam); registering a plugin entry in the native header action slot (couples the plugin to native slot ownership and pinned internals); keeping the close action in the toolbar (does not satisfy the requested placement).

### The close action is a trailing sibling of the native header, not a third native grid column

`NativeSessionHeader` renders the native header inside a plugin-owned header row; the close action is a trailing sibling at the end of that row. The native header keeps its own internal layout, so its fallback row and any future internal changes remain intact. Inserting a third grid column into the native header wrapper was rejected because it depends on the native header returning exactly two root nodes and breaks for the single-node fallback.

The action is unavailable during a subagent peek and disabled while a conversation command is pending. When `RetainedConversation` is loading or has failed to open, the same action is included in the state surface; the `NativeBoundary` fallback also receives it so a native render failure cannot trap the tab. Those state actions are siblings of the live-region text rather than children of a `role="alert"`/`role="status"` element.

### One command executor with explicit notice scope

The section keeps one executor for create, close, and reopen so the existing in-flight guard against concurrent commands is preserved. The executor records the scope of the last command; toolbar notices show create/close problems, while reopen problems are shown inside the popover and keep it open. Rename keeps its separate native-title error because it does not use the command executor. A single `ConversationNotices` presentation renders the scoped problems, replacing the current stack of ad-hoc `ErrorNotice` calls. When a persisted `selectionRequired` flag survives a drawer section remount, the section also shows the short selection hint next to those notices because the creation error itself is component state.

Alternative: one `useAction` per command. Rejected because it would allow concurrent create/close/reopen commands and multiply pending/error state for little benefit.

### Shared conversation inventory in a pure module

`src/shared/conversations.ts` owns `openSessionIds`, `closedSessionIds`, `firstOpenSessionId`, and `agentOrdinal`. It has no React or host dependencies, so the client drawer, page state, auto-run view, and the host command layer can all use the same rule. `resolveActiveConversation` keeps its current signature and delegates to the helper. The closed list preserves the existing `closedSessionIds` order (close order); no ordering change is introduced.

Alternative: a client-only helper. Rejected because the host command layer has the same first-open rule and would keep diverging.

### Reopen selects the conversation and respects existing peek behavior

Reopening uses the existing `conversation.reopen` command followed by `chooseConversation`, which clears the peek and selects the reopened root. On success the popover closes and focus moves to the reopened tab after a short post-commit retry, falling back to the chip only when the tab remains unavailable; on failure the popover stays open with the error. The chip and menu are disabled while the command is pending. Escape and outside-click dismissal return focus to the chip.

## Risks / Trade-offs

- **Popover clipping inside the flex drawer** → cap the popover height, make its list scrollable, set an explicit stacking order, and verify at narrow drawer widths.
- **Context loss across the native slot boundary** → the provider wraps the rendered conversation surface; the close action falls back to a no-op when the context is absent, and the existing navigation context proves the slot stays in the React tree.
- **Escape closes both the popover and the drawer** → handle Escape in the popover, prevent its default, and verify the drawer remains open when only the popover is dismissed.
- **Focus loss when reopening the last closed conversation removes the chip** → move focus to the reopened tab after a successful reopen; keep the chip mounted until the command settles so dismissal focus remains valid.
- **Native body failure leaves no header** → render the close action in `.kanban-native-state` loading/error surfaces and in the `NativeBoundary` fallback.
- **Notice consolidation hides a distinct error** → consolidate presentation, not error state: create/close/rename stay in the toolbar area, reopen stays in the popover, and selection-required guidance stays in the empty state.
- **Shared helper changes reach the host build** → keep `src/shared/conversations.ts` free of client imports and runtime dependencies so both build targets can consume it.
- **Header-row wrapper changes native header spacing** → move the border/background to the row and leave the native header's internal layout untouched; verify fallback spacing.
- **Order of closed entries may not match user expectation** → preserve the current close order in this change to avoid an unrequested behavior shift.

## Migration Plan

No data or schema migration is needed. Existing `sessionIds` and `closedSessionIds` data keeps its meaning. The change ships in the plugin build and is rolled back by reverting that build; no host restart semantics change and no new command is introduced.

## Open Questions

None. The interaction, placement, availability, and cleanup scope were confirmed during exploration; the remaining choices are implementation details covered by the decisions above.
