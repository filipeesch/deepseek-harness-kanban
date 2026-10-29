# Proposal

## Why

A task card currently packs four information families into one meta line: the project name, the attention dots, the `Working` badge, and the background-activity count. At the 240px column width there are about 198px of usable card width, so the line is already tight with one job and breaks with several activity kinds: the project name collapses to zero width and the background chip overflows the card. The same card also grows by a whole row only when the stage run action appears, and renders operation/transition status as two unattributed grey paragraphs.

## What Changes

- Redesign the task card layout into explicit regions: title, a context line with the project label and attention dots, a dedicated activity strip, and a single status strip.
- Move the stage run/countdown action into the activity strip at its trailing edge, so the action no longer adds a separate row and the card keeps a stable activity-strip height while idle, working, or background.
- Keep the background indicator to one line: a single activity kind keeps its per-kind label (`1 job`, `2 subagents`, `1 schedule`); two or more kinds aggregate into one total (`3 activities`), with the full labels available on hover and to assistive technology.
- Keep the project label always visible as a quiet, ellipsized context label, and keep the attention dots on the context line.
- Replace the two grey operation/transition paragraphs with one status strip that carries a tone and an icon per state.
- Place the selection checkbox inline at the leading edge of the context line instead of floating it over the title area.
- Extract the card from `BoardView` into a presentational `TaskCard` with small parts (context, activity, status) and move its styles into a dedicated card styles module; remove the empty attention wrapper, the dead background-label variant, duplicated working attributes, duplicated style rules, and hardcoded colors.
- Leave the task drawer, the host contract, and all task/board commands unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: the visible execution state on task cards now lives in a dedicated activity region with an aggregated background count, and the board gains a task-card layout requirement that defines the card regions, the single-line activity strip, the inline run action, the inline selection control, and the status strip.

## Impact

- Client code: `src/client/board.tsx` (card rendering extracted), new `src/client/task-card.tsx` and `src/client/card-styles.ts`, plus `src/client/activity.tsx`, `src/client/activity-styles.ts`, `src/client/auto-run-view.tsx`, and `src/client/styles.ts`.
- No host, domain, protocol, persistence, or command changes; the card still renders only from the snapshot and the existing auto-run controller.
- Browser and e2e appearance tests pin the current card selectors and the single-meta-line height assumption; they will be updated in the implementation phase.
