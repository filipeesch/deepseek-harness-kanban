# Design

## Context

See `proposal.md` — Why. The constraints that shape this design:

- The drawer renders the host's public `conversation.window` occurrence inside `src/client/conversation-surface.tsx` and wraps it in its own `.kb-conversation-window` box; the plugin owns no part of the chat, the chips, or the link handlers.
- Every host path that opens something in the right Sidebar funnels through two service methods: `ctx.sidebarRight.openResource(address, options)` and `ctx.sidebarRight.openTab(kind, options)`. That is where the chat's file links, tool-row paths and line references, deliverable previews, user-text chips, page shortcuts, and the browser page all end up.
- Both methods act on a resolved target: the most recently reported embedded panel occurrence while it is mounted and expanded, else the Session the layout names as on screen. While the board fills the frame's main column no Session is on screen, and the drawer's panel occurrence only exists while expanded, so a collapsed drawer has no target and the host throws `sidebarRight: no session surface is mounted`. The chat surfaces that failure as the "Couldn't open file" dialog with Close and Retry.
- The host also exposes `openResourceIn(sessionId, address, options)` and `openTabIn(sessionId, kind, options)`. Its own packages call them (`ui-open-in-app`, `ui-sidebar-terminal`); they are class methods that the published `ISidebarRight` interface does not declare. They claim the resource and open content in that Session's store, which reveals the column as part of the same intent.
- A Session's panel store is minted by the slot runtime when any session-scoped seat that shares it mounts. The conversation header's corner control registers with that store, so a drawer conversation that is on screen always has one, even with the panel collapsed.
- The plugin already resolves the optional `sidebarRight` service per conversation seat instead of at apply time (`src/client.tsx`, because the host may provide it after this client generation applies) and already narrows host faces structurally (`src/client/sidebar-panel-port.ts`, `src/client/host-navigation.ts`).
- Product decisions recorded for this change: fix it inside the plugin; one change; minimum refactoring; an open from a transient subagent peek settles in the task conversation's panel.

## Goals / Non-Goals

**Goals:**

- Any open issued from the drawer conversation lands in the drawer's panel and opens it, for every link kind the host routes to the Sidebar, with no failure notice.
- Leave every path the host can resolve itself untouched, including the main chat, an already-expanded drawer panel, and a host without the embedded-panel capability.
- Keep the host coupling in one removable module with a structural interface and a restore path, in the same spirit as the existing optional host ports.
- Make the behavior assertable in the plugin's own isolated lane instead of documenting it as a host-owned residual gap.

**Non-Goals:**

- Changing any DSH source, publishing a new host API, or bumping the DSH floor.
- DOM listeners, markup heuristics, or synthetic clicks: the plugin does not read the chat's rendered structure.
- A pending-open queue, a plugin-owned expansion write, per-occurrence layouts, or a plugin copy of any tab type.
- Refactoring the host's target heuristic, its duplicated `openResource`/`openResourceIn` paths, or the `fileAddressFor` call sites; those were explicitly left out of scope.

## Decisions

### D1. Intercept the host's open calls instead of the DOM

The plugin wraps `openResource` and `openTab` on the resolved service instance and, only when the original call throws, re-issues the open for the drawer's Session through the per-Session methods. Every link kind is covered because the host funnels all of them through those two methods.

Alternatives considered:

