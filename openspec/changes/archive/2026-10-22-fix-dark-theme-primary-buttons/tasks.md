# Tasks

## 1. Primary action theming

- [x] 1.1 Map `.kb-primary` fill, foreground, and border to `--dsw-alias-button-primary-fill` and `--dsw-alias-label-primary-foreground`, and add an explicit `.kb-primary:hover:not(:disabled)` rule after the generic button hover that uses `--dsw-alias-button-primary-hover`; verify the stylesheet contains all three tokens, the primary hover rule follows the generic hover rule, and computed contrast is at least 4.5:1 at rest and on hover in both appearances.
- [x] 1.2 Replace every remaining browser `Highlight` accent (focus outlines, selected-tab underline, drop indicator, selected-card outline, drawer resize hover) with the host focus-ring and `--dsw-alias-state-business-primary` accent tokens; verify `grep -n 'Highlight' src/client/styles.ts` returns no matches.

## 2. Regression coverage

- [x] 2.1 Add stylesheet assertions for the primary tokens, the primary hover rule order, and the absence of `Highlight`/`HighlightText`; verify `pnpm vitest run tests/client/board.test.tsx` passes.
- [x] 2.2 Run `pnpm run check` and verify typechecks, the full test suite, and the build all succeed.

## 3. Existing-GUI verification

- [x] 3.1 Rebuild with `pnpm run build`, reconcile the plugin through the supported native operation, refresh the existing GUI, and verify every primary action at rest and on hover in light and dark (New task, Configure projects, Create task, Save task, Save project, Save workflow, Save note, Move and run, Create worktree, Attach worktree); capture screenshots under `.verification/`.
- [x] 3.2 Verify keyboard focus rings, the selected-tab underline, the selected-card outline, the drop indicator, and the drawer resize hover in both appearances; capture screenshots under `.verification/`.
- [x] 3.3 Run `openspec validate fix-dark-theme-primary-buttons --strict` and verify it passes.
