# Tasks

## 1. Shared conversation inventory

- [x] 1.1 Create `src/shared/conversations.ts` with `openSessionIds`, `closedSessionIds`, `firstOpenSessionId`, and `agentOrdinal`; verify `pnpm typecheck` succeeds.
- [x] 1.2 Replace the duplicated open-session filters in `page-state.ts`, `auto-run-view.tsx`, `drawer-conversations.tsx`, and `host/app.ts` with the shared helpers; verify `pnpm typecheck` and that no ad-hoc `sessionIds.filter(...closedSessionIds...)` or `sessionIds.find(...closedSessionIds...)` remains.
- [x] 1.3 Extract the conversation label and `Agent N` fallback into a client module reused by the drawer and the auto-run view; verify `pnpm typecheck` and that the auto-run target copy still matches the tab label.

## 2. Closed-conversations control

- [x] 2.1 Add the `ClosedConversationsMenu` component with the chip, anchored popover, scrollable list, clickable title rows, Escape/outside-click dismissal without closing the drawer, focus entry, focus return to the chip on dismissal, and focus to the reopened tab on success; verify `pnpm typecheck`.
- [x] 2.2 Wire the menu into the Conversations toolbar after the tablist and before the new-conversation action, and remove the `<details class="kb-closed">` block and its hint; verify the chip is absent with zero closed conversations and shows the correct count otherwise.
- [x] 2.3 Add chip and popover styles using the host tokens, remove the `.kb-closed` rule, and keep the focus-visible treatment consistent; verify light and dark rendering at a narrow drawer width.
- [x] 2.4 Route reopening through the menu: reopen, select, and focus the reopened tab on success; close the popover. On error, keep the popover open with the failure inside. Verify both outcomes against the fake host.
- [x] 2.5 Replace the all-closed empty state with the short copy that points to the chip; verify it never repeats the closed list or adds a second reopen action.

## 3. Header close action

- [x] 3.1 Add the `ConversationActions` context and `ConversationCloseAction` component, and provide the context from `DrawerConversations`; verify `pnpm typecheck`.
- [x] 3.2 Compose the plugin header row with the native header and the trailing close action, without changing the native header's internal layout; verify the native header and its fallback both render the row.
- [x] 3.3 Enforce availability: the action closes the active root, is absent during a subagent peek, is disabled while a conversation command is pending, and names the active conversation; verify each state.
- [x] 3.4 Keep the close action reachable in the native loading/error surface and the `NativeBoundary` fallback; verify a failed conversation can still be closed.
- [x] 3.5 Remove the close button and its props from `ConversationTabs`; verify the toolbar contains only the tablist, the closed-conversations chip, and the new-conversation action.

## 4. Notices and state cleanup

- [x] 4.1 Track the last command scope in the section executor and add the consolidated `ConversationNotices` presentation; verify create/close/rename notices appear in the toolbar area and reopen notices stay inside the popover.
- [x] 4.2 Remove the duplicated synthesized selection problem and keep that guidance in the empty state; verify `pnpm typecheck` and the selection-required path.

## 5. Validation

- [x] 5.1 Update the existing client assertions and fixtures affected by the moved close action, the removed closed block, and the new empty-state copy; verify the targeted client tests pass.
- [x] 5.2 Run `pnpm check` and fix typecheck, test, and build regressions; verify it exits successfully.
- [x] 5.3 Run the plugin-owned browser lane for the drawer appearance and keyboard dismissal, using the isolated profile and writing evidence under `.verification/`; do not use the developer's running GUI or personal `$DSH_HOME`.
