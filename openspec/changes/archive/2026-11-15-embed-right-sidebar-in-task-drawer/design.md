# Design

## Context

See `proposal.md` — Why. The constraints that shape this design:

- The host already provides the capability in private-dsh `master` (`69b0f199`, spec `sidebar-right-panel`): a public `sidebar.right.panel` Component Factory with `main` and `embedded` variants, `ctx.sidebarRight.capabilities.embeddedPanel`, and `ctx.sidebarRight.forSession(sessionId)` returning a stable face with an observable `expanded` state, `openTabs()`, `setExpanded`, and `toggleExpanded`.
- The host embedded occurrence sizes to its container, reports no frame track or fullscreen, shares the Session's store with the main column, enters the navigation-target layer while mounted and expanded, stops the frame occurrence from drawing that Session's bodies while it is mounted, and returns nothing until the store exists and the column is expanded. It renders docking chrome only: tabs, add, collapse; no split, fullscreen, or floating layer; committed splits render and floats stay in the main occurrence.
- The plugin's supported DSH floor is 0.2.2 and its published SDK does not declare the new Factory or the per-Session face. The installed-but-not-yet-released host does. The plugin therefore needs a structural, optional port and a runtime capability check, not a dependency bump.
- The drawer already hosts the host's `conversation.window` occurrence inside a retained Session area (`src/client/conversation-surface.tsx`), renders the conversation through a session-scoped slot (`kanban.conversation`), and owns its width persistence (`src/client/drawer.tsx`, key `dsh-kanban.drawer.width`).
- The plugin may not render the host's tab seats itself: keyed slot ownership is enforced by the renderer, and the tab bodies live in host packages that export no components. Reusing the host panel is therefore the only way to get files, preview, terminal, and browser.

The plugin-owned real-composition lane stages its scenario outside the DSH checkout and imports that checkout's scaffold by absolute path. Because the scaffold imports workspace packages that only exist behind per-package links, the runner aliases every checkout workspace package (root export and explicit subpath exports) into the generated Vitest config; the lane that exercises this change is what motivates that runner support.

## Goals / Non-Goals

**Goals:**

- One plugin composition that hosts the host panel beside the drawer's embedded conversation, using the retained Session area and no plugin copy of panel state.
- Predictable geometry: split, rail width, drawer growth and restoration, and a covered presentation when the viewport cannot fit both.
- Isolated host integration: a structurally typed, optional port at the composition root, so the board keeps working on hosts without the capability and a later host change is a one-file concern.
- Leave the code smaller than we found it: one width/resize hook, the conversation-area composition extracted, and one reusable unsupported-native-surface notice.

**Non-Goals:**

- Implementing any DSH behavior in this repository (the host change is merged and tracked by card `6b923088`).
- Floats, pane split, fullscreen, or a per-occurrence layout in the drawer panel.
- A plugin-owned file tree, preview, terminal, or browser.
- Changing the main column's Sidebar, the conversation window's requirements, or the drawer's existing dismissal and persistence behavior.

## Decisions

### D1. Consume the host panel through an optional, structurally typed port

The composition root (`src/client.tsx`) reads the Sidebar service once with `ctx.get('sidebarRight')` inside a `try/catch`, the same optional-service pattern `src/client/host-navigation.ts` already uses for `layout`. It builds a `SidebarPanelPort` only when the service reports `capabilities.embeddedPanel === true` and exposes `forSession`. The port narrows the host to what the drawer needs: `face(sessionId)` returning the stable face (observable `expanded`, `setExpanded`) plus the capability flag. The service and face are declared as local structural interfaces, mirroring the existing `conversation.window` typing bridge, so the pinned SDK keeps compiling and no private-fork package becomes a dependency.

The port is created once per client generation and captured by the `kanban.conversation` seat closure; it is passed to the workspace as a prop, not read from a global. Components depend on the port interface only, which keeps unit tests host-free.

Alternatives considered: adding `@deepseek-ai/dsh-client-ui-sidebar-right` as a dependency (rejected: the published SDK does not declare the API and the private fork is not an install target); reading the service inside the workspace component (rejected: hidden dependency and untestable); bumping the DSH floor (rejected: the panel is optional and the floor is a product promise).

### D2. Render the Factory occurrence in the slot that already has the Session area

