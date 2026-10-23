# Tasks

## 1. Locale dependency and native action host

- [x] 1.1 Add `@deepseek-ai/dsh-client-locale` at the existing rc.2 pin to the client dependency list, add it to `dsh.client.inject`, add `locale` to the client runtime injection, and import its client types; verify `pnpm install` and `pnpm typecheck` resolve `ctx.locale` without changing any other DSH version.
- [x] 1.2 Add `src/client/native-session-actions.tsx`: read `conversation.session.header.actions` entries, filter to `agent-preset`, `subagent-catalog`, and `job-list`, sort by order, call each entry's inject with the session id, synthesize `use<Name>` hooks from its hook sources, bind `t` from its locale, render the native component with the session standard props and an error boundary, and return null when no entry is available; verify `pnpm typecheck` and the host unit test.
- [x] 1.3 Add `tests/client/native-session-actions.test.tsx` with fake slot entries and fake native components: assert the three ids and order, the injected business face, the standard session props, the `t` namespace, hook synthesis and selection, the error boundary, and no plugin fallback when entries are absent; verify the focused Vitest file passes.

## 2. Status slot, frame, and row

- [x] 2.1 Add the `kanban.session.status` child slot to the `main:kanban` registration and `MainProps`; implement `SessionStatus` to read the native entries, subscribe to slot mutations, and render `NativeSessionActions` only while the session is open; verify the client typecheck and the bridge slot registration.
- [x] 2.2 Move the retained session provider around the frame: render `kanban.session.status` before `kanban.conversation`, move `.kb-native-conversation` under the frame, and make the frame/panel flex columns with a non-scrolling row and `min-height: 0`; keep the native content's existing scroll floor; verify the existing retention/composer tests; the real GUI scroll/no-double-scroll check is part of 4.4.
- [x] 2.3 Extract `resolveActiveConversation`, `ConversationTabs`, and `ConversationBody` from `Conversations`; remove the `NativeView` wrapper; verify the existing tab/new/close/reopen and section tests still pass.
- [x] 2.4 Add the row styles: host tokens, native actions-band spacing, `container-type: inline-size`, `:empty{display:none}`, and the group label/data attribute; verify the row follows tabs, hides when empty, and does not aggregate other conversations.

## 3. Board header clearance

- [x] 3.1 Add `padding-inline-start: max(20px, var(--dsh-frame-leading-clearance, 20px))` to `.kb-header` so the collapsed macOS sidebar's traffic lights and shell controls never overlap the title, subtitle, or toolbar; verify the style token is present; the desktop clearance and wrap check is 3.2.
- [ ] 3.2 Verify the desktop behavior with the sidebar collapsed, expanded, fullscreen, and at a narrow window width; confirm the title/subtitle/toolbar clear the window chrome and record the result. This check is manual because the Electron traffic lights are outside the browser smoke.

## 4. Verification

- [x] 4.1 Add `tests/client/conversation-surface.test.ts` for `resolveActiveConversation` (selected open, selected closed/stale, no selection, all closed); verify the focused Vitest file passes.
- [x] 4.2 Extend `tests/bridge/plugin.test.tsx` and `tests/bridge/cordis.test.ts`: `main:kanban` declares the status child, the status slot renders before the conversation slot inside the provider, exactly one status slot exists per drawer, tab switches remount it, Info/Git/Notes unmount it, and the registration count/keys are updated; verify the focused bridge tests pass.
- [x] 4.3 Run the existing `tests/client/board.test.tsx` regression plus `pnpm typecheck`, `pnpm test`, and `pnpm check`; resolve regressions and record the commands.
- [ ] 4.4 Run one opt-in owner-authorized GUI smoke on the pinned release with a disposable task: open a conversation with native actions, confirm the real mode label and subagent/job popovers render in the status row, switch tabs and sections, confirm a native popover keeps the drawer open, and confirm the row stays outside the transcript scrollport without double scrollbars. Use no real model and do not re-test native count/popover internals; record the evidence. This remains outside CI.

## 5. Documentation

- [x] 5.1 Update the README with the status row, the read-only mode boundary, the private pinned-host integration, the no-picker scope, and the collapsed-sidebar header behavior; verify the text matches the implemented behavior and the pinned DSH release.
