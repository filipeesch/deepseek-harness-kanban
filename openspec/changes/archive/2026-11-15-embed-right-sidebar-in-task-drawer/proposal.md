# Proposal

## Why

The native DSH chat has a right Sidebar beside the conversation — workspace files, document and image preview, terminal, and browser tabs — and the task drawer already hosts the native conversation window, but it has no way to open that panel. Two visible symptoms follow: clicking a file link inside a drawer conversation fails because the Sidebar has no Session surface while a main panel is active, and the window's right-bar corner control writes an expanded state that nothing draws, then hides itself.

The host now exposes the panel as a public embedded surface (private-dsh `69b0f199`, capability `sidebar.right.panel`), so the plugin can host the same panel beside the drawer's conversation instead of rebuilding files, preview, terminal, and browser.

## What Changes

- Add the host's right Sidebar panel to the drawer's **Conversations** section for the active root conversation, beside the embedded conversation window: a real split, a resizable divider, a 45% default width, and a persisted rail width.
- Open the panel from the host's existing right-bar corner control in the drawer's conversation header and close it from the panel's own collapse control; add no new open or close chrome.
- Share one panel state per Session with the main column: the same tabs, layout, history, and `dsh.sidebar-right.v1.<sessionId>` persistence, so an open from either place reveals the same tab and a terminal tab stays one process.
- While the panel is expanded, file and line links, page shortcuts, and assistant Markdown links configured for the Sidebar from the drawer conversation open in the drawer's panel instead of failing for lack of a Sidebar surface.
- Grow the drawer to fit conversation plus panel when the panel opens (remembering the base width) and restore the base width when the panel collapses or closes; when the viewport cannot fit both, present the panel over the conversation inside the drawer.
- Bind the rail to the active root conversation tab; do not present it for a transient subagent peek, while a conversation is being created, or when no conversation is open.
- Detect the host capability at runtime: on a host without the embedded panel the drawer keeps today's behavior — no rail, no notice, no dead control.
- Refactor the code this feature touches: one shared width/resize hook for the drawer and the rail, the conversation-area composition extracted out of the drawer, an injected optional host port for the panel, and one reusable unsupported-native-surface notice.
- **Not in scope**: floating panes, pane split, or fullscreen inside the rail (the host embedded occurrence is docking-only); per-occurrence layouts; new tab types; any change to the main column's Sidebar or to DSH sources in this repository.

## Capabilities

### New Capabilities

- `drawer-sidebar-panel`: the host's right Sidebar panel embedded in the task drawer — binding to the active conversation Session, the split and rail presentation, width reservation and restoration, shared per-Session state, open and close affordances, and graceful absence on hosts without the capability.

### Modified Capabilities

<!-- None: the drawer's existing conversation, resizing, and navigation requirements keep their behavior; the rail is new behavior with its own capability. -->

## Impact

- Client composition: `src/client.tsx` (optional host port built at the composition root), `src/client/conversation-surface.tsx` (conversation workspace around the window occurrence), `src/client/drawer.tsx` and the new width hook (base width plus a rail reservation), a new `src/client/conversations/workspace.tsx` (split, divider, rail mount, narrow overlay), `src/client/styles/base.ts` and the drawer styles, and a reusable native-surface notice.
- Host contract consumed (not implemented here): `renderFactorySlot('sidebar.right.panel', { variant: 'embedded' })`, `ctx.sidebarRight.capabilities.embeddedPanel`, and `ctx.sidebarRight.forSession(sessionId)` with its observable `expanded` state. Available in the private-dsh `master` at `69b0f199`; typed structurally in the plugin so the supported DSH 0.2.2 floor and the absence fallback stay intact.
- Tests: client unit tests for the port, layout, width reservation, and rail presence; the plugin-owned browser harness with a fake panel Factory; and the isolated real-composition lane, where the full rail acceptance runs only when the booted host reports the capability.
- Documentation: the README's drawer and host-compatibility sections, plus the operations notes for the rail's width, persistence, and capability fallback.