The `kanban.conversation` seat, which is already rendered inside the retained `SessionProvider`, builds a `renderPanel` render-prop — `() => renderFactorySlot('sidebar.right.panel', { variant: 'embedded' }, { fallback: null })` — and hands it to the workspace; no Session identity is passed, and the workspace itself never touches the slot renderer, so tests pass a stub panel and the seat stays the only place that knows the host Factory name. The host returns nothing while the column is collapsed, so the plugin controls the rail's own box and reservation from the observable `expanded` state instead of inferring from the occurrence's DOM.

The Factory name and its input are called through a narrow local typing bridge (the same cast pattern `conversation-surface.tsx` uses for `conversation.window`), so the pinned SDK's `SlotFactoryMap` does not need the private-fork declaration.

Alternatives considered: a plugin-owned child slot that renders the panel (rejected: an extra registration with no benefit; the seat already receives `renderFactorySlot`); rendering the panel only after the user interacts (rejected: the observable state is the source of truth and must survive a reload).

### D3. Extract the conversation workspace and a pure layout planner

A new `src/client/conversations/workspace.tsx` owns the conversation-plus-panel area: the embedded window occurrence, the panel occurrence, the divider, and the covered presentation. It receives `{ sessionId, port, renderPanel, window }` (where `window` is the already-rendered conversation-window sibling) and reports its reservation to the drawer width controller through a context, so the workspace renders standalone in tests with a fake port, a stub panel, and the default no-op reservation. All width decisions live in a pure `src/client/conversations/workspace-layout.ts`:

- `CONVERSATION_MIN = 420`, `RAIL_MIN = 320`, `RAIL_DEFAULT_RATIO = 0.45`, `DIVIDER = 8`.
- `planWorkspace({ drawerWidth, viewportWidth, railWidthPreference })` returns either `{ kind: 'split', railWidth, extra }` or `{ kind: 'cover', railWidth }`. Split is chosen when a widened drawer (clamped to 90% of the viewport) can hold the conversation minimum, the rail, and the divider; otherwise the rail covers the conversation.
- The rail width defaults to 45% of the drawer base width, clamped to `[RAIL_MIN, 70% of the drawer]`, and never below the conversation minimum in split mode.

The planner is unit-tested without React, which is where the narrow, wide, and resize edge cases live.

Alternatives considered: computing widths inside the drawer (rejected: the drawer does not know the active conversation or the panel state); CSS-only sizing (rejected: the covered mode and the reservation need explicit decisions and testable numbers).

### D4. The drawer width becomes a hook with base and reservation

`src/client/drawer.tsx` currently owns the clamp, `localStorage`, pointer, and keyboard logic for its width inline. It moves to `src/client/use-drawer-width.ts` with a small controller:

