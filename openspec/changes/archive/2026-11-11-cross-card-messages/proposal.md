# Proposal

## Why

DeepSeek Harness has no way for one chat to send a message to another independent chat: `send_message` works only inside a subagent tree, and the Kanban plugin explicitly excludes inter-card messaging. Cards are therefore isolated even when their agents need to hand off context, report an outcome, or ask another card to act. This change adds a user-authorized message from one task conversation to another task in the same Hub, delivered into the target conversation and visible in its transcript.

## What Changes

- Add `send_task_message` to the product tool surface. It is available only inside a task conversation, requires the user's explicit request, and targets another task in the same Hub.
- Deliver the message as a durable, plugin-sourced native message that starts its turn with the host's `steer` semantics: a running target reads it at its next step, an idle target starts a new turn.
- Present the message as one collapsed context row that names the sending task and expands to the full text, using the host's native context-row presentation.
- Always identify the sending task (Hub, board, title, and identifier) in the message content so the recipient can answer with the same tool.
- Allow a reply only when the received message's own text explicitly asks for one. There is no reply flag, thread, or reply record; the sender writes the request when the user asked for a reply.
- Resolve the target task's first open conversation. When the task has none, create its default worktree for a Git-backed task without a worktree and without a recorded base-project choice, then create the first conversation, which uses the deployment default model.
- Reject a message to the sending task itself and to a task in another Hub. Add no product message-size limit, delivery-rate limit, or deferral in this version.
- Keep every existing behavior unchanged: a message-triggered turn is an ordinary turn for auto mode, and no Hub state, note, team file, worktree branch beyond the first-conversation default, or sharing document records the message.
- Update the `product-tools`, `task-conversations`, and `worktree-management` specifications, and the README's product boundary and tool table.

## Capabilities

### New Capabilities
- `task-messages`: the cross-card message tool contract, consent and scope, durable delivery as conversation context, target conversation preparation, reply model, transcript row, and non-effects.

### Modified Capabilities
- `product-tools`: the product tool surface gains `send_task_message` and no longer excludes inter-card messaging; the explicit-user-intent rule and task-conversation availability cover it.
- `task-conversations`: a cross-card message delivery may create a task's first conversation, and that path uses the deployment default model.
- `worktree-management`: a cross-card message delivery that needs a first conversation creates the target's default worktree automatically and blocks on a preparing or error binding.

## Impact

- Host: new tool registration, a message service with narrow ports, a durable message source kind, target conversation and worktree preparation, and wiring. No stored schema or Hub-state change.
- Client: one new context-row definition for the message source, reusing the native context-row renderer. No new section, badge, unread state, or persisted plugin data.
- Docs: README product boundary and tool table, plus the `product-tools` purpose.
- Tests: host tests for scope, consent, deduplication, delivery, and first-conversation preparation; client tests for the row definition; a browser test for the rendered row. No real model traffic.
- Dependencies: none new.
