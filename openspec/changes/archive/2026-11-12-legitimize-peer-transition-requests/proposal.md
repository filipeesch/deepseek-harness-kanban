# Proposal

## Why

A task conversation can already message another task, and a task can already move itself at the end of a turn by declaring a transition, even with auto mode off. The contract does not let those two capabilities compose: `set_next_transition` is described as available only when the user or the stage instruction asked for the declaration, and `send_task_message` requires the sending user's explicit request. A coordinator task therefore cannot hand a stage over to a peer through a message — the peer's agent is told not to declare, and the sender cannot start a handoff from its own stage instruction.

## What Changes

- A cross-card message may explicitly request that the receiving task declare the transition its body names. The receiving task decides under its own rules: the destination must be a target the message names and its current stage configures, the reason is still required, its own stage instruction and conditions still govern whether it may leave, and a stage already executing deterministic steps still routes through its captured exit. The request never moves the card by itself.
- `send_task_message` becomes available when the sending conversation's stage instruction explicitly directs the handoff, in addition to the user's explicit request. Sending a message merely to record the agent's own progress stays unauthorized.
- The sending agent is guided to read the target's allowed transitions before composing the request and to include the target stage identifier and the reason in the body. No argument, schema, or send-time validation is added: a request the target cannot satisfy fails in the target's turn.
- What counts as an explicit request is agent judgment over the message text. The plugin adds no marker, envelope, or deterministic check.
- The preset documentation separates the two authorization scopes: a stage instruction may authorize a handoff message and a routing request, while task, board, note, and team-file writes still require the user's explicit request.
- One internal refactor: the per-origin advance-arming condition becomes a single domain function shared by the turn observation and the advance admission, so the two reads cannot drift.

No change is made to the advance machinery, the message delivery, the transcript presentation, or auto mode.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `task-messages`: the tool-authorization rule gains the sending stage instruction, and a new requirement states the peer transition request and the recipient's decision rule.
- `product-tools`: the `set_next_transition` trigger gains an explicit peer request, and the `send_task_message` authorization scenarios gain the stage-instruction source.

## Impact

- Tools: the descriptions of `send_task_message` and `set_next_transition` change; neither tool gains, removes, or renames an argument.
- Specs: `task-messages` and `product-tools` receive delta requirements. The advance requirements in `kanban-board` already cover a reason-carrying recording and stay unchanged.
- Code: `src/domain/transition-route.ts` gains the per-origin arming predicate and `src/host/advance-admission.ts` consumes it; advisory text changes in `src/host/tools/messages.ts` and `src/host/tools/transitions.ts`.
- Documentation: `README.md`, `presets/skills/kanban-workflow-design/references/coordination.md`, `presets/skills/kanban-workflow-design/references/operations.md`, and the preset `SKILL.md` where its scope summary repeats the rule.
- Tests: host unit tests for the arming predicate and for the message-to-declared-advance composition, including the negative case where a message alone moves nothing.
- No change to stored schemas, Hub state, worktrees, delivery identity, or client presentation.
