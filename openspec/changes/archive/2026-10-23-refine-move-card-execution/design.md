# Design

## Context

See `proposal.md` for the motivation and `specs/` for the observable requirements.

The current client mounts one `MoveDialog` from the board (`src/client/board.tsx`) only when the destination column has an `onEnterPrompt`. The dialog shows the raw instruction, a conversation `<select>`, and Move and run / Move only / Cancel. The board's `requestMove` decides between an immediate move, a reorder, and that dialog. The host `task.move` command supports an optional `worktree`, a `mode: 'run'`, an exact `expectedInstruction`, and a persistent `PendingTransition` that is placed and sent by `drainPending` (`src/host/app.ts`).

The host already injects execution guards at `agent/pre-step` and `agent/request` (`src/index.ts`). The pinned SDK uses the same `agent/pre-step` mechanism for its own durable model-switch notice: it calls `next()`, then returns a decision with an additional `createUserMessage` carrying a producer source. The native Chat view classifies a `user/message` whose source kind is not `user` as a context node, but its `isVisibleChatNode` policy hides ordinary context nodes and retains only context with tool changes. The Kanban client therefore renders a plugin-owned task-context row above the native transcript from the retained session event window; the model still receives the native message.

The New task dialog initializes its project from `state.projects[0]?.id` (`src/client/forms.tsx`), so the first project is selected by position.

## Goals / Non-Goals

**Goals:**

- Make every permitted move immediate and organization-only; no move starts an agent.
- Make instruction execution explicit, deterministic, and available after the move.
- Give each task conversation its task context exactly once, through a native model-facing context message, not repeated message envelopes.
- Keep the drawer flow native: the instruction becomes an editable composer draft and the user presses Send.
- Remove the dialog, the conversation picker, and the run-mode pending transition from the UI path.
- Fix the card's nested-control structure while adding the card action.

**Non-Goals:**

- A one-shot "already ran" marker, per-stage run history, or a new persisted pending state.
- Backfilling the task context into conversations whose first message already exists.
- Changing worktree management, task deletion, questions, notes, or native session ownership.
- Removing the legacy `task.move` run command or its `worktree` field; only the UI stops using it.
- A new board capability, a new package, or a data-version migration.

## Decisions

### 1. Every move is an immediate plain move

`requestMove` always applies the move; the `MoveDialog`, the `move` state, and the instruction branch are removed. The drawer's stage control calls the same move path and awaits its result. The existing optimistic placement and rollback stay.

**Alternatives considered:** a compact chooser or redesigned dialog (rejected: it keeps a confirmation on a direct-manipulation gesture and still requires an agent choice); move-and-run through the legacy pending transition (rejected: it conflates organization with execution and keeps the "return to base" recovery semantics on a run-only action).

### 2. The card action runs the stage instruction directly

A focused `RunInstructionButton` renders on cards whose current stage has an `onEnterPrompt`. It sends a new `task.runInstruction` command with `taskId`, the current `columnId`, and the exact `expectedInstruction`.

The host validates that the task is still in that stage, has no unresolved context operation or confirmed transition, and that the instruction still equals the expected text. It resolves the target to the task's first open conversation, or creates a new conversation when none is open, runs `assertExecutionContext`, and sends **only the instruction**. It does not persist a pending transition. Admission failures surface inline on the card.

