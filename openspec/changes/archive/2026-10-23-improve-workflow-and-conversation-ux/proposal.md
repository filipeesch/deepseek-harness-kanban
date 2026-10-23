# Proposal

## Why

Daily board use still has five avoidable friction points: workflow YAML is edited in a plain textarea, the conversation worktree notice sends users to the Git tab instead of creating with the values it already derives, grouped columns clip cards because column heights are split equally, the task drawer appears abruptly, and the question strip promises that users can close it but offers no dismiss action. These are related UX gaps in the same board/conversation workflow, so they are proposed as one reviewable change.

## What Changes

- Replace the workflow textarea with a CodeMirror 6 YAML editor in a wider Configuration dialog, with line numbers, syntax highlighting, folding, search, vertical resize, and a maximize toggle.
- Add live workflow diagnostics from the shared parser: syntax positions from YAML parsing, schema messages from the existing workflow parser, a summary for schema issues, and Save disabled while the YAML is invalid or still being checked. Host validation remains authoritative for orphaned columns and revision conflicts.
- Preserve the workflow draft when switching Configuration tabs and confirm before closing with unsaved changes. Fix the modal focus trap so it includes contenteditable editors and respects keys already handled by the editor.
- Add one-click worktree creation to the missing-worktree notice. The notice previews the derived branch, destination, and source; creation refreshes collision-aware defaults when the draft is untouched; a missing base path or a Git failure falls back to the Git tab with an actionable message.
- Extract shared worktree draft/default logic used by both the notice and the Git panel. The Git form accepts an empty source branch and lets the host fall back to the project default branch or `HEAD`, matching the host contract.
- Make workflow columns content-height only: a column grows with its cards and no longer clips them. Columns in grouped workflows no longer share an equal-height split, and the board page scrolls vertically.
- Animate the task drawer: a subtle slide-and-fade entrance and a symmetric exit, replayed only when opening from a closed drawer. Escape, the header close button, and board-background clicks all use the exiting path; reduced-motion users get no animation.
- Add a Dismiss action to the left side of the question-strip footer. Empty rounds dismiss immediately; a draft asks for inline confirmation. Dismissing removes every unresolved round in that conversation, sends no chat message, and lets the user continue in the normal composer.
- Persist question dismissal as a durable dismissed-turn marker and prune stored question page payloads for dismissed turns. Native transcript events are never modified, and transcript replay cannot resurrect a dismissed round.
- Refactor the touched client surfaces: extract `WorkflowEditor` and a reusable `CodeEditor`, extract the shared worktree draft hook, extract the missing-worktree notice, and keep the modal focus fix generic.
- Add the layered verification assets in this change: fast node/in-memory and jsdom tests, a separate plugin-owned Playwright browser harness, and two plugin-owned real-composition e2e scenarios run through a pinned DSH rc.2 web lane before release. Testing is not a separate OpenSpec change.

No breaking API changes are intended. The observable column layout, workflow-editor DOM, Git source-branch validation, drawer timing, and question-strip actions change by design.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `kanban-board`: add rich workflow editing with live validation and draft protection; require content-height columns; require animated task-drawer open and close.
- `worktree-management`: change the missing-worktree notice's Create action from a Git-tab handoff to default-value creation, including fallback behavior and preview.
- `structured-questions`: add an explicit dismiss action, confirmation when a draft exists, conversation-wide dismissal of unresolved rounds, durable dismissal persistence, and removal from the composer dock without a submitted answer.

## Impact

- Client: [forms.tsx](src/client/forms.tsx), new workflow editor/editor module(s), [git.tsx](src/client/git.tsx), new worktree draft/notice module(s), [drawer.tsx](src/client/drawer.tsx), [board.tsx](src/client/board.tsx), [styles.ts](src/client/styles.ts), [ui.tsx](src/client/ui.tsx), [client.tsx](src/client.tsx), [client-bridge.ts](src/client-bridge.ts), [questions/QuestionForm.tsx](src/questions/QuestionForm.tsx), [questions/styles.ts](src/questions/styles.ts).
- Host: [app.ts](src/host/app.ts), [questions/indexer.ts](src/questions/indexer.ts), [host/question-storage.ts](src/host/question-storage.ts), [host/controller.ts](src/host/controller.ts), [remote.ts](src/remote.ts), [host/tools.ts](src/host/tools.ts).
- Dependencies: add CodeMirror 6 state/view/commands/language/YAML/lint/search packages and the Lezer highlight package; no worker-based editor runtime.
- Data: question-session records gain an optional dismissed-turn list; old records remain readable. No board schema version change is expected.
- Documentation: README, operations, and question/worktree behavior notes need updates after implementation, including the manual pre-release e2e procedure.
- Verification: add fast node/in-memory tests and jsdom component tests; add `tests/browser/` with a separate `pnpm test:browser` Playwright harness for real layout, CodeMirror, and animation; add `tests/e2e-dsh/` templates plus `scripts/e2e-dsh.mjs` for two real-composition scenarios against a pinned DSH `dsh-v0.2.1-rc.2` checkout, run manually before release. No aria goldens and no testing-specific change.
