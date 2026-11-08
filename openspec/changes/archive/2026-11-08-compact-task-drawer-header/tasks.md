# Tasks

## 1. Packaging and dependency

- [x] 1.1 Add `lucide-react` at the exact version `1.70.0` to `dependencies` in `package.json` and update the lockfile; verify `pnpm install` completes and `pnpm build` succeeds.
- [x] 1.2 Add `THIRD-PARTY-NOTICES.md` with the ISC notice for `lucide-react` and list it in the `files` array; verify `npm pack --dry-run --json` includes the file.
- [x] 1.3 Bump `version` in `package.json` for the published artifact; verify `node -p "require('./package.json').version"` reports the new version and `pnpm build` succeeds.

## 2. Domain

- [x] 2.1 Add `nextStage(workflow, fromColumnId)` to `src/domain/transitions.ts` returning the following `TransitionDestination` in workflow order or `undefined` in the last stage; verify `pnpm exec vitest run tests/domain/transitions.test.ts` covers a middle stage, the last stage, and an unknown source.

## 3. Icons

- [x] 3.1 Convert `src/client/icons.tsx` into an adapter over `lucide-react` with a shared wrapper for default size 16, stroke width 2, `aria-hidden`, and `focusable={false}`, preserving every existing export name; verify `pnpm typecheck` passes and the affected client tests still run.
- [x] 3.2 Map the sixteen existing glyphs to Lucide equivalents, keeping the `Play` fill through `fill="currentColor"`; verify the board, drawer, dialogs, Git, and Notes surfaces render their icons in the browser harness.
- [x] 3.3 Add `MessageIcon` (`MessagesSquare`), `NoteIcon` (`NotebookPen`), and `AdvanceStageIcon` (`ChevronsRight`) while the auto-mode icon keeps the double chevron; verify `pnpm typecheck` and a harness screenshot shows the three new glyphs.
- [x] 3.4 Confirm no component still imports a hand-written SVG path or the removed internal helpers; verify with a repository search limited to `src/client` and `pnpm typecheck`.

## 4. Header composition

- [x] 4.1 Add an `IconTabs` primitive (items with id, label, and icon) that keeps the current roving tabindex and arrow-key behavior and exposes the label as both `aria-label` and `title`; verify unit tests cover the accessible names, tooltips, and keyboard navigation.
- [x] 4.2 Add `DrawerTitle` with the one-line title, ellipsis, title tooltip, and inline project chip; verify unit tests cover a long title, a missing project fallback, and the absence of a second header line.
- [x] 4.3 Add `DrawerStageControl` with the stage select and the next-stage action; verify unit tests cover the action calling `onMove` with `nextStage`, being hidden in the last stage, disabled while blocked, and naming a restricted destination.
- [x] 4.4 Add `DrawerActions` composed of the shared auto-mode control, delete, and close; verify unit tests cover each callback and the disabled states.
- [x] 4.5 Add `DrawerHeader` and `drawer-header-styles.ts` implementing the wide one-row layout and the narrow two-row layout through a container query on `.kb-drawer`; verify a browser test at 1000px, 620px, and 420px checks the row count, the absence of hidden controls, and title ellipsis.
- [x] 4.6 Switch `TaskDrawer` to render `DrawerHeader` and delete the old inline header and toolbar JSX while keeping width, leases, worktree draft, section, and move ownership in the drawer; verify `pnpm exec vitest run tests/client/board.test.tsx tests/client/drawer-conversations.test.tsx` passes.

## 5. Activity indicator

- [x] 5.1 Add `ActivityDot` that pulses for agent execution or background activity, reuses the existing background copy helpers for its accessible name and tooltip, and adds no live region; verify unit tests cover running, background-only, both, and settled states.
- [x] 5.2 Wire the dot into the Conversations tab name and tooltip and remove `TaskActivity` and the header execution line; verify `pnpm exec vitest run tests/client/activity.test.tsx` reflects the new behavior.
- [x] 5.3 Remove the drawer-only execution styles (`kb-execution-drawer` and the Working line selectors); verify the browser running-status spec checks the dot on the Conversations tab instead of header text.

## 6. Auto mode

- [x] 6.1 Merge `CardAutoModeControl` and `DrawerAutoModeToggle` into one `AutoModeControl` with card and header variants, and include the state sentence in the control's `title` and `aria-label`; verify unit tests cover off, armed, advancing, held, paused, and failed states.
- [x] 6.2 Remove `AutoModeNotice` and the `kb-drawer-automode` and `kb-drawer-auto` styles; verify `pnpm exec vitest run tests/client/auto-mode.test.tsx` and the browser auto-mode spec assert the state through the chip.
- [x] 6.3 Check that an admitted or failed advance is still presented through the task transition status above the panel; verify the auto-mode browser spec covers the admitted and failed cases without a separate notice.

## 7. Worktree notice

- [x] 7.1 Replace the missing-worktree card with one compact line that shows the derived branch and destination, exposes the source branch in the tooltip, and keeps the create, review-in-Git, and continue actions inline; verify the browser worktree-notice spec covers create, dismiss, and no-destination states.
- [x] 7.2 Keep suggestion and action failures as compact notices without adding a card layout; verify the failure states keep their role, message, and retry path.

## 8. Styles and cleanup

- [x] 8.1 Remove the obsolete header, section-toolbar, activity, and auto-mode selectors from `styles.ts` and concatenate the new header style module; verify `pnpm exec vitest run tests/client/styles.test.ts` and `pnpm build` pass.
- [x] 8.2 Verify the header in light and dark appearances at 1000px, 620px, and 420px, including focus rings, contrast, and the selected section state; capture screenshots under `.verification/`.

## 9. Documentation

- [x] 9.1 Update `README.md` to describe the compact header, icon-only sections, activity dot, auto-mode chip, next-stage action, and compact worktree notice; verify the changed paragraphs match the implemented behavior.
- [x] 9.2 Update `docs/operations.md` where it describes the drawer header, the auto-mode surfaces, and the pause presentation; verify the text matches the implemented behavior.

## 10. Verification

- [x] 10.1 Run `pnpm check` and confirm host and client typechecks, vitest, and the build pass.
- [x] 10.2 Run `pnpm test:browser` and confirm the new header, activity, auto-mode, and worktree specs pass in both appearances.
- [x] 10.3 Update the e2e templates that referenced the removed auto-mode notice and run the isolated lane: `--only native-drawer` passed 2/2; `--only auto-mode` fails at the advance assertion identically on the untouched base commit 90569d9 against the available `dsh-v0.2.2-rc.1-850` checkout, recorded as environment drift rather than a change regression.
- [x] 10.4 Run `openspec validate "compact-task-drawer-header" --json` and confirm the change is valid, then review the final diff for unrelated changes.