- `baseWidth` is the persisted preference (`dsh-kanban.drawer.width`), exactly as today.
- `reserve(extra)` publishes an effective width = `min(90% viewport, max(baseWidth, conversationMin + extra))`; `release()` returns to `baseWidth`. A manual resize while reserved updates the reserved width, not the base.
- The resize handle, double-click reset, and keyboard steps keep their current behavior and are shared with the divider through a `useResizableEdge` helper for pointer and keyboard handling (the drawer's outer divider and the workspace divider use the same helper with different bounds and directions). It captures the pointer, reverts a cancelled gesture, and removes its listeners on unmount.

`TaskDrawer` publishes `{ reserve, release }` through a `DrawerWidthContext` beside `ConversationLeasesProvider` (the workspace is inside the drawer's React tree, so the context crosses the slot boundary); the workspace consumes it through `useDrawerWidthReservation()`, whose default is a no-op for standalone renders. Reserve runs while the active Session's panel is expanded, and release runs on collapse, on the active conversation changing to a collapsed Session, when the section leaves Conversations, and when the drawer closes — every path is an effect cleanup, so the base width cannot stay reserved. The persisted value remains the base width, so a reload never restores a drawer grown for the panel.

Alternatives considered: persisting the grown width (rejected: the drawer would stay wide after the panel closes); a CSS transition on the drawer width (rejected: the split must track pointer movement exactly).

### D5. The rail width is one product preference

The rail width persists under `dsh-kanban.rail.width` as pixels, clamped on read and on every layout. It is deliberately not per Session: the panel's own tabs and layout are already per Session, and the user asked for one rail width.

### D6. Follow `expanded` for presence, reservation, and restore

The workspace subscribes to `port.face(sessionId).expanded` with `useSyncExternalStore` and renders the panel only while it reads `true`. This one rule drives the rail presence, the reservation, and the restore, because the host collapses the column on its own paths too (the panel's collapse control, closing the last docked tab, the header corner control). The plugin never writes the expansion state: the native corner control and the panel's collapse control are the only intents, so the two surfaces cannot disagree.

Alternatives considered: a plugin-local `open` state synchronized with the host (rejected: two sources of truth and a dead native control); writing `setExpanded` from the plugin (rejected: no plugin-owned control needs it).

### D7. When the panel covers the conversation, keep both mounted

In cover mode the panel is positioned over the conversation area, the divider is not rendered, and the conversation stays mounted underneath but marked inert and `aria-hidden` while covered, so the composer cannot take focus behind the panel. Collapsing the panel removes the covered presentation in the same commit that `expanded` becomes false. This keeps the conversation's retained Session (and the host window's state) intact, which the "Warm task conversation surfaces" requirement depends on.

### D8. Contain a failing panel occurrence

`src/client/conversation-surface.tsx` already wraps the conversation slot in a `NativeBoundary`. The workspace adds a second, panel-scoped boundary: a crash inside the host panel is reported in the drawer and removes the panel (releasing the reservation) while the conversation keeps rendering. The panel never replaces the conversation with a plugin-owned fallback.

### D9. Absence is inert, and no notice is added

The workspace renders the conversation exactly as today when the port is absent. There is no update notice: the panel is a new optional capability, the absence has no observable trigger in the drawer, and the existing `conversation.window` notice already covers the only mandatory window surface. The unsupported-native-surface notice in `conversation-surface.tsx` is extracted to `src/client/native-surface-notice.tsx` (title, detail) so the conversation window keeps its notice and a future surface can reuse it; the rail intentionally uses no notice.

### D10. Small cleanups stay inside the change

- `drawer.tsx` delegates its Conversations section composition (worktree notice, window, rail) to the new workspace and a smaller section component; the drawer keeps the header, stage, script, and lease ownership.
- One width/resize hook serves both the drawer and the divider; the duplicated clamp and storage code disappears.
- The conversation-area composition moves from `drawer-conversations.tsx`/`conversation-surface.tsx` into `conversations/workspace.tsx`.

The `ConversationSurfaceOwner` interface is left as is (the user declined that refactor); the workspace receives the factory renderer directly from the seat props.

## Risks / Trade-offs

- **The capability is not in the published SDK** → the plugin types the port structurally and casts the Factory call, with a capability check; when a release declares them, the bridge is deleted without behavior change.
- **The real-composition lane needs a host build with the capability** → the lane detects `capabilities.embeddedPanel` and explicitly reports "unsupported host" for the rail scenarios instead of failing; the full acceptance runs against a built checkout containing `69b0f199` (documented in the README's verification notes).
- **Shared state cuts both ways** → closing the last docked tab in the drawer collapses the Session's column, so the main chat later shows it collapsed; the spec and README state this, and the drawer reacts to the same `expanded` change.
- **Drawer growth can surprise** → the base width is remembered and restored on every close path, and the persisted value never changes because of the panel.
- **Cover mode hides the conversation** → the conversation stays mounted and inert, the divider disappears, and collapse returns it; the split is preferred whenever the viewport allows.
- **A host regression in the embedded occurrence** → the panel-scoped boundary contains it; the conversation and the drawer remain usable, and the reservation is released.
- **Rail width preference is product-wide** → deliberate; per-Session widths would multiply state and conflict with the shared layout.

## Migration Plan

No data migration. The drawer keeps `dsh-kanban.drawer.width`; `dsh-kanban.rail.width` is new and read-tolerant (invalid or missing values fall back to the default). On hosts without the capability the behavior is byte-for-byte today's. Rollback is removing the workspace mount and the port: the persisted keys are inert and the host panel state is untouched.

## Open Questions

- When a DSH release declares the Factory and the per-Session face in the published SDK, the structural bridge and the local cast should be replaced by the declared types. That timing does not change the specs, the approach, or the tasks.
