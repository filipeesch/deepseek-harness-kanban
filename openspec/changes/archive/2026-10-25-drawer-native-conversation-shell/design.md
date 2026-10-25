# Design

## Context

See `proposal.md` for motivation. The relevant current state is:

- The drawer renders a custom conversation shell: plugin task tabs, a compact native-action status row, the public `conversation.content` factory, and an absolutely positioned task-context row.
- The native conversation root (`main.conversation` / `ConversationRoot`) is private and ownership-scoped. `ctx.slots.renderSlot` only renders `root`; child slots render through authorization-scoped component props. A plugin cannot import or render the native root without a DSH change.
- The native session header, its lineage/actions/utilities children, the agent-preset seat, and the Chat context row are ordinary slot entries. Their components are private, but the entries are readable through `ctx.slots.entriesOfSlot`, exactly as the current `NativeSessionActions` host already does for header actions.
- The native content factory (`conversation.content`) and composer are public. The drawer already uses them.
- The pinned DSH release is `dsh-v0.2.1-rc.2`. Private entry contracts are version-coupled and must be guarded.

## Goals / Non-Goals

**Goals:**

- Make the drawer's conversation chrome native: session title/ancestry, lineage, actions, mode picker, and utilities, without a DSH change.
- Keep subagent navigation inside the drawer while preserving native breadcrumb/catalog behavior.
- Make the first-turn task context an ordinary inline transcript row through the native context-row presentation.
- Keep the implementation modular and dependency-inverted: the drawer depends on small navigation/mode/surface ports, not on DSH internals.
- Remove the custom overlay and reduce the draw/client god modules.

**Non-Goals:**

- Hosting the resident global conversation header or its window-drag/leading navigation.
- Native View tabs or Trajectory. Chat is the only drawer view.
- Standardizing or patching DSH; the host remains pinned.
- Reimplementing native labels, counts, popovers, mode selection, lineage, or context-row UI.
- Changing the task context host injection, board schema, or host/remote contract.

## Decisions

### 1. Host the native session header instead of a custom shell

Read the `conversation.session.header` entry and render its component with a manually assembled prop kit:

- standard session/global props from a new session-scoped `kanban.session.header` slot inside the existing `SessionProvider`;
- `hideChrome: false` so the action band is available for the mode seat;
- `open` wired to drawer navigation;
- `selectView` inert;
- an empty `useConversationViews` source and a `{ view: 'chat' }` dummy `useStore`, because View tabs are out of scope;
- a manual `renderSlot` that hosts the child slots;
- the native `conversation` locale binding.

A generic **NativeSlotHost** reads entries from `ctx.slots.entriesOfSlot`, sorts list entries by order/registration, synthesizes `use<Name>` selector hooks from each entry's inject face, binds each entry's locale, passes owner props and the outer standard kit, and wraps each entry in an error boundary. It subscribes to slot and locale revisions so late registrations and language changes re-render.

This replaces the custom `SessionStatus`/`kanban.session.status` primary surface. The existing native-action row is retained only as a fallback when the header entry is unavailable; the fallback still renders native entries, not replicas.

Alternatives considered:

- *Pursue a public DSH shell factory.* Cleanest long term, but blocked on an upstream change and version bump. Rejected for this change.
- *Reimplement the header with plugin UI.* Avoids private entries but does not deliver the native header, lineage, or mode picker. Rejected.
- *Render `main.conversation` through the slot renderer.* Rejected: ownership-scoped and private.

### 2. Omit resident header, View tabs, and store-backed entries

The resident `conversation.header` owns global leading navigation and `data-window-drag`; it belongs to the main layout, not a drawer. It is not hosted.

The native View tab row is driven by the private conversation store. Rather than create a second view-selection state machine, the host supplies an empty view roster and an inert state. Chat remains the only view.

Entries that declare a native store seat cannot be hosted correctly: an isolated store instance would render a control that cannot affect the real native surface. The pinned case is `conversation.session.header.corner` (right-sidebar expand). Such entries are skipped rather than faked. Utilities without store seats are hosted normally.

### 3. Native mode seat with a plugin controller, not a fake retention

Render the native `conversation.hero.agentPreset` component in the header action band for a **blank top-level task conversation**. The component's `main` guard is satisfied by a locally supplied `useSessionRetainInfo` hook returning a synthetic `mainView` count; this changes only the component's render gate, not the Session Controller's retention.

Selection behavior is ours, behind a `ModePort`:

