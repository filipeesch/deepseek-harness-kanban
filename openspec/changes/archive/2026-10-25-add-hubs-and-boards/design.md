# Design

## Context

See `proposal.md` for motivation and the capability deltas for the behavior contract.

The plugin currently owns one `BoardState`: one workflow, one project registry, and one task collection. The host writes that state as one document, and the client renders one board surface. Hub segregation touches every layer because the unit of consistency, the unit of navigation, and the unit of tool scope all change together.

Observed current state:

- `BoardStore` is the single durable writer. It validates a strict `BoardStateSchema`, serializes mutations with one tail, checks a global revision, and publishes a cloned snapshot only after `StateStorage.save` resolves.
- `KanbanApp` coordinates commands, native sessions, worktrees, attention, questions, and workspace reconciliation in one class. Several helpers assume `store.snapshot().tasks` is the complete task set.
- `native.ts` creates one native DSH workspace per project path and per task worktree. That behavior is independent of any Hub and must remain so.
- The client `BoardView` combines the page shell, board surface, task creation, search/filter, selection, drag-and-drop, dialogs, and configuration entry points. `Configuration` combines general settings, projects, and the workflow editor.
- Board tools assume one implicit board. `list_boards` returns a synthetic global entry; `list_projects`, `list_cards`, `get_board_summary`, and `create_card` have no board parameter.
- `task-context.ts` injects the task title, identifier, description, and stage. It has no Hub or board vocabulary.

Constraints:

- No DSH core change and no new dependency.
- Native DSH workspaces, sessions, Git, worktrees, sandbox policy, and execution remain host-owned.
- The plugin ships host and client as one bundle. The persisted state may migrate, but the previous storage must not be destroyed.
- The product is local-first. A single-user dataset is expected; per-Hub isolation is a domain and write boundary, not a distributed-system boundary.
- Testing is part of this change. The strategy favors cheap in-memory module tests, keeps host integration behind the existing fake ports, and reserves the real DSH composition for one release-gate e2e.

## Goals / Non-Goals

**Goals:**

- Make the Hub a real aggregate boundary with its own revision, projects, boards, tasks, and notes.
- Keep every task and every board unambiguously inside one Hub.
- Give each board its own workflow and make the active board the scope of the board surface.
- Preserve native workspace, session, worktree, and execution semantics exactly.
- Make Hub switching, board switching, and attention aggregation predictable and persistent.
- Decompose the current god classes while preserving the existing durable-write guarantees.
- Migrate the current state without recadastramento and without deleting the legacy document.
- Add cheap automated verification for the new boundaries, with module-level in-memory tests, host integration, client jsdom, browser navigation, and one release-gate e2e.

**Non-Goals:**

- Hub-scoped native workspaces, Hub root folders, or Hub filesystem containment.
- Reusable workflow templates or copying a workflow between boards. A board is one name plus one YAML document.
- Moving tasks between boards or Hubs.
- Hub or board administration tools.
- Per-Hub team collaboration, permissions, or multi-user concurrency.
- Lazy per-Hub client streaming in this change.
- Testing DSH-native session, workspace, Git, sandbox, or model internals. Those remain host-owned and already have their own coverage.
- Testing against the owner's live profile, board, sessions, or storage.

## Decisions

### Hub is an aggregate, not a native workspace

A Hub is a logical record with a name, a revision, projects, boards, tasks, and notes. It has no path, no workspace identifier, and no lifecycle coupling to DSH. A project keeps its own `projectPath`, `gitRootPath`, and native workspace binding. A task keeps its effective directory and its native conversations.

Hubs are listed by `createdAt` order and boards by their persisted array order. Renaming does not reorder; creating appends; deleting removes. Manual reordering is not part of this change.

Alternatives considered:

- A Hub mapped to a native DSH workspace would reuse sidebar grouping, but it would overload the host's term and couple Hub deletion to workspace ownership. Rejected.
- A Hub with a root folder would resemble Railyin, but it would add containment validation and imply filesystem authority the product does not need. Rejected.

### One Hub record per aggregate, one repository

