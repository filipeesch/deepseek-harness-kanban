# Proposal

## Why

The task drawer spends a large share of its space on chrome before the conversation starts. In the default 620px drawer the header, the section toolbar, and the optional automatic-advance notice consume roughly 184px, and the first-open missing-worktree notice adds another ~155px. The Working/Background line duplicates what the board card already shows, and the "Auto mode: off" button is the widest control in the header. On a 420px drawer the header alone is 113px tall and leaves about 160px for the title. The conversation is the reason the drawer exists, so its chrome should be compact and layered instead of stacked.

## What Changes

- Replace the stacked drawer header with one compact row on wide drawers and two rows at 560px or narrower: section icons, a centered title with an inline project chip, then the stage select, the next-stage action, the automatic-mode chip, delete, and close.
- Move the section navigation into the header as icon-only tabs that keep their accessible names and add tooltips; remove the separate section toolbar.
- Render the task title on one line with an ellipsis and a tooltip, and show the project as a chip next to it instead of on a second line.
- Remove the header Working/Background line and present agent execution and background activity as one pulsing dot on the Conversations section tab, with the activity labels in its tooltip and accessible name.
- Remove the automatic-advance notice above the section panel. The auto-mode chip carries the state sentence, including a pause reason, in its tooltip and accessible name.
- Reuse the board card's auto-mode chip in the drawer through a shared control with a header-sized variant.
- Add a next-stage action beside the stage select. It moves the task to the next workflow column through the existing move pipeline, including restricted-transition confirmation, first-execution preparation, and the instructed-stage countdown, and it disappears in the last stage.
- Replace the missing-worktree card with a single line that shows the derived branch and destination plus the create, review-in-Git, and continue-in-base-project actions; the source branch moves into the tooltip.
- Add `lucide-react` and migrate the plugin's hand-written icons through a thin adapter, adding richer glyphs for the sections, the notes, and the next-stage action.
- Publish a third-party notices file with the new icon dependency's license text.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-conversations`: the drawer header composition, section navigation, the activity indicator that replaces the execution-status line, the automatic-advance presentation, and the new next-stage action.
- `worktree-management`: the missing-worktree notice becomes a compact single line and moves the source-branch preview into the tooltip.

## Impact

- Client: `src/client/drawer.tsx` is decomposed into header, title, section-navigation, stage-control, and action parts; `auto-mode.tsx`, `activity.tsx`, `worktree-notice.tsx`, `icons.tsx`, `ui.tsx`, and `styles.ts` change, and a new header style module is added.
- Domain: `src/domain/transitions.ts` gains a pure next-stage helper consumed by the new action.
- Dependencies and distribution: `lucide-react@1.70.0` is added as an exact dependency, `THIRD-PARTY-NOTICES.md` joins the published `files`, and the package version is bumped for the published artifact.
- Tests and documentation: client, browser, and e2e lanes cover the new header, icon tabs, activity dot, auto-mode chip, next-stage action, and compact worktree notice; the README and `docs/operations.md` describe the new drawer chrome.
