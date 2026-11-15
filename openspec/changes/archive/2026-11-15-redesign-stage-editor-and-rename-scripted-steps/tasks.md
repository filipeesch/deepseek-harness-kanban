# Tasks

## 1. Specification vocabulary

- [x] 1.1 Rename the capability directory `openspec/specs/deterministic-steps` to `openspec/specs/scripted-steps` with `git mv`, and update its title and Purpose; verify `openspec list --specs` reports `scripted-steps` with 31 requirements and `openspec validate --specs` passes
- [x] 1.2 Rename the requirement header `Deterministic stage definition` to `Scripted stage definition` and the scenario labels `Create in a deterministic initial stage` and `Chain two deterministic stages` in `scripted-steps`; verify the three headers read the new spelling and are exactly the names the change's delta uses
- [x] 1.3 Replace the product term with "scripted" in the prose of every other specification that names it, keeping the legacy `deterministic:` key mentions that describe compatibility; verify `grep -ri deterministic openspec/specs` returns only those compatibility mentions and the two `stage-editing` scenario labels recorded as an open question
- [x] 1.4 Update the cross-references that point at the capability by name in `stage-editing`, `task-conversations` and `kanban-board`, and in the README; verify no reference names the old capability identifier

## 2. Domain workflow key

- [x] 2.1 Accept the authored `scripted:` and `deterministic:` keys in the workflow parser and reject a stage that authors both, with a diagnostic naming both keys; verify domain tests cover a legacy document, a new document and the conflicting one
- [x] 2.2 Emit `scripted:` for the stage a write touches and preserve the authored spelling of every stage it does not name; verify a test loads a legacy document, writes one stage's name, and asserts exactly one key changed
- [x] 2.3 Accept both spellings in the YAML diagnostics and in the field-scoped edit vocabulary, so neither reports a false problem for a legacy document; verify the diagnostics test and an `edit_board_yaml` call scoped to the legacy field name both pass
- [x] 2.4 Assert that canonical equality and the executable fingerprint are unchanged by the key spelling; verify a test resolves the same program authored under both keys and gets the same fingerprint

## 3. Approval rule and origin

- [x] 3.1 Extend the approval record with its origin (author save or explicit review) and the moment it was recorded, and read a record without an origin as an explicit review; verify tests cover a new record of each origin and a legacy record
- [x] 3.2 Decide the author-save case in the `board.stage.update` command handler: after a successful write, approve the resolved version only when the write changed the stage's scripted definition, the source is inline, and the command came from the stage editor; verify a host test approves from the editor command and records the origin
- [x] 3.3 Verify that a tool write, an accepted shared update, a publish and a board restore record no approval, with the restored stage returning to pending review
- [x] 3.4 Wake the entries waiting on the replaced version after an automatic approval, and verify a waiting card starts without a second approval
- [x] 3.5 Present the recorded origin wherever the stage reports its approved state, including the editor's Approval tab, the waiting card and the board queue; verify client tests assert the origin text for both origins

## 4. Stage editor shell

- [x] 4.1 Add the `stage` dialog size with a wide, fixed height, a non-scrolling tab row and a non-scrolling action footer, and verify a browser test measures the same dialog box on the smallest and largest tab
- [x] 4.2 Keep every tab panel mounted and hidden rather than unmounted, and verify a browser test edits the program, switches tabs twice, returns, and still finds the caret, undo history and draft intact
- [x] 4.3 Build the tab shell with one descriptor per tab owning its own fields, and verify the existing stage-editing browser suite still passes with the fields reached through their tab
- [x] 4.4 Present only the tabs the stage has content for, and verify a browser test counts three tabs for an agent stage and five for a scripted one
- [x] 4.5 Take the opening tab from the surface that opens the editor, falling back to Stage when the requested tab is unavailable, and verify the stage header, the diagram connection and the card script panel each open their own tab
- [x] 4.6 Extract the stored-version query and the post-save notice out of the dialog, and verify the client tests for both entry flows pass against the extracted units

## 5. Program surface

- [x] 5.1 Move the Bash and TypeScript language mapping into one module shared by the read-only review and the editable program, and verify the review browser test still renders highlighted source
- [x] 5.2 Render the program in an editable code surface with line numbers, search, bracket matching, a `Mod-s` binding to the editor save and a resizable container, and verify a browser test types into it, saves with the keyboard, and sees the stored program change
- [x] 5.3 Keep an external file source expressed as a path field with no code surface, and verify a browser test that switches the source form shows one and not the other

## 6. Validation across tabs

- [x] 6.1 Collapse the two problem taxonomies into one problem type carrying its field, with one inline renderer used for every field; verify client tests present each existing problem through the single renderer
- [x] 6.2 Add an optional per-tab state to `Tabs` that a tab can use to announce it holds a problem, and verify an accessibility assertion reads that state from the tab
- [x] 6.3 Select the first tab, in order, that holds a problem when a save is refused, and verify a browser test starts on a valid tab, saves, and lands on the tab with the problem

## 7. Execution token

- [x] 7.1 Write `DSH_SCRIPTED_RUN` for new executions while the guard still sweeps `DSH_DETERMINISTIC_RUN` for one release, and verify the guard test proves cleanup for a process carrying either token

## 8. Rename

- [x] 8.1 Rename the `deterministic-*` modules and their imports to `scripted-*`, and verify `pnpm run typecheck` and `pnpm run build` succeed
- [x] 8.2 Rename the remaining identifiers, types, client commands and host ports that carry the term, and verify `pnpm test` passes with no test edited to accommodate a rename alone
- [x] 8.3 Replace every user-visible string that names the capability, including the execution-mode options, the review dialog, the approval queue, the script panel, the activity dot and the tool descriptions; verify a browser assertion finds no user-visible occurrence of the old term on the board, the drawer and the editor
- [x] 8.4 Rename the documentation page and update the README and the three preset references, and verify every changed link resolves and the preset stays under its size ceilings

## 9. Verification

- [x] 9.1 Run `pnpm check` and verify the host and client typechecks, the unit suite and the build all pass
- [x] 9.2 Run `pnpm test:browser` and verify the adapted stage-editing, deterministic and workflow suites pass in both host themes
- [x] 9.3 Update the real-composition templates and fixtures to author `scripted:`, keep one fixture on the legacy key, and verify the deterministic lane passes in replay mode
- [x] 9.4 Run `openspec validate --specs` and confirm the capability rename landed before archiving this change