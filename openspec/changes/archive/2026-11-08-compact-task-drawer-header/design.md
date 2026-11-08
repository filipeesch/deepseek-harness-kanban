# Design

## Context

See [proposal.md](proposal.md) for the motivation and [specs/task-conversations/spec.md](specs/task-conversations/spec.md) and [specs/worktree-management/spec.md](specs/worktree-management/spec.md) for the behavior contract.

The drawer is composed by `TaskDrawer` in `src/client/drawer.tsx`. It owns width persistence and resizing, the conversation lease registry, the worktree draft, the section state, the stage move wrapper, and the whole header in one JSX expression. The measurements from the isolated browser harness are:

| Region | 620px drawer | 420px drawer |
|---|---|---|
| `.kb-drawer-header` (title, project line, activity line, actions) | 95px | 113px |
| Section toolbar plus stage select | 39px | 39px |
| Automatic-advance notice when auto mode is armed | ~50px | ~50px |
| Missing-worktree card on first open | ~155-190px | ~190px |
| `Auto mode: off` button | 127x32px | 127px of 420px |
| Section labels | 261px total | 261px total |

Constraints that shape this approach:

- The drawer width is user-resizable from 360px to 90% of the viewport, so the compact layout must react to the **rendered drawer width**, not the viewport width.
- The plugin cannot render the host's `conversation.header` or `conversation.content`; the drawer chrome is plugin-owned except the embedded native window.
- The existing move pipeline already lives in the board (`useMoveRequest` via `onMove`): restricted-transition confirmation, first-execution preparation, and instructed-stage countdown arming. Any new movement affordance must reuse it.
- The pinned host API has no change in this design. The plugin only composes its own chrome and one new client dependency.

## Goals / Non-Goals

**Goals:**

- Return vertical space to the conversation and keep every existing control reachable.
- One composition root for the drawer header with small, testable parts and explicit inputs.
- Reuse the existing move, auto-mode, activity, and worktree state instead of adding new host contracts.
- One icon system with a single adapter seam, so the icon library is replaceable.

**Non-Goals:**

- Reworking the native conversation window, the composer, or the host header.
- Changing the board card layout, its status strip, or its activity region.
- Moving the delete action into an overflow menu (revisit only if the title space becomes a problem).
- Adding labels back to the section tabs on wide drawers.

## Decisions

### 1. Split the drawer header into a composition, not a larger component

`TaskDrawer` remains the composition root: it keeps width, leases, worktree draft, section state, and `moveTo`. It renders a new `DrawerHeader` that receives already-derived values and callbacks. `DrawerHeader` composes four small parts:

- `DrawerTitle`: one-line title with ellipsis and tooltip, plus the project chip.
- `DrawerSectionNav`: the icon-only section tabs.
- `DrawerStageControl`: the stage select and the next-stage action.
- `DrawerActions`: the auto-mode chip, delete, and close.

The parts do not own board state, do not read the store, and do not call `run` directly; they receive values and callbacks. This keeps each part independently renderable in the jsdom and browser harnesses.

*Alternatives.* Keep everything inline in `drawer.tsx`: the header would become a god component and the new responsive branches would be untestable in isolation. Extract a container that owns state: it would duplicate the composition root and couple the header to the lease and draft hooks.

### 2. One row on wide drawers, two rows on narrow drawers

The wide layout is: section icons, centered title with project chip, then stage select, next-stage action, auto-mode chip, delete, and close. At 560px or narrower the header becomes two rows: title plus the auto-mode/delete/close actions first, then the section icons plus stage select and next-stage action. No control is hidden at any supported width.

The layout reacts to the rendered drawer width through a CSS container query on `.kb-drawer` (`container-type: inline-size`). This is required because the drawer is resizable independently of the viewport: a 420px drawer on a 1400px screen must still use the compact layout. The alternative of reading the React `width` state is unreliable because `max-width:100%` can clamp the rendered width below the stored width.

*Alternatives.* Viewport media queries: the drawer can be narrow on a wide viewport, so they would be wrong. A `ResizeObserver` that sets a `data-compact` attribute: works, but adds a render loop and state for something CSS can express; keep it as the fallback if the target browser matrix ever loses container-query support.

### 3. Icon-only section tabs through a new `IconTabs` primitive

`ui.tsx` keeps the text `Tabs` used by Settings and the note editor. A new `IconTabs` accepts `items: { id, label, icon }[]` and preserves the current roving tabindex and arrow-key behavior. The visible content is the icon; the button keeps `aria-label` with the section name and a `title` tooltip, so tests that select a tab by accessible name keep working. The Conversations item also renders the activity dot inside the tab.

*Alternatives.* Add icon support to `Tabs`: it would branch on an optional icon and couple two unrelated surfaces. Render labels with `font-size:0`: inaccessible and unmaintainable.

### 4. The activity dot replaces the header execution line

`TaskActivity` and the `kb-execution-drawer` styles are removed. A new `ActivityDot` derives one dot from `running` and `background`: it pulses when either fact is present and has no visual distinction between them. The Conversations tab's accessible name and tooltip combine the section name with the facts, reusing `backgroundDetails` and the existing activity copy helpers. No live region is added; the dot is decorative and the button carries the name.

*Alternatives.* Keep a compact Working/Background text: the user explicitly rejected the extra line. Put the dot next to the title: the title already needs its full width for the ellipsis, and the tab is visible from every section. Reuse the hub's running pill with a count: the drawer already has the native window for the running detail, and a count was explicitly rejected.

### 5. One auto-mode control shared by card and drawer

