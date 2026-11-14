# Tasks

## 1. Relation model in the Hub aggregate

- [x] 1.1 Add the `HubRelation` type to `src/shared/types.ts` and an optional relation collection to `HubState`, and declare the matching optional collection in `src/domain/schema-parts.ts`. Verify with `pnpm run typecheck` and by opening an existing Hub fixture that has no collection.
- [x] 1.2 Create the pure relation module in `src/domain/card-relation.ts`: canonical endpoint order for the symmetric type, direction derivation for one card, and rejection of a self edge. Verify with unit tests in `tests/domain/card-relation.test.ts` covering both types and both endpoint orders.
- [x] 1.3 Add the Hub-level relation validation pass in `src/domain/hub-schema.ts`: reject a relation whose endpoint task is absent from the Hub, a self edge, and an epic cycle. Verify with tests covering a chain, a diamond that is not a cycle, a three-node cycle, and a nested epic that stays acyclic.
- [x] 1.4 Rebuild a read-only relation index when a Hub opens and expose reverse lookup from it, so a card read never scans the collection per relation. Verify with a test that reads an index built from a fixture and reports both directions.
- [x] 1.5 Cascade relation removal inside `deleteTask` in `src/domain/hub-operations.ts`, in the same mutation. Verify with a test that deletes an epic and confirms its child relations are gone while an unrelated relation survives.

## 2. Aggregate operations for relation writes

- [x] 2.1 Add the `createRelation` aggregate operation taking a collection, applying all or nothing, with a limit of 100 relations per call and an allocated identifier per relation. Verify with tests for a full batch, a rejected batch leaving the document unchanged, and an over-limit batch.
- [x] 2.2 Add the `deleteRelation` aggregate operation taking a collection of identifiers, applying all or nothing and reporting an unknown identifier as a rejection. Verify with tests for a full batch and for a batch with one unknown identifier.
- [x] 2.3 Expose both operations through the Hub repository transaction path so a settled batch publishes one state change. Verify with a repository test that observes exactly one change notification per accepted batch.

## 3. Activity port

- [x] 3.1 Define the `TaskActivitySource` port and a pure aggregation function in `src/domain/task-activity.ts`: running when any conversation runs, union of pending kinds, summed queued prompts, background count, and each settled conversation's outcome. Verify with unit tests over zero, one, and several conversations, including a task with a closed conversation.
- [x] 3.2 Bind the port in the host composition to the attention coordinator's cached facts reader. Verify with a test that a fake source returning facts produces an aggregated value and that a source returning nothing produces the unavailable value without throwing.
- [x] 3.3 Register the collection and both new aggregate operations in the storage and schema tests that enumerate Hub document fields. Verify with `pnpm test`.

## 4. Card read projections

- [x] 4.1 Create the projection module in `src/host/card-projection.ts` with `compact` and `detail` shapes, moving the history and ledger exclusion inside it. Verify with unit tests asserting the compact shape has no description and the detail shape does.
- [x] 4.2 Add relation references to the compact shape: relation identifier, type, direction, and the other task identifier. Verify with a test over a card with one outgoing epic relation and one symmetric relation.
- [x] 4.3 Add the epic roll-up to the detail shape: direct children with identifier, title, stage, and activity, a limit of 50, the total child count, and a truncation flag. Verify with tests for no children, children within the limit, and children over the limit.
- [x] 4.4 Add activity to both shapes through the port, with the unavailable value propagated. Verify with a test that reads a card while the source is unavailable and still succeeds.
- [x] 4.5 Verify the detail shape keeps history and the deterministic ledger out of the payload. Verify with a test that seeds both and asserts neither appears.

## 5. Tool surface

- [x] 5.1 Extend `list_cards` in `src/host/tools/cards.ts` to accept a Hub identifier and select every board of that Hub, to return the compact shape, and to keep the title-and-description search filter. Verify with tool tests for a board scope, a Hub scope, and a query that matches only a description.
- [x] 5.2 Change `get_card` to return the detail shape. Verify with a tool test asserting description, relations with the other endpoint's title and stage, activity, and the epic roll-up.
- [x] 5.3 Add `get_cards` accepting a collection of identifiers, returning the compact shape in requested order without duplicates, reporting unknown identifiers separately, rejecting an empty collection, and reporting truncation above 100 identifiers. Verify with tool tests for each case.
- [x] 5.4 Add `src/host/tools/relations.ts` exposing `create_relation` and `delete_relation` over narrow ports rather than the whole app, with the batch contract, the empty-collection rejection, and non-concurrency-safe registration. Verify with tool tests and an assertion that both report `isConcurrencySafe === false`.
- [x] 5.5 Update the tool descriptions of both relation tools to state the authorization rule — user request, stage instruction, or peer request — and to name the direction of the epic type. Verify by reading the registered descriptions in a test.
- [x] 5.6 Register the new module in `src/host/tools/index.ts` and confirm the declared surface. Verify with a test that lists the registered tool names and finds the three new tools.

## 6. Delivery result

- [x] 6.1 Extend `src/host/inter-card-messaging.ts` and `src/shared/task-message.ts` so the result carries the target's stage identifier and activity, read through the activity port and resolved from the target immediately before delivery. Verify with tests for a running target, a settled target, and an unavailable activity source that still delivers.

## 7. Task drawer

- [x] 7.1 Add the read-only Relations section rendering outgoing then incoming relations with type and the other card's title, and place it before History in the drawer section order. Verify with a browser test in `tests/browser/relations.spec.ts` asserting the section order and the listed relations.
- [x] 7.2 Add the empty state and assert no create or remove action is rendered. Verify with browser tests for a card with no relation and for a card with relations.

## 8. Documentation and gates

- [x] 8.1 Update the tool table and the feature prose in `README.md` for the three new tools, the changed card reads, the activity payload, and the delivery result. Verify by reading the rendered section and confirming every named tool exists in the registered surface.
- [x] 8.2 Run `openspec validate card-relations --strict` and confirm the change validates. Verify by the command's exit status.
- [x] 8.3 Run `pnpm run check` and confirm typechecks, unit tests, and the build pass.
- [x] 8.4 Run `pnpm test:browser` and confirm the drawer and board browser lanes pass.
