# Tasks

## 1. Published layout and log format (domain)

- [x] 1.1 Replace the manifest module with a layout-stamp module that reads and writes `kanban-hub.yaml` carrying only `version: 4`, and verify the domain test covers: current version read, older version reported as absent, newer version refused, and no board fields accepted.
- [x] 1.2 Implement the JSON Lines event-log codec: encode one event per line, decode with per-event version, preserve retained stamps, and verify round-trip tests cover a multi-event log, an unknown kind, an unknown version, and an out-of-order sequence.
- [x] 1.3 Implement replay with a cursor: apply only events after a given sequence, start from the most recent whole-workflow event when the cursor precedes it, and verify a test recovers a board from genesis, from a checkpoint, and from a mid-log cursor with the same authored text.
- [x] 1.4 Implement the checkpoint rule: append a whole-workflow event when the events after the last whole-workflow event pass the bound, and verify a test proves the earlier events remain, the recovered workflow is unchanged, and retained stamps are untouched.
- [x] 1.5 Delete the snapshot/compaction code path and its tests, and verify no module exports a storage snapshot or compaction function and the suite passes.

## 2. Board identity events (domain)

- [x] 2.1 Add `board.renamed`, `board.scope-changed`, `board.rank-changed`, and `board.removed` to the event vocabulary with their codecs, and verify encoding, decoding, and replay tests cover each kind and the removal.
- [x] 2.2 Implement sparse rank generation and comparison, including inserting between two ranks and rebalancing when no rank fits, and verify a test orders a shuffled board list and moves one board with a single generated rank.
- [x] 2.3 Extend event derivation to emit identity events from the mirror to the local board (name, project scope, rank, removal) beside the workflow events, and verify a test derives a rename-only batch, a scope-only batch, a position-only batch, and a mixed batch.
- [x] 2.4 Extend materialization so identity events update the applied name, project scope, and position without rewriting the workflow, and verify a test applies an identity-only batch and leaves the authored workflow text unchanged.

## 3. One board state decision (domain)

- [x] 3.1 Replace `evaluateBoard` with a decision that takes the local board, its mirror, the last observed head, and its log, and returns one state plus the apply outcome and draft flag; verify tests cover in sync, workflow draft, identity draft, updates available, needs review, update required, and removed.
- [x] 3.2 Derive the draft flag by comparing the local board with the mirror, and verify a test proves a renamed board, a scope-changed board, and a reordered board are each drafts, and a workflow-equal board is not.
- [x] 3.3 Delete the host-side state function in the sharing view and make the view render the stored decision, and verify the view test asserts one state per board and no recomputation from digests.

## 4. Storage ports and providers (host)

- [x] 4.1 Replace the manifest and log ports with the layout boundary: stamp read/write, log enumeration, probe, read, create, and append against head; verify the contract test runs against a memory store and fails when an append head is stale.
- [x] 4.2 Rewrite the local-folder and Google Drive Local layout store for JSON Lines, enumeration of `*.jsonl` in `kanban-boards`, and conflict-copy detection over the stamp and the logs; verify the directory layout tests cover create, append, enumerate, a tombstoned log, an ignored non-`.jsonl` entry, and a conflict copy.
- [x] 4.3 Rewrite the Git layout store for enumeration and append under the clone's lane, and verify the Git layout test covers create, append, enumerate, and a stale append refused without changing the stored log.
- [x] 4.4 Rewrite the Google Drive Cloud layout store for sibling `.jsonl` files, a cached file-id map plus enumeration, and compare/verify around every write; verify the Drive layout tests cover create, append, enumeration from the file-id map, adoption by name, and a detected concurrent write.
- [x] 4.5 Implement the presence rule (stamp or at least one log) in every provider and in the Drive Local folder browser, and verify the browser and layout tests report presence for a stamp-only folder and for a log-only folder.

## 5. Per-board unit and service decomposition (host)

