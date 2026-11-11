# Design

## Context

See `proposal.md` - Why for motivation. The relevant behavior is specified by `specs/task-messages`, `specs/product-tools`, `specs/task-conversations`, and `specs/worktree-management`.

DeepSeek Harness keeps every chat as an independent native session. Its `send_message` is restricted to a subagent tree, and the durable `agent-message` source is produced only by subagent orchestration. The host does give a plugin the primitives this feature needs: `sessionController.resolveAgent` resumes a cold session, an `Agent` accepts `steer` (next step when running, a new turn when idle), and a plugin may declare its own durable message source.

The plugin already has the surrounding plumbing:

- `src/shared/ports.ts` exposes `SessionPort` with `create`, `directory`, `setDirectory`, `isIdle`, `send` (host prompt, user source), `deliverStageInstruction` (plugin source), `facts`, `archive`, `directories`, and `topology`.
- `src/host/task-locator.ts` maps a session to the task that owns it, and `HubRepository.findTask` resolves a task by identifier across Hubs.
- `src/host/native.ts` resolves an agent and delivers plugin-sourced messages for stage instructions; `src/host/stage-delivery.ts` already implements at-most-once delivery over the pending inbox and the durable log.
- `src/host/first-execution.ts` creates a default worktree and then a first conversation; `KanbanApp.createConversation` owns conversation retention, workspace binding, and effective-directory alignment.
- `src/host/tools/index.ts` composes product tools from small modules, and `src/client/context-row.tsx` builds a visible context row for any plugin source kind.
- `src/index.ts` composes the host adapters and the client registers chat definitions beside `kanban-task` and `stage-instruction`.

Constraints that shape the approach: no stored schema change, no Hub-state or sharing write, no deterministic consent detector, auto advance unchanged, no messaging policy in the `KanbanApp` facade, and no growth of the broad `SessionPort`.

## Goals / Non-Goals

**Goals:**

- Make the message a durable native record, delivered at most once, that wakes the target with the chosen steer semantics.
- Keep policy (scope, consent guidance, identity) in a testable service behind narrow ports.
- Confine the one serialized first-conversation preparation to a small app use case that shares the app's command ordering; it owns no messaging policy.
- Reuse the native context-row presentation and the existing first-conversation preparation instead of inventing parallel UI or worktree logic.
- Preserve the existing rule that a message is not user work: it must not affect pending-user-work, conversation titles, or auto-mode admission.
- Leave the codebase with less duplication than it has today: one generalized plugin-message delivery and one shared context-message factory.

**Non-Goals:**

- Threads, reply records, inbox/outbox, unread state, card badges, broadcasts, or a persisted message history.
- Cross-Hub messages, ordinary-chat senders, subagent senders, or messages to the sending task.
- Size limits, rate limits, deferral while the target awaits the user, or loop prevention.
- Changing how auto advance admits a settled turn.
- Reusing DSH's tree-scoped `send_message` or its `agent-message` source.

## Decisions

### 1. Tool, service, and ports; one serialized preparation use case

The tool is a thin adapter: it resolves the sending task from the calling session, validates the arguments, and delegates to `InterCardMessaging`. The service owns the policy (same Hub, different task, target conversation, delivery identity, result shape) and depends on ports rather than on `KanbanApp`:

```
[send_task_message]  (tool: args + exec.callId)
         |
         v
[InterCardMessaging]  (scope, identity, preparation, delivery)
   |              |                 |
   v              v                 v
[TaskScope]  [ConversationPreparer] [TaskMessageDelivery]
```

Alternatives considered:

- A `KanbanApp.sendTaskMessage` method: rejected. `src/host/app.ts` is already a large facade; a cross-cutting feature would grow it with policy that has nothing to do with Hub commands. The only app addition is `prepareMessageConversation`, a small use case that must share the app's command serialization with a concurrent user first-start; it contains no messaging policy.
- Logic inside the tool body: rejected. It would mix DSH execution context, policy, and delivery, and would be hard to test without a host.
- A separate package: rejected. The feature is small and belongs beside the board tools; a package would add distribution surface without a boundary benefit.

The composition stays in `src/index.ts`, matching how schedule and sharing runtimes are wired. Domain validation (non-empty body and content composition) stays pure and testable; the native message factory owns the notice-summary bound.

### 2. A narrow delivery port, not another `SessionPort` method

`SessionPort` is a native-adapter facade with eleven members; adding message delivery there would force every caller and fake to depend on a capability it does not use. Instead, a `TaskMessageDelivery` port exposes the one operation the service needs: deliver a prepared message to a resolved target session, at most once per identity. Its native adapter composes `sessionController.resolveAgent` and `agent.steer`.

