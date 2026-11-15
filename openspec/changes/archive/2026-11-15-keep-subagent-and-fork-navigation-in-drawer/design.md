# Design

## Context

See `proposal.md` for motivation. The constraints that shape this design:

- The drawer renders one `conversation.window` occurrence with `variant: 'embedded'` for the active root conversation, inside a retained Session area (`src/client/conversation-surface.tsx`). The plugin owns the conversation-surface gates: the single live-composer claim, read tracking, and the open-failure report.
- Window navigation is global. Three host call sites end in `uiWorkspace.openSession(...)`: the subagent catalog and lineage entries (`ui-subagent`), the Session header breadcrumb and lineage title (`ui-conversation`), and the turn-tail branch, which forks and then opens the child (`ui-chat`). `openSession` retains the target as `mainView`, writes the persisted selection, releases the previous reference, and then calls `layout.selectPanel(null)`, which unmounts the Kanban panel and therefore the board and the drawer.
- The host exposes no per-occurrence navigation seam: `conversation.window` takes only `variant`. The previous change removed the plugin's hand-built header and its peek precisely because redirecting those call sites required reading private header entries and fabricating header inputs.
- The pinned host does expose the state this design needs: `layout.panelInfo` (a synchronous snapshot store), `layout.selectPanel`, `sessions.list` rows carrying `retainedBy` (`publishRetention` patches the row synchronously at retain time), `sessions.retain(SessionTarget)` with a source declared by the plugin, `sessions.subagentAddress`, `sessions.refresh()`, and `sessions.fork`.
- Fork adoption already exists on the host (`src/host/conversation-adoption.ts`, driven by the `agent/created` event) and aligns the child directory before attaching it; it is idempotent and reports failures. The host projects `header.parentSession` into each listed Session (`SessionListEntry.parentSessionId`), while the client's local fork placeholder does not carry it.
- The board's page state (`src/client/page-state.ts`) lives at client level, so a panel unmount does not lose the selected task, the active conversation, or the section.

## Goals / Non-Goals

**Goals:**

- Keep the Kanban panel and the drawer mounted for a native navigation whose target belongs to the open task, and apply the target inside the drawer.
- Show an owned subagent descendant as a transient peek with the native window and a native breadcrumb return.
- Turn a branch of an open task conversation into an attached, active conversation tab, with the failure path visible in the drawer.
- Keep the plugin free of header assembly and of any new host requirement.
- Leave the classification, the state transitions, and the pending-fork lifecycle unit-testable without a browser.

**Non-Goals:**

- Changing the host window, header, catalog, fork implementation, or navigation.
- Adding descendants to the task's conversation list, ownership, or lifecycle.
- Persisting the peek, or restoring the host's previous main selection.
- Replacing the drawer's native window composition with anything plugin-owned.

## Decisions

### 1. Bounce at the panel boundary instead of intercepting the intents

The client observes `layout.panelInfo`. When it leaves `kanban` for `null` while a task drawer is open, the client resolves the navigated Session against the open task's lineage and, for an owned target, re-selects `kanban` and applies the drawer outcome.

Why: the three intents live in three host plugins and have no public interception point, while the panel boundary is public, single, and synchronous. The alternative — shadowing the native catalog/lineage slot entries and re-hosting the header — is exactly what the previous change removed: it recovers the lost behavior only by reading private header entries, fabricating header inputs, and re-declaring the native entries' child slots, and it cannot intercept the breadcrumb `open` without owning the whole header.

Alternatives considered: a host navigation seam on the window occurrence (the clean long-term fix; rejected for this change to avoid a new DSH release and a pin bump); observing only the session list (cannot tell a deliberate navigation from an owned one synchronously); a global service override (too invasive, affects every plugin).

### 2. The navigated Session is read from `sessions.list`, not inferred

`replaceMain` retains the target as `mainView` before it calls `selectPanel(null)`, and `publishRetention` writes `retainedBy` into the list row synchronously. The panel notification therefore already observes the selected target: the client reads the row whose `retainedBy.mainView` is positive. This is the same read the host's own workspace tree performs to find the current Session, so it is a supported read rather than a heuristic.

Alternatives considered: the persisted `dsh.sessions.current` key (a private storage key; silently breaks if it is renamed); scanning `sessions.retainInfo` for every candidate (allocates a source per id and cannot cover an unknown id); classifying by blankness, cwd, or update time (cannot separate a fork from a new Session).

### 3. Restore in the same update; never touch the host selection