The persisted unit is one `HubState` record. The storage domain uses `layout: 'per-record'` with a `hubs` table. Each Hub record carries its own `revision`, projects, boards, tasks, and notes. The global slot carries the global settings and the initialization marker.

```text
kanban_hubs (domain, per-record)
  global.json                 { initializedAt, settingsRevision, worktreeBasePath? }
  hubs/<hub-id>.json          HubState
```

Why this shape:

- A task, board, or project mutation rewrites only its Hub's record.
- Hub creation and deletion are one record write each.
- Hub revisions are independent, so a stale command for one Hub cannot conflict with another Hub.
- The record is the consistency boundary for task/project/board invariants.

The repository serializes all writes through one tail. That is deliberately more conservative than per-Hub tails: it makes Hub name uniqueness, last-Hub protection, and settings writes race-free with the same single-writer guarantee the current store has. Storage writes are still per Hub. A local single-user product does not justify a per-Hub lock hierarchy yet.

`HubRepository` owns:

- Loading the `hubs` table and global settings.
- `list()`, `get(hubId)`, `snapshot()`, and `subscribe()`.
- `create()`, `rename()`, `delete()`, and `settings.save()`.
- `transact(hubId, expectedRevision, fn)` for every mutation inside one Hub.

`transact` clones the stored record, runs the mutation, validates the complete `HubState`, increments the Hub revision, writes that one record, updates the repository view, and notifies listeners only after durability.

Alternatives considered:

- One global `KanbanState` document would make migration and atomicity trivial, but every write would rewrite every Hub and the repository would become a god state object. Rejected.
- One record per board would shrink writes further, but project and board deletion would cross records and lose atomicity, and task moves within a board would still need a board-level record. Rejected for this change.

### Hub-scoped schema and pure domain operations

`HubState` is the aggregate:

```ts
interface HubState {
  id: string;
  name: string;
  revision: number;
  projects: Project[];
  boards: Board[];
  tasks: Task[];
  notes: Note[];
  createdAt: string;
  updatedAt: string;
}

interface Board {
  id: string;
  name: string;
  workflowYaml: string;
  workflow: Workflow;
  createdAt: string;
  updatedAt: string;
}

interface Task {
  // Existing task fields, plus:
  boardId: string;
}
```

The workflow parser and the task/worktree/conversation fields stay as they are. `Task.columnId` is interpreted against its board's workflow. Notes stay Hub-level and keyed by `taskId`; they are already task-scoped and do not need a second owner.

The schema is split by concern instead of one `BoardStateSchema` super-refinement:

- project, board, task, note, and operation schemas;
- board workflow canonicalization;
- Hub-level cross-reference validation: board IDs and names, task `boardId`, task `projectId`, task `columnId` against the owning board, session ownership, pending-transition columns, notes, and workflow/orphan consistency.

Pure operation modules mutate a draft and throw `KanbanError`. Examples:

```text
src/domain/hub/operations.ts       rename
src/domain/board/operations.ts     create, rename, delete, saveWorkflow
src/domain/project/operations.ts   save, delete
src/domain/task/operations.ts      create, edit, move, delete, instruction
src/domain/conversation/operations.ts
src/domain/note/operations.ts
```

`HubRepository` does not contain those rules. It owns durability, revisions, cloning, and notification. This keeps the store small and makes operations testable without a domain backend.

Cross-Hub uniqueness of task and session identifiers is enforced by the repository at the write boundary. A per-record schema cannot see sibling records. The repository rejects a mutation that would assign a task ID or session ID already owned by another Hub.

### Board owns its workflow; no templates

`Board.workflowYaml` and `Board.workflow` are the only source for that board's columns, transitions, groups, initial stage, and entry instructions. Saving a workflow parses it, validates that existing tasks and pending transitions in that board are not orphaned, and writes only that board. There is no template table, no template reference, and no propagation.

Board creation uses the existing `DEFAULT_WORKFLOW_YAML`. Board name is authoritative for navigation. A `name` inside the workflow YAML remains accepted as authored metadata but does not rename the board or select it.

Alternatives considered:

