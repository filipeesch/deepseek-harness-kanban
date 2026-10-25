# Tasks

## 1. Domain model and persistence

- [x] 1.1 Add `HubState`, `Board`, `KanbanState`, global settings, and `Task.boardId` to the shared model while keeping the current `BoardState` compiling; verify `pnpm typecheck` passes with the new types unused.
- [x] 1.2 Split the persisted schema into per-concern schemas (project, board, task, note, operation) plus Hub cross-reference validation for board ownership, task `boardId`/`projectId`/`columnId`, workflow canonicalization, and note ownership; verify `pnpm typecheck` and validate a migrated legacy shape through the new schema with a throwaway script.
- [x] 1.3 Port the existing project, board, task, conversation, and note mutation rules from `BoardStore` into pure operation modules under `src/domain/*/operations.ts`; verify `pnpm typecheck` and compare each ported rule against its current `BoardStore` method before deleting the old code.
- [x] 1.4 Add the `kanban_hubs` storage domain with `layout: 'per-record'`, a `hubs` table, and a global settings/initialization slot; verify `pnpm typecheck` and confirm the domain opens in the isolated host without touching the legacy `kanban` document.
- [x] 1.5 Implement `HubRepository` with one write tail, per-Hub revisions, Hub/board name uniqueness, last-Hub protection, Hub/board/project deletion eligibility, cross-Hub task and session ownership checks, and settings revision; verify `pnpm typecheck` and a repository smoke against a temporary storage fake.
- [x] 1.6 Implement the additive legacy migration: read the frozen v2 `kanban` state, create `My Hub` and the default board, copy projects/tasks/notes and the global worktree base path, write the initialization marker last, and leave the legacy document untouched; verify by opening the isolated host against a copy of a v2 state file and confirming one Hub and one board.
- [x] 1.7 Expose `HubStorage` and `LegacyStateReader` as ports and inject a clock plus ID factory into `HubRepository` and the operation modules so revisions, timestamps, and generated IDs are deterministic in tests; verify `pnpm typecheck` and that the production adapter is the only DSH-specific implementation.

## 2. Host commands and coordination

- [x] 2.1 Add `TaskLocator` and `TaskMutationPort` that resolve a task to its Hub, board, and project and expose all tasks across Hubs; verify host typecheck and that a task/session cannot be reported in two Hubs.
- [x] 2.2 Split `KanbanApp` into a thin `KanbanCoordinator` plus command modules for Hub, board, project, task, conversation, settings, and worktree commands; verify `tsc -p tsconfig.host.json --noEmit` and keep each module free of direct storage access.
- [x] 2.3 Adapt attention, execution guards, question persistence, pending-transition dispatch, workspace reconciliation, worktree collision checks, and task-context injection to use the locator instead of a single task array; verify host typecheck and inspect every former `store.snapshot().tasks` call site.
- [x] 2.4 Switch plugin wiring in `src/index.ts` to the new repository and coordinator, and remove the old `BoardStore` injection; verify `pnpm build` completes for the host bundle.
- [x] 2.5 Change the RPC snapshot and command contract to `KanbanSnapshot` with `hubs`, global settings, `hubId`-scoped commands, Hub/board receipts, and a settings revision; verify host typecheck and that the remote declarations reflect the new shapes.
- [x] 2.6 Implement Hub and board lifecycle commands (create, rename, delete) and per-board workflow save with orphan-column validation; verify each command through the isolated host and confirm the last-Hub and non-empty-board rejections.

## 3. Agent tools

- [x] 3.1 Add a `ToolScope` resolver and query service for `list_hubs`, `list_boards(hub_id)`, `list_projects(board_id)`, `get_board_summary(board_id)`, `list_cards(board_id)`, and `get_card(task_id)`; verify ordinary-chat calls without a board fail with an actionable error and task-conversation calls resolve the task's board.
- [x] 3.2 Add the write service for `create_card(board_id, project_id, ...)`, `edit_card`, and the existing note tools, reusing the host task/note commands and rejecting projects outside the board's Hub; verify host typecheck and the scope-mismatch error.
- [x] 3.3 Register the reworked tool definitions and descriptions, remove any Hub/board administration tool, and update the discovery wording; verify `pnpm build` and inspect the registered tool list in the isolated host.

## 4. Client

- [x] 4.1 Update `ClientBridge` and `ClientApi` for `KanbanSnapshot`, Hub/board receipt kinds, global settings, and `hubId`-scoped commands; verify `tsc -p tsconfig.client.json --noEmit`.
- [x] 4.2 Extract the Hub/board view helpers and create dialogs from `BoardView`, keeping it as the page shell with an active-board `BoardState` view; verify client typecheck and that drag/drop, selection, search, project filter, drawer, and destructive dialogs still receive the same scoped inputs.
- [x] 4.3 Add Hub and board tabs to `BoardView`, with `localStorage` selection per Hub through an injectable storage port, fallback when a Hub or board disappears, and the Hub-without-boards empty state; verify client typecheck and reload behavior in the isolated client.
- [x] 4.4 Add pure Hub and board attention selectors and render aggregated indicators on both tab levels; verify client typecheck and that switching Hubs preserves the indicator on an inactive Hub.
- [x] 4.5 Split configuration into General (global worktree path), Hub (name, deletion, boards), Projects (Hub registry), and Board (name, workflow, deletion), keeping workflow draft preservation and scoping the editor to the active board; verify client typecheck and each section against the active Hub/board.
- [x] 4.6 Add Hub and board create, rename, and delete dialogs with name-conflict errors, last-Hub protection, board deletion blocking when tasks exist, and Hub deletion confirmation counts; verify client typecheck and the corresponding command outcomes.
- [x] 4.7 Update task creation, task drawer, first-turn context display, page-state reset on Hub/board switch, and tab styles for the active Hub/board; verify client typecheck and that only the active board's tasks are rendered.
- [x] 4.8 Wire `client.tsx` to the Hub-aware `BoardView` entry point and verify `pnpm build` completes for the client bundle.

