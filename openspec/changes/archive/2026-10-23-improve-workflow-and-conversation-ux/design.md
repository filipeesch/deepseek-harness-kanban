# Design

## Context

This is a single host/client DSH plugin. The client is bundled by esbuild into one browser module loaded through `window.__ModuleLoader__`; React is external and there is no worker runtime of its own. The host owns Git, native sessions, storage, and the question projection; the client renders the board, task drawer, and question strip. See [proposal.md](proposal.md) for motivation and the three spec deltas for the behavior contract.

Relevant current constraints:

- Workflow YAML is stored verbatim and validated host-side by `parseWorkflow`, which uses the `yaml` package and rejects unsupported fields. The Workflow tab is currently an 18-row textarea in a 680px Configuration modal.
- Worktree defaults already come from `worktreeDefault()` on the host; the source branch already falls back to `project.defaultBranch ?? 'HEAD'` in the Git adapter. The client Git form is stricter than the host and the notice currently only switches tabs.
- The board renders grouped workflow columns inside one vertical slot. Each column currently uses `flex:1`, so a multi-column group splits its stretched height equally instead of respecting card content.
- The task drawer is mounted only while a task is selected. All close paths currently clear the selection immediately.
- Question rounds are projected from native session events, not stored as rounds. `QuestionIndex` derives rounds from stored projection events plus transcript replay; `QuestionStore` persists one record per conversation. A bare deletion would be recreated by replay.
- The `decision_request` tool description already promises that users can close the form and answer in chat; the UI has no explicit dismissal.

## Goals / Non-Goals

**Goals:**

- Deliver the three spec deltas with one coherent client/host seam per concern.
- Reuse the existing workflow parser and host worktree defaults so the UI does not invent separate semantics.
- Keep the new editor, worktree draft logic, notice, and question dismissal independently testable and reusable.
- Define a layered verification strategy that keeps fast feedback on pull requests and reserves the real DSH composition for a manual pre-release gate.
- Keep persistence backward compatible with existing board and question records.
- Preserve the plugin's public extension boundary: no replacement server, native engine change, or new approval/decision system.

**Non-Goals:**

- Extending the rich editor to task descriptions, notes, or question answers.
- Adding a YAML formatter, linter rule set, or schema editor UI.
- Changing the workflow parser's supported fields or adding WIP limits.
- Changing Git worktree coordination, permission checks, or conversation-directory switching.
- Running the pinned DSH real-composition e2e on every pull request; it is a manual pre-release gate.
- Adding aria goldens or a coverage threshold for this change.
- Creating a separate testing-only OpenSpec change; verification belongs to this change.
- Minifying the client bundle in this change.

## Decisions

### Editor technology: CodeMirror 6

Use CodeMirror 6 instead of Monaco or an enhanced textarea.

- CodeMirror is DOM-based, tree-shakeable, has no worker requirement, and supports YAML through `@codemirror/lang-yaml`/Lezer. It fits the single-module browser bundle.
- Monaco would add multi-megabyte assets and worker URL/CSP problems in this loader.
- A textarea cannot provide syntax highlighting, folding, positioned diagnostics, or search with the requested quality.

Pin exact package versions in the repo's existing style: `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-yaml`, `@codemirror/lint`, `@codemirror/search`, and `@lezer/highlight`. Use a curated extension set rather than the full basic-setup meta package: line numbers, active-line gutter/highlight, history, bracket matching, fold gutter, search, YAML language, lint, line wrapping, default/history/search/fold keymaps, indent-with-tab, and a `Mod-s` binding for the form's save action. The editor theme and syntax colors are defined with host CSS variables and `color-mix` so dark and light appearance follow the host. The editor is controlled by React but the CodeMirror view is created once per mount; external value changes are dispatched only when they differ from the current document.

### Editor module seams

- `src/client/code-editor.tsx` — generic controlled CodeMirror wrapper. Props: `value`, `onChange`, `label`, `readOnly`/`disabled`, `diagnostics`, `onSaveShortcut`, `describedBy`, and sizing class hooks. Owns view lifecycle, theme, diagnostics dispatch, and accessibility attributes.
- `src/client/workflow-diagnostics.ts` — pure analysis: parse with `parseDocument` for syntax errors and line/column positions, then run the shared `parseWorkflow` for schema acceptance. Returns a stable analysis object with syntax diagnostics, schema issues, and the parsed workflow when valid.
- `src/client/workflow-editor.tsx` — Workflow form: draft, debounced analysis, status summary, Save/Reload, shortcuts, and dirty reporting. It receives the draft and its setter from Configuration so tab switches do not unmount the text.