- A Hub-level workflow would reduce editing but couple all boards. Rejected.
- A Hub-level template catalog would match Railyin but add sharing, propagation, and orphan migration work the user explicitly excluded. Rejected.

### One snapshot for all Hubs; per-Hub revisions

The host snapshot becomes:

```ts
interface KanbanState {
  hubs: HubState[];
  settings: KanbanSettings;
}

interface KanbanSnapshot {
  state: KanbanState;
  attention: Record<string, Attention>;
  sequence: number;
  clientEpoch?: number;
  questionRounds?: QuestionRound[];
  commandReceipt?: CommandReceipt;
}
```

The host sends every Hub. The client selects the active Hub and board. This keeps Hub attention, board attention, Hub fallback, and the existing single-stream `ClientBridge` simple. The payload is bounded by the local product's usage; moving to per-Hub streams later is a transport-only change because the repository already exposes Hub records independently.

Every Hub-scoped command carries `hubId`. Hub mutations use the Hub's `expectedRevision`; settings use `settingsRevision`. Hub create and delete are repository-level commands. Command receipts add `hub` and `board` kinds.

Alternatives considered:

- A host-selected active Hub would put UI state in the host and break multiple windows. Rejected.
- A per-Hub stream would reduce payload, but it would add stream switching, Hub-list subscriptions, and attention aggregation across streams for no current scale benefit. Deferred.

### Board surface and page shell are separate

The client splits the current `BoardView` into:

```text
KanbanPage          Hub tabs, board tabs, localStorage selection, config entry, empty states
BoardSurface        columns, cards, drag/drop, search/filter, selection, drawer, dialogs
BoardConfiguration  board name, workflow editor, board deletion
HubConfiguration    Hub name, Hub deletion, board management
ProjectsSettings    Hub-scoped project registry
GeneralSettings     global worktree base path
```

`KanbanPage` owns the active Hub and board. `BoardSurface` receives the active `HubState`, the active `Board`, and a `hubId`-aware command runner. It never reads another Hub. The task drawer receives its board workflow from the active board; a task's board cannot differ from the surface that opened it.

Selection state stays in `page-state.ts` for the lifetime of the plugin, but switching Hub or board resets search, project filter, selection mode, selected task, and open drawer. The active Hub and the last board per Hub are UI preferences in local storage, not domain state. They are validated against each snapshot and fall back to the first available Hub or board.

### Attention is projected globally, displayed per scope

`AttentionCoordinator` keeps its per-session cache and bounded reconcile. Its task source becomes every task across every Hub. `KanbanSnapshot.attention` stays keyed by task ID.

The client derives scope attention with pure selectors:

```text
hubAttention(hub, attention)    OR of tasks whose board is in the Hub
boardAttention(board, attention) OR of tasks whose boardId is the board
```

Hub and board tabs reuse the same unread and execution indicator vocabulary as cards. Detailed awaiting-reply, failure, and background labels remain on the card and drawer; tabs present the aggregate activity signal only. No new host-side attention stream is needed.

### Board-anchored tools and explicit scope

Tools are split into a read service, a write service, and the definitions:

```text
src/host/tools/queries.ts     listHubs, listBoards, listProjects, boardSummary, listCards, getCard
src/host/tools/commands.ts    createCard, editCard, notes
src/host/tools/scope.ts       resolveHub, resolveBoard, resolveTask, taskContext
src/host/tools/definitions.ts registration and schemas
```

Scope rules:

- `list_hubs` needs no scope.
- `list_boards` needs `hub_id`; in a task conversation it may resolve the Hub from the task.
- `list_projects`, `get_board_summary`, `list_cards`, and `create_card` need `board_id`; in a task conversation the board may be inferred from the task.
- `get_card`, `edit_card`, and note tools find the task across Hubs; the board and Hub are returned in the result.
- An ordinary chat without a board ID receives an actionable error. No UI selection, default board, or native workspace is used as a fallback.
- No tool creates, renames, or deletes a Hub or board.

Tool writes reuse the same `TaskCommands` and `NoteOperations` as the UI. They do not write repository records directly.

