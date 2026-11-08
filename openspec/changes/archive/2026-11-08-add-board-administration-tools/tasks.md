# Tasks

## 1. Domain workflow editing

- [x] 1.1 Add `src/domain/workflow-edit.ts` with a pure `applyWorkflowEdits(text, edits)` that rejects an empty edit collection, applies each literal `old`/`new` pair in order, requires each `old` to occur exactly once at its turn, and reports distinct not-found and ambiguous errors; verify with a new `tests/domain/workflow-edit.test.ts` covering single, multiple, missing, ambiguous, empty, and comment-preserving cases.
- [x] 1.2 Add `editBoardWorkflow(hub, boardId, edits, deps)` to `src/domain/hub-operations.ts` that calls `applyWorkflowEdits` and then `saveBoardWorkflow`, and expose it on `HubStore.editBoardWorkflow` in `src/host/hub-repository.ts`; verify with domain tests that an invalid result, an orphaned task stage, or a failed match leaves `workflowYaml` and `workflow` unchanged.

## 2. Board administration service

- [x] 2.1 Add `src/host/board-administration.ts` with a narrow sharing port (sharing view, board-bound check, local-change notification, board removal, publish), a serialized mutation tail, and methods for read, create, rename, remove, whole-workflow save, and partial workflow edit; verify with `tests/host/board-administration.test.ts` for revision checks, empty-board deletion, duplicate names, scope rules, and all-or-nothing edits.
- [x] 2.2 Add the per-call publishing policy to the service and cover every branch: unbound Hub, connection preview, continuous storage, explicit storage success, explicit storage blocked by team updates, explicit storage failure after a local save, and local-only removal; verify each branch asserts the local state survived and the reported publishing outcome.
- [x] 2.3 Move the `board.create`, `board.rename`, `board.delete`, and `board.workflow.save` cases in `KanbanApp.execute` onto the service, preserving command receipts, local-change notification, board removal bookkeeping, and the returned snapshot; verify `tests/host/hub-commands.test.ts`, `tests/host/app.test.ts`, and `tests/host/sharing-runtime.test.ts` pass.

## 3. Product tool module split

- [x] 3.1 Replace `src/host/tools.ts` with `src/host/tools/` (`support.ts`, `scope.ts`, `discovery.ts`, `cards.ts`, `notes.ts`, `boards.ts`, `questions.ts`, `index.ts`) and keep the existing helper signatures and tool behavior unchanged; verify `tests/host/tools.test.ts`, `tests/host/hub-commands.test.ts`, and `tests/host/product-walkthrough.test.ts` pass after only the expected tool list is updated.
- [x] 3.2 Extend `get_board_summary` with `include_workflow`, returning the exact YAML, the parsed workflow, the Hub revision, and the board's publishing state only when requested, and always returning the Hub revision in the summary; verify a new `tests/host/board-tools.test.ts` asserts both shapes and an unknown board rejection.
- [x] 3.3 Implement `create_board`, `update_board`, `edit_board_yaml`, and `delete_board` with explicit-intent descriptions, the documented argument validation, and the service result shape; verify the new board tool tests cover create with and without YAML, duplicate names, rename side effects, whole replacement, unknown-field rejection, orphaned stages, partial edit failures, empty-board deletion, scope requirements, and last-board deletion.
- [x] 3.4 Update the exact tool list assertion and the model-facing guidance test so the new surface is `create_board`, `update_board`, `edit_board_yaml`, `delete_board`, and the extended `get_board_summary`, with no Hub administration tool; verify `tests/host/tools.test.ts` passes.

## 4. Ordinary-chat write guard

- [x] 4.1 Add the write guard to the four board administration tools: reject a direct task conversation, reject a subagent descendant of a task conversation, fail closed when the lineage read fails, and leave reads unrestricted; verify `tests/host/board-tools.test.ts` covers an ordinary chat, a task conversation, a task subagent, a failed lineage read, and a successful board read from a task conversation.
- [x] 4.2 Verify the guard runs before any resolution or mutation and returns `BOARD_ADMIN_REQUIRES_ORDINARY_CHAT` without creating, changing, or deleting a board; assert the repository state is unchanged in each rejection test.

## 5. Sharing and publishing integration

- [x] 5.1 Implement the board sharing port in `src/host/app.ts` over the existing sharing service and pass it to the board administration service, while keeping the command path on the UI publishing policy; verify `tests/host/sharing-runtime.test.ts` and the new publishing branch tests pass.
- [x] 5.2 Add tool-level publishing tests for a Git binding (publish after create, rename, workflow save, and workflow edit), a continuous binding (scheduled, no explicit publish), a blocked publish (local change preserved and problem reported), an unbound Hub, and a local-only removal (no publish); verify `tests/host/board-tools.test.ts` and any new sharing test file pass.

## 6. Deprecated command removal

- [x] 6.1 Change `src/client/workflow-editor.tsx` to emit `board.workflow.save` with explicit `hubId` and `boardId` props supplied by `src/client/settings/board-settings.tsx`; verify the client workflow editor tests and browser workflow editor spec pass.
- [x] 6.2 Remove `workflow.save` from the `Command` union in `src/shared/types.ts`, from `src/remote.ts`, from `src/host/app.ts`, and from the client rewrite in `src/client/hub-view.ts`; update `tests/host/product-walkthrough.test.ts`, `tests/browser/fake-api.ts`, `tests/browser/publishing.spec.ts`, and `tests/browser/workflow-editor.spec.ts` to the new command; verify `pnpm typecheck` and `pnpm test` pass.
- [x] 6.3 Keep `HubStore.setWorkflow` for domain test callers but confirm no production client or remote caller still emits `workflow.save`; verify with a repository-wide search and a green `pnpm test`.

## 7. Documentation and release

- [x] 7.1 Update `README.md`: the registered tool table, the board administration workflow guidance (exact read, partial edits first, whole YAML for restructuring, ordinary-chat restriction, automatic publishing), and remove the statement that Hub and board administration is UI-only; verify by reading the rendered section and searching for stale claims.
- [x] 7.2 Bump `version` in `package.json` for the release that ships the change, following `AGENTS.md`; verify the value is greater than the currently published version and that the release workflow inputs still match.
- [x] 7.3 Run `pnpm check` and the isolated real-composition lane with board and conversation coverage from `AGENTS.md`; record the result under `.verification/` without tokens or owner data.

## 8. Final verification

- [x] 8.1 Run `openspec validate add-board-administration-tools --strict` and confirm the change has no validation issues.
- [x] 8.2 Review the final diff against the spec deltas: every new requirement has a covering test, the board UI behavior is unchanged except the command identity, and no Hub administration tool was introduced.
