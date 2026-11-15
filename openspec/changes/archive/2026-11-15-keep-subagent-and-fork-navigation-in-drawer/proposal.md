# Proposal

## Why

The drawer hosts the host's native conversation window, but the window's navigation is global: selecting a subagent in the header lineage or catalog, following a breadcrumb ancestor, or branching a turn all call the host's `openSession`, which selects the target in the main panel and unmounts the Kanban panel. The drawer therefore closes, the board disappears, and a fork of a task conversation - which the plugin already adopts as another conversation of the task - is only reachable after the user returns to Kanban. A subagent or a branch requested from inside a task is work on that task, so both should stay inside the task's drawer while ordinary native navigation stays untouched.

## What Changes

- Detect a native navigation that leaves the Kanban panel while a task drawer is open, resolve the navigated Session against the open task's lineage, and re-select the Kanban panel in the same tick with the target already applied inside the drawer. The board and the drawer are never unmounted for a target that belongs to the open task.
- Open a subagent selected from the window's native lineage or subagent catalog as a transient peek inside the drawer: it replaces the conversation body, the tab strip keeps only the task's conversations, and the native breadcrumb returns to the task conversation. Nested descendants use the same surface. A target outside the task's owned lineage keeps the host's native navigation.
- Ask the host to attach a fork of a task conversation as that task's conversation (reusing the existing adoption path) and select the resulting tab in the drawer. A fork created from the turn-tail branch is classified by refreshing the session list once; while it is being attached the drawer shows a pending state. An attach failure is reported in the drawer with an action that opens the fork in the main chat.
- Leave foreign targets alone: a fork of a subagent descendant, a fork adopted without a navigation (the window header's session menu), a conversation of another task, and any ordinary chat keep the host's native navigation, and only a fork claimed by the branch navigation is selected automatically.
- **BREAKING** for the specified navigation contract: the drawer no longer follows native subagent navigation into the main panel, and an adopted fork is no longer appended without becoming active when the drawer claims it. Both were explicit requirements of this product.
- Introduce the client-side navigation bounce as a small port-driven coordinator plus a pure lineage resolver, so the classification, the re-selection and the pending-fork lifecycle are testable without a browser.
- Refactor the drawer's conversation surface around the new state: a discriminated drawer view replaces the conversation id and selection flags, the lease registry accepts a Session id or a subagent address, and the conversations component is split into the tab strip, the creation and preset flow, and the conversation surface.
- Update the `task-conversations` requirements, the README conversation section, and the Kanban compatibility note; no DSH change is required.

## Capabilities

### New Capabilities

None. The host already specifies its native window, subagent catalog, and fork behavior; this change adopts and composes them inside the plugin.

### Modified Capabilities

- `task-conversations`: replaces the requirement that the drawer follows native subagent navigation, adds the board-preserving navigation bounce and the transient subagent peek, changes fork adoption so the claiming drawer selects the fork and asks the host to attach it, extends the native window requirement to cover the peeked descendant, and clarifies that lineage ownership and the conversation tab list are unchanged by a peek.

## Impact

**Client**

- New pure module for the drawer's navigation targets: resolves a navigated Session into a root conversation, an owned subagent descendant, a fork of a conversation, or a foreign target, failing closed on a missing row or a lineage cycle.
- New client-level coordinator that observes the layout panel selection and the session list, restores the Kanban panel, applies the drawer outcome, and owns the pending-fork lifecycle with a generation guard.
- `src/client/page-state.ts`: the drawer view becomes a discriminated union covering the active conversation, the peeked descendant, the selection-required state, and the pending fork.
- `src/client/conversation-leases.ts`: leases acquire a typed target (Session id or subagent address) and release the peek with the surface that shows it.
- `src/client/conversation-surface.tsx`: the retained conversation and window adapter accept the peek target while keeping the single-composer claim, read tracking for root conversations, and the open-failure report.
- `src/client/drawer-conversations.tsx`: split into the tab strip, the creation/preset flow, and the conversation surface; the component keeps the drawer's conversation composition.
- `src/client.tsx`: instantiate the coordinator with its ports at the client composition root.

**Host**

- One client command that attaches an existing fork to a task through the existing fork-adoption path and reports the resulting conversation or the failure. No model-facing tool, prompt section, session event, or durable task state changes.

**Dependencies**

- None. No DSH change is required; the design uses the pinned host's public layout, session-list, and navigation surfaces.

**Tests and evidence**

- Unit tests for the resolver (root, direct and nested descendant, fork, foreign, missing row, cycle) and for the coordinator (retain notification, same-tick re-selection, generation guard, pending-fork attach and failure).
- Client tests for the peek surface, breadcrumb return, pending fork state, attach failure notice, and the split conversations component.
- The isolated real-composition lane (`--only native-drawer`) extended: the board stays mounted when a subagent is selected, the peek opens and returns, and a branch ends with the new tab selected.

**Out of scope**

- Changing the host window, the header, the subagent catalog, the fork implementation, or any other host plugin.
- Adding subagent descendants to `sessionIds`, the closed-conversation list, ownership, worktree protection, deletion counting, or archiving.
- Selecting a fork the drawer did not claim, restoring the host's previous main selection after a bounce, or adding a shortcut between a task card and the main chat.
- Persisting the peek across a drawer close, a task switch, or a reload.