`CardAutoModeControl` and `DrawerAutoModeToggle` converge into one `AutoModeControl` with a `variant: 'card' | 'header'` prop. The card keeps its compact chip metrics; the header variant matches the header control height. `autoModeView` keeps returning the state, the tooltip sentence, and the status text. The control's `title` carries that sentence for every state. Its accessible name carries the sentence for the stateful states (advancing, failed, paused, instruction, and dead-end) and the held wait sentence; the armed and off states expose the action and the pressed state, with the armed destination available in the tooltip. `AutoModeNotice` and the `kb-drawer-automode` styles are removed.

*Alternatives.* Keep two controls: they would drift in state wording and duplicate the same `autoModeView` logic. Keep the notice only for pause/failure: the user chose that the control alone carries every state; the task transition status already presents an admitted or failed advance above the panel.

### 6. Next-stage action as a pure domain helper plus the existing move pipeline

`src/domain/transitions.ts` gains `nextStage(workflow, fromColumnId)`, a pure function that returns the following `TransitionDestination` in workflow order, or `undefined` in the last stage. The `DrawerStageControl` renders the action only when a next stage exists, disables it while the task is blocked or a move is in flight, and calls the same `moveTo` wrapper the select uses. Because it goes through `onMove`, restricted confirmation, first-execution preparation, and instructed-stage arming are inherited without new branches. The action's name includes the destination and a confirmation note when the destination is restricted.

*Alternatives.* Duplicate a move command call in the header: it would bypass the preparation and countdown rules. Use the existing `transitionDestinations` and pick the following entry in the UI: that leaves the domain rule untested and spreads the stage-order assumption across components.

### 7. Compact worktree notice, full draft stays in Git

The missing-worktree card becomes one flex line: a short label, the derived branch and destination with truncation and a tooltip that also exposes the source branch, and the existing create/review/continue actions inline. Suggestion and action errors stay as compact notices; they only add height on failure. The draft editing and the complete branch/path/source preview remain in the Git section, which already owns those controls.

*Alternatives.* Keep the `<dl>` preview: it costs ~155px before the first conversation. Move everything to Git: it would add a section switch before the first execution and weaken the one-click create path.

### 8. Add one icon library behind a thin adapter

`lucide-react@1.70.0` (ISC) is added as an exact dependency. `src/client/icons.tsx` becomes an adapter that re-exports the existing icon names backed by Lucide components, with a shared wrapper for the default size (16), `strokeWidth` 2, `aria-hidden`, and `focusable={false}`. `Play` keeps a filled triangle through `fill="currentColor"`. New glyphs are `MessagesSquare` (Conversations), `NotebookPen` (Notes), and `ChevronsRight` (next stage); the auto-mode icon keeps the existing double chevron. A `THIRD-PARTY-NOTICES.md` file carries the ISC notice and joins the published `files`.

*Alternatives.* Import Lucide directly in every component: it spreads size, stroke, and accessibility decisions across ten files and makes a library swap a large diff. Import the host's `ui-primitives` sprite: it binds the plugin to internal symbol ids, needs the host sprite in the isolated harness, and does not cover the needed glyphs. Keep hand-written SVGs: no dependency, but more manual maintenance and an inconsistent set when new icons arrive.

### 9. Keep the new header styles in their own module

The drawer CSS currently lives in one long string in `styles.ts` with an appended `activityStyles` and `cardStyles`. The new header, section-tab, title, stage, action, activity-dot, and compact-worktree selectors go into `drawer-header-styles.ts`, concatenated the same way. The obsolete selectors are deleted from `styles.ts`.

*Alternatives.* Keep appending to the existing long lines: it makes the header change hard to review and keeps growing the least reviewable part of the styles.

## Risks / Trade-offs

- **Long titles truncate at the default width** → The header gives the title ~155-190px at 620px. The ellipsis and tooltip are the accepted trade-off; the full title stays in Info. If this proves insufficient, moving delete into an overflow menu recovers ~38px without touching the header layout.
- **Two adjacent double-chevron controls** → The auto-mode chip keeps its pill shape and the `AUTO` label; the next-stage action is a square icon button whose tooltip and accessible name name the destination. If the two still read as the same control, only the auto-mode glyph changes, which is one adapter line.
- **Icon-only navigation is less discoverable on touch** → Each tab keeps an accessible name and a tooltip. The alternative is losing ~140px of header width; the user chose the icons.
- **Container queries** → The compact layout depends on `@container` support in the DSH web runtime. The target is a modern Chromium-based web app, which supports it. Without it the header stays in the wide one-row layout and its auto-sized tracks can overflow below ~460px; a viewport media query would be wrong because the drawer is resizable independently of the viewport, so the fallback would be a `ResizeObserver` toggling a `data-compact` attribute.
- **New dependency and license notice** → Lucide is ISC and needs its notice in the published package. The artifact gains `THIRD-PARTY-NOTICES.md` and an exact version pin. The measured bundle cost is small compared with the current client bundle.
- **Two spec capabilities change** → `task-conversations` and `worktree-management` both need deltas; the worktree delta is easy to forget because the main change looks drawer-only.
- **Version and release** → The published artifact changes behavior, so `package.json` version is bumped and the release workflow publishes a new immutable version. Rollback is a revert plus reinstalling the previous version; a published version is never reused.

## Migration Plan

1. Add the dependency and the third-party notice, and bump the package version.
2. Add the domain helper and its tests.
3. Add the icon adapter and migrate the icons.
4. Extract the header parts, then switch `TaskDrawer` to the new composition and delete the old header, activity, auto-mode, and toolbar code and styles.
5. Add the activity dot, the shared auto-mode control, and the next-stage action.
6. Compact the worktree notice.
7. Update the browser and e2e lanes, the README, and the operations documentation.
8. Verify with `pnpm check`, `pnpm test:browser`, and the isolated `e2e-dsh` lanes; capture screenshots in both appearances.

Rollback is a revert of the change plus reinstalling the previous published version; no data or stored state changes are introduced.