The re-selection happens inside the `panelInfo` notification, which runs in the same call stack as `selectPanel(null)`. The layout store flushes synchronously and React renders once, so the panel is never committed as inactive and the board is never unmounted. The client does not call `openSession` again: the host's `mainView` stays on the Session the user picked, which is also what the drawer shows. Not restoring the selection removes an `openSession` re-entrancy (which would re-enter the notification), keeps the sidebar's current row consistent with what is displayed, and leaves the reload behavior identical to the host's native behavior.

Trade-off: the host keeps a `mainView` reference to the peeked child while the panel is active. The drawer also retains the child; the main pane is not mounted while a panel is active, so there is only one live occurrence and the composer claim is unaffected.

Alternatives considered: restoring the previous Session (captured when the board was activated) — more faithful to the prior state but adds a second navigation and a re-entrancy guard for no visible benefit; clearing the selection (no public API).

### 4. A branch is proven by the host, not guessed from the placeholder

A fork child is a new Session whose client row is a local placeholder. It cannot be told apart from a brand-new Session by blankness, cwd, or time, and — on the pinned host — not by lineage either: the host creates the fork with `isSeeded` and the copied seed, but records no `parentSession` on the child's header, so neither the client catalog nor the announcement-based adopter can see the parent. What the child does carry is the source prefix: `buildForkSeed` copies the source log through the cut and reports the inherited length, so the branch source is provable from data the host already owns. The proof reads the branch first and refuses it when it inherits nothing — so an ordinary chat costs one read — then reads the claimed conversation and compares the start of the prefix plus the last inherited event, which marks the cut.

The claim therefore carries a candidate parent — the conversation the drawer was showing — and the host accepts it only when the child records that parent (hosts that do record lineage) or inherits the start of that conversation's log, and then aligns and attaches it in the same request. The client still refreshes the session list once: on a host that projects the lineage the catalog path decides and the drawer shows a pending claim; on the pinned host the proof decides, and a Session the host refuses (a new chat, a branch of another conversation) attaches nothing and keeps the native navigation.

