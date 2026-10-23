# Tasks

## 1. Dependency and build setup

- [x] 1.1 Add exact-pinned CodeMirror 6 packages (`@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-yaml`, `@codemirror/lint`, `@codemirror/search`, `@lezer/highlight`) to `package.json` and update the lockfile; verify `pnpm install` succeeds and `pnpm typecheck` still passes.
- [x] 1.2 Record the pre-change client bundle size and confirm the client build still produces `lib/client.js` with React external and no worker entry; verify with `pnpm build` and a size check of `lib/client.js`.

## 2. Question dismissal: persistence and host API

- [x] 2.1 Add optional `dismissedTurns` to the question-session record/snapshot types and the storage schema, keeping version 1 and backward compatibility; verify typecheck plus a storage round-trip test with and without the field.
- [x] 2.2 Add `QuestionIndex.dismiss(sessionId, roundIds)`, dismissed-turn tracking, and filtering of dismissed turns in round rebuilding; verify new indexer tests cover dismiss, `getRounds`, `pending`, serialize/restore, and late pages.
- [x] 2.3 Prune persisted question page events for dismissed turns during serialization (native pages by turn, PTC pages by resolved root-call turn with a keep-if-unresolved fallback) while retaining call/end/human events; verify indexer tests assert pruned payloads and unchanged answered derivation.
- [x] 2.4 Implement `App.dismissQuestions(sessionId, roundId)`: validate the trigger round, dismiss every unresolved round in that session, persist immediately, and return the remaining rounds; verify a host test calls it, reloads the store, and observes no dismissed round.
- [x] 2.5 Add the owner-only `kanban/dismissQuestions` remote schema, `KanbanRemote` typing, and controller method; verify typecheck and a controller/remote test for success and unknown-round rejection.
- [x] 2.6 Add `ClientBridge.dismissQuestions`, a local dismissed-ID set, and filtering for `accept`, `prepareQuestions`, and in-flight merges; verify bridge tests cover success, stale merge fencing, reload hydration, and duplicate dismissal.

## 3. Question dismissal: footer UI

- [x] 3.1 Add the optional `onDismiss` prop and a leading footer Dismiss button in `QuestionForm`, hidden when no callback exists and disabled while submitting, submitted, or dismissing; verify component tests assert placement, absence without the prop, and disabled states.
- [x] 3.2 Detect draft content (choices, free text, Other text, per-answer notes, Additional Notes), show the inline discard confirmation only when needed, focus the non-destructive action, and restore the footer on cancel; verify component tests for empty, populated, cancel, and confirm paths.
- [x] 3.3 Wire the Dock to call `bridge.dismissQuestions` and show a dismissal error without unmounting the strip on failure; verify the plugin test asserts no native message is sent and the strip disappears after success.
- [x] 3.4 Add footer/confirmation styles consistent with the host theme and responsive behavior; verify the panel renders correctly in light and dark appearance without overflow.
- [x] 3.5 Verify dismissal clears the conversation's pending question state and allows a later round to appear normally; verify host/bridge integration tests cover the waiting indicator and a subsequent round.

## 4. Worktree draft and one-click notice

- [x] 4.1 Create `src/client/worktree-draft.ts` with pure derivation/normalization/validation helpers and a `useWorktreeDraft` hook covering suggestion loading, touched fields, reload, and refresh; verify focused unit tests for defaults, collisions, edits, and invalid values.
- [x] 4.2 Create `src/client/worktree-notice.tsx` with the preview, Create, Review in Git, Dismiss, pending, and inline error states; verify component tests for default create, no-base-path fallback, Git failure, and blocked operation.
- [x] 4.3 Mount the shared draft hook once in `TaskDrawer`, pass it to the notice and `GitPanel`, and remove the duplicated suggestion/effect logic; verify typecheck and the existing Git/drawer tests with the new props.
- [x] 4.4 Implement quick-create semantics: use the displayed draft, refresh the host suggestion only when untouched, omit `sourceBranch` when the project has none, and never silently rename a user-edited draft; verify client tests assert the exact `worktree.create` command.
- [x] 4.5 Align Git source-branch behavior with the host (optional source, project default or HEAD placeholder, shared validation) and remove the unused `prefix` prop; verify worktree-default tests cover empty source and edited values.
- [x] 4.6 Confirm the notice and Git section show identical branch/path/source values for the same task and that a notice-created worktree follows the existing operation/idle switching flow; verify an integration test or manual smoke.

## 5. Workflow editor

