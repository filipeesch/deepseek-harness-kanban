# Design

## Context

See `proposal.md` — Why. This section records only the current state and constraints that shape the approach.

**Current creation path.** `task.create` reaches `KanbanApp.createTaskNow` (`src/host/app.ts`) and `operations.createTask` (`src/domain/hub-operations.ts`). The domain operation already writes `instructionPending` when the board's initial column has an effective entry instruction (`entryInstruction`), but it creates no conversation, workspace, worktree, or execution. `NewTaskDialog` (`src/client/forms.tsx`) collects title, description, and project, sends `task.create`, validates the creation receipt, opens the drawer, and shows the fixed hint "No agent starts automatically."

**First-execution preparation today.** `ExecutionPreparationController` (`src/client/execution-preparation/`) is a client-owned state machine used before a user move or the card play action. Its `gate.ts` decides whether the dialog applies; the controller asks the worktree question, creates the worktree or records the base-project choice, creates the first conversation, and presents DSH's native model seat. The first conversation must be created after the worktree is ready because a session header is immutable. The native model seat needs a retained session and shows the deployment default without submitting anything.

**Stage-instruction countdown today.** `AutoRunController` (`src/client/auto-run.ts`) owns one transient record per task, a five-second timer, cancel, a single execution path (`task.runInstruction`), and a failed record. `useBoardMoves.armAfterMove` arms it after a committed move into an instructed stage. The host's `admitStageInstruction` (`src/host/stage-instruction.ts`) is the only send/admission path and clears the entry marker on success.

**Auto mode today.** `task.autoMode` is a persisted per-task setting, off by default, toggled through `task.autoMode`, and consumed by the host-owned `AutoAdvanceCoordinator`. Creation cannot set it.

**Worktree defaults today.** `KanbanApp.worktreeDefault` returns `{ branchName, path }` and returns `path: ''` when no worktree base path is configured. `worktreePathForBranch` joins a configured base with the branch; `initialWorktree` and `useWorktreeDraft` repeat the derivation on the client. The notice, the Git section, and the execution preparation each special-case the empty destination.

**Tool creation today.** `create_card` (`src/host/tools/cards.ts`) calls `app.createTask` directly, bypassing the command handler, and documents that it starts no agent.

**Constraints.** The user selected a host use case with no durable startup state; the five-second countdown remains client-owned; the interactive preparation keeps its current behavior; a failed start must leave the card and the play action; the tool surface has no cancelable countdown; existing tasks and pending transitions must keep working; the client and host ship as one plugin bundle, so command and wire shape changes are atomic.

## Goals / Non-Goals

**Goals:**

- Start a created task's first execution from the workspace creation journey without a preparation dialog, using the default worktree and the deployment default model.
- Keep one planner for the worktree/model/start rules used by the interactive preparation and the automatic creation path.
- Derive a worktree destination beside the repository when no base path is configured, removing the empty-destination sentinel from every surface.
- Reuse the existing countdown, its card/drawer presentation, its cancel semantics, and the single stage-instruction admission path.
- Give the tool surface the same creation/start behavior through the same host use case.
- Consolidate the `NewTask` shape across the wire, domain, legacy store, and tool.

**Non-Goals:**

- Durable startup state or a host-side countdown; the user selected the existing transient, client-owned countdown.
- Changing the interactive preparation's worktree question, model seat, cancel, or retry behavior.
- Extracting the creation flow from `BoardView` or removing the board's fallback `AutoRunController`; both were explicitly left out of scope.
- A plugin-owned model picker, a task-level model preference, or a new auto-advance rule.
- A data-version migration or backfill for existing tasks.

## Decisions

### Decision 1: The automatic preparation is a separate host use case invoked after creation

`task.create` stays atomic: it creates the card, applies `autoMode`, writes the entry marker, and returns its creation receipt. A second command, `task.prepareFirstExecution`, then prepares worktree and first conversation only; the client arms the existing countdown after it resolves. The tool calls the same application method with an immediate dispatch.

*Why:* if the preparation ran inside `task.create`, a post-create failure (worktree, conversation) would reject the command after the card already existed, and the client would lose the creation receipt. The separate call also lets the card and drawer present a preparing state and lets the tool choose immediate dispatch.

