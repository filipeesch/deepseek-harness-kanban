# Design

## Context

See [proposal.md](proposal.md) for the motivation. The current drawer composes the native conversation surface in two plugin-owned steps:

- `kanban.session.header` renders `NativeSessionHeader`, which selects the host's `conversation.session.header` entry, fabricates a fixed rc.2 prop bag (`hideChrome`, `open`, `selectView`, `useConversationViews`, `useStore`, `renderSlot`, `t`), hosts the header children manually, and mounts a synthetic `conversation.hero.agentPreset` seat through `ModeSeatController`/`ModePort`.
- `kanban.conversation` renders `EmbeddedConversationBody`, which tracks read state, reports an open failure, and renders `conversation.content` with `variant: 'embedded'`, a forced `phase`/`hero: false`, and a fixed Chat View.

The host now declares `conversation.window` (`session-maybe`) as a public Factory that renders `conversation.header` and `conversation.content` for the Session bound at its render position. The Factory has no store, no inject face, no locale, and no component export. Its occurrence input is only `{ variant: 'main' | 'embedded' }`. Header extension points are global to the definition, and the Conversation store stays pinned to `session` scope on the body and header, so View roster, pins, selection, and draft remain per-Session facts. An absent Factory definition renders the caller's `fallback`.

Constraints that shape this design:

- Declaring is claiming: the plugin cannot render `conversation.header` or register into `conversation.session.header` without colliding with `ui-conversation`.
- The Factory cannot be given a store or identity; the Session binding must come from the render position.
- The plugin's remaining slot entry receives `renderFactorySlot` and `useSession` from the host renderer, which is the only public seam the drawer needs.
- The host window derives `settling | hero | active` itself; a caller cannot override the phase.
- The release containing `conversation.window` is not published yet; the latest tag (`0.2.2-rc.1`) predates it.
- The `task-conversations` spec changes are defined in [specs/task-conversations/spec.md](specs/task-conversations/spec.md).

## Goals / Non-Goals

**Goals:**

- One public window occurrence per active task conversation, with no hand-assembled header and no version-coupled prop bag.
- A thin plugin adapter for the concerns the host window does not own: read tracking, the single-composer claim, and open-failure reporting.
- A clean removal of the peek, header, and host-seat stack, with a small plugin-owned preset card picker for the choice the host no longer offers outside its main panel.
- Explicit, user-visible behavior on a host that lacks the Factory.
- Publication only against a DSH release that declares the window.

**Non-Goals:**

- Changing `conversation.window`, `conversation.header`, `conversation.content`, the View roster, or the host's navigation.
- Preserving in-drawer subagent navigation or the transient peek.
- Keeping the drawer's forced Chat View or its docked-only blank conversation.
- Refactoring unrelated client modules, the host bridge, questions, notes, Git, or leases beyond the peek removal.
- Supporting two host releases at once.

## Decisions

### 1. Keep one session-scoped adapter slot; remove the header slot

`kanban.conversation` remains a single `session` child of `main`. It receives the Session binding from the `SessionProvider` and `renderFactorySlot` from the renderer, and it renders the embedded window. `kanban.session.header` is removed entirely.

*Alternatives.* Render the window directly from `BoardView`: `main` is root-scoped and the plugin would have to thread the renderer capability and Session area through several layers, losing the host's scope binding. Keep `kanban.session.header` for the close action: it would still be a plugin-owned header seat and would keep the version coupling the change removes.

### 2. Split lifecycle, gates, and host composition

Three responsibilities, each in one place:

- `RetainedConversation` keeps the lease and the `SessionProvider`; it renders the adapter slot and nothing else.
- `TaskConversationWindow` (the `kanban.conversation` entry) keeps read tracking, the open-failure gate, and the occurrence with the missing-Factory fallback.
- The host window owns header chrome, phase, View selection, transcript, composer, and statistics.

*Alternatives.* Put read tracking and error handling inside `RetainedConversation`: it would need `useSession` and the host renderer, mixing lease lifecycle with conversation rendering. Keep `EmbeddedConversationBody` and add the window on top: two entry points for the same surface and a dead `conversation.content` path.

### 3. Let the host derive the phase and the View

The adapter passes only `{ variant: 'embedded' }`. It does not pass `phase`, `hero`, `sessionId`, a local `views` Component, or a View name.

*Alternatives.* Recreate the old `hero: false`/fixed-Chat behavior: the window does not accept a phase or a local View selection, and passing a local Component across occurrences is rejected by the occurrence-bound rule. Keep the body-only `conversation.content` call and place the header above it: that is the manual composition being removed and would collide with the window's header declaration.

### 4. Keep the plugin gates around the occurrence