Keep `forms.tsx` as the composition point for Configuration and the other editors. This is the selected refactor boundary; the remaining sections are not split in this change.

### Workflow validation and draft lifetime

- Validate locally with a ~250 ms debounce. While a new analysis is pending, Save is disabled along with the invalid state. Use the same `parseWorkflow` semantics the host uses, so a locally valid document is not rejected for a client-only rule.
- Syntax diagnostics use exact document positions from the `yaml` parser. Schema failures do not currently expose node paths; show them at the document start and in an issue summary below the editor. Keep host errors (orphaned column, revision conflict) in the existing error surface after Save.
- Host save remains authoritative; no replacement of the last valid workflow on failure.
- Lift the draft to `Configuration` and track dirty by comparing it with the last saved `workflowYaml`/revision. Switching tabs preserves it. Closing the dialog or activating Reload while dirty opens an inline confirmation; cancel keeps the draft and the dialog. Use an inline confirmation rather than a nested modal to avoid a second focus trap.
- Pass a `size` prop through `Modal` so Workflow can request a wide dialog (~1100px) while other sections keep the current width. The editor starts around 55vh, supports vertical resize, and has a maximize toggle. Actions remain in a sticky footer.
- Fix `Modal` for the editor: include `[contenteditable="true"]` in the focusable query and ignore keyboard events where `defaultPrevented` is already true. This prevents the focus trap or Escape handler from stealing CodeMirror's Tab and search interactions.

Alternative considered: a dedicated full-page workflow editor. Rejected as a larger navigation/lifecycle change; the wide modal preserves the established Configuration entry point.

### Shared worktree draft and one-click notice

- Move the default/suggestion logic out of `git.tsx` into `src/client/worktree-draft.ts`:
  - pure derivation of the title slug, base-path join, trimming, and command normalization;
  - validation that matches the host (a new branch needs a branch and path; source may be omitted);
  - `useWorktreeDraft({ api, task, project, basePath, enabled })` returning the draft, touched flags, suggestion state, error, reload, field setters, reset, and a `refreshSuggestion()` promise.
- Mount the hook once per open drawer (`TaskDrawer`) and pass the same draft to the new `WorktreeNotice` and the Git panel. This removes the duplicate effects and keeps the notice and Git form consistent. Git-only concerns (branches, attach, remove, confirmations) stay in `git.tsx`.
- `WorktreeNotice` shows the derived branch, destination, and source (project default or `HEAD`) and offers Create, Review in Git, and Dismiss. Create uses the displayed draft; when the draft is untouched it first refreshes the host suggestion to avoid stale collisions; when the user edited the draft it uses those values without silently renaming them.
- If no base path is configured, Create routes to the Git section with a destination-required message rather than calling create with an empty path. Git errors stay inline in the notice with a review path and retry.
- The create command includes `sourceBranch` only when the project defines one; otherwise the host uses HEAD. The Git form's source field is no longer required for new branches and displays the effective fallback.
- The notice is disabled while a context operation or pending transition blocks worktree creation. The existing conversation-switch flow, idle waiting, and operation journal stay unchanged.

Alternative considered: fetch defaults only when Create is clicked. Rejected because the notice needs a preview and users should see what will be created. Refreshing on creation preserves collision safety.

### Content-height columns

Change `.kb-column` from `flex:1` to `flex:0 0 auto`. The column's content defines its height inside a grouped slot; cards are no longer clipped and the board page's existing vertical scroll handles overflow. Do not introduce a column-level scroll container. Column slots may still stretch at the row level, but the visible column surface ends at its content, which matches the selected content-only behavior. This is a CSS-only change with no board data or layout algorithm change.

### Drawer open and close animation

- Add `data-entering` and `data-closing` states to the drawer element and CSS keyframes for a subtle slide+fade (24px, ~180 ms) and its symmetric exit.
- Track `entering` and `closing` in `BoardView`. `openTask(id)` sets entering only when no drawer was open; switching cards while open does not replay. All close paths (header button, Escape, board-background click) call `requestCloseDrawer`.
- Keep the drawer mounted through the exit: set `closing`, wait ~180 ms, then clear the selection. Clear the timer on unmount, on a new open, or if the task disappears. A reopen during exit cancels the timer and keeps the drawer available. If reduced motion is preferred, finalize immediately and let CSS disable the keyframes.
- During exit, set `pointer-events:none` on the drawer and preserve the existing focus restoration. Do not animate layout properties and do not use `animation-fill-mode` on the entrance so transforms do not persist after opening.