### Migration is additive and non-destructive

The legacy domain remains `kanban` (version 1, single layout, `BoardState` global). The new domain is `kanban_hubs` (version 1, per-record, `hubs` table, settings global). The new domain is authoritative after initialization.

Initialization sequence:

1. Open `kanban_hubs` and read its global initialization marker.
2. If `initializedAt` is present, use the existing records.
3. If it is absent, open the legacy `kanban` domain and read its global state.
4. Build `HubState` with:
   - Hub id `default`, name `My Hub`;
   - board id `default-board`, name from the legacy workflow's `name` when the legacy revision is greater than zero, otherwise `Kanban`;
   - the legacy workflow as that board's YAML;
   - the legacy projects and notes unchanged;
   - every legacy task with `boardId: 'default-board'`;
   - the legacy worktree base path in the new settings global.
5. Write the Hub record first, then the initialization marker and settings. The legacy revision heuristic distinguishes a real legacy installation from the untouched initial state; any write increments the legacy revision.
6. Close the legacy domain. Do not modify or delete its document.

If the legacy data is missing, the legacy domain's initial state produces the fresh-install Hub. If it is present but invalid, open rejects and the plugin startup fails with the validation problem; the new domain is not initialized. Re-running migration uses the deterministic `default` Hub and board IDs, so a crash after the Hub write but before the marker write is idempotent.

The previous plugin can still open the untouched legacy document. Changes made after migration live only in the new domain; downgrade semantics are documented as "new data is not visible to the previous version."

### Execution, worktrees, and native sessions cross Hubs through locators

The existing execution guards and worktree coordinator assume one task collection. They receive a `TaskLocator`/`TaskMutationPort` instead:

```ts
interface TaskLocator {
  findBySession(sessionId: string): LocatedTask | undefined;
  findById(taskId: string): LocatedTask | undefined;
  all(): LocatedTask[];
}
```

`LocatedTask` carries the Hub, board, project, and task. The locator is implemented by `HubRepository` and backed by the in-memory Hub records. Guards, attention, task-context injection, workspace reconciliation, pending-transition dispatch, and worktree collision checks all use it. No helper scans a single `state.tasks` array anymore.

Worktree base path remains global in settings. Worktree collision checks consider tasks in every Hub because worktrees share a filesystem. Native workspace creation remains per project path and per worktree path; Hub creation or deletion never creates, moves, or removes a native workspace.

### Module seams

```text
src/shared/
  hub.ts                 HubState, Board, KanbanState, settings
  task.ts                Task and task-owned operation types
  command.ts             Hub-scoped command union and receipts
  snapshot.ts            KanbanSnapshot

src/domain/
  schemas/*.ts           per-concern zod schemas and Hub cross-reference validation
  hub/operations.ts      Hub rename and aggregate helpers
  board/operations.ts    board create/rename/delete/workflow
  project/operations.ts  project save/delete
  task/operations.ts     task create/edit/move/instruction/delete placement
  conversation/operations.ts
  note/operations.ts
  workflow.ts            unchanged parser

src/host/
  storage.ts             kanban_hubs domain, legacy read/migration
  hub-repository.ts      per-record persistence, revisions, write tail, listeners
  task-locator.ts        LocatedTask queries across Hubs
  commands/*.ts          hub, board, project, task, conversation, worktree, settings
  coordinator.ts         snapshot, question persistence, pending dispatch, lifecycle
  attention.ts           task source across Hubs
  task-context.ts        Hub/board-aware context injection
  tools/{queries,commands,scope,definitions}.ts

src/client/
  page.tsx               KanbanPage: selection, tabs, empty states, config
  hub-tabs.tsx
  board-tabs.tsx
  board-surface.tsx      extracted from the old BoardView
  configuration.tsx      General, Hub, Projects, Board sections
  create-dialogs.tsx
  page-state.ts          UI preferences and local-storage selection
  styles.ts              existing styles plus tab styles
```

