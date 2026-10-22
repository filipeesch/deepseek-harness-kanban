# Proposal

## Why

In the host's dark appearance, every primary action renders as a pale-blue browser selection fill with black text. On hover, the generic button rule outranks the primary rule and replaces the fill with a near-black surface mix while the text stays black, producing roughly 1.13:1 contrast. The control becomes unreadable and visually detached from the host theme. The board also still uses the browser `Highlight` selection color for focus rings, the selected-tab underline, the drop indicator, the selected-card outline, and the drawer resize affordance, so those accents do not follow the host palette either.

## What Changes

- Render primary actions with the host primary button tokens (`--dsw-alias-button-primary-fill`, `--dsw-alias-label-primary-foreground`) and pin their hover state to `--dsw-alias-button-primary-hover`, so the fill and foreground remain legible in both appearances.
- Replace the remaining browser `Highlight` accent usages (focus rings, selected-tab underline, drop indicator, selected-card outline, drawer resize hover) with host focus and accent tokens.
- Add stylesheet coverage that fails if a primary action falls back to `Highlight`/`HighlightText` or loses its explicit hover rule.
- Out of scope: layout, workflow, interaction, or host-style changes. Fixed danger and status colors that do not adapt to dark appearance are tracked separately.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: add a requirement that board controls follow the host light and dark appearance, including legible primary-action fills and hover states, and host-themed accent and focus indicators.

## Impact

- Affects the board stylesheet at `src/client/styles.ts` and its stylesheet tests.
- Requires a rebuild, native plugin reconciliation, and visual verification in the existing GUI in both appearances.
- No API, dependency, data, workflow, or host changes.