Alternatives considered: a one-line host change recording `parentSession` on the fork (rejected to keep this change free of a DSH release, and the plugin's proof keeps the host authoritative); trusting the client's claim without proof (a new chat would be attached as a conversation); classifying by blankness, cwd, or time (a new Session is indistinguishable); reading the fork from the host's adoption announcement (a stream frame and the RPC response are not ordered, so it can miss the moment of navigation).

The pending work is bounded: one refresh per observed navigation, a generation guard so a later navigation supersedes it, and a timeout after which the client does not re-select the panel.

### 5. The drawer claims a fork through an explicit attach command

The claim asks the host to attach the fork to the task through the same adopter the announcement path uses, and the command reports the resulting conversation or the failure. It also carries the branch proof of decision 4, so the host — never the client — decides that the Session is a branch of that conversation. This makes the drawer's claim authoritative: the tab is selected from the command's result, a failure on the catalog path is reported where the user is looking, and the announcement path stays as the safety net for hosts that record lineage. Both paths converge on the same idempotent adoption, so no adoption logic is duplicated.

Alternatives considered: relying only on the announcement (no deterministic selection and no local error, which is the behavior this change exists to fix); adopting from the client (the client has no transactional access to the Hub).

### 6. The peek is a transient view, not a conversation

The peek lives in the drawer's page state as a Session target and is rendered by the same conversation surface and window occurrence. It is not written to the task: `sessionIds`, the closed-conversation list, the lineage, and ownership are untouched, so deletion, shared-worktree protection, and archiving keep their current rules. The peek is released when it ends; a reload or a reopened drawer starts on a conversation.

Because a child must be retained by its address for the native subagent binding to reach the window, the lease registry accepts a Session id or a subagent address keyed by the child id, replacing the string-only `acquireRoot` and its `SessionTarget` cast.

Alternatives considered: a real tab (it would have to be persisted and to enter lineage ownership, contradicting the ownership requirement); an overlay or side panel (more chrome, competes with the window's own header).

### 7. One discriminated drawer view

`TaskPageState` keeps a single `drawerView` union — the selected conversation with its explicit-selection flag, or a peek with the conversation it replaced — instead of the current `conversationId` plus `conversationSelectionRequired` plus new fields. A claimed fork is a sibling `claim` field, because it is pending work rather than something the surface presents. The resolver and the state transitions become pure functions over that union, so the classification matrix (root, direct child, nested child, fork, foreign, missing, cycle) is unit-tested without React or a real host. The previous values are not migrated: they are view state, not persisted facts.

### 8. Split the conversations component along its responsibilities

`drawer-conversations.tsx` currently owns the tab strip, creation, the preset choice, rename, notices, and the surface. The peek and the pending fork would grow it past a comfortable size, so the change extracts the tab strip, the creation/preset flow, and the conversation surface, leaving the component as composition. The extraction is behavior-preserving and is exercised by the existing tests before the new behavior is added.

### 9. The coordinator is a client-level object with injected ports

The bounce cannot live inside the drawer component: a fork's classification is asynchronous and its panel exit may unmount React state, and the observation must happen before the panel renders. A small coordinator is created at the client composition root with narrow ports — panel selection, session catalog, the task snapshot, the drawer page state, the attach command, and a reporter — and publishes its outcome through a snapshot the drawer subscribes to. The drawer never reads host services directly for navigation, and the coordinator is tested with fake ports.

Alternatives considered: a React effect in `BoardPage` (does not survive the panel unmount and cannot act inside the notification); a listener owned by the drawer (misses the window between the retain and the render).

### 10. Fail closed

The resolver walks only explicit `origin: 'subagent'` edges, stops on a cycle or a missing row, and treats a closed task conversation as unowned for navigation purposes. Any unresolved case keeps the host's native navigation. A future host change that removes `retainedBy.mainView` (or makes the layout flush asynchronous) therefore degrades to the current behavior instead of claiming a wrong Session.

### 11. Reuse the removed peek's proven pieces

The previous peek left two reusable pieces in history: the pure navigation/ownership reducer (`createConversationNavigation`, `isOwnedSubagent`) and the address-aware lease acquisition with its release-on-exit tests. This change ports those pieces into the new modules instead of inventing a new classification or lease mechanism; it does not resurrect the manual header, the mode seat, or the fabricated header props.

## Risks / Trade-offs

- **Claiming sidebar navigation while the board is open** → Clicking a conversation of the open task, or one of its descendants, in the workspace tree opens it in the drawer instead of the main panel. This is coherent with the drawer owning those Sessions; the escape is to leave the Kanban panel first. Documented in the README conversation section.
- **A branch shows a brief transition** → The client proves the branch with one host request before it re-selects the panel, so the pane presents the fork for that round trip. Accepted; the alternative is a host change. A failed proof, a refresh failure, or a timeout leaves the native navigation in place.
- **The pinned host records no fork lineage** → The announcement-based adopter can only adopt forks on hosts that record it, and a fork created from the window's session menu on the pinned host therefore stays foreign. The drawer's own branch navigation is covered by the proof path; the spec now states the adoption as conditional on the host recording lineage.
- **The host keeps a `mainView` reference to a peeked child** → The main pane is not mounted while the panel is active, so there is one live occurrence and no composer conflict. If a later host release ever mounts both, the existing single-composer claim reports it instead of silently duplicating the composer.
- **Dependence on two host behaviors** (`retainedBy.mainView` and the synchronous layout flush) → Both are public and already relied on by the host's own workspace UI. Unit tests pin the coordinator's assumptions, the compatibility note records them, and classification fails closed.
- **A forced list refresh on an unclassified exit** → Only when a drawer is open and the target has no row; the host call is single-flight and the result is reused. No polling.
- **Attention for the peek** → The peeked child is not acknowledged as a task conversation and contributes no task attention; its running state is already visible in the host's catalog row. Read tracking for the active conversation is unchanged.
- **Specification drift** → The two previously specified behaviors (follow native navigation; never select an adopted fork) are reversed deliberately; the delta spec, README, and compatibility note change in the same work.

## Migration Plan

1. Land the behavior-preserving extraction of the conversations component and the typed lease acquisition; the existing client tests must stay green.
2. Add the pure resolver and its tests, then the coordinator with fake ports and its tests.
3. Wire the coordinator at the client composition root and add the peek to the drawer surface; browser tests cover the peek and the breadcrumb return.
4. Add the attach command on the host and the pending-fork state; cover success, idempotency, failure, and the open-in-main action.
5. Extend the isolated real-composition lane (`--only native-drawer`) with the subagent and branch flows; the replay lane needs a committed fixture or a hand-authored override for the branch.
6. Update `README.md` (conversation section and the removed A7 note), the compatibility note, and the archived spec via the normal archive step.

Rollback is a revert: no persisted state, storage format, or dependency changes. The DSH pin is unchanged, so an older plugin build remains installable on the same host.

## Open Questions

- Whether the drawer should present a placeholder row while a claimed fork is being attached. The requirements allow either; the first implementation keeps the current conversation visible and selects the tab when the host reports the outcome, and a placeholder can be added later without a spec change.