The adapter keeps `viewSession` tracking on mount and visibility change, and `RetainedConversation` keeps `claimComposer`. If the Session's `openState` is `error`, the adapter renders the existing failure report instead of the window while the close action stays available in the active tab; a failed acquisition keeps the lease error with Retry and close. The window has no error face of its own, and a hidden conversation must not acknowledge a settled turn.

*Alternatives.* Let the host window handle open errors: it treats the error phase as active and would render an empty transcript, losing the current recovery message. Drop the composer claim: two occurrences for the same Session would contend for the single editor model.

### 5. Compile on the pinned SDK through a small local type bridge, and fail visibly without the Factory

The private-dsh release that declares `conversation.window` is not published yet, so the pinned SDK has no Factory declaration. The adapter types the single window call locally (a narrow renderer shape) while runtime dispatch stays exactly the host's `renderFactorySlot`; the bridge is removed when the release pin lands. The adapter also passes a fallback with an explicit "update DSH" notice. No manual header and no second runtime path are kept for older hosts, and the plugin remains installable on the pinned generation.

*Alternatives.* Keep the manual header as a fallback: two version-coupled paths and the debt the change exists to remove. Wait for the release before merging: correct but blocks the change indefinitely. Augment the host's `SlotFactoryMap` globally: it would collide when the real declaration arrives; the local renderer shape avoids that.

### 6. Remove the peek instead of intercepting host navigation

Header lineage and subagent-catalog entries belong to the host registration; their callbacks select a Session through native navigation. The plugin cannot redirect them without rebuilding the header. The peek, `ConversationNavigationProvider`, `createConversationNavigation`, `isOwnedSubagent`, the `lineage` port, `acquirePeek`, the `peek` state, the `target` conversation surface, and the peek e2e scenario are removed.

*Alternatives.* Add a navigation hook to the host window first: a separate host change that blocks this adoption and expands its scope. Observe the globally selected Session and bounce it back into the drawer: a visible navigation flicker, a loop risk, and behavior no spec would call stable.

### 7. Put the close action inside the active conversation tab

The task tab strip renders, for each open conversation, a wrapper with two sibling controls: the tab selection button (keeping `role="tab"`, `id`, `aria-selected`, rename, and context menu) and, on the active tab only, the `ConversationCloseAction`. A button cannot be nested inside the tab button, and the close must not change the selection. The action stays disabled while a conversation command is pending and remains reachable while the body is loading or failed because the tab strip is outside the window.

*Alternatives.* A separate strip button: rejected by the product decision. A global `conversation.session.header.utilities` entry: it would render in every occurrence, including the main panel, and would couple the drawer action to the global header. An overlay in the drawer corner: it competes with the host's corner and leaves the tab flow.

### 8. Keep a plugin-owned preset card picker, not the host seat

The host's `ui-agent-preset` hero seat and read-only label gate on `retainedBy.mainView > 0`. A drawer-only conversation retains with `kanbanTaskDrawer`, so both self-hide inside the public window; the old manual seat passed a synthetic `useSessionRetainInfo` with `mainView: 1`, which is exactly the shim this change removes.

The plugin therefore keeps the preset data layer (`agent-preset-port.ts`, adapted from the removed mode port) and adds `agent-preset-cards.tsx`. When the task has no open conversation, or when the plus action is used, the drawer renders the filtered host roster as cards in the conversation area. Selecting a card creates the conversation, selects that preset on the created session, and opens the window. A selection failure leaves the conversation on the host default, reports the failure, and keeps the cards available for a retry on that same conversation. Canceling the plus choice creates nothing; choosing another tab discards it. The host component seat, the synthetic retention/developer-tools/seat hooks, and `mode-seat.tsx` are removed. The developer-tools/roster filtering moves into the port.

*Alternatives.* Depend on the host seat: its gate is host-owned and hides outside `mainView`. Add a host change to relax the gate: viable and arguably cleaner, but it blocks this adoption and expands the host surface; revisit if DSH later exposes a hosted-window retention signal. Reintroduce the old header picker: contradicts the public-window adoption.

### 9. Shrink the native-slot helpers to their remaining consumers

After the header removal, `native-slot-host.tsx` serves only the execution-preparation model seat and `native-slot-descriptors.ts` serves the generic entry ordering. The header-only traits are removed: `before`, `owner`, `exclude`, `allowStore`, `renderFactorySlot` plumbing, `selectNativeSessionHeaderEntry`, `nativeSnapshotSelectorHook`, and the per-entry override context. `override` becomes a plain face transform. `NativeSlotSource` and `useSlotEntries` stay because the task-context row uses them.

*Alternatives.* Delete both modules and inline their logic into the two consumers: the model seat and the context row would duplicate the entry ordering and face assembly, and the tests would lose a shared seam.

