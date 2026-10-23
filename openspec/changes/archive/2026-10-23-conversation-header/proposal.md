# Proposal

## Why

Task conversations in the Kanban drawer render only the native chat body, so they lack the session header that ordinary DSH chats show: the agent mode, subagent activity, and background-job activity. The native actions are private, ownership-bound slot entries, so a supported reuse would require a DSH change.

The plugin can avoid that upstream change by hosting the host's existing native header-action entries directly. The row then shows the real native mode label, subagent tree, and background-job list/popovers rather than a plugin copy. The trade-off is a private, pinned-host integration; it is contained in one host module.

The board header also overlaps the macOS traffic lights and the collapsed-sidebar window-chrome controls when the DSH sidebar is fully collapsed. The host publishes a leading-clearance token for exactly that frame state; the Kanban header currently ignores it.

## What Changes

- Add one compact conversation status row under the task drawer's agent tabs, scoped to the active conversation.
- Render the host's actual native agent-mode, subagent, and background-job header-action components in that row by reading the native header-action slot entries. The native labels, counts, popovers, and actions remain native; the plugin does not reimplement them.
- The row follows the selected tab, does not aggregate other conversations, hides when no native action renders, and appears only in the Conversations section.
- The agent mode is **display-only** in the drawer. No mode picker is added; mode selection remains outside this change.
- Add the session frame and `kanban.session.status` slot so the row sits inside the session provider but outside the native transcript scrollport.
- Fix the Kanban board header's leading inset when the host sidebar is fully collapsed, using the host's published frame leading clearance. The title, subtitle, and toolbar must clear the macOS traffic lights and shell controls, including fullscreen and narrow widths.
- Add the native locale client dependency and injection needed to render the native action components and their labels.
- Keep the pinned DSH release. This change does not modify or require a new DSH release; the host integration is deliberately private and version-coupled to the pinned host.
- Refactor the conversation selection/tabs/body responsibilities so the new row does not grow the existing component.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-conversations`: adds the native status row, read-only mode display, and the pinned-host native action hosting contract; removes the blank-conversation mode picker from scope.
- `kanban-board`: adds the board header's leading clearance for the fully collapsed desktop sidebar and its fullscreen/narrow-width behavior.

## Impact

- Kanban client: a new native-action host module, a session-scoped status slot and frame, the conversation-area refactor, and the board header CSS.
- Dependencies: add the `@deepseek-ai/dsh-client-locale` client package at the existing rc.2 pin and inject the `locale` service; no DSH version change.
- Native coupling: the host reads the pinned DSH's `conversation.session.header.actions` entries (`agent-preset`, `subagent-catalog`, `job-list`) and the private entry inject/components. This is not a public rendering API; it must be guarded and tested against the pinned release.
- Host/remote contract: unchanged. No preset roster or selection API is added.
- Styling: the row uses host tokens and mirrors the native actions band; the board header uses the host frame clearance token.
- Verification: unit tests with fake native entries and components, bridge slot/frame tests, board regression, a CSS/host-token check, and one opt-in owner-authorized GUI smoke on the pinned release.