- [x] 5.1 Create `src/client/workflow-diagnostics.ts` with YAML syntax positions, shared `parseWorkflow` schema checks, a stable analysis result, and document-start diagnostics for schema issues; verify unit tests for valid, syntax-invalid, schema-invalid, and host-only cases.
- [x] 5.2 Create the reusable `src/client/code-editor.tsx` CodeMirror wrapper with YAML language support, line numbers, folding, search, history, bracket matching, line wrapping, `Mod-s`, read-only support, diagnostics dispatch, host theming, and accessible labeling; verify component tests exercise value sync, editing, diagnostics, and disabled state.
- [x] 5.3 Create `src/client/workflow-editor.tsx` with debounced analysis, Save disabled while invalid/checking, status/summary, Save/Reload, draft callbacks, and editable-state locking during save; verify component tests cover invalid state, correction, save failure, and reload.
- [x] 5.4 Move the workflow draft and dirty state into `Configuration`, preserve it across tab switches, and add the inline close/reload discard confirmation; verify the editor-race tests and new tab-switch/close tests.
- [x] 5.5 Add the `Modal` size prop for the wide Workflow dialog and fix the focus trap for `contenteditable` plus handled Escape keys; verify modal/editor tests for Tab cycling, Escape, search-panel Escape, and focus restoration.
- [x] 5.6 Add the wide-dialog, resizable/maximizable editor, sticky-footer, diagnostic, and code-editor styles using host theme tokens; verify light/dark visual render and the maximize/resize behavior in the existing GUI.
- [x] 5.7 Remove the old workflow textarea and unused imports from `forms.tsx`; verify typecheck and that Configuration still exposes General, Projects, and Workflow.

## 6. Column heights and drawer animation

- [x] 6.1 Change the column rule to `flex:0 0 auto` and remove any equal-share assumption; verify a grouped workflow with one long column and short peers renders every card inside its column and scrolls the board page.
- [x] 6.2 Add BoardView drawer `entering`/`closing` state, the closed→open replay guard, the delayed unmount timer, cancellation on reopen, and cleanup on task disappearance; verify board tests cover open, switch-while-open, close, and reopen-during-exit.
- [x] 6.3 Add the open/close keyframes, pointer-events suppression during exit, and `prefers-reduced-motion` handling; verify the visual transition and that reduced motion finalizes immediately.
- [x] 6.4 Verify all close paths (header action, Escape, board-background click) animate and restore focus, and that task deletion still unmounts immediately; verify focused board interactions.

## 7. Test infrastructure and layered verification

- [x] 7.1 Add node/in-memory tests for `workflow-diagnostics` and `worktree-draft` covering valid/syntax/schema cases, positions, collision/default derivation, touched-field sync, source fallback, and exact command normalization; verify `pnpm test` passes and the new files are typechecked.
- [x] 7.2 Extend the question indexer, persistence/app, and bridge tests for dismiss-one/all, `pending`, serialize/restore, late native/PTC pages, page pruning with call/end/human retained, immediate persistence, no native send/archive, and in-flight merge fencing; verify `pnpm test` passes.
- [x] 7.3 Add jsdom component tests for WorkflowEditor with a mocked CodeEditor, Configuration/Modal draft and focus behavior, worktree notice quick-create states, drawer timers/reduced motion, QuestionForm footer dismissal, and Dock wiring; verify `pnpm test` passes and textarea-era assertions are updated.
- [x] 7.4 Add the Playwright browser harness: harness entry, non-vitest fake API, `playwright.config.ts`, esbuild build script, and specs for grouped-column geometry/scroll, real CodeMirror, drawer keyframes/reduced motion, and worktree notice Create; verify `pnpm test:browser` passes and the command remains separate from `pnpm check`.
- [x] 7.5 Add `tests/e2e-dsh/` templates, the seeded `question-round.jsonl`, and `scripts/e2e-dsh.mjs`; keep templates out of the plugin typecheck; verify the runner rejects a missing/wrong DSH tag or missing web dist before copying, and removes copied files on success and failure.
- [ ] 7.6 Implement the board real-composition scenario (CodeMirror workflow save, grouped-column geometry/scroll, drawer entrance/exit/reduced motion) and verify it passes manually against a pinned `dsh-v0.2.1-rc.2` checkout with `DSH_SNAPSHOT=replay`.
- [ ] 7.7 Implement the conversation real-composition scenario (real temp Git, project/base path/task through UI, notice quick-create with worktree/branch/cwd, seeded question dismissal/reload/reply) and verify it passes manually against the pinned checkout.
- [x] 7.8 Add the manual pre-release DSH e2e procedure and result-recording entry to the release documentation; verify the documented commands match the runner and cover both scenarios.

## 8. Documentation and final verification

- [x] 8.1 Update README, operations, and question/worktree behavior notes for the editor, quick-create notice, content-height columns, drawer animation, dismissal semantics, the browser harness, and the manual DSH e2e; verify the documentation matches the spec deltas and commands.
- [x] 8.2 Update the `decision_request` tool description/help text to state that the form can be dismissed without sending a message; verify the tool text and docs agree.
- [x] 8.3 Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm check`; verify all pass and the client bundle contains no worker asset.
- [x] 8.4 Run `pnpm test:browser`; verify the separate browser lane passes and that `pnpm check` does not depend on it.
- [ ] 8.5 Run the manual DSH real-composition e2e with `node scripts/e2e-dsh.mjs` against the pinned rc.2 checkout; verify both scenarios pass with no page errors and no model calls, and record the DSH version and result.
- [ ] 8.6 Rebuild the plugin, reconcile it through the supported native Plugin Manager operation, and smoke-test the installed GUI for the editor, notice quick-create, grouped columns, drawer animation, and question dismissal; verify the results and any host-version limitation.
- [x] 8.7 Run `openspec validate "improve-workflow-and-conversation-ux"` and `openspec status --change "improve-workflow-and-conversation-ux"`; verify the change is valid and every planning artifact is complete.