`KanbanApp` is replaced by a thin `KanbanCoordinator` that routes commands to the command modules and owns snapshot assembly, question persistence, and lifecycle. `BoardStore` is replaced by `HubRepository` plus the pure operation modules. `WorktreeCoordinator` keeps its Git transaction logic but receives the task ports it needs.

## Risks / Trade-offs

- **Snapshot size**: all Hubs are sent on every change. Accepted for local-first usage; per-Hub streaming can follow without changing the repository contract.
- **Serialized writes**: one repository tail means a slow write in one Hub delays another. Accepted for local single-user safety; per-Hub tails would need a separate metadata chain for names and last-Hub protection.
- **Migration coupling**: the migration module must keep a frozen copy of the legacy `BoardState` schema. Keep it isolated in `storage.ts` and mark it read-only; do not import current operation types into it.
- **Legacy downgrade**: changes after migration are invisible to the previous plugin. The untouched legacy document is the backup; document this explicitly.
- **Cross-record invariants**: a per-record schema cannot enforce task/session uniqueness across Hubs. `HubRepository` enforces it at the write boundary; losing that check would allow duplicate ownership.
- **Board name vs workflow `name`**: two names can diverge. Board name is authoritative; the YAML name is authored metadata and never renames the board.
- **Large client refactor**: splitting `BoardView` and `Configuration` risks regressions in drag/drop, drawer focus, and draft preservation. Move behavior in slices and keep the existing pure helpers (`columnLayout`, `useCardDrag`, `page-state`) intact.
- **Hub deletion cleanup**: deleting a Hub removes project registrations but retains native workspaces and directories, consistent with project deletion. Users may still see native workspaces for deleted Hubs; this must be stated in the confirmation.
- **Attention cost**: projecting every task across every Hub on each refresh can be more expensive than one board. The existing per-session cache and bounded reconcile remain; scope aggregation is a client-side OR, not a second host read.

## Test Strategy

Verification is part of this change. It uses cheap in-memory module tests, host integration behind the existing fake ports, client jsdom tests, a browser lane, and one release-gate e2e. No new dependency and no separate test change.

| Layer | Main new files | Cost | What it proves |
|---|---|---|---|
| Pure and module-level unit | `tests/domain/hub-schema.test.ts`, `hub-operations.test.ts`, `hub-repository.test.ts`, `legacy-migration.test.ts`, `task-locator.test.ts`; `tests/host/tool-scope.test.ts` | milliseconds | Domain invariants, durability, migration, scope resolution |
| Host integration | `tests/host/hub-commands.test.ts`, `hub-tools.test.ts`, `hub-migration-domain.test.ts`, `hub-attention.test.ts`, `task-context-hubs.test.ts` | ~10 seconds | Command routing, tools, attention, native ports, domain declaration |
| Client jsdom | `tests/client/hub-page.test.tsx`, `hub-configuration.test.tsx`, `hub-attention.test.ts`, `page-state-selection.test.ts` | ~10 seconds | Tabs, selection, dialogs, configuration, scope selectors |
| Browser | `tests/browser/hub-navigation.spec.ts`, `hub-tabs-appearance.spec.ts` | ~30–60 seconds | Real rendering, persistence, layout, computed contrast |
| E2E release gate | `tests/e2e-dsh/kanban-hubs.e2e.template.ts` | manual, ~1–2 minutes | Real DSH composition and native conversation directory |

### Requirement mapping

| Capability | Primary verification |
|---|---|
| `hubs` ownership, lifecycle, bootstrap, migration | `hub-schema`, `hub-operations`, `hub-repository`, `legacy-migration`, `hub-commands`, `hub-migration-domain`, `hub-page` |
| `kanban-board` multiple boards, per-board workflow, tabs, attention | `hub-operations`, `hub-commands`, `hub-page`, `hub-navigation`, `hub-tabs-appearance` |
| `project-contexts` Hub scope and no native-workspace inference | `hub-schema`, `tool-scope`, `hub-tools`, `task-context-hubs` |
| `harness-navigation` General/Hub/Projects/Board sections | `hub-configuration`, `hub-navigation` |
| `product-tools` board-anchored discovery and writes | `tool-scope`, `hub-tools` |
| `task-conversations` first-turn Hub/board context | `task-context-hubs` |
| Native workspace, worktree, session, sandbox behavior | Existing native/worktree suites plus the release-gate e2e; no new host-native test matrix |

