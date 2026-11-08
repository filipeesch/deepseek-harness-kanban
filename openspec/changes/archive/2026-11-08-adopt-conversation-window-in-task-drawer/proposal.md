# Proposal

## Why

The task drawer assembles the native conversation window by hand: it reads private header slot entries, fabricates the rc.2 header prop bag, renders the header's child slots itself, and mounts a synthetic agent-preset seat. That integration broke on a DSH minor release: the host header gained mandatory shares (`setPinned`, `useEntryPins`, `useEntryActions`) and a fifth child slot, so the hand-built header throws during render and silently degrades to a fallback without title ancestry, View tabs, utilities, or the right-bar corner. DSH now exposes the whole window as the public `conversation.window` Factory, so the plugin can render the same native chrome without reconstructing it.

## What Changes

- Render one `conversation.window` occurrence with `variant: 'embedded'` inside the task's retained Session area. The occurrence takes only the variant; its Session binding comes from the existing `SessionProvider`, and the host composes the header and the body.
- Stop mounting or fabricating anything in the header: title ancestry, View tabs and their More menu, header actions, utilities, and the right-bar corner come from the host registrations that already own them.
- Let the window derive the conversation phase, and let the body use the Session's selected View. The plugin no longer forces a Chat View or a docked-only blank conversation.
- **BREAKING** Require a DSH release that declares `conversation.window`: raise `engines.dsh` and the DSH dev/peer dependencies, and bump the plugin version to `0.2.0`. Older hosts are not supported; a missing Factory renders an explicit "update DSH" notice instead of a blank area.
- Remove the hand-built header and its fallback: `native-session-header.tsx`, `native-session-actions.tsx`, `mode-seat.tsx`, the header-specific traits of `native-slot-host.tsx` and `native-slot-descriptors.ts`, and the synthetic header prop bag.
- Keep a plugin-owned agent-preset picker because the host's own preset seat and read-only label self-hide outside `mainView`. Present the host's native preset roster as selectable cards in the conversation area when the task has no open conversation, and make the plus action open the same choice. Activating a card creates the conversation, applies that preset to it, and opens the window; a failed selection leaves the conversation on the host default, reports the failure, and keeps the card available for retry. The existing preset port/controller is retained and refactored, not reimplemented.
- Remove the in-drawer subagent peek together with its navigation, lease, and state plumbing. Header lineage and catalog entries now use the host's native navigation, which selects the session in the main panel.
- Move the close action for the active conversation into that conversation's tab, to the right of its title, keeping the same pending-disable behavior and accessibility.
- Keep the plugin-owned conversation gates around the occurrence: the single-composer claim, read/view tracking, and the open-failure report with retry/close.
- Update the README conversation section, the affected `task-conversations` requirements, and the shared compatibility note by removing the header entries from its inventory.

## Capabilities

### New Capabilities

None. The public window is a DSH capability, already specified in the host repository; this change only adopts it in the plugin.

### Modified Capabilities

- `task-conversations`: the drawer requirements for the native window composition, preset selection and conversation start, host compatibility, subagent navigation, conversation close placement, and immediate opening change. The requirement that the plugin host the native header without a DSH release is replaced by the public-window adoption, the in-drawer subagent peek requirement is removed, and the explicit start/plus action becomes the agent-preset card choice.

## Impact

**Client**

- `src/client.tsx`: remove the `kanban.session.header` slot and the manual header component, register the window adapter on the remaining conversation slot, and wire the optional `remote.agentPresets` namespace into the card picker.
- `src/client/conversation-surface.tsx`: replace the body-only host with a thin window adapter and simplify the owner/services interfaces.
- `src/client/drawer-conversations.tsx`: place the close action inside the active conversation tab, replace the empty/start action with the preset cards, route the plus action through the same choice, and remove the peek state.
- New preset picker modules: the retained agent-preset port (filtered roster and selection), a provider/context that follows the optional `remote.agentPresets` namespace, and the card UI used by the empty state and the plus action.
- `src/client/styles.ts`: delete the manual header, fallback status, and peek-related styles; size the embedded window and the preset cards inside the drawer.
- Removed modules: `native-session-header.tsx`, `native-session-actions.tsx`, `mode-seat.tsx`, `conversation-navigation.tsx`; header-only code is removed from `native-slot-host.tsx` and `native-slot-descriptors.ts`. The preset port/controller is retained as the card picker's data layer, and new card/picker modules are added.

**Host dependency**

- A DSH release that declares `conversation.window` (private-dsh change `expose-conversation-window`). No host patch is required; the previous release range is no longer supported.

**Tests and evidence**

- Client, bridge, browser, and real-composition (`--only native-drawer`) lanes; the header/mode-seat tests are removed, and new tests cover the window occurrence, the missing-Factory notice, the open-failure gate, view tracking, the in-tab close action, the preset roster/filtering, and the card flow (empty state, plus action, selection failure and retry).

**Documentation**

- `README.md`, `openspec/specs/task-conversations/spec.md`, and the Kanban shared compatibility note (the preset roster/selection becomes an explicit compatibility entry).

**Behavior outside the browser**

- None. No model-visible text, tool, prompt section, session event, or durable task state changes.

**Out of scope**

- Changing the host window, the View roster or pin model, other window consumers, the first-turn task context, question rounds, leases, and the execution-preparation model seat.
