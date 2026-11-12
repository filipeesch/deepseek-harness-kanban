# Design

## Context

See the proposal for motivation. The plugin owns the task drawer header, whose stage control and action group are separate components; the embedded conversation window is host-owned. Advance currently uses a 15 px icon in a 28 px button, delete and close use 16 px icons in 32 px buttons, and Auto uses a 13 px icon with a text label. The diagram wraps a shared stage header used by the column board, passing a local lock-derived disabled state. Existing specifications contain mutually contradictory locked-state scenarios.

## Goals / Non-Goals

**Goals:**
- Keep geometry and spacing consistent across the task header without duplicating action logic or changing task behavior.
- Express diagram-specific edit visibility at the presentation boundary, retaining the shared stage editor and column behavior.
- Preserve accessibility and responsive layout and make the changed geometry and lock behavior testable.

**Non-Goals:**
- Change native conversation header contributions, persisted workflow state, host APIs, or the editor behavior.
- Convert the Auto chip to an icon-only control or create a new general-purpose UI framework.

## Decisions

### Shared visual metrics, existing responsibilities

Use a consistent 16 px icon size, 32 px square icon-only targets, and a 4 px gap for adjacent header actions as the starting metrics; center them on the same axis. Keep Auto as a text-bearing chip but align its icon and outer height with the action row. Apply the metrics locally to the drawer header and adjust the stage action group and responsive layout as needed. Preserve state-dependent availability and labels. These measurements extend the existing delete/close pattern, rather than introducing a generic button abstraction for a small local change. Validate the resulting geometry at narrow and wide widths.

### Visibility at the diagram boundary

Use the existing diagram lock to withhold the edit action from the shared stage header while locked, and restore the callback when unlocked. Preserve any independently unavailable edit state if one exists; do not conflate a missing callback with authorization. The column board continues to supply its edit action normally. Remove lock-specific disabled tooltip, props, and guards only if no other caller needs them. This keeps lock policy with its owning presentation instead of teaching a shared header about diagram state or merely hiding a disabled button with CSS. Preserve pointer isolation, keyboard operation, and focus restoration when the action is available.

### Verification and specification consistency

Extend the existing component and browser suites rather than adding a parallel test harness. Check actual bounding boxes, icon dimensions and spacing, accessibility, light/dark themes and wide/narrow layouts. Test initial lock, unlock, re-lock, keyboard behavior, no accidental dragging, and the unchanged column action. Replace the contradictory locked-state scenario bodies in the affected delta requirements; the validator requires retaining their legacy scenario headings even though those headings are misleading. Rename the headings in the durable specs after sync when the OpenSpec workflow permits it. Do not alter unrelated diagram gestures. Use exact accessible names for the lock and unlock controls in tests.

## Risks / Trade-offs

- [Long labels or narrow drawers overflow after target sizing] → Preserve the existing wrapping behavior and assert no horizontal overflow at supported widths.
- [Removing the focused edit action on relock can drop focus] → Verify keyboard lock interaction and avoid leaving focus on a detached element; preserve normal editor dismissal focus when its trigger remains available.
- [Shared component cleanup changes the column board] → Keep visibility controlled by the diagram adapter and test both presentations.
- [Icon drawing bounds differ despite identical SVG dimensions] → Inspect the isolated browser screenshots in both themes as well as checking geometry.

## Migration Plan

No data migration is required. Deploy with the plugin build and required version bump; rollback is a code revert. The default locked state and lock persistence remain unchanged.