*Alternatives considered:* inline in `task.create` (rejected: receipt/error contract and a long blocking create command); a durable startup record with a host runner (rejected by the selected scope: no persisted startup); a fully client-owned flow using `worktree.create`, `conversation.create`, and `task.runInstruction` (rejected: no tool path, three round trips, and the orchestration duplicated outside the host).

### Decision 2: `task.create` persists auto mode; the new command prepares, and the existing admission sends

- `task.create` (wire, `NewTask`, domain creation, tool args) gains `autoMode?: boolean`. The domain operation persists `task.autoMode = { enabled: true }` when set; no other creation behavior changes.
- `task.prepareFirstExecution` takes the task, the stage, the entry identity (`expectedEnteredAt`), and the reviewed instruction. It validates exactly the conditions `admitStageInstruction` validates for the entry (task still in the stage, marker identity, instruction unchanged, no unresolved operation or confirmed transition, project not relocating), prepares the worktree and first conversation, and returns the conversation identity. It never sends.
- The client arms `AutoRunController` after the preparation resolves; the timer's expiry calls the existing `task.runInstruction`, so the send, the entry clearing, and the failure semantics remain one path.
- The tool calls the same application method with `send: true`: after preparing, it calls `admitStageInstruction` with the resolved conversation and the current instruction. There is no countdown on that surface.

*Alternatives considered:* having the preparation command also send (rejected: the UI needs the cancelable window); a separate wire command for the tool (rejected: two entry points for one behavior); putting the send in the client for the tool (impossible: no client).

### Decision 3: One shared first-execution planner, with interactive and automatic modes

`src/domain/first-execution.ts` owns the pure plan:

```text
planFirstExecution({ task, project, workflow, columnId, settings, modelSeatAvailable, mode })
  -> {
       start: boolean,                          // automatic only: initial instructed stage
       worktree: 'ask' | 'create-default' | 'base' | 'blocked' | 'none',
       model: boolean,                          // interactive only: native seat applies
       entry: { columnId, enteredAt, instruction } | null,
     }
```

The interactive mode reproduces today's gate exactly: a Git-backed task with no conversation, no worktree, and no recorded base choice asks; an unresolved binding blocks; a folder project or a recorded choice needs only the model step. The automatic mode always uses `create-default` for a Git-backed project and `none` for a folder project, never asks, never presents the model step, and reports `start` only when the initial column has an entry instruction and the task has no conversation.

The client's `execution-preparation/gate.ts` delegates to the interactive plan, and the host's preparation use case consumes the automatic plan. One rule, two policies.

*Alternatives considered:* a second host-only planner (rejected: duplicates the binding, conversation, and folder rules); leaving the client gate and coding the host path independently (rejected: drift between two "first execution" definitions).

### Decision 4: The host preparation is a small ports-based application use case

`src/host/first-execution.ts` exposes `prepareFirstExecution(deps, request)` with injected ports:

```text
locate(taskId)                      -> { hubId, task, project, board }
worktreeDefaults(task)              -> WorktreeDefaults
createWorktree(taskId, CreateWorktree) -> void
createConversation(taskId)          -> sessionId
assertExecutionContext(sessionId)   -> void
send(sessionId, text, requestId?)   -> void        // used only for send: true
transact(...)                       -> void
report(error)                       -> void
```

Order: validate the entry → return an existing open conversation when there is one (idempotent retry) → for a Git-backed task with no ready worktree, derive the defaults and create the worktree, waiting until it is ready → create the first conversation → for `send: true`, admit the instruction with the existing `admitStageInstruction` → return `{ sessionId, sent }`. Worktree creation uses the existing coordinator's synchronous drive for a task with no conversations, so the first conversation uses the worktree directory. Failures throw and leave whatever was created in place; the card and entry stay.

*Alternatives considered:* a React hook or controller (rejected: the host owns the sequencing and the tool needs it); reusing `ExecutionPreparationController` on the client (rejected: it asks questions and depends on the native model seat); overloading `admitStageInstruction` to create conversations and worktrees (rejected: it would grow a second responsibility).