The existing `createStageDelivery` is generalized into a source-kind-parameterized helper. Stage delivery keeps its `stage-instruction` source and request identity, and the new message delivery uses `task-message` with `[senderSessionId, callId]`. Both get the same three checks: in-flight join, pending-inbox check, and durable-log check. The durable-log check also treats a durable `agent/inbox/spliced` insertion as an admission, because steering persists there before any `user/message` and a canceled steering leaves only that insertion; a restart must not deliver the same identity again. This removes duplication and keeps the at-most-once rule in one place.

Alternatives considered:

- Extend `SessionPort` with `deliverTaskMessage`: rejected by interface segregation; the port would grow for a capability only one consumer uses.
- Implement deduplication inside the message service: rejected. That is exactly the algorithm already proven by stage delivery; duplicating it risks the two paths drifting.
- Use `sessionController.prompt` with `mode: 'queue'`: rejected. The host records that source as `user`, so the message would count as pending user work, affect title derivation, and appear as a human prompt.

### 3. A plugin-owned source with the notice form, delivered with `steer`

The durable source is `{ kind: 'task-message', form: 'notice', summary, requestId, senderTaskId, senderSessionId }`. The model-facing content carries the sender's Hub, board, task title, and identifier before the body. The summary is `Task message from <title>`, bounded with `boundContextSummary`.

Delivery calls `agent.steer(message)`. That single call already implements the chosen semantics: a running driver consumes it at its next step, and an idle driver starts a turn. No status branch is needed.

Alternatives considered:

- Reuse `agent-message`: rejected. The source is owned by subagent orchestration, its fields are fixed (`form`, `senderSessionId`), it offers no delivery identity for dedupe, and its statistics and auto-review consumers assume tree semantics.
- Deliver a user prompt: rejected for the same reason as decision 2.
- Use `followup` or `inject`: rejected because they do not match the chosen running-target behavior.
- Use a `relay` form: rejected. `relay` is the subagent-to-subagent presentation; a Kanban notice should read as an injected context row, and the plugin already owns that presentation for stage instructions.

### 4. Delivery identity is the tool call, not a caller-supplied id

The identity is `[String(senderSessionId), String(exec.callId)]`. A model retry or a transport replay of the same call reuses the call identity, so the target does not wake twice. A reply is a new tool call and therefore a new identity. The plugin never accepts an identity argument from the model; that would let a retry forge a new identity.

Alternatives considered:

- A random UUID per call: rejected. It would defeat deduplication on retry.
- A caller-provided `request_id`: rejected. The model does not need it, and it is easy to reuse or mistype.

### 5. Resolve the first open conversation, then prepare one

The service asks `firstOpenSessionId(task)` first. When it exists, the message goes there. When the task has no open conversation, a `ConversationPreparer` port runs one serialized preparation:

1. A worktree binding in the preparing or error state fails the delivery with `WORKTREE_BINDING_UNRESOLVED`; nothing is created.
2. For a Git-backed task with no worktree and no recorded base-project choice, derive the default worktree with the same `worktreeDefaultsFor` and `WorktreeCoordinator.request({ kind: 'create' })` used by the automatic first execution, and wait until it is ready.
3. Create the first conversation through the serialized `KanbanApp.createConversation` use case with `ensureFirst`, which enforces the resolved decision, aligns the task's effective directory, reserves the workspace, and retains the session.
4. Re-resolve the task and the first open conversation immediately before delivery, so a concurrent user action that created a conversation wins without a second one being created.

The preparation shares the app's command serialization so a user action and a message cannot race the same task into two conversations. A first-start `conversation.create` carries `ensureFirst`: it reuses the first open conversation when one appeared while the request was queued. The plus action omits it and intentionally creates another conversation. A real `Promise.all` test covers both queue orders. A plus action that runs after a preparation still creates a second conversation by design.

Alternatives considered:

- Reuse `prepareFirstExecution`: rejected. It requires an unresolved instructed entry, presents a five-second countdown path, and dispatches a stage instruction; the message must not move the task or run a stage instruction.
- Create the conversation in the project directory without the worktree decision: rejected. It places the target in the wrong directory and bypasses a persisted user choice.
- Refuse when no conversation exists: rejected by the chosen behavior; the user asked for automatic preparation.

The "blocked / create-default / base / none" decision is extracted into `worktreeDecision` in `src/domain/first-execution.ts`, so first execution and message preparation use one rule instead of two.

### 6. Message content and reply guidance

The content is a short header followed by the body:

```
Message from task "<title>" (<taskId>) in Hub "<hub>" on board "<board>".
Reply only if this message asks for a reply, or if the user asks you to.

<body>
```