- [x] 5.1 Extract the lane registry and binding lifecycle from the publishing service into their own units, and verify the lane and lifecycle tests pass with the service reduced to routing them.
- [x] 5.2 Implement `BoardSync` with observe, evaluate, apply, publish, and mirror update for one board, and verify its tests cover a fresh board, a draft publish, an identity publish, a blocked publish, an apply, and a removal.
- [x] 5.3 Implement the publisher that derives the batch, appends it against the observed head, updates the mirror, and appends a checkpoint when due, and verify tests cover append, stale append, and checkpoint-on-bound.
- [x] 5.4 Implement the checker that reads the stamp, enumerates the logs, probes each, reads only changed or cursor-less logs, and stores counts without applying, and verify a test asserts no apply happens and an unchanged log is not read.
- [x] 5.5 Implement a Hub-level publish-all that iterates boards with local changes and reports a per-board outcome, and verify a test proves one board's failure does not stop another and no Hub-wide entry is written.
- [x] 5.6 Implement removal as a tombstone append and the orphan/reconnect rules against tombstones, and verify tests cover removal of an empty board, an orphan kept for a board with tasks, publishing an orphan as a new board, and a missing log that is not a removal.

## 6. Commands, types, and board administration (host)

- [x] 6.1 Replace `sharing.publish` with `sharing.publishAll` in the command schema and client API, remove the manifest-only command, and verify the schema test accepts the new command and rejects the old one.
- [x] 6.2 Update the sharing view type to carry per-board state, publish count, and update count, and drop the fields the new model does not have (`pending`, `orderChanged`, `removing`, `syncMode`, `repository`); verify the snapshot schema and its test round-trip the new shape.
- [x] 6.3 Route a team-scoped board removal through the per-board publish port as a tombstone, and verify the board-administration test asserts the tombstone publish and that a local-only removal publishes nothing.
- [x] 6.4 Keep the automatic publish-after-tool-write policy on the per-board path and verify the board tool tests assert a publish after create, rename, workflow save, workflow edit, and scope change, and no publish for a local-only removal.
- [x] 6.5 Delete the legacy record migration, the legacy document reader, the `legacyWorkflows` transport, and the old log versions; verify no `legacy` reader remains under sharing or the journal and the full unit suite passes.

## 7. Board publishing surface (client)

- [x] 7.1 Add one sharing action layer that dispatches publish, publish all, get updates, update board, and resolve with pending and failure state per scope, and verify its unit test covers dispatch, pending, and a reported failure.
- [x] 7.2 Move the workflow editor's share action onto the per-board publish and verify the browser test asserts a `sharing.publishBoard` command after the local save and that the board is no longer a draft.
- [x] 7.3 Extend the board banner to both directions (publish for local changes, get updates for team changes, review for a choice) and verify a browser test asserts each message and its action, and that dismissal resolves nothing.
- [x] 7.4 Present counts on the Hub tab and the board tab with accessible labels, and verify a browser test asserts the counts for one state, both states, and an inactive Hub.

## 8. Team Settings (client)

- [x] 8.1 Split Team Settings into the Connection area and the Changes area and show the storage cards only while unbound, and verify browser tests assert each area's contents and that the selector disappears once bound.
- [x] 8.2 Present one row per published board with its state, both counts, and its actions, plus the locally removed boards and Publish all / Get updates, and verify a browser test asserts the rows and each action's command.
- [x] 8.3 Remove the repeated connection details and the raw YAML panels from the section, and verify a test asserts the address, account, folder, and interval appear once and no `<pre>` workflow text is rendered.
- [x] 8.4 Render the semantic review summary with the full text on demand, and verify a browser test asserts the summary for a rename, a scope change, and a layout change, and that the full text is reachable.

## 9. Documentation

- [x] 9.1 Rewrite the README Team Settings and shared-document sections for the layout stamp, the per-board logs, per-board publishing, and the Connection/Changes split, and verify no sentence states the manifest, format version 2, or a Publish that sends every draft.
- [x] 9.2 Document the upgrade as forward-only with the reconnect step and the abandoned older layout, and verify the release note names both.

## 10. Verification

- [x] 10.1 Run `openspec validate --strict` on the change and verify it reports no issue.
- [x] 10.2 Run `pnpm check` and verify typechecks, unit tests, and the build pass.
- [x] 10.3 Run `pnpm test:browser` and verify the publishing and sharing evidence specs pass in light and dark appearance.
- [x] 10.4 Run `node scripts/e2e-dsh.mjs --checkout <dsh-checkout> --check --only hubs` and verify the isolated lane reaches the board with a connected storage.
- [x] 10.5 Run the isolated smoke checklist with a throwaway `DSH_HOME`: publish a board from its banner, publish all from Changes, get one board's updates, and verify no token or owner data appears in the screenshots under `.verification/`.
