# Design

## Context

See `proposal.md` — Why. This design covers only the card surface; the drawer, host contract, commands, and persistence are untouched.

The current card is rendered by a `renderCard` closure inside `BoardView`. That closure reads roughly ten board values (selection, attention, project lookup, auto-run controller, drag begin, click suppression), and the card's markup and styles are split across three places: `styles.ts` lines 15, 51–57 and 126, plus `activity-styles.ts`. The activity signals live inside the card's open `<button>`, which is why the background chip is a `tabIndex=0` element nested inside a button and why the card needs `pointer-events`, `stopPropagation`, and `z-index` coordination.

The single meta line was a deliberate choice in `2026-10-23-running-status-visibility`: project, attention, working, and background count shared one line so the card stayed compact and kept one height while idle, working, or background. This change reverses that density decision while preserving its invariants: the working indicator and accent stay visible, the background indicator stays quieter and carries the count plus labels, the whole card stays activatable, and the run-action semantics are unchanged.

Measured evidence, 220px card with 198px of usable content width: `Working` 61px, `2 jobs` 47px, `1 subagent` 71px, action 26px, gaps 21px — 226px total. The project name collapses to zero width and the chip renders up to 40px past the card edge.

## Goals / Non-Goals

**Goals:**

- Give each card a stable, explicit region structure with one owner per information family.
- Keep the activity region on one line in every task state, with a reserved height, so activity changes never resize the card.
- Render the run action and countdown in the activity region instead of a separate row.
- Remove invalid nested interactive content from the card and delete the hacks it required.
- Extract the card out of `BoardView` into a presentational component with injected handlers.

**Non-Goals:**

- Changing the drawer header, drawer activity line, or `TaskActivity`'s drawer variant.
- Changing auto-run semantics, entry resolution, command payloads, or attention computation.
- Adding filters, new card actions, or stage selectors.
- Clamping titles, or changing the 240px column width.
- Restyling attention dot colors or the working badge's visual language.
- Writing or updating tests in this change; they follow in the implementation phase.

## Decisions

### The card becomes a presentational `TaskCard` with injected handlers

`src/client/task-card.tsx` contains `TaskCard` plus three small parts:

```text
TaskCard
  +-- CardContext   (project label, attention dots, selection control)
  +-- activity      (Working badge, background chip, CardInstructionAction)
  +-- CardStatus    (operation / confirmed transition / run failure)
```

`TaskCard` receives task, column, project name, attention, selection state, the auto-run controller, and the handlers `onOpen`, `onToggleSelect`, `onBeginDrag`, and `shouldSuppressClick`. It renders from props only; it does not read board preferences, snapshot, or selection state. `BoardView` keeps orchestration: task filtering and ordering, the project lookup, the drag session, selection toggling, drawer opening, and focus restoration.

`CardInstructionAction` stays where it is (`auto-run-view.tsx`) and remains a self-contained control; it keeps its `key={column.id}` reset and its existing labels and countdown copy.

Alternatives considered: keep `renderCard` and only restyle (rejected — the closure is the reason the card cannot be reasoned about or reused, and the redesign touches every line of it); extract the whole board shell (rejected — a much larger diff that this change does not need).

### The open button wraps the title; an overlay keeps the whole card activatable

The article stays the card root. The open `<button class="kb-card-open">` wraps the title region only. Its `::after` pseudo-element is absolutely positioned against the card root and covers the whole card, so activating any non-control area still opens the drawer and keyboard focus still lands on the same button. The context, activity, and status regions are siblings of the button.

The context region and the background chip sit above the overlay and forward activation to the same handler, so the project name and attention dots keep their native hover labels and no part of the card becomes a dead zone. The run action and the selection control stay above the overlay as well; the blank part of the activity strip and the status region read through the overlay, because they carry no hover or control affordance.

This removes the nested build: the background chip is no longer a focusable element inside a `<button>`, so the surrounding `pointer-events` and `stopPropagation` workarounds can be deleted. It also keeps the existing behavior contract from "Open a task drawer": whole-card activation except nested controls.

Alternatives considered: keep every region inside the button and use `role="note"` on a nested span (rejected — invalid interactive nesting and it is exactly the current source of hacks); make only the title clickable (rejected — violates whole-card activation).

### One aggregation rule owns the background chip copy

`activity.tsx` gains a pure summarizer used by the card:

```text
distinct kinds == 1  ->  "<count> <kind>"          e.g. "1 job", "2 subagents"
distinct kinds >= 2  ->  "<total> activities"      e.g. "3 activities"
```

The chip's title and accessible name always carry the full label list, using the existing `backgroundDetails` join. This keeps the chip width bounded (max measured 83px for `12 subagents`, 76px for `12 activities`) so `Working` + chip + action stay under 198px. The existing `backgroundSummary`/`backgroundChipText` helpers are replaced by the new summarizer; the dead `standalone` branch is deleted. `TaskActivity`'s card variant is removed; the drawer variant stays unchanged.

Alternatives considered: per-kind tokens always (rejected — measured 226px with action, and the user chose aggregation on overflow); always aggregate even for one kind (rejected — the single-kind label is useful and fits); icon-plus-number tokens (rejected — less explicit and needs learned iconography).