### Module-level unit tests

The unit layer tests whole modules with in-memory fakes, not just individual methods. Add `tests/domain/hub-helpers.ts` with `MemoryHubStorage` (load/save/delete/meta, write log, deferred and failing writes), `MemoryLegacyReader`, `sampleHub`, and `twoHubState`.

- **Schema** (`hub-schema.test.ts`): valid two-board Hub; duplicate board IDs and case-insensitive board names; task `boardId`/`projectId`/`columnId` ownership; a column from another board rejected; note ownership; session duplication inside a Hub; pending transition and operation columns against the task's board; workflow canonical mismatch; unknown fields; global settings and revision; board order.
- **Operations** (`hub-operations.test.ts`): board create/rename/delete; duplicate names; last board leaves an empty Hub; board with tasks blocked; project deletion blocked by tasks in any board; task creation in the board's initial column and position; task move against the board's workflow; workflow save isolation and orphan rejection only on the owning board; Hub rename.
- **Repository** (`hub-repository.test.ts`): create/list by `createdAt`; Hub and board name uniqueness; per-Hub revision and `expectedRevision`; serialized writers without lost updates; save failure leaves memory and observers unchanged; subscriber isolation and unsubscribe; last-Hub protection; Hub deletion with and without tasks; settings revision; cross-Hub task/session ownership; snapshot cloning; only the changed Hub record written.
- **Migration** (`legacy-migration.test.ts`): v2 with `revision > 0` uses the workflow name; v2 with `revision === 0` uses `Kanban`; IDs, sessions, worktrees, notes, and worktree base path preserved; invalid legacy state fails without marking the new domain initialized; failure between the Hub write and the marker is idempotent on rerun; the legacy reader observes no writes.
- **Task locator** (`task-locator.test.ts`): find by task and by session across Hubs; Hub/board/project context; missing task; no task reported in two Hubs.
- **Tool scope** (`tool-scope.test.ts`): `list_hubs` without scope; `list_boards` requires a Hub; `list_projects`, `get_board_summary`, and `list_cards` require a board; `get_card` resolves across Hubs; `create_card` rejects a project from another Hub; a task conversation infers its board; an ordinary chat without a board receives an actionable error and no fallback.
- **Client selectors** (`hub-attention.test.ts`, `page-state-selection.test.ts`): Hub and board attention OR semantics, inactive Hub attention, clear behavior; local-storage selection, per-Hub board memory, fallback for missing IDs, and reset on board switch.

### Host integration

Add `tests/host/hub-helpers.ts` with a two-Hub fixture and compatibility helpers (`commandForHub`, `hubState`, default Hub/board selectors) so existing host tests migrate with minimal churn. Add `tests/host/fake-storage-domain.ts` that supports a global slot plus tables and records the opened specs; reuse the pattern already proven in `tests/host/questions-persistence.test.ts`.

- **Commands** (`hub-commands.test.ts`): create Hub and board; create tasks in two boards; `hubId`-scoped commands; missing or wrong Hub; board workflow isolation; Hub/board/project deletion rules; receipts `hub` and `board`; global settings revision.
- **Tools** (`hub-tools.test.ts`): `list_hubs`/`list_boards`/`list_projects`/`get_board_summary`/`list_cards`/`get_card`; `create_card` and `edit_card` from an ordinary chat and from a task conversation; cross-Hub project rejection; no administration tools.
- **Migration integration** (`hub-migration-domain.test.ts`): open the real `kanban_hubs` spec through the fake storage domain; migrate a synthetic v2 record; assert the per-record declaration; reopen without a second migration; confirm the legacy reader and the new writer are separate.
- **Attention and context** (`hub-attention.test.ts`, `task-context-hubs.test.ts`): tasks in two Hubs contribute to the same attention map; inactive Hub facts are available to the client selector; first-turn context names the Hub and board; no native workspace inference.