The reply request itself is ordinary text the sender writes, as decided. The tool description states the rule for both sides: the sender includes the request when the user asked for a reply; the recipient replies only when the message asks, and uses `send_task_message` with the sending task as the target. There is no reply flag, thread, or record.

Alternatives considered:

- A `reply_requested` argument: rejected by the decision for text-only.
- A structured envelope that duplicates the body: rejected. It would create two sources of truth and a parsing burden for the model.

### 7. Consent stays an agent-use rule

The tool description requires the user's explicit request. Runtime validation is structural only: a task-owned sender, a target in the same Hub, a different task, and a non-empty body. There is no `confirmed` argument, approval dialog, or persisted consent record, matching the existing board-write rule. This is a guidance boundary, not a security boundary; the plugin does not claim otherwise.

Alternatives considered:

- A `confirmed: true` argument: rejected. It adds friction and a false sense of enforcement; the host has no deterministic consent signal.
- A product approval dialog: rejected. It would contradict the existing explicit-intent rule for board writes.

### 8. The transcript is the record

The message is a native `user/message` event with a plugin source. The target transcript is the durable record; there is no plugin storage domain, snapshot field, unread state, or message history. The client claims the source with an exclusive Chat Definition and delegates rendering to the host's native context-row component, with an inline fallback.

Alternatives considered:

- A per-session message store like the question store: rejected. It would add storage, snapshot merging, and read-state reconciliation for a feature that only needs a transcript row.
- A Hub-state message list: rejected. It would publish messages to team storage and mix conversation data with board data.
- A card badge: rejected. It needs read-state tracking and was explicitly excluded from the first version.

### 9. Client presentation reuses the context-row factory

`createContextRowDefinition('kanban-task-message', 'task-message')` plus `ContextRowView` with the title `Task message`. The definition is registered in `src/client.tsx` beside the task-context and stage-instruction definitions.

Refactor opportunity: the three node modules are nearly identical (a kind constant, a data type alias, a definition, and a view that delegates to `ContextRowView`). A small `createPluginContextRow({ nodeKind, sourceKind, title, fallbackClass })` factory would remove that duplication and make the next plugin message row a one-liner.

### 10. Testing and verification

- Host unit tests use the existing fake ports and a fake agent: scope rejection, same-task rejection, empty body, dedupe (pending and durable log), summary/content, steer delivery, and the first-conversation preparation matrix (default worktree, base choice, blocked binding, folder project, creation failure keeps the worktree).
- Client tests cover the definition match and the node payload, plus the fallback path.
- A browser test renders the row under the host theme fixture and asserts the expanded text.
- No real model traffic. `pnpm check` and `pnpm test:browser` remain the gates; no new dependency is introduced.

## Risks / Trade-offs

- [Agents can ping-pong] -> No rate limit was chosen. The tool description limits replies to messages that ask for one; transcripts make the loop visible. A future guardrail can be added without a spec change to delivery.
- [A running target can be redirected mid-turn] -> `steer` is the chosen semantics. The message is a notice row, and the target agent decides how to use it.
- [Preparing the first conversation creates a branch and directory] -> The behavior matches the automatic first execution, the result reports it, and a conversation failure keeps the created worktree.
- [A cold target session is resumed] -> Same cost as a stage instruction; the service resolves before checking the inbox so a restart-parked message is seen.
- [A concurrent user action races the preparation] -> The preparation is serialized, first-start creation uses `ensureFirst`, and the service re-resolves the task and the first open conversation immediately before delivery. A plus action still intentionally adds another conversation.
- [Auto advance may move a card after a message-driven turn] -> Accepted. The behavior is unchanged from any other completed turn and is covered by an explicit spec scenario.
- [Consent is guidance, not enforcement] -> Accepted. It matches every existing product write; the tool never presents itself as a security control.
- [A steering admission can be canceled before it becomes a `user/message`] -> The durable dedupe scans `agent/inbox/spliced` insertions for the same source kind and identity, so a restart does not re-deliver it.
- [A new durable source kind must replay] -> Plugin source kinds with extra fields are already used by `kanban-task` and `stage-instruction`; no format migration is needed.
- [The 120-character notice summary can truncate a long task title] -> Accepted. The expanded row carries the full body, including the sender identity header.

## Migration Plan

- No data migration: no stored Hub field, storage domain, or snapshot value changes.
- Deployment: version bump in the pull request that changes the installed artifact, per the project release rule.
- Rollback: remove the tool registration and the client definition. Messages already delivered remain as plugin-sourced context rows; an unclaimed plugin source is hidden by the host's ordinary context handling, so no history is lost.
- Documentation: update the README product boundary (the "no inter-card messaging" statement and the tool table). The `product-tools` purpose was updated with the change.

## Open Questions

None. The decisions that would change scope, behavior, or the task breakdown were resolved before this design.