- `list()` reads the native roster through `remote.agentPresets.list`;
- `select(sessionId, id)` calls `remote.agentPresets.select`;
- failures are surfaced through the native seat's own error/Toast state.

A small `ModeSeatController` implements the native seat's `load/select/dismissRefusal/introduced` face and its snapshot source. It initializes from the session's current preset or the roster default, filters broken roster entries the way the native seat does, and supplies the native seat's developer-tools gate from the host configuration when available (otherwise it leaves the roster unfiltered). The native `agent-preset` label entry is filtered out only while the picker is actually available; otherwise the label remains. There is no task-level default and no plugin preset storage.

Alternatives considered:

- *Retain the drawer session as `mainView` so the native controller works.* Rejected: it changes global current-session/retention semantics and can affect shortcuts and other native surfaces.
- *Plugin-built mode select.* Rejected: loses the native picker.
- *Task-level default.* Rejected: plugin-owned state that native DSH does not model.

### 4. In-place subagent peek with native navigation

A `ConversationNavigation` context carries two operations to the native header host:

- `openSession(sessionId)` — select a task root tab or peek a subagent ancestor;
- `openSubagent(address)` — peek a child from the lineage or catalog.

The native `subagent-catalog` action and the lineage entry are hosted with their inject faces wrapped so `openChild` calls `openSubagent`; `openChildAside` remains native (right sidebar). The native header's `open` callback is our `openSession`, so breadcrumb/title ancestors navigate inside the drawer.

`TaskDrawer` owns the transient peek target (the native `SubagentAddress` shape). It is cleared on drawer close, task switch, root-tab selection, new/close conversation, and before a stage-instruction prefill. `Conversations` renders the active root or the peeked child through the same native conversation surface. The child is retained by its address (`sessions.retain(address)`), so the native composer election works; it is released when the peek exits.

Ownership checks walk from the target to a task root through native subagent edges. A target outside the task's owned lineage is not peeked; the original native action/behavior is used.

Alternatives considered:

- *Transient child tabs.* Rejected: mixes task and lineage hierarchies and adds tab lifecycle rules.
- *Native right sidebar for the primary click.* Rejected: the requirement is to keep the conversation in the drawer.
- *Keep native global navigation.* Rejected: it replaces the board panel.

### 5. Inline task-context row as a visible Chat node

The host continues to inject the durable `user/message` with source `kanban-task` from `src/host/task-context.ts`. No model request shape changes.

A client module registers an **exclusive** conversation Definition for that event on the `chat` target:

- match only append-surface `user/message` events whose source kind is `kanban-task`;
- build a custom visible node (`kanban-task-context`) with `content`, `source`, `producer`, `form`, `seq`, and `time`;
- use `groupTree: 'turn'` so the row stays outside the Turn process disclosure and is not treated as the opening human input;
- `anchorSeq` is the injected event's sequence, so the row sits at its real transcript position.

A keyed `conversation.chat.node` renderer for `kanban-task-context` delegates to the native `conversation.chat.node` key `context` component when present, binding the `chat` locale. If that native entry is unavailable, a minimal inline disclosure preserves the text. The node is visible wherever the task conversation renders, not only in the drawer. The temporary overlay, its absolute positioning, padding/transform workaround, and the retained-window text extractor are removed.

Alternatives considered:

- *Change the source to `user` so Chat renders a user bubble.* Rejected: loses the context/human distinction and affects turn navigation/user semantics.
- *Register a visible native `context` node.* Rejected: Chat's `isVisibleChatNode` hides ordinary context by kind.
- *Drawer-only registration.* Rejected: panel-dependent transcript presentation and registration lifecycle.

### 6. Module seams and dependency direction

Proposed client modules (flat, matching the existing client layout):

| Module | Responsibility |
|---|---|
| `native-slot-host.tsx` / `native-slot-descriptors.ts` | Generic manual slot host plus its pure entry ordering/filtering/hook-name descriptor builder |
| `native-session-header.tsx` | Native session header host and fallback native-action row |
| `mode-seat.tsx` / `mode-seat-controller.ts` / `mode-port.ts` | Native seat host, pure controller, and native roster/selection adapter |
| `conversation-navigation.tsx` | Pure target resolver/peek reducer plus the React navigation context and owned-lineage check |
| `conversation-surface.tsx` | Retention/provider/content-factory/draft binding; accepts `SessionTarget` |
| `task-context-node.tsx` | Exclusive Definition, visible node builder, keyed renderer, native context-row delegation |
| `drawer-conversations.tsx` | Task tabs, closed tabs, creation/rename, peek surface, navigation provider |
| `drawer.tsx` | Task header/toolbar/sections and peek/prefill coordination |
| `client.tsx` | Composition root: services, slot registrations, bridge, board page |

