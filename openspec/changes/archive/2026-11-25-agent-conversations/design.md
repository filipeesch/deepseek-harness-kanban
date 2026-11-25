# Design

## Context

See `proposal.md` for motivation. The constraints that shape this design, verified in the current source:

- A task owns `sessionIds` and `closedSessionIds`; every entry instruction today targets `firstOpenSessionId` in about ten places, and `createConversationNow` in `src/host/app.ts` is the one creation path (it creates the native session, applies the board default preset, then the board default model, then the board tool policy, and only then adds the session to the task).
- The host allows a preset to be selected only before a conversation's first turn (`agent-preset/locked`); the model is a per-session selection applied after the preset, which recomposes the agent.
- The plugin registers its product tools at application scope, so a conversation sees all of them unless its own preset mounts `kanban-preset-tools` with a narrower allowlist. The board policy only masks MCP tools.
- The turn-end advance is per task: any open conversation that ends a `completed` turn arms it (`src/host/turn-advance.ts`), and `resolveAdvanceDecision` holds while any conversation is running or the task owes the user work.
- `send_task_message` refuses the sending task and always targets the target task's `firstOpenSessionId`; delivery is a native plugin-sourced message through `agent.steer`, so an idle target starts a turn immediately.
- `blocksAdvance` already treats an unresolved entry as a hold, and the card already reports a destination entry whose delivery failed with its run action available.
- Workflow writes reapply composed documents through text-range writers that preserve every authored character outside the rewritten field (for example `src/domain/board-agent-preset-field.ts`), and the board default preset resolves through `effectiveBoardPreset` from the authored scalar, then the implicit operator metadata, then the host default.
- Deleting a task already archives every conversation it owns (`src/host/session-archiver.ts`), so an agent conversation needs no deletion rule of its own.

## Goals / Non-Goals

**Goals:**

- One workflow contract: a board declares agents, a stage names one, and the stage's instruction runs in that agent's conversation.
- One resolution point for "which conversation owns this task right now", replacing the scattered first-open lookups so that delivery, advance, replies, and cross-card messages cannot disagree.
- A held stage entry that is visible on the card, recoverable with a retry, and neither silent nor destructive.
- A message path between conversations of one task that cannot start a second agent on the same work at the wrong moment.
- A legacy read path that never rewrites a board, and one write path that migrates when the person edits agents or defaults.

**Non-Goals:**

- Subagents cannot carry a preset; this change uses task conversations, not delegation.
- No new stage kind and no new routing owner. A stage with an agent is still an agent-instruction stage: it routes through declaration, auto mode, or the person.
- No tool masking for agent conversations, and no per-agent MCP allowlist.
- No queue or deferral for cross-task messages; only a message to the sending task itself can be deferred.
- No automatic archiving or removal of an agent conversation, and no conversation-to-conversation dialogue protocol beyond the existing message tool.
- No evaluation of authored `when` conditions at runtime, and no change to the decision or scripted stage contracts.

## Decisions

### D1 - Agents live at the document root, a stage references one by id

`agents` is a root list of `{id, name, preset, model?}`; a column names one with `agent: <id>`. Declaring the agent once makes "one conversation, one preset" structural instead of a rule the validator has to enforce per stage, and it gives the message tool and the UI a stable handle.

Alternative rejected: `agent_preset` and `model` on the column, one per stage. It repeats the preset on every stage and permits two stages that reuse a conversation to disagree, which the host cannot honour because the preset is locked after the first turn.

### D2 - `main` is implicit, always present, never removable

A document without `agents.main` keeps today's resolution. `agents.main` names the main conversation's agent; a `main` entry without `preset` is an explicit host default, with a preset it names that preset. Removing `main` is invalid. The main conversation is not created by a binding and is not removed with one.

Alternative rejected: `main` as a reserved id that must appear in every document. It forces every board to materialize a choice nobody made and turns the board operator default into a YAML literal.

### D3 - Legacy reading is unconditional; migration is one explicit gesture

Resolution order for the main agent stays: `agents.main`, then the authored root `agent_preset`/`model`, then the board metadata (`defaultPresetMode`), then the host default. The `agents` section is written only when the person edits the agents or the defaults surface; editing an instruction, a route, or a layout never rewrites the document into the new shape. The same write retires `defaultPresetMode` by materializing the effective choice on `main`.