## 5. Cleanup and existing-suite migration

- [x] 5.1 Retire the single-board assumptions from the plugin path and configuration UI, keep the legacy `BoardStore`/schema isolated for migration tests, and verify `pnpm typecheck` and `pnpm build`.
- [x] 5.2 Update the README and capability purposes to describe Hubs, per-board workflows, global worktree settings, and board-anchored tools; verify `openspec validate add-hubs-and-boards --strict` and search for stale "global board" wording.
- [x] 5.3 Mechanically migrate existing test fixtures and expectations to the Hub model so the current gates compile and pass; keep this to fixture and expectation migration only, because the new coverage is added in group 6. Verify `pnpm check`.

## 6. New automated coverage

- [x] 6.1 Add the test helpers: `tests/domain/hub-helpers.ts` (`MemoryHubStorage`, `operationDeps`, `sampleHub`), `tests/host/fake-kanban-storage.ts` (storage-domain facility), and the existing `tests/host/helpers.ts`/`tests/client/helpers.ts` fixtures extended for Hubs; verify `pnpm typecheck` and that the new tests import them.
- [x] 6.2 Add `tests/domain/hub-schema.test.ts` and `tests/domain/hub-operations.test.ts` covering board/task/project ownership, name uniqueness, workflow isolation and orphan rejection, task creation/move in the owning board, project deletion across boards, and board lifecycle; verify `pnpm vitest run tests/domain/hub-schema.test.ts tests/domain/hub-operations.test.ts`.
- [x] 6.3 Add `tests/domain/hub-repository.test.ts` covering per-Hub revisions, `expectedRevision`, serialized writers, save-failure isolation, subscribers, last-Hub protection, deletion eligibility, cross-Hub task/session ownership, settings revision, snapshot cloning, and that a mutation writes only its Hub record; verify `pnpm vitest run tests/domain/hub-repository.test.ts`.
- [x] 6.4 Add `tests/domain/legacy-migration.test.ts` covering the `revision > 0`/`revision === 0` board-name paths, preservation of IDs/sessions/worktrees/notes/settings, and invalid legacy state without initialization; cover the partial seed-write idempotency in `tests/domain/hub-repository.test.ts`; verify both focused suites.
- [x] 6.5 Cover task/session lookup across Hubs and board discovery inference in `tests/host/hub-commands.test.ts`, including `list_hubs`/`list_boards`/`list_projects`/`list_cards`/`create_card` scope, cross-Hub project rejection, and the ordinary-chat missing-board error; verify the focused host suite.
- [x] 6.6 Cover Hub/board creation, `hubId` command routing, workflow isolation, deletion rules, receipts, global settings, ordinary-chat and task-conversation tool calls, and the absence of administration tools in `tests/host/hub-commands.test.ts` and `tests/host/tools.test.ts`; verify both focused suites.
- [x] 6.7 Add `tests/host/storage-migration.test.ts` for the `kanban_hubs` domain migration/reopen path, plus multi-Hub attention coverage in `tests/host/hub-commands.test.ts`; verify the focused host suites.
- [x] 6.8 Add client tests `tests/client/hub-navigation.test.tsx`, `tests/client/hub-configuration.test.tsx`, and `tests/client/hub-view.test.ts` covering tabs, local-storage persistence, empty Hub, create/delete confirmations, board-scoped rendering, configuration sections, attention, command scoping, and Hub-level project usage; verify those focused files.
- [x] 6.9 Update `tests/browser/fake-api.ts` and `tests/browser/harness.tsx` for a two-Hub snapshot and add `tests/browser/hub-navigation.spec.ts` covering tabs, reload persistence, empty Hub, inactive attention, and board creation; board workflow isolation is covered by the host suite; verify `pnpm test:browser`.
- [x] 6.10 Add `tests/browser/hub-tabs-appearance.spec.ts` covering active/inactive tab and attention-indicator contrast in light and dark with the host theme fixture, plus screenshots under `.verification/`; verify `pnpm test:browser`.
- [x] 6.11 Add `tests/e2e-dsh/kanban-hubs.e2e.template.ts` and a `--only hubs` mapping in `scripts/e2e-dsh.mjs` for the fresh-install Hub/board navigation and native-directory scenario; the template selects the project and asserts the new native session's `cwd`; verify `node scripts/e2e-dsh.mjs --checkout <pinned-dsh> --check`; actual execution remains the manual gate in 7.4.

## 7. Verification and release gates

- [x] 7.1 Run an isolated smoke with a throwaway `DSH_HOME` and a cloned web profile: boot the migrated/default Hub and board, create a reserved-name Hub, open Configuration → Projects before any board exists, create a board, and capture a screenshot plus a short report under `.verification/`.
- [x] 7.2 Run `pnpm check` (host/client typecheck, full Vitest, build) and report the result; the new unit, host integration, and jsdom suites run in this gate.
- [x] 7.3 Run `pnpm test:browser` and report the navigation, appearance, and contrast results.
- [ ] 7.4 Run the `--only hubs` e2e lane against the pinned DSH checkout and report the result; keep it a manual release gate. (Attempted; the pinned checkout is missing `p-limit`, so the lane could not start.)
- [x] 7.5 Consolidate the evidence: requirement-to-test mapping, screenshots, commands run, and residual risks in `.verification/hubs-report.md`. Confirm no separate test change was created, no test-specific capability was added, and the developer's DSH application, profile, board, and sessions were untouched.
