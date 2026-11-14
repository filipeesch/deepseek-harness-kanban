# Proposal

## Why

Orchestrating a set of cards through the product requires reconstructing the project by hand. Cards record no relation to one another, so the parent epic, its children, the order between them, and who must report to whom exist only as prose inside card descriptions and as memory in the orchestrating agent. Every scan of that project costs one full read per card, and no read says whether a card's conversation is still working, waiting for a person, or already finished. The visible result is an orchestrator that cannot answer "how are my children now" or "did that card stop without telling me" from the product, even though the host already computes most of what is needed.

## What Changes

- Record relations between cards as typed edges stored in the Hub, outside the task record: `epic` (directed) and `related` (symmetric). Relations are N:N, must target a card in the same Hub, must not form an epic cycle, and are removed when either endpoint task is deleted. They are local to the installation and are never published to team storage.
- Expose relations to agents through three tools:
  - `create_relation` writes a batch of edges in one call, all-or-nothing.
  - `delete_relation` removes a batch of edges by identifier, all-or-nothing.
  - Card reads report outgoing and incoming relations with the other endpoint's identifier.
- Change the card read surface:
  - `list_cards` accepts `hub_id` and scans every board of that Hub, stops returning the description, and reports relation references.
  - `get_card` adds relations with the other card's identifier, title and stage, the per-task activity, and an epic roll-up of direct children with a limit and a truncation signal.
  - A new `get_cards` reads several cards in one call with the same compact payload as `list_cards`.
- Report per-task activity — running, pending user work, last settled turn, and background work — in card tool payloads, computed from the native conversation facts the host already owns.
- **BREAKING** `list_cards` and `get_cards` no longer return a card's description; reading a body requires `get_card`.
- **BREAKING** `get_card` returns the detail payload at the top level rather than wrapping the task under `task`: an instruction written against `result.task` must read the field directly. It also becomes the only read that returns a description.
- Extend the `send_task_message` result with the target's stage and activity at delivery, so a sender does not re-read the target to learn where the message landed.
- Add a read-only Relations section to the task drawer, presented before History. No relation writing is offered through the interface in this change.
- Authorize relation writes in the group that already covers `send_task_message` and `set_next_transition`: the user's explicit request, a direction in the stage instruction delivered to the conversation, or an explicit request in a cross-card message. A peer request authorizes no other write.

## Capabilities

### New Capabilities

- `task-relations`: the recorded relation graph between cards — its types, cardinality, scope, cycle rule, lifecycle with task deletion, local-only nature, the epic roll-up of direct children, and its read-only presentation in the task drawer.

### Modified Capabilities

- `product-tools`: the tool surface gains relation writes and a batch card read, `list_cards` gains Hub scope and loses the description, `get_card` gains relations, activity and the epic roll-up, card payloads carry per-task activity, and the authorization grouping of relation writes.
- `task-messages`: the `send_task_message` result reports the target's stage and activity at delivery in addition to the target task, its conversation, and any work created for the delivery.

## Impact

- **Domain**: the Hub aggregate gains a relations collection beside tasks and notes; task deletion removes incident edges; a Hub-level invariant pass validates that both endpoints exist in the Hub and that epic edges form no cycle. The per-task invariant checker from `schema-parts.ts` cannot see the graph and is not the place for the cycle rule.
- **Host tools**: a new relations tool module; `cards.ts` gains Hub-scoped listing, the batch read, and the epic roll-up; `messages.ts` and `inter-card-messaging.ts` extend the delivery result. The two card projection shapes become explicit and shared.
- **Host composition**: card reads stop being pure reads of the persisted Hub, because activity is resolved from native conversation facts. The activity source is injected so the tools stay testable without a live host.
- **Client**: a new drawer section, read-only. No board-card change is required for relations.
- **Sharing**: relations never enter the published layout. Card flow history stays out of tool payloads.
- **Not in this change**: dependency or blocker edges with an unblocked policy, the project card-creation contract, milestone recording, agent presets for planning and execution, and any change to the board workflow document format.