The drawer and header host depend on small values/interfaces (`ModePort`, navigation context, `SessionTarget`) rather than reaching into native services. The native host modules take narrow source ports (`NativeSlotSource`, `NativeChatNodeSource`) and the `client.tsx` composition root adapts `ctx.slots`, `ctx.locale`, and the native components into them. Those ports keep the cheap tests free of a real DSH context; the native host modules remain the only place that knows the private entry names.

`RetainedConversation` gains a `SessionTarget` (session id or address) rather than assuming a root id. The task-tab path passes ids; the peek path passes the address. Composer claims, draft bindings, and retention releases stay in the existing surface lifecycle.

### 7. Fallback and error containment

- Header entry missing or crashing → compact native-action row (existing pinned actions), no plugin replica.
- Mode seat entry missing or roster unavailable → keep the native read-only label.
- Mode selection failure → native seat error/Toast.
- Native context-row entry missing → minimal inline context disclosure.
- Store-backed header entries → omitted; no isolated store.
- Every hosted entry has its own error boundary; one failure does not take down the drawer.

## Verification Strategy

The private host has four verification seams: pure policy, React host, bridge composition, and real native composition. The fast suite must never boot DSH; the real lane proves the native entry contracts and the native Chat pipeline.

### Fast pure tests

- `native-slot-descriptors`: list/single ordering, shadowing winners, store-backed skip, owner/fallback shape, hook-prop names, locale namespace.
- `conversation-navigation`: root/direct/nested/fork/missing/cycle ownership; `openSession` for root, descendant, and ancestor; peek clear on root-tab, section, close, and task switch.
- `mode-seat-controller` + `mode-port`: roster load, current/default preset, exact-session select, refusal, unavailable remote, busy, broken-preset filter, developer-tools filter, no task default.
- `task-context-node` Definition: exclusive append-surface match, no normal-user/replacement match, visible node shape, `groupTree: 'turn'`, anchor, content/source/producer/form.
- `conversation-surface-target`: root id vs child address, release semantics.
- `styles` contract: native-header/fallback selectors, zero frame leading clearance, no overlay/absolute task-context rule, no leftover conversation-content layout hack.
- Existing `task-context` host tests: add the explicit source/role assertion while retaining once-only, prepend, aborted-step, and no-backfill coverage.

### jsdom module and bridge tests

- `NativeSlotHost`: entry order, inject-face assembly, synthesized selector hooks, locale, owner/fallback, late registration, locale revision, per-entry boundary, store-backed skip.
- `NativeSessionHeader`: exact prop kit, `hideChrome`, drawer `open`, inert view store/roster, child-slot calls, header fallback, store-backed corner/utility skip.
- Mode seat host: synthetic `mainView` only gates rendering; blank root vs started vs child; load/select/refusal; no real `mainView` retention.
- Task-context renderer: native `context` entry used, fallback disclosure, `chat` locale, node data, expand/collapse.
- `TaskDrawer`/`Conversations`: peek child rendering, root-only tabs, root-tab exit, section/close/task-switch reset, prefill clears peek, no task command/session mutation.
- Bridge composition: `kanban.session.header` ordered before content, `uiConversation.events.register` registration/disposal, `conversation.chat.node` key, navigation overrides (owned/foreign/aside), child retained by address and released, mode remote calls, no `layout.selectPanel`.
- Real Cordis test: `inject` includes `uiConversation`; the plugin loads with the fake service and expected slots.
- Existing tests that encode the removed status row, overlay, or extractor are updated or replaced.

### Optional plugin-owned browser harness

Use only for plugin-wrapper geometry that jsdom cannot compute: header wrapper at minimum/default drawer width, fallback row, mode menu portal, peek panel, inline row inside a fake chat flow. It cannot prove native DSH CSS or behavior and is not the native acceptance gate.

### Pinned DSH real-composition e2e

Run against the unchanged `dsh-v0.2.1-rc.2` checkout with deterministic replay/seed data; no real model, no owner profile.