Alternative considered: animate only opening. Rejected by the user's decision for a symmetric close; the delayed-unmount state is small and contained in BoardView.

### Question dismissal: UI and client state

- Add an optional `onDismiss` prop to `QuestionForm`; hide the control when absent so direct component consumers remain valid.
- Replace the footer's single right-aligned action row with a leading Dismiss button and a trailing Back/Next/Submit group. The footer is only visible when the panel is expanded, which is consistent with the chosen footer placement.
- Dismissal is disabled while submitting/submitted and while a dismissal is in flight. When no draft exists, call `onDismiss` immediately. When any choice, free text, Other text, per-answer notes, or Additional Notes exist, replace the footer with an inline confirmation and focus the non-destructive action; confirming calls `onDismiss`, canceling restores the footer.
- The Dock in `client.tsx` passes `onDismiss` and calls `ClientBridge.dismissQuestions(sessionId, roundId)`; dismissal sends no native message and does not call `assertSubmissionAllowed`.
- The bridge keeps a local dismissed-round set, calls the new remote method, applies the returned remaining rounds for the session, filters any in-flight `prepareQuestions` merge or stale snapshot by the dismissed set, and publishes. The strip then unmounts because the Dock filters out answered/dismissed rounds.

### Question dismissal: host and persistence

- Extend `QuestionSessionRecord`/snapshot data with optional `dismissedTurns: number[]` (sorted unique). Keep version 1; older records remain valid. Extend the storage schema with the optional field.
- `QuestionIndex` tracks dismissed turns per session. `buildRounds` excludes those turns. `getRounds`/`pending` therefore never expose a dismissed round; the awaiting-reply attention clears through the existing `pending()` check.
- Add `QuestionIndex.dismiss(sessionId, roundIds)`; resolve each displayed round to its turn, mark the turns, rebuild once, and emit. `serializeSession`/`serialize` include the dismissed turns and prune page events for dismissed turns:
  - `native-page` events carry their turn directly.
  - `ptc-page` events resolve their turn through the root call event when available; if not resolvable, retain the event and rely on the marker.
  - Keep call, turn-end, and human events so answered/settlement derivation for other rounds is unchanged.
- Add `App.dismissQuestions(sessionId, roundId)`: prepare the session, validate that the trigger round is unresolved, collect every unresolved round in that session, dismiss their turns, persist immediately, and return the remaining rounds. No board command, chat message, or native approval is created.
- Add an owner-only `kanban/dismissQuestions` remote method and `KanbanRemote` typing; return the remaining `QuestionRound[]` outcome. Update the controller and the tool description (`decision_request` already says the form is optional) to keep documentation aligned.
- The native transcript is never modified. A dismissed turn stays dismissed through replay because the marker is restored before transcript events are re-applied; later pages for that turn are filtered out.

Alternative considered: deleting the stored session record or all projection events. Rejected because it would remove unrelated rounds and because replay could recreate the dismissed round without a marker. Pruning only page payloads plus the marker satisfies the deletion intent while preserving derivation.

### Data and dependency compatibility

- No board schema version change is expected; the three spec deltas change presentation and one question-session optional field.
- Existing question records without `dismissedTurns` load unchanged. New records are readable by this and later code that knows the optional field. A rollback to a pre-change plugin version whose strict record schema rejects unknown fields requires removing `dismissedTurns` or restoring a compatible version first; forward compatibility with older strict schemas is not claimed.
- CodeMirror packages are runtime client dependencies, MIT, and browser-only. The host bundle is unaffected because the client build is separate.

### Verification approach

Use four layers instead of one end-to-end suite:

1. **Node/in-memory unit tests** for pure or storage-backed modules: workflow diagnostics, worktree draft derivation, question projection/dismissal/pruning, host dismissal, and bridge filtering. These are the cheapest and cover the most edge cases.
2. **jsdom component tests** for React behavior and state machines: `WorkflowEditor` with a mocked `CodeEditor`, Configuration draft/close handling, Modal focus, worktree notice, drawer timers/reduced motion, question footer/draft confirmation, and Dock wiring.
3. **A plugin-owned Playwright browser harness** for what jsdom cannot compute: real CSS layout, real CodeMirror, CSS keyframes, and reduced-motion behavior. It renders the actual client components with a fake API, requires no DSH host, and runs as a separate `pnpm test:browser` command. It is intentionally not added to `pnpm check` so the default check stays portable.
4. **Two plugin-owned real-composition scenarios** driven through DSH's web e2e lane, run manually before release against a pinned `dsh-v0.2.1-rc.2` checkout. They cover the real plugin bundle, profile, native sessions, real Git, persistence, and the actual web shell.

