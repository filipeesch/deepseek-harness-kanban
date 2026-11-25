# Proposal

## Why

Every agentic stage of a board runs in the task's first open conversation, so one task always speaks with one agent. A workflow cannot say that a stage belongs to a specialist: a design stage, a security review, a database migration, or a capability another plugin ships all have to be done by the conversation that carries the rest of the flow, or copied there by hand. The workflow has no place to name an agent, and the parser rejects a per-stage preset.

The product already has most of the mechanics: a task owns several native conversations, a conversation's agent preset is selected before its first turn, every task conversation receives the task context and is counted for pending work, and a completed turn can advance the task. What is missing is the workflow contract that says which conversation runs a stage, how control returns to the main conversation, and how the two exchange the result.

## What Changes

- A board declares its agents in its workflow. The `agents` root list carries `id`, `name`, `preset`, and an optional `model`; `main` is implicit, always present, and never removable. A stage names its agent with `agent: <id>`, so several stages can share one agent and one conversation.
- **A stage with an agent runs in that agent's conversation.** Its entry instruction is delivered there instead of to the task's first open conversation. The conversation is created with the agent's preset and model before its first turn, titled with the agent's name, opened when the stage starts, reopened when the person closed it, and kept as an ordinary task conversation afterwards.
- **A stage without an agent keeps the main conversation.** The main conversation is the first open conversation that carries no agent binding; when none is open, one is created for the main agent. Stages, cross-card messages, and replies target it exactly as they always have.
- **The workflow continues in the main conversation.** The specialist routes like any agent stage does: its prompt asks it to declare the transition, otherwise auto mode or the person moves the task. The host never advances on its own.
- **The result crosses conversations through the existing message tool.** `send_task_message` stops refusing the sending task: an omitted target names the task's main conversation and `agent: <id>` names an agent's conversation. It also gains `deliver_at: <stage>`: the host holds the message and delivers it when the task first enters that stage, together with that stage's instruction when the destination conversation is the same. A held message the flow never reaches is discarded and recorded in the task history.
- **Only the conversation that owns the current stage arms the turn-end advance.** A reply to a finished specialist, or a side conversation, can no longer move the task under auto mode.
- **An agent whose preset the host does not offer does not start.** No conversation is created; the entry stays unresolved, the card names the missing preset, and a retry action becomes available once the preset is installed. A missing model falls back to the main agent's model and then to the deployment default, with a notice.
- **The board configuration owns the agents.** The Defaults surface lists the board's agents with the main agent pinned and non-removable, edits each preset and model, reports an unavailable preset or model without rewriting it, and saves one guarded workflow write. Legacy boards keep resolving the root `agent_preset` scalar, the root `model` mapping, and the board-default metadata; the `agents` section is written when the person edits the agents or the defaults, never by an unrelated edit.
- The stage editor's Stage tab gains the agent selection, and the workflow architect gains `set_agent`, `remove_agent`, and `set_stage_agent` behind its existing gate. The write report names changed agent bindings and warns about a preset or model the host does not offer.
- **BREAKING for a compatible peer, not for the accepted behavior:** a published or exported workflow that authors `agents` requires a build that understands it. An older installation blocks that board with its validation problem instead of dropping the field, so every installation on a team must be updated before such a board is published.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflow-authoring`: the `agents` root list and the `agent` stage key, their validation, their preservation, the agent authoring tools, and the write report's agent observations.
- `kanban-board`: the agent conversation as the stage instruction's target, the held entry when the preset is unavailable, the advance armed only by the owning conversation, the agents surface in the board defaults, and the board default preset and model resolving through the main agent.
- `task-conversations`: agent conversations and their binding, their title and reopening, and the conversation-creation rules that now take the agent's preset and model.
- `task-messages`: a target of the same task addressed to an agent or the main conversation, deferred delivery into a stage, and the reply target.
- `stage-editing`: the agent selection in the stage editor's Stage tab.
- `workflow-transfer`: a document that authors agents is carried verbatim and blocks an installation that cannot read it.
- `task-history`: a message held for a stage that the flow never reaches is discarded and recorded as a flow fact.

## Impact

- **Domain:** the workflow parser and field schema (`src/domain/workflow.ts`, `src/domain/schema-parts.ts`), the agent list and binding projection, a stage-agent resolution module, the board preset resolution (`src/domain/board-preset.ts`), the workflow write report and diagnostics, and a pure held-message policy.
- **Host:** conversation creation and targeting in `src/host/app.ts`, one conversation resolver replacing the scattered first-open lookups, the turn-end advance (`src/host/turn-advance.ts`, `src/host/advance-admission.ts`), the stage instruction admission, the cross-card messaging and native delivery, the stage instruction tools, the agent authoring tools, and the board administration write path.
- **Shared:** the task record gains the conversation role and the held-message queue, and the message and workflow wire types gain the agent fields.
- **Client:** the drawer conversation tabs and creation flow, the stage editor, the board defaults surface, and the worktree/stage status copy that names the run target.
- **Presets and skills:** the workflow architect's tool allowlist and its YAML reference, and the operation skill's stage guidance.
- **Docs and specs:** `docs/user/workflows.md`, `docs/user/conversations.md`, `docs/user/agent-tools.md`, `docs/user/presets.md`, and the specification deltas listed above.
- **Compatibility:** stored tasks and boards without agent data are read by the legacy path; no task or conversation is rewritten. The only incompatible artifact is a workflow document that authors `agents`, which older builds refuse rather than silently ignore.
- **Verification:** deterministic tests with injected ports for parsing, preservation, conversation targeting, the held entry, the advance owner, deferred delivery, and the migration write; no acceptance run depends on a real model.
