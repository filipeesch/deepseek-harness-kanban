# Tasks

## 1. Task Drawer Header

- [x] 1.1 Harmonize the advance, Auto, delete, and close icon dimensions, target alignment, and adjacent spacing using local header styles; verify browser geometry in wide and narrow drawers, including no overflow.
- [x] 1.2 Preserve Auto text, state, tooltips, accessible names, keyboard controls, and existing callbacks; verify the drawer component tests and keyboard-focused browser checks.

## 2. Workflow Stage Editing

- [x] 2.1 Gate the diagram stage-edit action on the existing layout lock at the presentation boundary; verify the action is absent initially and after relock, present and usable after unlock, and remains present in the column board.
- [x] 2.2 Remove obsolete lock-specific disabled props, tooltip, and guards where unused; verify stage editor opening, keyboard focus handling, and pointer isolation do not initiate drag or persist layout changes.
- [x] 2.3 Update existing stage-edit and workflow tests to distinguish exact Lock and Unlock labels and cover lock transitions, keyboard interaction, and unchanged column behavior.

## 3. Verification and Release Metadata

- [x] 3.1 Bump the package version for the installed artifact and verify the manifest reflects the new version.
- [x] 3.2 Run `pnpm check` and `pnpm test:browser`; inspect isolated browser screenshots at supported wide and narrow widths in light and dark themes and record any failures.
- [x] 3.3 Validate the OpenSpec change and confirm the affected requirement deltas replace the contradictory locked-state scenarios without losing existing requirements.
