# Design

## Context

See `proposal.md` - Why for the motivation and the measured baseline. Two facts shape the approach beyond that:

The header is one flex row today. [board-header.tsx](../../src/client/board/board-header.tsx) renders `.kb-heading` (title, subtitle, toolbar) and then a single `hubNav` slot, and the CSS makes the navigation occupy a full line of its own with `.kb-hub-nav{flex-basis:100%}`. [hub-nav.tsx](../../src/client/hub-nav.tsx) renders both tab rows inside one `<nav>`, so the header cannot place them on different lines without either splitting that component or telling it to render differently.

The popover behaviour the filter control needs already exists, inline, in [closed-conversations.tsx](../../src/client/closed-conversations.tsx): three refs, an `open` state, a `dismiss(restoreFocus)` callback, capture-phase `pointerdown` and `keydown` listeners gated on a `pending` flag, `preventDefault` plus `stopPropagation` on `Escape` so the task drawer stays open, and an initial-focus effect. That behaviour is specified in `task-conversations` under *Closed conversations stay out of the conversation flow*, and `tests/browser/closed-conversations.spec.ts` covers it. Reusing it is therefore both a de-duplication and a way to inherit a tested implementation.

Two constraints bind the result. The leading content of the header must clear `--dsh-frame-leading-clearance`, and the Hub tabs become leading content by moving onto the title row. And the filter values live in `BoardPageState`, which [tests/bridge/plugin.test.tsx](../../tests/bridge/plugin.test.tsx) uses to assert that a filter survives a plugin regeneration; that persistence must not change.

## Goals / Non-Goals

**Goals:**
- A 107px header that holds the title, Hub tabs, and toolbar on one line and the board chips on the next, at 1100px and above.
- One entry point for both filters, with an at-a-glance indication of what is active.
- One popover implementation in the plugin, with the drawer-collision handling in a single place.
- Header geometry expressed in a header style module, so `styles/base.ts` stops being the place every area's rules accumulate.

**Non-Goals:**
- Splitting `board.tsx` itself. It owns snapshot, preferences, selection, dialogs, destructive operations, batch, drawer animation, auto-run, and moves; that decomposition is its own change and is not a prerequisite here.
- Any change to what the filters mean. `filterTasks` keeps its semantics, and no new filter kind appears.
- Any behaviour change in the closed-conversations menu. Its migration to the extracted primitive is invisible and its existing scenarios are the acceptance criterion.
- Keyboard shortcuts, and any persistence of the popover's open state.
- The workflow diagram, the task drawer, and the column board layout.

## Decisions

### Two tab-row components instead of a layout flag on `HubNav`

`hub-nav.tsx` exports `HubTabRow` and `BoardTabRow`, each rendering its own `<nav>` landmark and its `role="tablist"` with the existing accessible names `Hubs` and `Boards`. The private `ScopeTab`, the indicator order, and `RunningTasksBadge` stay in the same file and are shared. `HubNav` is deleted; `BoardHeader` places the two rows through `hubTabs` and `boardTabs` props, mirroring the `viewControl` slot it already accepts, and `board.tsx` keeps composing them from snapshot facts so the header stays presentational.

A `layout: 'stacked' | 'inline'` prop was the alternative, and it is rejected: it would make one component answer to two geometries, put header layout knowledge inside the navigation, and demand a new flag value for every future arrangement. The rows are separate compositions, so they should be separate components. Folding the rows into `BoardHeader` directly was also rejected: it would move activity projection and sharing badges into the header and start the god-component problem again.

### A `Popover` component, not a headless hook

`src/client/popover.tsx` exports `Popover`, which owns the anchor element, the trigger's `aria-haspopup`, `aria-expanded`, and `aria-controls`, the capture-phase outside-pointer and `Escape` listeners, `preventDefault` plus `stopPropagation` on dismissal, focus restoration to the trigger, and initial focus into the body. The consumer supplies the trigger element and the popover body. Its props are `{ trigger, label, align, dismissable, initialFocusSelector, anchorClassName, popoverClassName }`; `dismissable` defaults to `true` and carries the closed-conversations `pending` guard, and `initialFocusSelector` replaces the hard-coded `button.kb-closed-item:not([aria-disabled=true])` query.

