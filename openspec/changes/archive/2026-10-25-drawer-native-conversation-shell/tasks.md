# Tasks

> Fast/bridge/component gates pass. The real-composition lane in section 7 is implemented but blocked by the local pinned checkout's incomplete install/build, not by a plugin failure; see the section-7 note and `8.3`. Checked items below mean implementation plus fast/component verification; the unchecked section-7/acceptance items remain the gate.

## 1. Native slot foundation

- [x] 1.1 Add `native-slot-host.tsx` plus the pure `native-slot-descriptors.ts` builder, with entry reading, list ordering, inject-face assembly, synthesized selector hooks, locale binding, owner/fallback support, per-entry boundaries, store-entry skipping, and slot/locale subscriptions; verify with fake entries and `pnpm typecheck`.
- [x] 1.2 Add `native-session-header.tsx` that hosts the native `conversation.session.header` component with the session standard kit, drawer `open`, inert view state, and a manual child-slot host; verify a session header renders and an unavailable header falls back to the native-action row.
- [x] 1.3 Add the session-scoped `kanban.session.header` slot to `main:kanban`, render it in `RetainedConversation` above the native content, and remove the primary compact status row while keeping the native-action fallback; verify tab and section switching show the correct header.
- [x] 1.4 Verify store-backed native header entries (the pinned corner entry) are omitted rather than rendered against an isolated store, and that a missing/erroring entry does not take down the drawer.

## 2. Native mode selection

- [x] 2.1 Add `mode-port.ts` with a native adapter over `remote.agentPresets.list/select` and a null/unavailable adapter; verify roster read, exact-session selection, refusal, and absence handling.
- [x] 2.2 Add `mode-seat.tsx` plus the pure `mode-seat-controller.ts` state (`options`, `current`, `error`, `busy`, `introduce`); render it in the header action band for a blank top-level task conversation and filter the native `agent-preset` label only while the seat is available; verify blank, started, and peeked-child states.
- [x] 2.3 Verify mode selection is per conversation only: no task-level default, no plugin preset storage, and the native read-only label returns after the first turn.

## 3. In-drawer subagent peek

- [x] 3.1 Add `conversation-navigation.tsx` with the drawer navigation context, `openSession`, `openSubagent`, address resolution, and owned-lineage verification; verify root, descendant, and foreign targets.
- [x] 3.2 Extend the conversation surface to accept a `SessionTarget`, retain a peeked child by its subagent address, and release it when the peek exits; verify both root-id and child-address retention without changing task session state.
- [x] 3.3 Wrap the hosted `subagent-catalog` action and lineage inject faces so `openChild` peeks in the drawer, `openChildAside` stays native, and the native header breadcrumb `open` navigates the drawer; verify no main-panel navigation from the drawer.
- [x] 3.4 Render the peek in `Conversations` while keeping the task tab strip as the root surface; verify native breadcrumb ancestor navigation, tab selection exits the peek, and the child is absent from tabs/session IDs/closed entries.
- [x] 3.5 Coordinate the transient peek in `TaskDrawer`: clear it on drawer close, task switch, root-tab selection, new/close conversation, section exit, and before a stage-instruction prefill; verify the prefill still targets the active root composer.
- [ ] 3.6 Verify the peek uses the native composer election: one-shot child read-only, continuable child native follow-up/parent-offline behavior. (The surface retains the native conversation reference and delegates to the native content factory; the real-child e2e case is blocked with section 7.)

## 4. Inline task context

- [ ] 4.1 Add `task-context-node.tsx` with an exclusive `chat` Definition for append-surface `user/message` source `kanban-task`, a visible `kanban-task-context` node, and `groupTree: 'turn'`; verify the row appears at the injected event position in the drawer and native Chat. (Definition and renderer are unit-tested; real Chat row acceptance remains blocked in 7.3.)
- [x] 4.2 Register a keyed `conversation.chat.node` renderer that delegates to the native `context` entry component with the `chat` locale, with an inline disclosure fallback when that entry is unavailable; verify presentation and expand/collapse.
- [x] 4.3 Remove the task-context overlay, retained-window extractor, absolute-position/padding CSS, and the obsolete extractor test; verify the row scrolls with the transcript and does not remain pinned.
- [x] 4.4 Verify the injection remains once-only per conversation, still precedes the first user message, does not repeat for later instructions, and is not backfilled for existing histories.

## 5. Refactor and cleanup

- [x] 5.1 Extract the native conversation surface (retention/provider/content factory/draft/composer claim) from `client.tsx`; keep `client.tsx` as the composition root; verify typecheck and the existing conversation flows.
- [x] 5.2 Extract `drawer-conversations.tsx` (tabs, closed tabs, creation/rename, peek surface, navigation provider) from `drawer.tsx`; leave `TaskDrawer` with task header/toolbar/sections and peek/prefill coordination; verify section and tab behavior.
- [x] 5.3 Reuse or generalize the existing native-action logic for the fallback; remove the superseded status-row slot/CSS and dead overlay styles; verify no unused exports remain.
- [ ] 5.4 Add the native-header wrapper/fallback styling within `.dsh-kanban`, including zero frame leading clearance and narrow-width behavior; verify the drawer layout at minimum and default widths. (CSS contract and browser suite pass; the 360px native-header assertion is in the blocked 7.1 lane.)