Alternative rejected: migrate on any workflow edit. A one-character instruction edit would appear in the diff and in every published peer as a structural rewrite.

### D4 - The main conversation is the first open conversation with no agent binding

The task records a role per conversation (`sessionRoles`), and a conversation without a role is the main one. This preserves today's "first open conversation" for every board without agents, covers a task that starts in an agent stage (the main conversation simply does not exist until a shared stage needs it), and needs no separate "primary" pointer that could disagree with the conversation list.

Alternative rejected: record the first conversation ever created as primary. It breaks when the first conversation is an agent conversation, and a closed primary would need recreation rules that the ordered rule does not.

### D5 - One conversation per agent per task, created on demand

The agent id is the conversation's identity inside the task: two stages that name the same agent share one conversation and its history. The conversation is created the first time the task enters a stage that names the agent, in the task's effective directory, with the agent's preset and model applied before its first turn, and its native title set to the agent name. It is opened as the active drawer tab when the stage starts, reopened when the person had closed it, kept as an ordinary task conversation afterwards, and archived with the task.

Alternatives rejected: one conversation per stage visit (tabs accumulate on every review loop), one per preset (a renamed agent loses its history), and one conversation for every agent stage (two specialists share one history and one preset, which the host forbids).

### D6 - One conversation resolver owns every target