`Popover` carries only positioning - an unskinned `.kb-popover` with the anchor geometry and stacking - and the consumer adds its skin through `popoverClassName`. That keeps [tests/client/styles.test.ts](../../tests/client/styles.test.ts) honest: it is the project's style-contract test and asserts selectors as strings over the concatenated stylesheet, so `.dsh-kanban .kb-closed-popover{` must keep existing with its own width, padding, and surface rules while the position and z-index move to `.kb-popover`. Selector-level contracts stay; only the exact-value header rule in `board.test.tsx` is replaced, and new selectors this change adds get their own contract entries.

A `usePopover` hook returning refs and handlers was considered and rejected: it leaves the ARIA wiring and the capture-phase ordering at each call site, which is precisely the subtle part, and a second consumer would re-derive it. The two consumers differ only in body content and in whether a click can be dismissed, both of which fit props.

`closed-conversations.tsx` migrates in the same change, keeping its own markup, titles, notices, and pending logic. Its `kb-closed-*` class names stay so the existing browser spec keeps passing. The migrated menu is the proof that the primitive is general, and it is what makes a duplicated implementation unacceptable.

Two dismissal rules the first draft left to chance are the primitive's job, both found in review. Escape belongs to the popover raised last: document listeners fire in registration order, not paint order, so without a shared raise order an older popover sitting underneath would swallow the key and dismiss itself. And an outside pointer closes without touching focus first, then takes the trigger back only when the click left focus stranded on the page — cancelling `pointerdown` would also cancel a card drag, and pulling focus back from a control the user just pointed at loses their intent.

### Filter values stay in page state; popover openness stays local

`BoardFilterControl` keeps `open` in local `useState`. The values keep flowing through the existing `usePageField(preferences, 'search' | 'projectFilter')` pair in `board.tsx`, which the header forwards as props, so the regeneration-survival test keeps its meaning.

Promoting `filterOpen` into `BoardPageState` was rejected: a popover is transient, it must close on Hub or board change, and persisting it would require explicit reset paths that the current `selectHub` and `selectBoard` do not have.

### The active-filter indicator is derived, never stored

The indicator reads `search.trim() !== '' || projectFilter !== ''` and counts the active filters. The `trim()` mirrors [task-filter.ts](../../src/client/task-filter.ts), so a whitespace-only search cannot light the badge while the board shows everything. The numeral is an `aria-hidden` accent badge on the trigger, and the trigger's accessible name and tooltip state which filters are active, which keeps the information available without a visual channel.

Storing an indicator flag beside the values was rejected: it could disagree with `filterTasks`, which is the only real source of truth about what the board is showing.

### One control height through a shared class, not a toolbar descendant selector

A `.kb-control` class carries the 32px height and is applied to the filter trigger, the presentation switch buttons, the select-cards action, and the configuration action. The `.kb-view-switch` rules move from `workflow-view/styles.ts` into the header module as part of this, since that control is header chrome that a later feature module happened to claim.

Setting `height` on `.kb-toolbar > *` was rejected: `.kb-input` is shared with the dialogs, the create dialogs, and the Git section, and a descendant rule either leaks into them or needs exclusions. The popover's own search input and project select keep the `.kb-input` height, which is correct inside a popover; only the row needs uniformity. The project select gets `min-width:0` with truncation and a tooltip carrying the full project name, replacing today's behaviour where the header `<select>` sizes itself to the longest project name and measured 398px.

### Header styles move to their own module