## 6. Fast automated verification

- [x] 6.1 Add pure in-memory tests for the native slot descriptor builder, conversation navigation/peek lifetime, mode seat controller and native port, task-context Definition, conversation-surface target, and the CSS cleanup contract; verify `pnpm test` and `pnpm typecheck`.
- [x] 6.2 Add jsdom tests for `NativeSlotHost` and `NativeSessionHeader`: entry order, inject/hook/locale/owner assembly, fallback, store-backed skip, late registration, locale revision, and per-entry error boundaries; verify with fake native entries.
- [x] 6.3 Add jsdom tests for the mode seat host and controller: synthetic `mainView` gate, blank/started/child gating, load/select/refusal, developer-tools filtering, label fallback, and no real `mainView` retention; verify.
- [x] 6.4 Add jsdom tests for the task-context renderer and drawer conversations: native context entry vs fallback, `chat` locale, native node data, peek child rendering, root-only tabs, root-tab exit, section/close/task-switch reset, prefill clearing the peek, and no task command/session mutation; verify.
- [ ] 6.5 Extend the bridge/plugin and real-Cordis tests for the new header slot, `uiConversation` registration/disposal, `remote.agentPresets`, navigation overrides (owned/foreign/aside), child retention by address and release, mode calls, and the context renderer key; verify `pnpm test` and the no-`layout.selectPanel` assertions. (Bridge covers header/slots/Definition; mode and child retention are covered by separate client tests; real-Cordis native action integration is not separately exercised.)
- [x] 6.6 Replace the existing assertions that encode the removed compact status row, absolutely positioned overlay, and extractor; update [board.test.tsx](../../../tests/client/board.test.tsx), [refinement.test.tsx](../../../tests/client/refinement.test.tsx), [drawer-prefill.test.tsx](../../../tests/client/drawer-prefill.test.tsx), [native-session-actions.test.tsx](../../../tests/client/native-session-actions.test.tsx), and the bridge Task-context assertion; verify no stale selectors or expectations remain.

## 7. Pinned DSH real-composition e2e

> Scenario, fixture, runner, and README wiring are implemented. The local pinned checkout cannot boot `launchWebScaffold`: its built `@deepseek-ai/dsh-app-boot` is missing `bundlePatchPaths`, and `p-limit` was not linked. This is an incomplete DSH install/build, not a plugin failure. Re-run this section after a full install/build of the pinned checkout.

- [ ] 7.1 Add a seeded `task-context.jsonl` fixture and a `kanban-native-drawer.e2e.template.ts` scenario for the native session header and per-conversation mode selection; verify no model call is needed and the native mode projection/label is correct.
- [ ] 7.2 Add the in-drawer subagent peek scenario to the template using the deterministic child replay pattern from [kanban-deletion.e2e.template.ts](../../../tests/e2e-dsh/kanban-deletion.e2e.template.ts); verify the child opens in the drawer, the board stays visible, the tab count stays 1, the parent breadcrumb returns, and no mode picker appears on the child.
- [ ] 7.3 Add the seeded inline task-context scenario: seed a session with a `kanban-task` message, open native Chat, and verify the row is inside the chat flow, not an overlay, appears once, expands, and survives reload.
- [ ] 7.4 Add the optional first-turn acceptance scenario with a deterministic replay fixture: select a mode, send the first message, verify the persisted context precedes the user message, the inline row appears in the drawer, the picker becomes the native label, and the next turn does not repeat the context. If the fixture is not practical, record the host-unit + seeded-row fallback in the change evidence.
- [ ] 7.5 Extend [scripts/e2e-dsh.mjs](../../../scripts/e2e-dsh.mjs) with `--only native-drawer`, update [tests/e2e-dsh/README.md](../../../tests/e2e-dsh/README.md), and verify `--check` plus the native-drawer lane produce screenshots/report evidence under `.verification/` without tokens or owner data. (`--check` passes; the lane is blocked by the incomplete DSH install/build above.)

## 8. Documentation and final gates

- [x] 8.1 Update the README drawer/mode/task-context paragraphs and any verification notes that describe the compact status row, read-only mode, or fixed task-context overlay; verify no stale statements remain.
- [x] 8.2 Run `pnpm test`, `pnpm typecheck`, and `pnpm build`; verify all exit successfully.
- [ ] 8.3 Run the pinned e2e command `node scripts/e2e-dsh.mjs --checkout <pinned-dsh> --only native-drawer`; verify the native header/mode, subagent peek, and inline context scenarios pass without a DSH source change or owner-profile access. (`--check` passes; lane blocked by the incomplete DSH install/build noted in section 7.)
- [ ] 8.4 Run `pnpm test:browser` if a plugin-owned browser harness scenario was added for wrapper geometry; otherwise record why the native e2e covers that layout risk. (`pnpm test:browser` passes 14 tests, but no wrapper geometry scenario exists; the blocked 7.1 lane covers that risk.)
