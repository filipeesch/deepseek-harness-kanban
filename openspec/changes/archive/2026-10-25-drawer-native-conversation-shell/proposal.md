# Proposal

## Why

The drawer's conversation area is a custom shell around the native transcript. That gap now produces three concrete failures: a subagent click switches the main DSH panel away from the board, the injected task context is pinned over the transcript instead of rolling with it, and the native chat mode selector never appears for a new task conversation.

The pinned DSH release has no public conversation-shell factory, but it exposes the session header, lineage, header actions, mode seat, and context row as slot entries. The plugin already hosts private native header actions successfully. Extending that pinned-host pattern to the session header and the two other entries removes the custom shell without a DSH change, while keeping the native transcript and composer public.

## What Changes

- Replace the compact native-action status row with the host's **native session header** for the active conversation: title, ancestry breadcrumbs, lineage/subagent switcher, header actions, and non-store utilities.
- Host the native **agent-preset seat** in that header for blank task conversations. Selecting a mode uses the native preset roster and selection API for that blank session; after the first turn the native read-only label replaces the picker. There is no plugin-owned mode or task default.
- Add an **in-place subagent peek**: the native subagent catalog and lineage open the selected child conversation inside the drawer instead of the main DSH panel. The native breadcrumb navigates parent/root in the drawer, the task tab strip stays the stable root-session surface, and the child never becomes a task session ID, closed entry, or persisted tab. The peek resets on drawer close, task switch, or root-tab selection.
- Reuse the **native composer election** for the peeked child: one-shot children stay read-only; continuable children keep native follow-up and parent-offline behavior.
- Replace the absolutely positioned task-context overlay with a visible **inline Chat node** rendered through the native context-row presentation. The context remains the durable plugin-sourced `kanban-task` message injected before the first user message; it is not a system prompt or a human-authored message. The row is visible wherever the task conversation is rendered.
- Keep the native transcript and `conversation.content` composer. Do not host the resident global conversation header, the native View tabs, or store-backed corner controls. Chat remains the only drawer view.
- Keep a fallback to the existing native-action row when the native session-header entry is unavailable, and per-entry boundaries so the drawer does not fail as a whole. Missing native pieces are not reimplemented.
- Extract the native host, slot hosting, mode seat, task-context node, conversation navigation, and drawer conversation surface out of the current monolithic client/drawer modules. Remove the task-context overlay, its absolute-positioning workaround, and the old status-row contract.
- Keep the pinned DSH release. This change does not modify DSH, add a new DSH dependency, change the host/remote contract, or change the board schema.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-conversations`: replaces the native status row and read-only mode requirements with a native session-header host, native mode selection for blank conversations, in-drawer subagent navigation, and an inline visible task-context row. Clarifies that a subagent peek retains a child reference transiently without adding it to the task's conversation tabs, retained session IDs, or closed list.

## Impact

- Kanban client: new native-header host, generic native-slot host, native mode-seat controller, inline task-context Chat node, in-drawer navigation controller, and a split drawer conversation surface.
- DSH coupling: the host reads the pinned `conversation.session.header` and its lineage/actions/utilities child entries, `conversation.hero.agentPreset`, and the keyed `conversation.chat.node` context entry. These are private, version-coupled entry contracts; the plugin must guard against missing entries and skip store-backed entries it cannot wire to the native instance.
- Runtime services: the client gains the `uiConversation` service injection for the Chat-node registration and uses the existing `remote` namespace for the native preset roster/selection. No host command or remote schema is added.
- Behavior: the drawer no longer presents a read-only-only mode or a separate compact action row; a subagent conversation stays in the drawer. The task-context row becomes part of the native transcript and is also visible in ordinary native Chat for task conversations.
- Documentation/specification: `task-conversations` deltas, README drawer/mode/task-context sections, and the existing verification assumptions that referenced the status row or overlay.
- Verification: the change carries its own layered plan — pure in-memory tests for slot descriptors, navigation, mode policy, and the task-context Definition; jsdom/bridge tests for native-host assembly, gating, fallbacks, peek lifetime, and retention; and a pinned-DSH e2e lane for the native header/mode, in-drawer subagent peek, and seeded inline context row, with an optional first-turn replay acceptance. Existing status-row, overlay, and bridge Task-context assertions are replaced. No separate testing-only change is created.