`src/client/styles/header.ts` is registered in [styles/index.ts](../../src/client/styles/index.ts) after `baseStyles` and takes the header, tab, and presentation-switch rules: `.kb-header`, `.kb-header h1`, `.kb-hub-row`, `.kb-board-row`, `.kb-toolbar`, `.kb-hub-tabs`, `.kb-board-tabs`, `.kb-hub-tab`, `.kb-board-tab`, `.kb-tab-add`, `.kb-control`, and the new `.kb-filter-badge`. `drawer-header.ts` is the precedent for a per-area module. `.kb-hint` stays in `base.ts` because `create-dialogs.tsx`, `git.tsx`, and `project-relocation-notice.tsx` use it; the header-only `.kb-search` rule is deleted, in `base.ts` and in the 760px media query, along with the subtitle's `.kb-heading` and the unused `.kb-hub-nav`.

### Board chips shrink inside a row that does not move

The board row gets an explicit `min-height` equal to today's 31px, and the chip shrinks about 20% in font size and padding. The active chip switches from the `border-bottom` underline to a filled `--kb-soft` with an accent border ring, because a shorter chip would leave the underline sitting off the row's baseline. Hub tabs keep the underline treatment, so the two rows still read as different levels of the hierarchy.

### Test strategy follows the geometry, not the CSS text

[tests/client/board.test.tsx](../../tests/client/board.test.tsx) asserts the header's CSS rule as a literal string, which makes any spacing change a false failure. Those assertions become structural: the browser lane measures `getBoundingClientRect()` for the header height, the row count, and the control heights, while the jsdom tests keep asserting behaviour. The six call sites that reach `getByRole('searchbox', { name: 'Search tasks' })` and `getByRole('combobox', { name: 'Project filter' })` gain a shared `openFilterPopover` helper in `tests/client/helpers.ts` rather than six copies of the click sequence.

## Risks / Trade-offs

- [Extracting the popover touches a drawer control whose dismissal rules are specified] → Migrate with no behaviour change and lean on the existing `tests/browser/closed-conversations.spec.ts`, `tests/client/drawer-conversations.test.tsx`, and the `task-conversations` scenarios for Escape, outside click, focus return, and the pending guard. If the primitive cannot express the pending case cleanly, keep the menu inline and record the primitive as single-consumer rather than bending the spec.
- [The title row squeezes the Hub tabs between 1000px and 1100px] → The toolbar already wraps and the tab rows already scroll; the browser lane asserts no clipping or hidden control at 1100px and 900px, which is where today's header already wraps.
- [Search and clearing each now cost two activations] → Deliberate, and the accent badge keeps the state visible. If it proves slow in practice, the header clear button returns as its own change; the layout has the freed width to accept it.
- [The filter popover has to sit above the board it covers and below the drawer that can cover it] → The ladder is card internals `≤3`, board overlays `2`/`6`/`8`, popover `10`, drawer `20`: the popover out-ranks every board layer and never a drawer one, and the browser lane asserts the paint order by hit-testing. A popover anchored inside the drawer still rides the drawer's own stacking context, so the closed-conversations menu stays above it. Below 760px the toolbar owns the whole line, which puts the funnel at the leading edge, so the same media query anchors the popover to that edge instead of the trailing one; the narrow browser cases assert both edges stay inside the viewport.
- [The macOS frame clearance now has to cover the Hub tabs as well as the title] → The requirement is updated, and the browser lane asserts the leading content starts past the clearance with the sidebar collapsed.
- [Literal CSS assertions fail as soon as spacing changes] → Replace them in the first commit, before any styling work, so a red suite always means a real geometry regression.

## Migration Plan

One pull request, no data migration, no host API change, and no new dependency; `Filter` and `FilterX` come from the `lucide-react` version already pinned. `package.json` goes from `0.6.0` to `0.6.1` in the same pull request, as AGENTS.md requires for a change to the published artifact. The compaction rides a patch release: it changes existing chrome and adds one control over existing page state, with no new capability and no persisted-shape change, and `0.6.0` is already an immutable published release.

Land in three reviewable steps: extract `Popover` and migrate the closed-conversations menu with green existing specs; replace the brittle CSS assertions and split `HubNav`; then the header layout, the filter control, and the style module.

Rollback is a revert. No persisted shape changes: `BoardPageState` keeps its keys, so an older client reading storage written by a newer one sees nothing new, and the plugin version pin needs no coordination.
