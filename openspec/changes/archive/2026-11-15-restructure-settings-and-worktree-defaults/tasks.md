# Tasks

## 1. Project worktree policy in the domain and host

- [x] 1.1 Add the optional `worktreePolicy` field (`'ask' | 'always' | 'never'`) to the project input and
      the registered project record, defaulting to `ask` when absent; verify with a domain test that a
      project saved without the field reads back as `ask` and that an unknown value is rejected.
- [x] 1.2 Accept and validate the field in the remote command schema; verify a command carrying an
      unknown policy is rejected while a command omitting it still succeeds.
- [x] 1.3 Normalize the field in the domain project save so a save that omits it keeps the stored value and
      a rename, re-key, or relocation preserves it; verify with tests covering each of those three paths.
- [x] 1.4 Extend the shared worktree-decision helper with the policy so one call answers a project's
      `ask`/`always`/`never` and the existing decision helpers account for it; verify with unit tests
      for the three policies over a Git-backed task and a folder project.
- [x] 1.5 Make `planFirstExecution` return `create-default` for an interactive `Always create` task and
      `base` for a `Never` task, and make the automatic and cross-card paths use the base project under
      `Never`; verify with domain tests for both modes.
- [x] 1.6 Relax the host worktree-decision invariant for a `Never` project so its first conversation no
      longer requires a per-task dismissal; verify with a host test that creating the first conversation
      in a `Never` project succeeds without `worktree.dismiss`.
- [x] 1.7 Verify a `Never` first execution creates no branch, no worktree, and no per-task choice, with a
      host test asserting the task record is unchanged apart from its conversation.

## 2. Worktree policy in the client surfaces

- [x] 2.1 Extract the segmented control into one presentational component with keyboard behavior and an
      accessible name, and move the Git section's existing usage onto it; verify the Git section still
      switches modes through its tests.
- [x] 2.2 Add the three-state policy control to the project editor and carry the value through the project
      draft and input; verify the editor test saves each state and posts the expected input.
- [x] 2.3 Add the help text that explains each policy state in the editor; verify the rendered copy for the
      three states in a client test.
- [x] 2.4 Extend the execution-preparation gate and controller with the `create-default` plan, provisioning
      the derived defaults without asking; verify with controller tests.
- [x] 2.5 Implement the fallback that moves the preparation to the asking phase with the failure visible when
      an `Always create` destination cannot be derived; verify a controller test asserts the phase and the
      reported failure.
- [x] 2.6 Honor `Never` in the drawer: no missing-worktree notice and no withheld conversation start action;
      verify with a drawer test for a `Never` project.
- [x] 2.7 Honor `Always create` in the drawer notice, offering creation without the base-project choice;
      verify with a drawer test.
- [x] 2.8 State the project's policy in the drawer notice and in the Git section; verify both render the
      expected sentence per policy in client tests.

## 3. Modal layering and stable overlay geometry

- [x] 3.1 Give the shared modal an explicit layer that owns its z-index and Escape/backdrop dismissal while
      topmost, and mark lower layers inert; verify with a test opening two modals and asserting only the top
      one closes on Escape and that focus stays in it.
- [x] 3.2 Add the fixed-height size variant with an internal scroll region and one width per overlay; verify
      with a browser test measuring identical dialog height and width across two sections with different
      content length.
- [x] 3.3 Verify the board overlay keeps the wider width across all five sub-sections and that the top-level
      dialog keeps its single narrower width; assert both in the configuration-layout browser spec.
- [x] 3.4 Verify a narrow viewport keeps the fixed height and reduces the width to the available space; add
      the assertion to the configuration-layout browser spec.

## 4. Configuration sections, Boards section, and the board overlay

- [x] 4.1 Give each configuration section descriptor its own draft guard and discard action, and remove the
      section-name check from the shell; verify the shell test still asks before discarding a section draft
      and that the guard works for a second section that holds a draft.
- [x] 4.2 Replace the section row with General, Hub, Boards, Projects, Schedules, and Team Settings, keeping
      General first and as the default, and drop the Board section; verify the shell test asserts the exact
      section row and the absence of a board section.
- [x] 4.3 Build the Boards section: the list with Edit and Delete per row, the New board action reusing the
      existing creation dialog, and no rename or active-board action in the row; verify with client tests.
- [x] 4.4 Build the board overlay container that projects the target board with `boardView` and renders the
      existing board sub-sections, including a board that is not active; verify a client test edits a
      non-active board and asserts the command carries that board's ids.
- [x] 4.5 Preserve the board draft guards inside the overlay and close the overlay back to the list on
      demand; verify that closing with a dirty panel asks first and that the list reflects the saved change.
- [x] 4.6 Converge the row deletion and the overlay danger-zone deletion on one confirmation, including the
      installation-or-team choice for a published board; verify both entry points with client tests.
- [x] 4.7 Reduce the Hub section to identity plus a separated danger zone, removing the board list, the board
      creation form, and the board task counts; verify the Hub section tests and that Hub deletion keeps its
      eligibility rules.
- [x] 4.8 Update the hints that still point at the Board section, including the board creation dialog and the
      closed-for-creation form notice; verify no user-facing string mentions a Board section.

## 5. Board default model control

- [x] 5.1 Present the model mode as the segmented control with the native selector always rendered beneath it
      and disabled under the deployment default; verify the Defaults tests for both modes.
- [x] 5.2 Verify the Defaults panel keeps its height when the mode changes, in a browser test that measures
      the panel before and after the switch.
- [x] 5.3 Keep the existing stored-route, unavailable-selector, and unreadable-catalog behavior unchanged;
      verify the native-model-field and board-defaults suites still pass.

## 6. Team Settings sub-tabs and Connection panels

- [x] 6.1 Present Connection and Changes as sub-tabs with Connection opened by default, and hide Changes while
      the Hub has no binding; verify with client tests for a bound and an unbound Hub.
- [x] 6.2 Split the Connection area into a Status panel and a Management panel with the interval in
      Management, keeping the storage cards for an unbound Hub; verify the publishing browser spec still
      passes and that a bound Hub renders no storage card.
- [x] 6.3 Verify the storage cards stay visible while the Hub is unbound, including after selecting a
      storage, and return only through Disconnect once bound; assert both in the publishing browser spec.
- [x] 6.4 Improve the Changes row hierarchy without changing what it computes or which actions it offers;
      verify the changes tests and the publishing browser spec.

## 7. Documentation and evidence

- [x] 7.1 Update `docs/operations.md` where it names the Board section, describing the Boards section and the
      board overlay instead; verify no documentation names a Board configuration section.
- [x] 7.2 Capture evidence under `.verification/`: every configuration section, the Boards list with and
      without boards, all five board overlay sub-sections, both model modes, the three policy states in the
      project editor, Team Settings bound and unbound, in light and dark and at a narrow viewport.
- [x] 7.3 Confirm the archived `worktree-management` requirement no longer contains the truncation marker by
      re-reading the delta block and comparing it with the scenario it restores.

## 8. Gates

- [x] 8.1 Run `pnpm check` and confirm host and client typechecks, vitest, and the build pass.
- [x] 8.2 Run `pnpm test:browser` and confirm the plugin-owned Playwright harness passes, including the new
      geometry, overlay, model-control, and Team Settings assertions.
- [x] 8.3 Run the isolated real-composition lane with `node scripts/e2e-dsh.mjs --checkout <dsh-checkout>`
      for the board, project, and prepare checks, and confirm they pass.
- [x] 8.4 Run `openspec validate restructure-settings-and-worktree-defaults --strict` and confirm the change
      is valid.