- **Capture-phase DOM listener that expands the panel first.** Covers only what has a stable marker (the user-text chip's `data-ref-chip`); assistant Markdown links, inline-code mentions, tool-row paths, and deliverable previews are matched only through CSS-module class names that carry a build hash. It also has to win a race against the host's own click handler (a synchronous `flushSync` render of the drawer plus the panel occurrence), and it silently degrades when the host changes markup. Rejected on coverage, coupling, and timing.
- **Wrap the chat view's injected `openFile`.** The chat view is a host Factory; the plugin cannot reach that injection.
- **Render the panel occurrence expanded at all times and hide it visually.** It would present an expanded panel as hidden, write shared per-Session state the person never asked for, and show that state in the main chat too.

### D2. One removable shim, installed with the existing optional port

A new `src/client/host-open-fallback.tsx` exposes a factory that takes the resolved service value, a drawer-Session provider, and a reporter, and returns an installer. The service is narrowed to a structural interface, never imported from a host package:

```
interface SidebarOpenService {
  openResource(address, options?): void
  openTab(kind, options?): void
  openResourceIn?(sessionId, address, options?): void
  openTabIn?(sessionId, kind, options?): void
}
```

The installer is idempotent per service value (a marker on the instance, or an owner token the module remembers), assigns the wrappers as own properties so the prototype methods remain the originals, and returns a disposer that deletes them. It installs only when the service reports the embedded-panel capability and both per-Session methods exist; otherwise it installs nothing and the drawer keeps today's behavior. It is wired where the conversation seat already resolves the port (`src/client.tsx`), because the service may arrive after the client applies; the effect depends on the resolved service so it re-runs when the service appears, and the disposer runs when the seat unmounts.

Alternatives considered: installing at apply time (rejected: the service may not exist yet); installing inside the workspace component (rejected: it would install on every drawer render and hide the dependency from the seat that already owns it); a Cordis service injection that waits for the provider (rejected: the plugin's other optional hosts use lazy resolution, and a second ordering mechanism would be a new pattern for one call).

### D3. Fall back only after the host fails, and rethrow the original

The wrapper calls the original first. If it returns, nothing changes. If it throws, the wrapper tries the per-Session path for the drawer's Session inside a `try`; if that path is unavailable, throws, or no Session is available, the wrapper rethrows the original error unchanged. The plugin never manufactures a failure, never swallows one, and never replaces the host's own failure handling.

The fallback runs inside the same synchronous call as the host's open, before the chat's async boundary, so the chip's local dialog and the chat's failure state never see a throw for a case the plugin could settle. The error is identified by behavior, not by the host's message text: any throw is a candidate, and an unhelpful candidate ends up rethrown.

Alternatives considered: matching the host's error message string (rejected: copied host vocabulary that can change silently); matching by error type (rejected: the host throws a plain `Error`); falling back before calling the original (rejected: it would claim opens the host can resolve, changing the main chat and the expanded drawer).

### D4. The target Session is the drawer's active conversation

The provider reads `pageState.selectedTaskId` → `taskPageState(pageState, id).view` → `conversationOf(view)`, the same facts the drawer navigation coordinator already reads. That is exactly the conversation whose links can be activated, and while a transient peek is presented the view still names the task conversation, which is the recorded product decision; the peek draws no panel of its own, so an open it issues is not shown while the peek is presented.

Alternatives considered: deriving the Session from the resource address (rejected: the peek's chat composes its address with the peeked Session, which would open a tab in a panel nothing draws; page opens carry no address at all); using the host's on-screen Session (rejected: it is undefined by definition in this case).

### D5. The plugin never writes the expansion state

The host's per-Session open already reveals the column as part of the open ("an open behind a collapsed panel is not an open"). The drawer keeps following the per-Session `expanded` observable for presence, width reservation, and restoration, so no plugin-owned flag or write is added and the two surfaces cannot disagree.

### D6. No pending-open queue, and a documented residual

If the drawer's Session has no panel state yet, the per-Session path does nothing (the host's contract for a Session no occurrence has materialized) and the drawer consumes that failure without a dialog: nothing opens and nothing reports. On supported hosts the conversation header's corner control mints the store, so this is the edge of the edge; a queue would need a drain point inside the host's occurrence mount, which the plugin does not own. This keeps the change to one module plus wiring, per the minimum-scope decision, and the residual is stated in the operations notes.

### D7. Verification stays in the plugin's own lanes

- Client unit tests drive the module with a fake service: the original success is untouched; a throw falls back with the drawer's Session; no drawer Session, a missing per-Session method, or a failing fallback rethrow the original; install is idempotent; the disposer restores the prototype methods.
- The isolated real-composition lane (`tests/e2e-dsh/kanban-sidebar.e2e.template.ts`) gains the assertion the lane currently documents as out of reach: with the panel collapsed, activating a file reference in the drawer conversation reveals the rail with the file tab and no failure dialog. The reference can come from a message typed into the drawer composer (the isolated instance has no credentials, so the turn fails after the pre-step and the user message still renders) or from a hand-authored replay fixture; the implementer picks the cheaper stable source.
- `pnpm check` and `pnpm test:browser` remain the fast gates.

### D8. Documentation and compatibility posture

`README.md`, `docs/operations.md`, and `tests/e2e-dsh/README.md` stop describing the collapsed-panel open as a host-owned residual gap and describe the claim, its coverage, and its two limits (host without the per-Session open; Session without a store). The DSH compatibility floor stays at 0.2.2: the capability check and the structural interface keep the shim optional, and the host's own behavior remains the fallback of the fallback.

## Risks / Trade-offs

- **The host renames or removes `openResourceIn`/`openTabIn`** → the installer requires both; without them nothing is installed and the host's dialog returns. The shim is the only module to delete when the host publishes a session-addressed open.
- **A host freezes the service instance or swaps it for a new object** → assignment fails or the wrapper is lost with the old instance. The installer writes in a `try`, treats a failed write as "not installed", and re-checks the resolved service on each seat mount; the failure mode is today's behavior, never a broken open.
- **A genuine failure the plugin cannot settle** → the original error is rethrown, so diagnostics and the host's dialog stay intact; the wrapper adds no message of its own.
- **A Session with no materialized panel state** → the per-Session open does nothing and the failure is consumed without a dialog (no tab, no error); documented as a residual, and unreachable on a supported host while the conversation header renders.
- **The peek opens in the task conversation's panel** → the file is not recorded against the peeked Session, and that panel is not drawn while the peek is presented, so the open is not visible until the peek ends (and only if that Session's panel state still exists). Intentional: the peek stays panel-free, and the open is addressed at the conversation the drawer actually presents.
- **Wrapping a host object is a compatibility shim, not a contract** → it is one module, structurally typed, feature-detected, restorable, and documented as removable; the plugin's own code never depends on the wrapped identity.