CodeMirror is not supported under jsdom by its maintainers; geometry polyfills are not a stable contract. Mocking the generic `CodeEditor` in component tests keeps form/validation tests fast and deterministic while the browser harness and DSH lane exercise the real editor.

Alternatives considered:

- **All tests in jsdom**, including CodeMirror and layout. Rejected: jsdom reports zero layout and CodeMirror explicitly does not support its view there.
- **A DSH-side test only.** Rejected as the default because the scenario would not be versioned with the plugin; the plugin-owned template + pinned runner keeps the test with the change. A future reusable DSH test-support package remains the long-term clean path.
- **Aria goldens at the DSH layer.** Rejected for this new UI because copy/layout churn would dominate review; semantic and geometry assertions were chosen instead.
- **Running the DSH lane on every PR.** Rejected because the lane builds DSH and the web dist; the fast layers stay on PRs and the DSH lane gates releases manually.

## Verification Strategy

### Fast layers

- `tests/client/workflow-diagnostics.test.ts` — valid/syntax/schema cases, positions, host-only local-valid case, comments preserved.
- `tests/client/worktree-draft.test.ts` — derivation, collisions, touched-field synchronization, source fallback, exact command normalization.
- `tests/questions/indexer.test.ts` — dismiss one/all, `pending`, serialize/restore, late native/PTC pages, page pruning with call/end/human retained.
- `tests/host/questions-persistence.test.ts` — dismiss-all persistence, reload, unknown/answered rejection, no native send/archive.
- `tests/bridge/bridge.test.ts` — remote call, local removal, in-flight merge fencing, stale snapshots, errors.
- `tests/client/workflow-editor.test.tsx` — mocked `CodeEditor`, Save gating, debounce, save failure, reload confirmation.
- `tests/client/` Configuration/Modal and drawer-animation tests — draft across tabs, close/Escape/backdrop confirmation, contenteditable focus, fake-timer exit/replay/reduced motion.
- `tests/client/worktree-notice.test.tsx` — preview, exact quick-create command, untouched refresh, edited-draft authority, no-base-path fallback, inline error.
- `tests/questions/QuestionForm.test.tsx` and `tests/bridge/plugin.test.tsx` — footer-left dismissal, draft confirmation, no native message, future round.
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check`.

### Browser harness

- `tests/browser/` contains the harness entry, a non-vitest fake `ClientApi`, `playwright.config.ts`, and `*.spec.ts` scenarios.
- esbuild builds the harness page; no DSH auth or native services are involved.
- Scenarios: grouped-column geometry and page scroll; real CodeMirror rendering/typing/diagnostics/`Mod-s`/maximize; drawer keyframes and reduced motion; worktree notice Create.
- Command: `pnpm test:browser`; kept separate from `pnpm check`.

### DSH real-composition e2e

- `tests/e2e-dsh/kanban-board-ux.e2e.template.ts` and `kanban-conversation-ux.e2e.template.ts` are plugin-owned templates excluded from the plugin typecheck.
- `tests/e2e-dsh/question-round.jsonl` is a canonical session fixture with one `decision_request` page; the test seeds it through `seedSession` and never calls a model.
- `scripts/e2e-dsh.mjs`:
  1. validates `DSH_CHECKOUT` at `dsh-v0.2.1-rc.2`;
  2. builds the plugin;
  3. verifies the DSH checkout is installed and has the built web dist;
  4. copies the templates into `$DSH_CHECKOUT/apps/web/tests/`;
  5. runs `DSH_SNAPSHOT=replay pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/kanban-*.e2e.ts`;
  6. removes the copied files in `finally`.
- Each template launches `launchWebScaffold({ profile: { packages: [{ dir: process.env.KANBAN_ROOT!, enabled: true }] } })` and drives `scaffold.authenticatedUrl` with Playwright.
- Board scenario: real CodeMirror workflow edit and save, grouped-column geometry/scroll, drawer entrance/exit/reduced motion.
- Conversation scenario: real temp Git repository, project/base path/task through the UI, notice quick-create with real worktree/branch/cwd, seeded question-round dismissal, reload persistence, and a normal chat reply.
- Assertions are semantic and geometric; no aria goldens.
- Cadence: manual before release; record the run and pinned DSH version in the release evidence.

## Risks / Trade-offs

- **CodeMirror grows the client bundle by roughly 0.5–1 MB unminified** → Accept for the requested editor quality; the client bundle is already unminified, and minification was explicitly left out. Measure the built bundle during implementation and revisit minification separately if needed.
- **CodeMirror and the modal focus trap can fight over Tab/Escape** → Include contenteditable in the focusable set, respect `defaultPrevented`, and verify Tab, search, Escape, and focus restoration together.
- **Schema diagnostics have no document positions** → Show positioned syntax diagnostics and a schema summary; keep host errors authoritative. A path-aware parser API is a later improvement, not required for this change.
- **Client validation could drift from host validation** → Reuse `parseWorkflow` rather than reimplementing schema rules; the host stays the final gate.
- **Draft confirmation adds an extra close path** → Centralize close handling in Configuration's `onClose` interceptor and reuse the same inline confirmation for close and Reload.
- **Quick create can race with another task or user Git work** → Refresh the host suggestion immediately before creating when the draft is untouched; surface Git errors instead of retrying with silently changed values.
- **The notice and Git form could disagree after edits** → One shared draft hook mounted at the drawer level; the Git form and notice read the same values.
- **Content-only columns change the board's aligned look** → Chosen behavior; the spec scenario explicitly requires short columns to end at their own content, and the page scrolls rather than clipping.
- **Delayed drawer unmount can conflict with task updates or deletion** → Centralize the timer in BoardView, cancel on unmount/new selection/task disappearance, and finalize immediately for reduced motion.
- **Pruning PTC page events needs root-call resolution** → Keep the event when the root turn cannot be resolved; the dismissed-turn marker still hides the round. Never prune call/end/human events.
- **Dismiss-all can discard older hidden rounds** → Chosen so the strip actually closes; future rounds are unaffected, and the confirmation covers any current draft.
- **Existing tests assume a textarea, two footer actions, immediate drawer close, and no dismiss control** → Update them alongside the implementation tasks; the fast suite must pass before the manual DSH gate.
- **CodeMirror is not supported under jsdom** → Mock `CodeEditor` in component tests and exercise the real editor only in the browser harness and DSH scenarios.
- **The DSH scaffold is local to its test tree, not a public test-support package** → Keep the templates plugin-owned and copy them into a pinned rc.2 checkout with a fail-loud tag/layout check and `finally` cleanup. A reusable DSH package is the long-term follow-up.
- **The manual pre-release cadence can be skipped** → Make the DSH run an explicit release-checklist item and record its scenario results and pinned DSH version.
- **The DSH web composition is not the Electron desktop renderer** → Document the limitation: it qualifies the plugin in the real web shell, not native desktop packaging.
- **The browser harness fake API can drift from `ClientApi`** → Reuse a pure fixture where practical and assert exact command shapes; typecheck the harness.
- **No aria goldens means broad copy/layout changes may slip** → Chosen trade-off; semantic labels, durable state, geometry, and animation presence cover the required behavior without golden churn.

## Migration Plan

1. Add the pinned CodeMirror dependencies and install them with the repo's pnpm version; do not change the package manager.
2. Implement the host question-dismissal model and remote method, then the client bridge and strip UI, so the persistence contract is available before UI wiring.
3. Extract the worktree draft hook and notice, then switch the notice to one-click creation and align the Git form's source validation.
4. Add the workflow editor modules and Configuration draft/close handling, then the modal focus/size support.
5. Apply the column CSS, drawer animation state/CSS, and styles.
6. Add fast unit and component tests alongside each implementation seam, then the browser harness and DSH e2e templates/runner.
7. Update README/operations/question notes and the release checklist, then run `pnpm typecheck`, `pnpm test`, `pnpm test:browser`, `pnpm build`, and `pnpm check`.
8. Run the pinned DSH real-composition e2e manually before release and record the results.
9. No data migration is required. No board data is rewritten. A rollback to a pre-change plugin version may reject records that contain `dismissedTurns` because the older record schema is strict; remove the field or restore a compatible version before rollback. The field remaining optional preserves compatibility with existing records.

## Open Questions

- Exact CodeMirror package patch versions and the measured client-bundle delta are implementation-time checks; they do not change the approach or specs.
- Whether schema diagnostics should eventually expose node paths is a future parser improvement; the summary fallback is sufficient for this change.
- The reload confirmation for a dirty workflow draft is treated as the same discard path as closing; no separate product decision is needed unless review disagrees.
