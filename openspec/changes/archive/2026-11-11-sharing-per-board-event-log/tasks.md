# Tasks

## 1. Stage identity in the workflow model

- [x] 1.1 Add the optional stable stage identity to the workflow type, the YAML parser, and the canonical form, and verify with a unit test that a workflow with identities and a workflow without them both round-trip through parse and canonical serialization
- [x] 1.2 Enforce identity uniqueness in `hub-schema.ts` and accept its absence, and verify with a schema test that duplicates are rejected and an identity-free workflow is valid
- [x] 1.3 Preserve the identity through every authored-text edit path — a stage update, a literal workflow edit, and a whole-workflow save — and verify with a stage-update test and a board-workflow test that a rename and a field edit keep the identity
- [x] 1.4 Implement identity allocation and matching, by identity first and by authored identifier second, for a workflow read from a v1/v2 document and for a wholesale replacement, and verify with a matcher test covering a kept stage, a renamed stage, and a new stage

## 2. Journal domain (pure, no I/O)

- [x] 2.1 Write the event codec and the versioned event union with its per-event format version, and verify with a test that every event kind round-trips and an unknown kind or version is rejected
- [x] 2.2 Write the reducer, which materializes one event into the authored text and re-parses it, and verify with one test per event kind
- [x] 2.3 Write event derivation from the last published board state and the local board state, and verify that identical states derive no events, a rename derives exactly one identifier event, and a move derives exactly one layout event
- [x] 2.4 Write the materializer that turns one event into authored-text edits, reusing the existing text-range helpers, and verify that comments, key order, quoting, and untouched stages survive an applied event
- [x] 2.5 Write conflict classification for identity and lifecycle cases, and verify that a divergent rename, a rename of a missing stage, and a same-field change classify differently
- [x] 2.6 Write compaction into a snapshot plus tail with a bounded watermark, and verify that recovery from a snapshot reproduces the same workflow and keeps every stage identity

## 3. Ports and the hub manifest

- [x] 3.1 Define the `HubManifestStore` port and the v3 manifest shape with its version token, and verify with a document test covering read, write, canonical token, and a rejected malformed manifest
- [x] 3.2 Define the `BoardLogStore` port with read, append against an expected head, and change detection, and verify with a contract test that runs the same expectations against a fake store
- [x] 3.3 Rewrite `state.ts`, `view.ts`, and `service.ts` to depend on the manifest and board-log ports instead of the whole-document boundary, and verify with a type-check and the per-board view and runtime tests

## 4. Service decomposition

- [x] 4.1 Extract the lane registry (serialized lanes, in-flight tracking, reentrancy guard) and verify the existing lane tests pass unchanged
- [x] 4.2 Extract binding lifecycle — connect, receive, initial publish, change location, resolve, restore, orphan publish, and board removal — and verify the existing lifecycle tests pass unchanged
- [x] 4.3 Give the service a per-board unit of work owning a board's cursor, its apply, its publish, and its status, and verify with tests that two boards advance independently and that a publish refuses while one has unapplied events
- [x] 4.4 Add the remote checker that reads the manifest and only the board logs that changed, and verify with a test that an unchanged board is never read

## 5. Applying and publishing per board

- [x] 5.1 Build the per-board comparison that produces a decision, a draft state, and an update count for one board, and verify it with the decision matrix test
- [x] 5.2 Apply a board by migrating its task references in the same transaction that stores the workflow, and verify that a rename with tasks in the stage is applied with no refusal and no task left in an undefined stage
- [x] 5.3 Scope the destructive refusal to one board, and verify that a refused board leaves every other board applicable and publishable
- [x] 5.4 Publish one board by appending only its events, persist the identity derivation allocated for a newly published stage into the local authored workflow in the same operation, and write its manifest entry only when the manifest does not name it, and verify that a retried publish after a partial failure converges and that a second publish derives no new identity
- [x] 5.5 Publish the manifest for board names, order, project scope, and removal, and verify with a test that a manifest publish sends no board workflow
- [x] 5.6 Enforce board publication isolation end to end, and verify that a board needing a choice, a board with a concurrent write, and a board from a newer plugin each leave the others working

## 6. Storage providers

- [x] 6.1 Implement the Git provider for the manifest and per-board logs — both files in one commit, per-file heads, the observed commit in provider state, and change detection by commit range — and verify with the Git store tests
- [x] 6.2 Implement the local folder provider — per-file observations, a temporary sibling and rename per file, and conflict-copy detection covering the manifest and the board logs — and verify with the local folder tests
- [x] 6.3 Implement the Google Drive Local provider on top of the local folder provider, including the mount re-proof per operation, and verify with the Drive Local tests
- [x] 6.4 Implement the Google Drive Cloud provider — manifest file ID, board file ID map, change feed for detection, and compare-then-verify per file — and verify with the Drive store tests
- [x] 6.5 Make provider-state reading tolerant of absent fields, and verify that a stored record written before this change loads and re-establishes on the first check

## 7. Stored state and compatibility

- [x] 7.1 Extend the stored publishing record with per-board cursors, published board heads, the stored manifest, and the pending manifest change, and verify with a migration test that an existing record loads with its bindings, orphans, and removals intact
- [x] 7.2 Normalize a v1 and a v2 document into a manifest plus one genesis board log per board, with identities derived from the authored identifiers, and verify that an upgrading installation can check and apply without republishing
- [x] 7.3 Refuse a newer configuration for the whole Hub and a newer board log for that board alone, and verify that the per-board case leaves the other boards applicable and publishable

## 8. Interface

- [x] 8.1 Add a board-scoped update command and wire it through the remote schema, and verify with a command test that it reads and applies only the named board
- [x] 8.2 Put the update action on the board banner when the active board has team events, and verify with a browser test that the banner offers it and that a board needing a choice offers review instead
- [x] 8.3 Report the per-board state on the board tab and the aggregate on the Hub tab, and verify with a browser test that both appear together when more than one applies
- [x] 8.4 Present the per-board publish, the per-board update, the draft and update counts, and the pending manifest change in Team Settings, and verify with a browser test for each storage surface
- [x] 8.5 Remove the automatic synchronization path and its wording from the service, the scheduler wiring, and the interface, and verify that no reference to continuous synchronization remains

## 9. Cleanup and verification

- [x] 9.1 Collapse the retired whole-document stores into one layout store per storage, and verify that no module still names the retired boundary by type-checking the tree
- [x] 9.2 Keep project-key canonicalization in one implementation and verify that every caller imports it
- [x] 9.3 Run the fast gate and verify typecheck, unit tests, and build all pass
- [x] 9.4 Run the plugin-owned browser harness and verify the sharing surfaces pass in both color schemes with screenshots stored under the verification directory
- [x] 9.5 Run the isolated real-composition lane for the board and conversation checks and verify the short report under the verification directory
