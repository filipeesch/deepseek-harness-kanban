## 1. Persisted entry marker

- [x] 1.1 Add the optional task `instructionPending` field to shared types and the board schema, validating its column reference; verify old boards without the field still load.
- [x] 1.2 Set the marker on creation in an instructed initial stage and when a move enters an instructed stage; clear it on entering an uninstructed stage; preserve it on same-stage reorder.

## 2. Prompt clearing

- [x] 2.1 Clear the marker on a `user/message` with source kind `user` in any task conversation, comparing event time with the entry time; ignore injected task-context messages and admission failures.
- [x] 2.2 Reconcile unresolved markers against durable session history during host initialization.

## 3. Card presentation and width

- [x] 3.1 Render the card instruction action only when the current instructed stage has an unresolved entry marker.
- [x] 3.2 Reduce the default column slot width from 300px to 240px and the minimum from 260px to 208px.
- [x] 3.3 Remove the custom older-message loader from the task-context row and update docs/tests to use the native Chat's paging instead.

## 4. Verification

- [x] 4.1 Add host tests for entry, any-prompt clearing, ignored context messages, admission failure, reorder, leave/re-enter, new-task initial stage, and restart reconciliation.
- [x] 4.2 Add client tests for action visibility with and without a marker and for the post-move action; update fixtures and the fake API.
- [x] 4.3 Add a style assertion for the 20% narrower columns and run the browser layout test.
- [x] 4.4 Run `pnpm run typecheck`, `pnpm test`, `pnpm run test:browser`, `pnpm run build`, and `openspec validate refine-instruction-action-lifecycle --strict`; fix failures.