A single module answers, from the live task and workflow: the main conversation, the conversation of an agent, and the conversation that owns the current stage (the stage's agent conversation when the stage names an agent, the main conversation otherwise), creating the required conversation only through the existing creation path. Every current first-open lookup is replaced by it: the card run action, the timed instruction, the advance dispatch, the exceptional admission, cross-card delivery, the scripted handoff, and the drawer's run notice.

Alternative rejected: pass the target through each call site. That is the current shape, and it is exactly why the rule cannot be changed in one place today.

### D7 - Creating an agent conversation reuses the one creation path

`createConversationNow` gains the agent as an input instead of a second creation path. It keeps the worktree decision, the effective directory, the session creation, the preset-then-model order, the tool policy, and the archival on failure. The role is recorded in the same transaction that adds the session to the task, so a conversation can never exist in the task without its role.

Alternative rejected: create the session with the preset as a host creation option. The host exposes no such option, and the preset must be selected on the resolved agent before the first turn, which is exactly what the existing port does.

### D8 - A missing preset holds the entry; a missing model falls back

The creation path attempts the agent's preset through the existing port. When the host reports it unavailable, the new session is archived, nothing is added to the task, and the entry stays unresolved with a recorded hold naming the missing preset; the card presents it and offers a retry. A model the host does not offer falls back to the main agent's model and then to the deployment default, reported on the card and in the conversation, because a model is a route and the agent identity is intact.

Alternatives rejected: create the conversation on the host default preset with a notice (the stage would run with the wrong agent, which the person cannot see from the card), and refuse the move (the flow would stop in the previous stage with no card-level story).

### D9 - The specialist routes like any agent stage

Nothing new arms an advance. The stage instruction's prompt asks the specialist to declare `set_next_transition`; without a declaration, auto mode moves the task or the person does. This keeps the host free of a fourth routing owner and keeps a single rule: an agent stage is completed by its conversation's turn.

Consequence recorded for authoring: the specialist preset must not mask the product tools, or it cannot declare or message. The architect's guidance and the docs state it.

### D10 - Only the owning conversation arms the turn-end advance

The advance coordinator compares the ending session with the current stage's owner conversation before it queues a settle, and the admission re-reads the same owner. A reply to a finished specialist, a side conversation, or a cross-card message turn can no longer move the task. The hold conditions stay task-wide: a running or waiting conversation of the task still prevents the advance.

Alternative rejected: keep the current any-conversation rule. With agents it lets a chat about the design move the task out of the design stage.

### D11 - `send_task_message` gains a same-task target and a deferred stage

The tool keeps its shape and gains two optional arguments: `agent` (an agent id of the sending task) and `deliver_at` (a stage id). An omitted `task_id` means the sending task; without `agent` the target is the main conversation. A call that names the sending task and no agent is legal; a call that names another task ignores `agent` and `deliver_at` keeps the current immediate behavior for cross-task messages. `deliver_at` names an existing stage of the active workflow and holds the message in the task until the task first enters that stage. A held message is released together with that stage's instruction when the target conversation is the stage's owner, otherwise as its own message; a held message the flow never reaches (the stage is removed, or the task reaches a terminal stage without it) is discarded and recorded in the task history.

Alternatives rejected: the host deferring every same-task message until the stage ends (the sender loses the choice between "now" and "at the next stage"), and a relative `next` value (it removes the sender's ability to name its destination, which was the point of the decision).

### D12 - Deferred delivery is a task-local queue with one release point

`heldMessages` is a bounded list on the task record: identity from the sending session and tool call, the sender, the target agent or main, the destination stage, the body, and the time. Writing it is idempotent per call identity; releasing it is idempotent per message identity; it is never published and never shared. The release runs in the transition placement path before dispatch, so the message and the instruction it accompanies are composed against the same task state.

Alternative rejected: deliver the held message from the advance coordinator after dispatch. The placement is the one place that already knows the destination entry and holds the command lane.

### D13 - The board defaults own the agents

The Defaults sub-section presents the board's agents: `main` pinned and non-removable, each other agent with its name, preset, and model, an add and a remove action, and one save. A stored preset or model the host does not offer is presented as unavailable and is never rewritten. Saving is one guarded workflow write against the revision the surface opened with, and it is the write that migrates a legacy board. The model control described today stays as the main agent's model control.

Alternative rejected: a separate Agents sub-section. The defaults surface already owns preset and model, and splitting the main agent's fields from the other agents would let one save contradict the other.

### D14 - Availability is a warning in authoring, a hold at runtime

The architect's validation and the editor present an unavailable preset or model as a warning and still allow the document to be saved and published, because a board travels between installations with different rosters. Runtime enforces availability with the hold from D8.

### D15 - The stage editor's Stage tab gains the agent selection

The select lists the board's agents (main first) and an option for the main conversation. It writes the stage's `agent` key; clearing it returns the stage to the main conversation. It does not create agents; the architect tools and the defaults surface do.

### D16 - New architect tools are gated like every design tool

`set_agent` (create or replace one agent), `remove_agent` (refuse `main`, refuse an agent a stage names), and `set_stage_agent` (bind or clear a stage). They compose one document, validate it with the board's semantics, preserve every authored character outside the `agents` section and the named stage field, and return the existing write report with the new observations.

### D17 - Task additions are additive and local

`sessionRoles` maps a session to `{agent}`; absent means main. `heldMessages` carries deferred messages. Neither is published, and a task stored before the change reads as all-main with no held messages.

## Architecture

### New and changed modules

- `src/domain/agents.ts`: the agent list projection, the implicit `main` agent, id and name rules, and the reference from a stage.
- `src/domain/conversation-role.ts`: pure role helpers over `sessionIds`/`closedSessionIds`/`sessionRoles` (main first open, agent conversation, owner of a stage).
- `src/domain/held-message.ts`: the held-message record, its identity, and the orphan rule.
- `src/host/conversation-target.ts`: the resolver (D6) over the app's ports.
- `src/host/held-messages.ts`: write, release, and discard held messages.
- `src/host/tools/agents.ts`: the three architect tools.
- Client: `src/client/settings/board/board-agents-panel.tsx`, `src/client/stage/agent-section.tsx`, and the tab/creation changes under `src/client/conversations/`.
- Changed: `src/domain/workflow.ts`, `src/domain/schema-parts.ts`, `src/domain/board-preset.ts`, `src/domain/workflow-stage-read.ts`, `src/domain/workflow-diagnostics.ts` or the write report module, `src/host/app.ts`, `src/host/turn-advance.ts`, `src/host/advance-admission.ts`, `src/host/stage-instruction.ts`, `src/host/inter-card-messaging.ts`, `src/host/task-message-native.ts`, `src/host/stage-notice.ts` (only if the notice text must name the agent), `src/shared/types.ts`, `src/shared/conversations.ts`, `src/shared/task-message.ts`, and the remote schema in `src/remote.ts`.

### Resolution rules

| Question | Answer |
| --- | --- |
| Agent of a stage | `column.agent` resolved against `agents`, with `main` always resolvable |
| Main conversation | first open session without a role |
| Agent conversation | the session whose role names that agent |
| Owner of the current stage | the stage's agent conversation when the stage names an agent, otherwise the main conversation |
| Target of an entry instruction | the owner of the destination stage after the move |
| Target of a cross-card message | the target task's main conversation |
| Target of a same-task message | the named agent's conversation, or the main conversation |

### Stage entry flow

1. The move, the timed instruction, the card run action, the advance, or the first execution resolves the destination entry.
2. The resolver returns the owner conversation; for an agent stage it creates the conversation when the agent has none, applying the agent's preset and model before any turn.
3. A preset the host does not offer archives the unnamed session, records the hold, and leaves the entry unresolved.
4. Otherwise the existing admission delivers the instruction and clears the marker; the transition briefing, the declared reason, and the scripted handoff are unchanged.
5. Held messages naming this stage are released in the same placement transaction and delivered with the instruction when the conversation matches.

### Turn-end flow

1. The coordinator reads the task from the ending session and compares it with the current stage's owner.
2. Only the owner queues a settle; every other conversation ends a turn without arming anything.
3. The existing settle, pending-work read, and admission run unchanged, and the destination entry is resolved through the resolver.

### Write and migration flow

1. Reading parses `agents` when present and projects the implicit `main`; absent sections leave the legacy resolution untouched.
2. The defaults surface and `set_agent`/`remove_agent`/`set_stage_agent` compose one document.
3. The writer replaces the `agents` section text (or inserts it in root key order) and the named stage field, preserving everything else character for character, parses the result, and returns it.
4. The guarded board write stores it with the revision the surface opened with; the first such write materializes `main` and retires `defaultPresetMode`.

## Risks / Trade-offs

- **Two preset sources during migration** → the legacy read is unconditional and the new write is the only migration; tests cover every combination of `agents.main`, root scalar, and metadata.
- **A held entry stalls a task** → the unresolved entry already blocks the automatic advance, the card names the missing preset, and the retry is a visible action; no pause is recorded because nothing failed.
- **The owner rule changes today's multi-conversation behavior** → documented as a product decision; a side conversation no longer moves the task, and the specs state it once.
- **A locked preset cannot follow a workflow edit** → an existing agent conversation keeps its preset; a changed agent preset applies to conversations created afterwards, which the spec and docs state.
- **The specialist may lack the product tools** → the preset must not mask them to declare or message; the architect guidance, the docs, and the stage instruction carry the requirement.
- **`send_task_message` scope growth** → one optional stage argument, one queue, a call-time validation of the stage, idempotent write and release, and discard recorded in history; the tool description bounds its use to an explicit request or a stage instruction.
- **Concurrent conversation creation** → creation runs in the command lane and the target is re-read before delivery, so a concurrently created conversation is adopted rather than duplicated.
- **A list-of-maps rewrite can lose authored comments inside the section** → the guarantee is stated for text outside the written section; the writer parses before returning and the defaults surface presents the result.
- **Older peers cannot read `agents`** → publishing and export documentation states the upgrade requirement, and import reports the board as blocked instead of dropping fields.

## Migration Plan

- Ship additive: parsing accepts `agents`, the resolver and the owner rule read it, and nothing rewrites stored data.
- Existing boards and tasks keep behaving exactly as today, including the board default preset and model.
- A board migrates the first time the person saves the agents or the defaults surface; until then, the legacy fields stay authored.
- Rollback: a build without this change reads a board that still authors only legacy fields. A board that already authors `agents` is refused by that build with its validation problem, which is the documented compatibility boundary; restoring the legacy fields is the explicit way back.

## Open Questions

- Whether a stage that names an agent and authors no entry instruction is an authoring warning or simply a stage that never starts. The runtime answer is the same; the authoring surface message can be decided during Apply.
- The exact bound of the held-message queue per task, and the wording of the discard entry in task history. Both are local and can be tuned without touching the specs.