### The activity region is one reserved line; only status grows the card

`CardActivity` renders a flex row with `min-height: 26px`, `flex-wrap: nowrap`, and a gap, ordering: working badge, background chip, run action pushed to the trailing edge with `margin-left:auto`. The reserved height is the card's default in every state, so a turn starting or ending, a count change, or the run action appearing does not move the card.

The chip is the only element that could overflow; it is bounded by the aggregation rule and additionally gets `overflow:hidden` with ellipsis as a safety valve. The status region is rendered only when it has content, so an operation or confirmed transition can still grow the card — those are rare, explicit states.

Alternatives considered: reserve the status rows too (rejected — inflates every idle card); render only when active (rejected — the card would resize on every turn start/end); reserve two activity lines (rejected — pays the second line in every card).

### Status becomes one toned strip

`CardStatus` derives one entry per fact:

- context operation → failure tone with `Operation failed`, or pending tone with `Operation: <phase>`;
- confirmed transition → failure tone with `Confirmed action failed`, or pending tone with `Confirmed action: <status>`;
- auto-run admission failure → failure tone, message from the auto-run entry.

The labels name the state; the drawer keeps the detailed cause and controls.

`TaskCard` reads the auto-run entry once for the failure message, using the shared `autoRunEntryForColumn`/`RUN_FAILURE_FALLBACK` helpers, and passes it to `CardStatus`; `CardInstructionAction` stops rendering the error paragraph and only renders the control. The strip renders entries in order and keeps `role="alert"` on the failure so the announcement behavior survives. Tones mix the host tokens already used elsewhere (`--color-destructive` with its existing fallback for failure, the business-primary accent for pending) toward the host label color so the 11px status text stays at AA contrast in both appearances, instead of relying on opacity.

Alternatives considered: keep the two grey paragraphs (rejected — the user asked for tone and icon); reuse the drawer's `OperationStatus`/`PendingTransitionStatus` (rejected — they are full panels with retry/return controls, too heavy for a card).

### Card styles move to a dedicated module

`src/client/card-styles.ts` exports `cardStyles`, imported by `styles.ts` and concatenated like `activityStyles` (the pattern already used by `activity-styles.ts` and `questions/styles.ts`). It owns `.kb-card*` and the card-only `.kb-background` chip; `activity-styles.ts` keeps the working-badge primitives shared with the drawer.

The card's class contract after the change:

| class | owner | note |
|---|---|---|
| `.kb-card`, `.kb-card-open`, `data-task-id`, `data-working` | root / title button | `data-working` only on the article |
| `.kb-card-context`, `.kb-card-project`, `.kb-card-select` | context region | new |
| `.kb-card-activity`, `.kb-background`, `.kb-working`, `.kb-card-run`, `.kb-card-countdown` | activity region | countdown class kept for existing e2e hooks |
| `.kb-card-status` | status region | new |
| removed | `.kb-card-meta`, `.kb-card-signals`, `.kb-card-check`, `.kb-attention` | replaced |

The card's pointer handler excludes `.kb-card-activity` (the whole interactive region) plus `input, select, textarea, a`, replacing the old `.kb-card-run, .kb-card-signals` selector in `BoardView`.

### Selection control moves inline

In selection mode the checkbox renders as the first child of the context region. The absolute positioning and the `padding-left:24px` hack on the title button are removed. The open button keeps its selection-mode `aria-label`/`aria-pressed` behavior so the card still toggles selection in that mode.

### Accessibility contract preserved

- The persistent `role="status"` working announcement remains mounted empty while idle and changes once when a turn starts; it moves into the activity region, outside the button.
- The open button keeps the accessible name `Open task <title>` / `Select task <title>`, and the title text stays inside it.
- The background chip keeps `title` with all labels and an accessible name with count plus labels; it is now a focusable sibling of the button rather than its descendant, and clicking it activates the card like the rest of the surface.
- Focus restoration after closing the drawer still targets `[data-task-id] .kb-card-open`.

## Risks / Trade-offs

- [Overlay hit-testing regresses after regions move out of the button] → keep the `::after` overlay on the card root, lift nested controls with `z-index`, and verify card opening from each region during the browser lane.
- [Aggregated counts hide the activity kinds at a glance] → keep single-kind labels, expose all labels on hover and to assistive technology, and leave the drawer's detailed line unchanged.
- [The card is slightly taller than today in the idle state because the activity region is reserved] → accepted trade-off for a stable layout; the reserved line is 26px instead of the old 18px meta line.
- [Class removals break the existing appearance and browser suites until updated] → the implementation phase updates `appearance.spec.ts`, `running-status.spec.ts`, `auto-run.spec.ts`, `styles.test.ts`, `activity.test.tsx`, and the e2e templates together with the component.
- [Aggregation copy drifts between the card and the drawer] → both derive labels from `backgroundDetails`; only the count/kind summary differs, and it is a single pure function.

## Migration Plan

No data or protocol migration. The change is client-rendered UI only; rollback is reverting the client files. The isolated browser lane (`pnpm test:browser`) and the e2e template selectors are updated in the implementation phase, not this one.