### 10. Keep the test seams at the adapter boundary

Unit tests render `TaskConversationWindow` with fake `useSession` and `renderFactorySlot`, asserting the occurrence input, the fallback notice, the open-error gate, and read tracking. Bridge tests assert the new slot registrations and the absence of `kanban.session.header`. The browser lane keeps the execution-preparation and drawer appearance fixtures. The real-composition lane asserts the embedded header, the right-bar corner, no `[data-window-drag]`, the in-tab close, the task-context row, and the card flow: cards in the empty state, the plus action's choice, and the preset recorded on the created session. Its first conversation is blank, so the host intentionally hides the title, View tabs, actions, utilities, and statistics footer there; those stay host-owned and are not claimed by this lane.

*Alternatives.* Test the host window itself: that belongs to DSH. Keep the old header tests: they cover code that no longer exists.

### 11. Version and dependency sequencing

- `package.json` version becomes `0.2.0`; the release workflow publishes that version after merge.
- `engines.dsh`, DSH peers, and devDependencies stay on the pinned `0.2.1-rc.2` generation for this transitional release; the local renderer bridge lets the pinned typecheck pass.
- The manifest pin to the release that declares `conversation.window` remains open (tasks 1.1/1.3) and is the follow-up once private-dsh publishes it.
- Until then, the e2e runs against the built private-dsh master; the runner's pinned-version warning is expected.

*Alternatives.* Publish first and bump later: the published artifact would fail on the released host. Keep `>=0.2.1-rc.2` and rely on the fallback: it would claim support the product explicitly dropped.

## Risks / Trade-offs

- **[The release is not available yet]** → A narrow local renderer type lets the pinned SDK compile and the `0.2.0` artifact ship with the update-notice fallback. The manifest pin to the Factory release remains a follow-up and must be closed when private-dsh publishes it.
- **[The drawer loses in-drawer subagent navigation]** → Accepted with the peek removal; native DSH navigation selects the child in the main panel and the task tabs stay root-only. The README and the removed requirement's migration state it.
- **[Blank task conversations look different]** → Accepted: the host hero centers the composer and shows the workspace chip; the preset choice moves to the plugin cards before the conversation is created. The README, spec, and e2e are updated.
- **[Preset selection becomes plugin-owned]** → The card picker depends on the optional `remote.agentPresets` roster and selection namespace, which the host can change; the port filters exactly as the native picker does, and the compatibility note records the dependency.
- **[Two occurrences for the same Session]** → The `claimComposer` gate refuses the drawer composer with an explicit message while another Kanban occurrence has it; the same-Session case stays documented as a host limitation.
- **[The window needs a sized flex parent]** → `RetainedConversation` keeps a flex wrapper and the manual conversation padding is removed; the window root is `height: 100%`. The e2e verifies a narrow (360px) drawer and the header's `scrollWidth`.
- **[Read state stops clearing]** → `viewSession` moves with the adapter; a unit test covers track/release on visibility, and the existing attention/read e2e stays green.
- **[Open failures become silent]** → The adapter keeps the explicit failure report and the tab's close action; a unit test covers the error gate.
- **[Header contributions can crash]** → The host's slot containment reports and retires the failing cell; the plugin adds no fallback. This replaces the old silent fallback row.
- **[The `kanban.conversation` slot name no longer describes only the body]** → It remains the conversation surface seam; renaming it would churn the slot surface, tests, and styles without a behavior change.
- **[Removing the peek touches leases, drawer state, and e2e]** → The removal is mechanical but broad; it is sequenced as its own task with the affected tests and README/spec edits.

## Migration Plan

1. Publish the private-dsh release that contains `expose-conversation-window` and record its version.
2. In this branch, pin `engines.dsh`, DSH peers/devDependencies, and the plugin version.
3. Replace the two-step conversation surface with the adapter plus the window occurrence.
4. Remove the header and peek stacks, refactor the preset port into the card picker, then remove or update the styles and tests they own.
5. Move the close action into the active tab and update the tab-strip styles.
6. Update README, the delta spec archive, and the shared Kanban compatibility note (remove the header inventory entries, record the public window, and add the `remote.agentPresets` roster/selection).
7. Verify: `pnpm check`, `pnpm test:browser`, and `node scripts/e2e-dsh.mjs --checkout <release-or-feature-checkout> --only native-drawer`; capture screenshots under `.verification/`.

Rollback is a revert of the adoption commit plus reinstalling the previous plugin version. Because the previous version depends on the old manual header, a rollback on a host that already includes `conversation.window` must also restore the previous DSH release; the release notes must state this.

## Open Questions

- Which exact release tag carries the Factory? It is resolved by the private-dsh release and only fills the version pins; it does not change the approach or the task breakdown.