**Alternatives considered:** reuse `task.move` with `mode: 'run'` and the same column (rejected: move semantics, placement, and the pending/return recovery path are the wrong abstraction); send through the native client conversation service (rejected: bypasses the host's canonical directory and execution guards); open the drawer and prefill instead (reserved for the drawer flow; the card action is the fast, direct path the user asked for).

### 3. Card-link structure for the card action

The card becomes a container. An inner open button carries the accessible name and is stretched over the card surface; the play action, selection checkbox, and attention content remain siblings above that overlay. The card's article no longer has `role="button"`, `tabIndex`, or card-level Enter/Space handling. Dragging begins from the article's pointer-down, while nested actions stop propagation; the stretched open button is part of the card surface rather than a nested control.

**Alternatives considered:** keep `role="button"` and add keydown/click guards (rejected: it preserves an accessibility anti-pattern and makes the play action a nested interactive control).

### 4. The drawer moves, then inserts only the instruction

The drawer's stage control moves the task immediately. If the destination has an entry instruction, the drawer switches to Conversations and asks a small injected `InstructionDraftPort` to insert only that instruction into the active conversation's composer. The port is implemented in `src/client.tsx` over `ctx.conversation.input.requestDraftInitialization(binding, { prompt, clearPreviousDraft })` and `input.for(binding.ctx).focus()`.

- The target is the conversation tab being viewed; if none is active, the first open conversation. If no conversation is open, the drawer reports it and inserts nothing (the card action can still create one).
- Existing text and attachments are preserved. The drawer shows an explicit Replace action; Replace removes the attachment ids through the session input and then initializes the draft with `clearPreviousDraft: true`. Declining leaves the draft untouched.
- The port queues a request until the conversation's retained binding is attached, which supports the switch from Info/Git to Conversations. The request is abortable when the task changes or the drawer closes, and is consumed once. A pending prefill that never reaches a composer is cancelled after a bounded wait.
- If the composer is submitting, the port reports `blocked`; the drawer says so and inserts nothing.

**Alternatives considered:** send the instruction from the host (rejected: the user explicitly wants to review and press Send); leave the drawer on its current tab (rejected: the prefilled prompt would be invisible); overwrite without asking (rejected: destroys an unsent draft).

### 5. Native first-turn context injection and a visible Kanban row

A new `src/host/task-context.ts` registers an `agent/pre-step` listener. The listener calls `next()` first so the existing execution guards and any downstream middleware keep their decisions, then:

1. Returns the decision unchanged when it is a rejection, when the step has no messages, when the signal is already aborted, or when the agent was already checked.
2. Finds the task owning `payload.agent.id`; returns unchanged for non-task agents.
3. Reads durable history and checks the signal again before changing the decision.
4. Returns unchanged and memoizes the agent when the history already contains any `user/message` (including a prior injected context); otherwise prepends a `kanban-task` context message without memoizing. An aborted or uncommitted attempt can therefore retry; once the context is durable, the next inspection sees it and memoizes the agent.

The message is built with `createUserMessage` and the source `{ kind: 'kanban-task' }`. Its content is the task title, task identifier, description, and the workflow stage at first contact. The source type is declared through `MessageSourceMap` augmentation so `createUserMessage` is type-safe. No form is set. The message is durable and model-facing, does not start a turn, and is not rendered by the native Chat because current `isVisibleChatNode` hides ordinary context nodes. The Kanban conversation panel reads the retained session event window and renders a plugin-owned task-context row above the native transcript; the row names the `kanban-task` producer and reveals the full text on expansion. The plugin adds no separate paging control; use the native Chat's older-message paging to load earlier history. (A temporary plugin load-older action was removed during the later lifecycle cleanup.) A conversation without the durable message renders no row.

The history check is authoritative for "first message": the current step's messages are removed from the inbox before the pre-step and are not yet durable, so the first step sees no `user/message`. A retry or resume sees the context (or the user's first message) and skips. The injector memoizes only after durable history proves delivery; an aborted attempt is not memoized and may retry. The per-agent memo avoids inspecting history on every step once the context is durable; a `clear` that recreates or resets the agent naturally re-evaluates. Compaction keeps its native summary; the context is a normal durable message subject to it. A conversation whose first message predates this behavior is not backfilled.

