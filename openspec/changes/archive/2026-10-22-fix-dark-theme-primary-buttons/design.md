# Design

## Context

See [proposal.md](proposal.md) for motivation. The board stylesheet currently relies on browser system colors for its primary fill and accents. Those colors follow the browser's color scheme, not the DSH host tokens that rebind on `body[data-ds-dark-theme]`; Chromium resolves `Highlight` to a pale blue and `HighlightText` to black in both appearances.

The cascade makes the hover failure independent of the palette. `.dsh-kanban .kb-button:hover:not(:disabled)` has specificity (0,4,0), higher than `.dsh-kanban .kb-primary` at (0,2,0), so the generic hover replaces the primary fill even though the primary rule is more specific in intent.

Host values observed for the relevant tokens:

| Token | Light | Dark |
|---|---|---|
| `--dsw-alias-button-primary-fill` | `#0f1115` | `#f9fafb` |
| `--dsw-alias-label-primary-foreground` | `#fff` | `#0f1115` |
| `--dsw-alias-button-primary-hover` | `#43454a` | `#ebeef2` |

## Goals / Non-Goals

**Goals:**
- Primary actions follow the host's light and dark primary-action palette, including a deliberate hover state.
- Focus and selection accents follow the host accent palette.
- A stylesheet test guards the token mapping and the hover precedence.

**Non-Goals:**
- Fixed danger and status colors that do not adapt to dark appearance.
- Layout, interaction, workflow, or host style changes.
- A new board palette or a second theme block.

## Decisions

### 1. Use host primary-action tokens

Map `.kb-primary` to `--dsw-alias-button-primary-fill`, `--dsw-alias-label-primary-foreground`, and `--dsw-alias-button-primary-hover`; the border follows the fill and hover fill. This matches the host's own primary-button contract and the question panel's existing mapping.

Alternatives considered:

- *Keep `Highlight` and only add a primary hover rule*: fixes the unreadable hover but leaves the off-palette pale blue in both appearances.
- *Use `--dsw-alias-state-business-primary` as the fill*: introduces a second blue accent and requires a foreground that meets contrast in both appearances; it does not match the host's primary-action convention.
- *Override only under dark appearance*: produces two different button languages and does not fix the off-palette light appearance.

### 2. Pin the primary hover after the generic hover

Add an explicit `.kb-primary:hover:not(:disabled)` rule after the generic button hover. It ties the generic rule's (0,4,0) specificity and wins by source order, so no `!important` or specificity reduction is needed.

Alternative considered: lower the generic hover with `:where()`. It would stop the override, but the primary action would still have no hover shade, so an explicit primary hover is required anyway.

### 3. Map accents to host focus and accent tokens

- Focus rings use the host focus-ring chain: `var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))`.
- The selected-tab underline, drop indicator, and selected-card outline use `var(--dsw-alias-state-business-primary)`.
- The drawer resize hover uses `color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,transparent)`.

This removes the browser selection palette from every board accent and follows the same tokens the host uses for focus and brand emphasis.

### 4. No fallback palette for the primary fill

The plugin is host-bound and the question panel already depends on these tokens. If a host build omits them, `var()` is invalid at computed-value time: the fill becomes transparent, the foreground inherits, and the control still renders as a legible border-only button. A fallback to `CanvasText`/`Canvas` would reintroduce system colors and can mismatch the host appearance.

### 5. Test the stable contract at the stylesheet level

Extend the board style test to assert the primary tokens, the presence and order of the explicit primary hover rule, and the absence of `Highlight`/`HighlightText`. Contrast is verified in a browser because stylesheet strings cannot compute it.

## Risks / Trade-offs

- [Primary actions change in light appearance too] -> Intended: the host draws enabled primary actions as near-black in light and near-white in dark. Visual evidence is captured in both appearances.
- [`--dsw-focus-ring-color` can be transparent in some host contexts] -> Use the host's own fallback chain and verify keyboard focus visibility manually in both appearances.
- [A future host rename removes the fill] -> Degrades to a border-only control, and the stylesheet test fails on the token contract.
- [Stylesheet assertions can be brittle] -> Assert only stable contracts: token names, selector order, and absence of system selection colors.

## Migration Plan

No data migration. Rebuild the plugin, reconcile it in the existing GUI, and verify both appearances. Rollback is reverting the stylesheet and its test; no persisted state changes.

## Open Questions

None.