### Decision 5: The client orchestration lives on the existing auto-run controller

`AutoRunController` gains a transient `preparing` status and two operations: `prepare(input, prepareCommand)` sets the record, awaits the preparation, and then `arm(input)`; `recordFailure(input, problem)` stores a failed record without a timer. The existing `arm`, `cancel`, `runNow`, `reconcile`, and `dispose` keep their semantics.

- `BoardView.onCreated` receives the created task id and the start decision, opens the drawer, and, when the initial column has an entry instruction, calls `autoRun.prepare(...)` with the fresh task identity and the command runner.
- The card's run slot renders `preparing` as a disabled busy control; `DrawerAutoRunNotice` renders a preparing status. A failure uses the existing `failed` record and status line; the play action returns for the unresolved entry.
- `reconcile` keeps a preparing or failed record while the marker still matches and cancels it when the entry is resolved, replaced, or the task disappears.
- The controller is owned by the client generation, not by a mounted board, so a preparation already in flight and its countdown can arm after the drawer or board unmounts. `BoardView`'s creation closure uses the board's stable command runner and the client-owned controller.

No new creation hook or `BoardView` extraction is introduced; that refactor was not selected.

*Alternatives considered:* a separate creation-start controller (rejected: a second owner of the per-task timer and failure record); an optimistic pre-armed countdown (rejected: the target conversation does not exist yet and expiry could race the preparation); blocking the dialog until the preparation finishes (rejected: the card should appear and the drawer open immediately).

### Decision 6: The tool surface prepares and dispatches in one call

`create_card` gains `auto_mode` and no `start_execution` option. After `app.createTask`, the tool calls the same application method with `send: true` when the board's initial column has an entry instruction, then returns the task plus a `firstExecution` outcome (`not-applicable`, `sent`, or `failed` with the problem). A failure leaves the task in the initial column with the unresolved entry; the tool reports the failure instead of retrying. The tool description and the product-tools delta describe the new behavior.

*Alternatives considered:* a `start_execution` switch (rejected by the user: the tool always follows the rule); no start (rejected: surface-dependent behavior); a host five-second timer (rejected: no cancel UI and new transient state).

### Decision 7: Worktree defaults derive beside the repository and return a discriminated result

`src/shared/worktree-name.ts` gains the portable derivation:

```text
defaultWorktreeDestination({ gitRootPath, basePath, branchName })
  -> basePath ? <base>/<branch>
             : <dirname(gitRootPath)>/<basename(gitRootPath)>-<branch>
```

The rule is global: the host's `worktreeDefault`, the client's initial Git draft, the notice preview, the preparation, and the automatic creation all use it. The configured base path remains a pure override, and collisions advance the branch and destination together under the same rule.

`worktreeDefault` returns `{ kind: 'derived', branchName, path, sourceBranch? }` or `{ kind: 'unavailable', reason }` instead of an empty path. The empty-path sentinel, `destinationMissing` inferred from a blank string, and the "route to Git because there is no destination" branches are removed. An unavailable result now means a real failure (invalid derived path or name exhaustion), not an unconfigured base.

*Alternatives considered:* base = the repository's parent with the bare branch name (rejected: cross-repository collisions and ambiguous sibling names); a `<repository>-worktrees` grouping folder (rejected: extra nesting); keeping the empty-path sentinel and only special-casing creation (rejected: the user selected a whole-solution default and the discriminated cleanup).

### Decision 8: `NewTask` becomes one shared schema

`src/shared/task-creation.ts` defines a strict zod schema for the creation input (`projectId`, `title`, `description`, `boardId?`, `autoMode?`) and infers `NewTask` from it. `shared/types.ts` re-exports the type; `remote.ts` builds the `task.create` command schema from it; `hub-operations.createTask`, the legacy board store, and the `create_card` args use the same type. The domain operation validates the `autoMode` boolean and persists it. The command's `boardId` and the command's `hubId` stay where they are.

*Alternatives considered:* adding `autoMode` independently to the type, wire schema, domain input, legacy store, and tool (rejected: the selected consolidation); a nested `options` object (rejected: unnecessary wire churn).