### Client jsdom

- **`hub-page.test.tsx`**: Hub and board tabs; switch; local-storage reload and fallback; Hub without boards; create Hub/board; last Hub disabled; board deletion blocked with tasks; board-only task rendering; project filter limited to the Hub; attention on inactive tabs.
- **`hub-configuration.test.tsx`**: General/Hub/Projects/Board sections; Board unavailable without a board; workflow save includes `hubId`/`boardId`; draft preservation; global worktree path; Hub deletion confirmation counts.
- **`hub-attention.test.ts`** and **`page-state-selection.test.ts`**: pure selector and preference tests, including a fake local-storage adapter that does not touch the global jsdom store.

### Browser

- **`hub-navigation.spec.ts`**: tabs render and switch; selection survives reload; a Hub without boards shows the create-board empty state; inactive Hub/board attention is visible; board workflow edits do not affect the other board.
- **`hub-tabs-appearance.spec.ts`**: active/inactive tabs and the attention indicator in light and dark, asserting host-token usage and at least 4.5:1 text contrast against the real background; screenshots under `.verification/`. No golden screenshots.

Update `tests/browser/fake-api.ts` and `tests/browser/harness.tsx` additively for a two-Hub snapshot and a `hubs`/`hubs-appearance` scenario.

### E2E release gate

Add `tests/e2e-dsh/kanban-hubs.e2e.template.ts` and a `--only hubs` runner mapping. The scenario starts from a fresh scaffold, creates a second Hub and a board through the UI, creates one task in each board, switches tabs, verifies that only the active board's tasks are rendered, opens a conversation, and verifies the native conversation directory is still the project path. It does not seed or assert the legacy migration; that path is covered by the migration integration test because seeding a legacy domain inside the scaffold is brittle.

### Testability seams

- Inject a clock and an ID factory into `HubRepository` and the operation modules so revisions, timestamps, and generated IDs are deterministic.
- Define `HubStorage` and `LegacyStateReader` as ports with in-memory implementations; keep the DSH storage adapter behind `HubStorage`.
- Define `TaskLocator` and `ToolScope` as interfaces; keep the tool services independent of `KanbanApp`.
- Add a local-storage port for the client selection functions instead of reading `window.localStorage` directly.
- Keep Hub and board attention selectors pure.
- Extend the existing fake `storageDomain` facility with a global slot so the new domain spec is exercised without a real backend.
- Provide additive compatibility helpers for the current suite; the mechanical migration remains in the implementation, not in a separate test change.

### Existing suite migration

The implementation migrates the current host, client, bridge, browser, and e2e fixtures to the Hub model while keeping `pnpm check` green. The new suites above are added on top of that migration; they do not duplicate the mechanical fixture work and do not introduce a test-specific capability or spec delta.

### What not to test

- DSH-native session, workspace, Git, sandbox, or model internals. Those remain host-owned and already have their own coverage.
- Real model calls; the e2e lane runs with `DSH_SNAPSHOT=replay`.
- The owner's live profile, board, sessions, or storage.
- A full e2e matrix. One release-gate scenario is the approved ceiling.
- Golden screenshots or every visual pixel. The appearance test checks computed tokens and contrast only.
- The same host semantics again in the browser layer.

### Residual risks

- The real legacy-domain read and the real new-domain write are not exercised in one automated lane. The fake storage domain covers migration logic, and the e2e covers the new domain and UI; a real-backend host test is the follow-up if this gap matters.
- The e2e depends on the pinned DSH checkout and remains a manual release gate.
- Attention aggregation across many Hubs is linear in tasks. If scale becomes a concern, add one repository/attention smoke with several Hubs and many tasks rather than a large matrix.

### Gates

- Fast: `pnpm check`.
- Browser: `pnpm test:browser`.
- E2E: `node scripts/e2e-dsh.mjs --checkout <pinned-dsh> --only hubs` after implementation.
- Isolated acceptance: the throwaway `DSH_HOME` smoke from `AGENTS.md`.
- Never validate against the developer's running DSH application, personal `$DSH_HOME`, board, or sessions.
