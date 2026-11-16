# Proposal

## Why

Clicking a file link inside a task drawer conversation fails unless the drawer's right Sidebar panel is already expanded. The host opens a resource through the Session the Sidebar currently targets: while the drawer's panel is collapsed the embedded occurrence is not a target, and while the board fills the frame's main column no Session is on screen, so the host has nothing to open into. The chat reports "Couldn't open file" with Close and Retry, and Retry repeats the same failure because nothing changes between attempts. The same click works once the panel is expanded, which is why the gap reads as "the link needs the sidebar open first".

The links themselves are host-owned, so the plugin cannot change how the host addresses an open. What the plugin can do is finish the open the host could not target: the drawer already knows which conversation it is presenting, and the host already exposes a per-Session open that its own packages use.

## What Changes

- The plugin claims resource opens for the drawer's active conversation: when the host's open call cannot resolve a Session surface, the plugin re-issues that open for the Session the drawer is presenting, so the file lands in that Session's panel and the panel opens.
- Coverage is the host's own routing, unchanged: user file chips, assistant Markdown file links, inline-code file mentions, tool-row file paths and line references, deliverable previews, and external links configured to open in the Sidebar (browser tab).
- While the drawer presents a transient subagent peek, an open targets the task conversation's panel rather than the peeked Session's; the peek draws no panel, so the open is not shown while it is presented.
- Nothing changes when the host can resolve the open itself: the main chat, an already-expanded drawer panel, and any host without the embedded-panel capability keep their current behavior. A host that does not expose the per-Session open keeps today's dialog because the plugin rethrows the host's own error.
- The plugin no longer documents the collapsed panel as a limitation: the drawer's panel opens on a link click, and its expansion still arrives only through host writes.
- `package.json` version bump, as every change to the installed artifact requires.

**BREAKING**: none. The behavior is additive and every existing open path keeps its result.

## Capabilities

### New Capabilities

None. The change completes behavior the drawer's panel capability already promises.

### Modified Capabilities

- `drawer-sidebar-panel`: an open from the drawer conversation lands in the drawer's panel even while that panel is collapsed, opening it in the same step; the panel therefore opens for a resource open as well as through the conversation header's native corner control.

## Impact

- Client composition: a new `src/client/host-open-fallback.tsx` module, wired where the conversation seat already resolves the optional `sidebarRight` service in `src/client.tsx`; the Session it targets comes from the board page state the drawer already writes.
- Host contract consumed, not implemented: the existing `openResource`/`openTab` service methods plus the per-Session `openResourceIn`/`openTabIn` that the host's terminal and open-in-app packages already call. All are read through a structural interface, the pattern the plugin already uses for `sidebar.right.panel`.
- Tests: client unit tests with a fake service, and one assertion in the plugin-owned isolated lane that a file link clicked with the panel collapsed reveals the rail with the file tab.
- Documentation: `README.md`, `docs/operations.md`, and `tests/e2e-dsh/README.md` stop describing this as a host-owned residual gap.
- No host source changes, no new dependency, no DSH floor change, no data migration.