### Decision 9: Presentation, persistence, and compatibility

- The preparing state is transient and separate from the card status strip; only preparation and send failures use the status strip, matching the existing run-failure rule.
- No persisted task field is added. Auto mode, the entry marker, the worktree, and the conversations already exist. `DATA_VERSION` is unchanged.
- The new command and the `worktreeDefault` result shape are wire changes; the plugin client and host ship together, so no compatibility shim is needed. Existing pending transitions and tasks are untouched.
- The README's creation, auto-mode, and worktree sections are updated with the new defaults and the tool behavior.

### Decision 10: Verification lanes

| Behavior family | Lane |
|---|---|
| Planner modes, entry eligibility, folder/Git/binding rules | `tests/domain/first-execution.test.ts` |
| Worktree sibling derivation, collisions, discriminated result | `tests/shared/worktree-name.test.ts`, `tests/host/worktree-default.test.ts` |
| Creation input schema, auto-mode persistence | `tests/domain/task-creation.test.ts`, `tests/domain/hub-operations.test.ts` |
| Host preparation order, idempotency, failures, send mode | `tests/host/first-execution.test.ts`, `tests/host/app.test.ts` |
| Tool create_card behavior and outcome | `tests/host/card-tools.test.ts` |
| Dialog, start decision, preparing/countdown/failure UI | `tests/client/board.test.tsx`, `tests/client/auto-run-ui.test.tsx`, `tests/client/auto-run.test.ts` |
| Interactive preparation unchanged after the planner move | `tests/client/execution-preparation-gate.test.ts`, `tests/client/execution-preparation-controller.test.ts` |
| Appearance and countdown after creation | `tests/browser/auto-run.spec.ts`, `tests/browser/appearance.spec.ts` |
| Real composition: creation → sibling worktree → conversation → send, cancel, unchecked, auto mode, tool | `tests/e2e-dsh/kanban-auto-run.e2e.template.ts` plus a creation scenario |

## Risks / Trade-offs

- **A failure after creation is not part of the creation response** → The preparation is a separate command; the client records the failure on the card and the tool reports it. The card, the entry, any created worktree, and any conversation remain.
- **A client crash between creation and preparation leaves the card with the play action** → Accepted by the no-durable-startup decision; the entry stays unresolved and the play action can retry the preparation.
- **Creating the worktree can take seconds** → The card and drawer show a preparing state; the dialog closes immediately after the receipt. The command is serialized with other board commands, as worktree creation already is.
- **A sibling destination can collide across repositories** → The repository name is part of the folder and the existing collision rule advances the branch and destination together; name exhaustion is reported as an unavailable default rather than a silent fallback.
- **The countdown remains transient** → Reloading before the send sends nothing and restores the play action; this is the existing countdown contract.
- **Two clients or a retry could prepare twice** → Commands serialize; the use case returns an existing open conversation and skips worktree creation, so the second call does not create a duplicate conversation.
- **A changed entry instruction or a busy task** → The preparation validates the same identity and busy conditions as the send admission and fails visibly; the card keeps the play action.
- **The tool sends without a cancel window** → The agent surface has no countdown; the tool result reports the outcome, and a failure leaves the unresolved entry for a later manual run.
- **The first conversation's directory is fixed by its session header** → The preparation always creates the worktree before the conversation and waits for readiness; the automatic path never creates the conversation first.
- **A migration is unnecessary but the wire changes** → Client and host ship together; existing tasks, pending transitions, and worktrees are unaffected; rollback only reverts the plugin version.

## Migration Plan

- Additive behavior for existing tasks: no backfill, no data-version bump, no schema rewrite. A task created without the new options behaves as before.
- The new command, the `autoMode` creation field, and the discriminated `worktreeDefault` result are internal wire changes shipped in one plugin version.
- Existing interactive preparations, pending transitions, worktree bindings, and auto-mode states keep their current handling.
- Rollback is a plugin-version revert. Tasks created with the feature keep valid worktrees, conversations, auto mode, and entry markers; an unresolved entry remains actionable through the play action, and no cleanup is required.