**Alternatives considered:** `agent.inject` on `agent/created` (rejected: the agent may be created before a move, making the stage stale; the pre-step sees the latest task); seed the composer (rejected: it touches the user's draft and does not cover a normal first question without extra state); auto-send a context message at creation (rejected: it starts a turn and violates deliberate execution); inject hidden native request context (rejected: the user chose a context row that is visible in the conversation).

### 6. The instruction text is only the instruction

The board action and the composer prefill carry the raw stage instruction. The task context is supplied by the injected context message, not by a message envelope. The legacy `task.move` run path is updated to build only the instruction, so it cannot repeat the envelope if another caller still uses it. The old envelope text builder is removed from the run path.

**Alternatives considered:** keep the envelope in the first message text (rejected: it duplicates the visible task-context row and conflicts with "transitions only instructions").

### 7. Extract the shared transition rule

A small pure module (for example `src/domain/transitions.ts`, or a shared file with no `yaml` import) provides `canTransition(workflow, from, to)` and `permittedDestinations(workflow, from)`. The board's `allowedDestination`, the drawer's permitted list, and the host's `canTransition` use it. The same module keeps the host and client from drifting. The host's existing `canTransition` re-exports or delegates to it.

**Alternatives considered:** duplicate the rule in the new card/drawer code (rejected: the duplication already exists and is the kind of drift this change should not add).

### 8. The New task project starts empty

`NewTaskDialog` initializes the project state to `''` instead of the first project. The disabled placeholder, `required`, and the disabled Create button remain. No project is preselected even when the board is filtered to one project. No domain or command change is needed.

**Alternatives considered:** preselect the active project filter (rejected: the user asked for an always-empty, deliberate choice).

### 9. No new persisted state; one runtime dependency

The board state, schema, and data version are unchanged. The context lives in the native session log; the card action and drawer prefill are transient. `@deepseek-ai/dsh-llm` moves from a dev-only dependency to a runtime dependency for `createUserMessage`, `MessageSourceMap`, and the context source type. The host bundle already externalizes package dependencies, and the DSH host provides the pinned version.

**Alternatives considered:** hand-build a branded `UserMessage` (rejected: duplicates SDK freezing and identity rules); add a plugin-owned `pendingRun` field (rejected: no durable retry requirement for a card-level message send).

## Risks / Trade-offs

- **[The pre-step context injection depends on the returned messages being logged]** → It is the same mechanism the SDK uses for its model-switch notice, and the retained event window exposes the durable message. If the injection throws, report and return the original decision rather than failing the turn; the conversation continues without context.
- **[History inspection on the first step can be slow or fail]** → Inspect once per live agent, use the turn signal and a bounded timeout, and do not mark the agent checked on failure so a later step can retry.
- **[A resumed or compacted conversation may not show the context]** → Resume with history is intentionally not re-injected; compaction is a native boundary. The context is a normal durable message and is subject to the native summary, not a plugin-owned guarantee across compaction.
- **[The native Chat hides ordinary context rows]** → The Kanban client derives a visible task-context row from the retained event window (the same durable window the native Chat consumes). The row is presentation-only; the model message remains native. The row is absent for conversations whose first message predates this behavior.
- **[Draft initialization requires a retained binding]** → The port queues until the conversation attaches when the drawer switches to Conversations, is abortable on task change/drawer close, and consumes each request once. A blocked native initialization writes nothing; a request that never reaches a composer is cancelled after a bounded wait.
- **[Replace can lose attachments]** → The native initialization is authoritative and runs before any attachment removal. Replace changes text only when initialization applies, then removes attachments and reports `blocked` if a removal fails. The notice states that both text and attachments are replaced, the action requires an explicit click, and the user can retry or cancel.
- **[The card run has no persisted retry state]** → Admission failures are reported inline and the action remains available. A retry is a new send; the card/tooltip should point the user at the conversation if the admission outcome is uncertain. This matches an ordinary composer send more than the old transition flow.
- **[The legacy `task.move` run path can drift]** → Its text is made instruction-only and it keeps the exact-instruction guard; the UI no longer creates it. Removing the legacy command remains a separate cleanup.
- **[A large client surface changes]** → The MoveDialog and its tests are deleted; the card, drawer, forms, client draft port, and host command are the changed areas. The replacement coverage is specified in the Test Strategy below and in `tasks.md`.

## Test Strategy

Verification is layered so the plugin-owned behavior runs in memory, and only the SDK-owned surfaces need a real host.

**Cheap unit and module layer (the default for this change):**

- **Task-context message and decision** — extract the decision from the `agent/pre-step` registration, or inject `inspect` and `report`. Unit-test the message role/source/content, then the first step, later step, resume with history, non-task agent, rejection, empty step, inspect failure, and clear/new agent. One small Cordis `Context` test verifies the listener registration, prepend order, and disposal; the detailed cases use the pure decision.
- **Host run command** — use `KanbanApp` + `BoardStore` + `MemoryStorage` + `TestSessions` to test first-open and created-conversation targets, exact instruction-only text, no stage/position change, busy/moved/changed/cwd rejections, and the wire schema. This is an in-memory module test, not a native e2e.
- **Draft port** — define a narrow `DraftSession` adapter and fake it. Test queue-before-attach, applied/preserved/blocked, Replace removing attachments and setting `clearPreviousDraft`, focus, abort, and single consumption.
- **Client card and drawer** — jsdom `BoardView` + `fakeApi`: card-link open button/keyboard/drag/selection, card action presence/payload/disabled/selection/error, drawer move + switch + prefill, active/first/no-open target, preserve/Replace, abort, and the empty project default.
- **Bridge adapter** — a fake `conversation.input` in the existing bridge fixture verifies that `client.tsx` calls `requestDraftInitialization` with the retained binding and instruction, focuses, and does not submit or call a host command.
- **Pure helpers and schema** — the shared transition rule, the pure `runInstruction` command factory that the card action only renders and runs, and the `task.runInstruction` schema are tested directly.

**Replaced and updated coverage:**

- Delete the MoveDialog tests. Their stale-instruction guarantee moves to the host exact-instruction test and a client test that the card action sends the current instruction.
- Update the card drag test for the stretched open button; the article's pointer-down handler must treat that button as the surface, not a nested control.
- Update the instructed-move client tests to immediate moves plus the card action.
- Update the legacy `task.move` run text assertions from the envelope to instruction-only in the host app and product walkthrough; keep the pending/retry and changed-instruction coverage.
- Keep the native execution-guard tests and the deterministic adapter tests unchanged.

**One bounded acceptance smoke (not the cheap suite):**

- The native Chat and composer are SDK-owned; the plugin renders the task-context row above the native transcript from the retained event window. Run one owner-authorized GUI scenario: the first message shows that visible row and the user message contains only the question; a first transition inserts only the instruction and does not repeat the context; the card action runs without a dialog and leaves the stage unchanged; preserve/Replace works in the composer; a new conversation gets its own context; the New task project select is empty and required. Capture the evidence under `.verification/`.

**Known gaps:**

- The native Chat hides ordinary context rows; the plugin row's extraction and disclosure are covered by the bridge fixture, and the GUI smoke validates the visible integration. Composer contenteditable behavior and the real agent loop's logging remain native.
- Compaction is a native boundary; the context remains a normal durable message. The cheap tests cover resume with history and clear/new agent, not the native compaction policy itself.
- The card-link overlay's visual hit-testing is not meaningful in jsdom; the pointer-down test and the GUI smoke cover the behavior.

## Migration Plan

- No data migration. Board state, schema, and data version are unchanged.
- Existing tasks and conversations keep their history. Existing conversations with messages are not backfilled with the task context.
- Existing `PendingTransition` records remain readable/retryable by the current drawer status UI; the new UI does not create run transitions.
- Deploy by rebuilding the plugin and reconciling it through the supported native plugin operation; refresh the existing GUI. Rollback is a code revert: the injected context rows remain inert session history, and no board data is rewritten.
- Update the README, operations guide, and the two capability specs in the same change.

## Open Questions

None. The remaining details are implementation-level and do not change the specs, approach, or task breakdown.
