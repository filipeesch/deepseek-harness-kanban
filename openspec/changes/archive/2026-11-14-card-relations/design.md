# Design

## Context

The Hub document already holds `tasks`, `notes`, and `schedules` as optional collections, and opening a stored Hub validates the whole aggregate. Two validation seams exist today: a per-task invariant pass shared by both aggregates (`createTaskInvariantChecker`), which receives one task at a time, and the Hub schema, which sees the whole document. Task deletion runs through one aggregate operation (`deleteTask`), and no tool deletes a task.

Card reads today are produced by two tools that each assemble their own object from the stored task, sharing only a helper that strips `history` and `deterministic` (`withoutHistory`). Activity is already computed per conversation by the host — `running`, `background`, `pending`, `settledTurn` — cached by an attention coordinator and published to the client in the host snapshot. No product tool reads it.

See proposal.md for motivation; see the spec deltas for required behavior.

## Goals / Non-Goals

**Goals:**

- Keep the relation graph a first-class Hub aggregate that validates as a whole, without enlarging the per-task invariant pass.
- Keep each read and write path small: one pure relation module, one projection module, one activity port, and thin tool modules.
- Make card reads cheap by default and expensive only on request.

**Non-Goals:**

- Dependency or blocker semantics, and any "unblocked" policy.
- Relation editing in the interface.
- Publishing relations, or relating cards across Hubs.
- Changing the board workflow document or the task record's persisted shape.
- Agent presets or role-based tool surfaces.

## Decisions

### Relations are a Hub collection, not a task field

A relation is stored as `{ id, type, from, to }` in a Hub-level collection. The alternative — a relation list on each task — was rejected because it forces every task projection to carry a graph concern, makes the inverse direction a second copy or a Hub-wide scan anyway, and gives the edge no identity for removal. A separate collection also lets `delete_relation` address an edge directly instead of reconstructing it from two endpoints.

The inverse direction is derived by indexing the collection in memory when a Hub opens, not stored twice. The index is rebuilt from the collection and never persisted, so it cannot diverge.

### Type semantics are fixed to two values

`epic` is directed from the epic to the child: the epic is the source. `related` is symmetric and stored once with its endpoints in a canonical order (lexicographic by task identifier), so a reverse request is deduplicated rather than creating a second row. A direction relative to a card is therefore derived at read time: `outgoing`, `incoming`, or `symmetric`.

An `epic` edge whose declaration is reversed would be indistinguishable from a correct one, so the tool contract states the direction explicitly and the roll-up reads only `from = card`.

### Graph validation lives in a Hub-level pass

The cycle rule needs the whole graph, so it cannot join the per-task checker, which receives one task and a column set. A dedicated relation pass runs inside the Hub aggregate validation and checks three things: both endpoints exist in the Hub, no self edge, and no epic cycle. Cycle detection is a depth-first walk over epic edges only, bounded by the number of tasks; it runs when the document is validated, not on every read.

Reference integrity is validation, not tolerance. A stored relation pointing at a missing task is invalid state and fails the Hub open, exactly like a task pointing at a missing project. This is why deletion must cascade in the same transaction rather than leaving cleanup to a later pass.

### Deletion cascades in the aggregate operation

`deleteTask` removes every relation whose source or target is the deleted task, in the same transaction that removes the task. The alternative — refusing a delete while relations exist — was rejected because it turns a single user action into a two-step procedure and leaves the graph inconsistent if the second step never happens.

### Two card projections, one module

A single projection module owns both shapes. `compact` produces the listing payload used by `list_cards` and `get_cards`: no description, relation references, activity. `detail` builds on `compact` and adds the description, the project record, board and Hub identity, relations with the other endpoint's title and stage, and the epic roll-up. `withoutHistory` becomes an internal step of that module instead of a helper each tool calls, so the rule "history and ledger stay out of tool payloads" has one home.

The alternative — one payload everywhere — was rejected: a Hub-wide listing would carry descriptions, which is the cost the change exists to remove.

### Activity is injected, aggregated, and never persisted

The tools receive a narrow `TaskActivitySource` port: given task session identifiers, return the per-conversation facts or nothing. The host binds that port to the attention coordinator's cached facts reader, which is already coalesced and retried, so a card read does not add a new native read pattern. The aggregation rule is fixed: running when any conversation runs, the union of pending kinds, the sum of queued prompts, the number of background activities, and each settled conversation's last outcome.

Reads never write and never persist activity. When the port returns nothing, the payload reports activity as unavailable; reporting idle would be a false answer, and failing the read would make a native hiccup look like a broken board.

### Batch operations are all-or-nothing and bounded

`create_relation` and `delete_relation` take a collection and apply all of it or none, matching the repository's existing partial-edit contract. Limits are fixed at 100 relations per write, 100 identifiers per `get_cards` call, and 50 children per epic roll-up; each reports truncation or rejects with an actionable problem rather than silently shortening.

### Card writes are exclusive and card reads are not

A card write is never concurrency-safe: `create_relation`, `delete_relation`, `create_card`, and `edit_card` declare no parallel-group claim, while `list_cards`, `get_card`, and `get_cards` do. Making `create_card` and `edit_card` exclusive is a correction of their previous claim, not a behavior change of the write itself.

### The batch read reports missing identifiers instead of failing

`get_cards` returns the cards that exist and lists the identifiers that name no task. Rejecting the whole call was rejected because a scan across a project routinely races a deletion, and a read that fails for one stale identifier is less useful than one that reports it.

### The delivery result describes its target

The send path already resolves the target task immediately before delivery. It gains the target's board stage and the same activity value a card read reports, read through the same port. A failure to read activity is caught and reported as unavailable; it never withholds a delivery that already succeeded.

### Interface is read-only and sits before History

A Relations section renders in the drawer from the task's relations, ordered outgoing then incoming, each naming its type and the other card's title. It renders before the History section and offers no write action. The alternative — writing from the drawer — would add a second authorization path for a write the tools already own.

## Risks / Trade-offs

- **Activity makes a card read depend on live native state** → the port is bound to an existing coalesced cache, an unavailable answer is explicit, and the read never blocks on a cold native scan beyond the coordinator's own retry policy.
- **A Hub-wide listing multiplies activity resolution** → the compact payload is resolved only for the cards actually returned after the limit, and the limit is explicit.
- **Cycle validation cost grows with the graph** → only epic edges are walked, and only during document validation.
- **Relations are invisible to teammates** → this is deliberate: the published layout carries boards, not the local task graph. Teams align on workflows, not on each other's cards.
- **A downgrade cannot read the new collection** → the stored field must exist in the schema from the first write, and an older version rejects the document. Downgrade across this change is unsupported, consistent with other optional collections.
- **The epic roll-up can be mistaken for a completion signal** → the roll-up reports stage and activity only, and no requirement lets the product infer an epic's completion from its children.

## Migration Plan

1. Extend the stored Hub schema with an optional relation collection and register the Hub-level relation validation. An absent collection means no relations, so no backfill runs and existing Hubs open unchanged.
2. Add the aggregate operations — create, delete, and the cascade inside task deletion — before any tool uses them.
3. Replace the two ad-hoc card payloads with the projection module, then add the batch read and the Hub-scoped listing.
4. Bind the activity port and extend the delivery result.
5. Add the drawer section.

Rollback: revert the tools and the drawer section, then the aggregate. A document written with relations cannot be read by a build that does not declare the collection; that is the only irreversible step, and it happens at the first relation write.

## Open Questions

None that change the specs, the approach, or the task breakdown. The numeric limits above are defaults chosen for this version and are recorded in the tasks that introduce them.
