# Tasks

## 1. Host panel port

- [x] 1.1 Add `src/client/sidebar-panel-port.ts` with the structural `SidebarPanelService`, `SidebarSessionFace` and `SidebarPanelPort` types and a `createSidebarPanelPort(value)` factory that returns a port only when the service reports `capabilities.embeddedPanel === true` and exposes `forSession`, narrowing the face to the observable `expanded` and `setExpanded`. Verify `tests/client/sidebar-panel-port.test.ts` covers a supported service, an older service without the capability, a malformed value, and reads for a Session with no mounted occurrence.
- [x] 1.2 Build the port once in `src/client.tsx` from an optional `ctx.get('sidebarRight')` inside a `try/catch` (the pattern `host-navigation.ts` uses for `layout`) and pass it, plus a `renderPanel` render-prop that calls `renderFactorySlot('sidebar.right.panel', { variant: 'embedded' }, { fallback: null })`, into the `kanban.conversation` seat closure. Verify `pnpm typecheck` passes and `pnpm vitest run tests/client/conversation-surface-window.test.tsx` still passes with the port absent.

## 2. Workspace geometry and width

- [x] 2.1 Add `src/client/conversations/workspace-layout.ts` with `CONVERSATION_MIN = 420`, `RAIL_MIN = 320`, `RAIL_DEFAULT_RATIO = 0.45`, `DIVIDER = 8`, `planWorkspace(...)` and rail clamping. Verify `tests/client/workspace-layout.test.ts` covers split, cover, the drawer growth target, a narrow viewport, and rail bounds.
- [x] 2.2 Add the rail width preference read/write under `dsh-kanban.rail.width` with tolerance for missing, invalid, and out-of-range values. Verify the layout tests cover the 45% default, a stored width, and clamping on read and on resize.
- [x] 2.3 Add `src/client/use-resizable-split.ts` (pointer capture, keyboard arrows and Home, bounds, ARIA value) and move the drawer's inline width logic into `src/client/use-drawer-width.tsx` with `baseWidth`, `reserve(extra)`, `release()`, and the existing `dsh-kanban.drawer.width` persistence. Verify `tests/client/use-drawer-width.test.tsx` proves the base width never changes while reserved, the reserved width follows a manual resize, and release restores the base.
- [x] 2.4 Update `src/client/drawer.tsx` to use the hook and provide `DrawerWidthContext` around the drawer body, keeping the existing resize handle, double-click reset, Escape, background dismissal, and draft retention. Verify the existing drawer tests pass unchanged: `pnpm vitest run tests/client/drawer-header.test.tsx tests/client/drawer-animation.test.tsx tests/client/drawer-conversations.test.tsx`.

## 3. Conversation workspace

- [x] 3.1 Add `src/client/conversations/workspace.tsx` with the split layout, divider, covered presentation, the `useSyncExternalStore` subscription to the Session face's `expanded`, the reservation effect, a panel-scoped error boundary, and the accessible labels. Verify `tests/client/conversation-workspace.test.tsx` covers rail presence per `expanded`, absence without a port, session switching, release on collapse, cover mode, the inert conversation while covered, focus not trapped, and no plugin-owned tab chrome.
- [x] 3.2 Mount the workspace in the conversation surface that renders the conversation window occurrence, so the window and the panel are siblings inside the retained Session area and the panel receives no Session identity. Verify `tests/client/conversation-surface-window.test.tsx` still renders the window and that a new assertion shows the workspace absent when the port is unavailable.
- [x] 3.3 Add the styles for the split, divider, covered panel, minimum widths, and focus rings in `src/client/styles/`. Verify a browser appearance test asserts the host theme tokens and contrast in light and dark and writes screenshots under `.verification/`.

## 4. Absence and shared notice

- [x] 4.1 Extract the unsupported-native-surface notice from `src/client/conversation-surface.tsx` into `src/client/native-surface-notice.tsx` (title and detail props) and reuse it for `conversation.window`; the rail intentionally has no notice. Verify the unsupported-host test still asserts the update notice.
- [x] 4.2 Verify the capability-absent drawer renders no rail, no notice, and no additional control, and that it still renders the conversation window normally. Verify with a client test plus the browser harness scenario that disables the port.

## 5. Plugin-owned browser harness

- [x] 5.1 Add a `drawer-sidebar` scenario to `tests/browser/harness.tsx` that renders the workspace through `renderConversation` with a fake port, a stub panel body, and the theme fixture, and add `tests/browser/drawer-sidebar.spec.ts` covering: the rail appearing and disappearing with the fake face's `expanded` (the native control is exercised in the real lane), pointer and keyboard rail resize, the rail width surviving a reload, the drawer growing and restoring its base width, cover mode in a narrow viewport, conversation switching, and light/dark tokens. Verify `pnpm test:browser` passes and screenshots land under `.verification/`.
- [x] 5.2 Confirm no existing browser expectations changed by running the full `pnpm test:browser` and checking the drawer-header, drawer-peek, drawer-animation, and appearance specs.

## 6. Isolated real-composition lane

- [x] 6.1 Add a `sidebar` lane template (or extend `native-drawer`) that opens a task with a conversation, expands the panel from the native right-bar corner control, opens the files page and a terminal inside the drawer panel (resource-link targeting is host-owned and remains a documented residual gap), switches conversations, and reloads with the panel expanded. Gate the rail assertions on `capabilities.embeddedPanel` and report `unsupported host` without failing when the booted checkout lacks it. Verify with `node scripts/e2e-dsh.mjs --checkout <built checkout containing 69b0f199> --check --only sidebar`, then run the lane itself against that checkout.
- [x] 6.2 Record the lane prerequisite (a built DSH checkout containing `69b0f199`) in `tests/e2e-dsh/README.md` and verify the runner lists the new lane in its usage text.

## 7. Documentation and release

- [x] 7.1 Document the rail in the README's drawer section: the native open and close controls, the split and rail width, the drawer growth and restore, the shared per-Session state, the panel's docking-only chrome, the absence behavior on older hosts, and the limitation that link opens are claimed only while the panel is expanded.
- [x] 7.2 Update the operations notes for `dsh-kanban.rail.width`, the base-width reservation, the shared collapse effect, and the host capability dependency, and bump `package.json`'s version in the release convention.
- [x] 7.3 Run the full gates: `pnpm check`, `pnpm test:browser`, `openspec validate --strict embed-right-sidebar-in-task-drawer`, and the isolated smoke from `AGENTS.md` against a built DSH checkout; record the evidence under `.verification/` without tokens or owner data.