- **A — native header and per-conversation mode:** create a task, open the drawer, assert the native session header and the absence of the compact row/resident header/View tabs/corner; select a mode on a blank conversation, assert the session projection and native label, create a second conversation with a different mode, assert both; verify Info hides the header and the drawer stays open on native portals; check narrow-width overflow.
- **B — in-drawer subagent peek:** create a task, start a deterministic child through the same replay pattern as `kanban-deletion`, open the native catalog, select the child, assert it renders in the drawer while the board stays visible and the tab count stays 1; navigate back with the parent breadcrumb; assert no child tab/session ID and no mode picker on the child.
- **C — seeded inline task context:** seed a session with a `kanban-task` message and a normal user message, attach it to a workspace, open ordinary native Chat, and assert the row is inside the chat flow, not an overlay, appears once, expands, and survives reload. This proves the real Chat Definition/visible-node pipeline while the Kanban panel is inactive.
- **D — optional first-turn acceptance:** with a deterministic first-turn replay fixture, select a mode, send the first message, assert the session log has the context before the user message, the inline row appears in the drawer, the picker becomes the native label, and the next turn does not repeat the context. If the fixture cost is high, the host unit test plus C cover the two halves; D is the strongest acceptance, not the minimum gate.

### Commands and cadence

```sh
pnpm test                 # pure + jsdom, every change
pnpm check                # typecheck + vitest + build
node scripts/e2e-dsh.mjs --checkout <pin> --check
node scripts/e2e-dsh.mjs --checkout <pin> --only native-drawer
```

The pinned lane stays opt-in/nightly or pre-release because it needs the built DSH checkout. It is isolated and deterministic, so it can run without the owner's profile. Screenshots and a short report go under `.verification/` without the authenticated URL token.

### Coverage boundaries

- Fake native entries test adapter behavior; only A/B/C prove the real private entries and native rendering.
- The browser harness is not native-DSH evidence.
- Native utilities vary by profile; tests assert the header/no-row/no-resident/View/corner contract, not arbitrary utility IDs.
- Profile preset availability varies; use the shipped built-ins or an explicit deterministic preset configuration.
- Store-backed entries are asserted absent rather than tested with an isolated store.

## Risks / Trade-offs

- **Private host surface grows** → Keep all entry names, prop assembly, and store rules in two native modules; guard each entry; fall back to native-action/read-only/simple-row behavior; pin and test against the rc.2 entry contracts.
- **Dummy view store in the header** → It is intentionally inert and only satisfies a header read; View tabs are not rendered. If a future host version reads more view state, the header boundary falls back rather than guessing.
- **Synthetic `mainView` hook for the mode seat** → It affects only the component's render gate, not retention or navigation. Selection still goes through the native roster/selection API for the exact session.
- **Store-backed entries are skipped** → The corner expand control is absent in the drawer. This is documented; a broken control backed by an isolated store is worse than an absent one.
- **Native header CSS assumes the resident header frame** → Host the session-header fragment in a small plugin wrapper with the native grid/padding and zero frame leading clearance; keep native inner classes.
- **Peek ownership/security** → Verify the target's subagent lineage to a task root; otherwise delegate to the original native action. The peek is transient and releases its reference on exit.
- **Prefill while peeking** → `TaskDrawer` clears the peek before targeting the root composer, preserving the existing draft/prefill rules.
- **Global task-context row changes native Chat** → Deliberate requirement; the row is plugin-owned context, uses native presentation, and does not alter the model request.
- **Visible node affects Turn process folding** → Use `groupTree: 'turn'`, not `input` or process, and keep the node out of turn-navigation prompts (custom kind).
- **No DSH change** → The host remains pinned; a DSH layout change may require a plugin update. The fallback path keeps the drawer usable.

## Migration Plan

1. Add the native slot host and native session-header host; add the `kanban.session.header` slot and render it inside the provider. Remove the primary status row but keep the fallback native-action row.
2. Add the mode seat/controller/port and the action-band integration; verify blank/started gating.
3. Add the conversation navigation context and in-place peek; wire lineage/catalog overrides and `TaskDrawer` peek lifetime.
4. Add the task-context Definition/renderer; remove the overlay, extractor, and overlay CSS; verify native Chat and drawer presentation.
5. Split the draw/client modules, update the README, and implement the verification strategy: fast pure/jsdom/bridge tests, the pinned native-header/mode/peek/context e2e, and the optional first-turn acceptance.
6. Run `pnpm check` and the pinned `--only native-drawer` lane; record the evidence under `.verification/`.
7. Roll back by restoring the previous client modules/status row/overlay; no host, remote, board, or DSH change is involved, so there is no data migration.

**Rollback**: revert the plugin change. The native host and all data remain untouched.
