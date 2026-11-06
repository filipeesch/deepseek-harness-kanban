# Tasks

## 1. Domain: shared document and identity

- [x] 1.1 Add the shared document model (`version`, ordered boards with key, name, and authored workflow text) with strict validation and serialization; verify a round-trip unit test preserves the workflow text byte for byte, including comments and blank lines.
- [x] 1.2 Add the canonical document token and prove it is stable for identical content and changes for any board, name, order, or workflow change; verify token unit tests cover ordering and whitespace-only differences.
- [x] 1.3 Add the local projection from a Hub state (boards, names, order, authored YAML) and unit-test that projects, tasks, notes, Hub names, and settings never appear in the projection.
- [x] 1.4 Add board-key allocation, the `boardId → key` binding model, orphan anchors (`lastKey`, `lastPublishedName`), and locally removed markers; verify unit tests for key stability across renames, uniqueness, and orphan bookkeeping.

## 2. Domain: three-way plan and application

- [x] 2.1 Implement the published/received/local status comparison per Hub and per board; verify a table-driven test covers in-sync, draft, updates-available, needs-review, orphan, and removed-here.
- [x] 2.2 Implement the plan builder that computes applies, conflicts, refusals, removals, orphans, and automatic reconnections from the three inputs; verify tests for a team-only change, a local-only change, a both-sides change, and a remote removal with and without local work.
- [x] 2.3 Implement the refusal rules: a published workflow that leaves a task in an undefined column, and a published board colliding with an unpublished local board name; verify tests prove nothing applies and the refusal names the board, the column, and the task count.
- [x] 2.4 Implement the pure application of a plan onto a Hub draft, validating every board workflow before any mutation; verify tests prove the draft is unchanged when validation fails and that one Hub transaction yields either the whole plan or nothing.
- [x] 2.5 Implement reconnection precedence (exact key, then normalized name among orphans only) and prove no duplicate board is produced; verify tests for both paths and for the collision refusal when the local board is not an orphan.

## 3. Host: sharing state

- [x] 3.1 Declare the `kanban_sharing` domain (per-record table keyed by Hub id, versioned schema) with a strict record for binding, base document and token, board bindings, orphans, removed boards, and last check result; verify a persistence test opens, writes, reopens, and reads a record.
- [x] 3.2 Add the sharing state store adapter with load/save/delete and corruption handling that fails with a typed error instead of throwing raw schema messages; verify tests with a malformed record.

## 4. Host: provider boundary and Git adapter

- [x] 4.1 Add the `SharedConfigStore` port and the provider factory keyed by provider id, rejecting any provider other than Git with an explicit error; verify unit tests for the unsupported-provider path and for the read/write contract with an in-memory store.
- [x] 4.2 Implement the Git adapter over an injected command runner: ensure the managed clone under the resolved sharing root, read the document and token, and write a document only when the expected token still matches; verify integration tests using temporary repositories and a local bare repository as the team remote.
- [x] 4.3 Map adapter failures to typed problems (unreachable repository, authentication failure, stale token, invalid document) without leaking revision-control wording to the interface; verify tests for a stale token, a missing remote, and a malformed document.

## 5. Host: sharing service

- [x] 5.1 Create `HubSharingService` with a per-Hub serialized lane covering connect, disconnect, check, get updates, publish, resolve, restore, publish orphan, remove orphan, and interval changes; verify tests prove the lane rejects reentrancy and that every operation starts from the stored state.
- [x] 5.2 Implement connect and the first-connection flow (empty repository publishes; a repository with content previews and waits for adopt or publish); verify tests for both paths and for the unchanged Hub when the user cancels.
- [x] 5.3 Implement check and the Hub/board status projection, including drafts, updates, conflicts, unavailable state, and the last successful check; verify service tests with an in-memory provider that changes between calls.
- [x] 5.4 Implement get updates: build the plan, refuse the whole application when required, apply in one transaction, and record the received document; verify tests for partial merge, refusal, per-board choice, and no mutation on failure.
- [x] 5.5 Implement publish gating and the stale-token race: blocked while updates exist, nothing published on a lost race, drafts preserved, updates reported; verify tests for all three outcomes.
- [x] 5.6 Implement disconnect and Hub-deletion cleanup: remove the binding, stop checks, remove the managed clone, and keep all local boards and state; verify tests for disable, delete, and a Hub deleted while a check is queued.
- [x] 5.7 Implement board removal outcomes and orphan actions: local-only removal, team-wide removal draft, publish as new board, delete orphan, and restore locally removed board; verify tests for each outcome and for a team update that must not recreate a removed board.

## 6. Host: scheduler and integration

- [x] 6.1 Implement `SharingPollScheduler` with an injected clock and timer, per-Hub interval (default 5 minutes, minimum 1, zero disables), an immediate check after startup and after connect, skip-while-busy, and disposal; verify fake-timer tests for default, configured, disabled, busy, and dispose.
- [x] 6.2 Add the `sharing` map to the host snapshot and compose it in the app snapshot; verify a snapshot test covers an unpublished Hub (absent), a published Hub with updates, and a published Hub with a failed check.
- [x] 6.3 Add the `SharingCommand` union, its schema, the `kanban/sharing` remote descriptor, and the controller handler returning the updated snapshot; verify a controller test for a valid command, a rejected command, and a non-owner caller.
- [x] 6.4 Wire the sharing domain, service, scheduler, and Git adapter in `src/index.ts`, and dispose them with the plugin; verify the wiring test that closes the plugin without leaving a timer or an open domain.
- [x] 6.5 Extend Hub deletion to disconnect a published Hub locally and extend board deletion with the local-only or team-wide choice in the host command path; verify tests for a published Hub deletion (clone and binding removed, published document untouched) and for both board deletion choices.

## 7. Client

- [x] 7.1 Extend the client types and API for sharing commands and the snapshot projection; verify typecheck and a projection test for every Hub and board state.
- [x] 7.2 Replace the nested Configuration section rendering with a section registry while keeping General, Hub, Projects, and Board behavior identical; verify the existing browser tests still pass and the workflow draft survives tab switches.
- [x] 7.3 Build the Publishing section: connect form, interval, Hub status, per-board table, refusal detail, locally removed boards with restore, and the Connect, Publish, Get updates, Refresh, and Disconnect actions; verify browser-harness tests for the unpublished, published, updates-available, needs-review, and unavailable states.
- [x] 7.4 Add the board banner, the Hub tab indicator, and the per-board tab indicators with accessible labels; verify browser tests that the indicators survive an inactive Hub and board, and that the banner leads to the review.
- [x] 7.5 Add `Save and share` next to the quiet `Save` in the workflow editor, keeping the local save when the share fails; verify a browser test that the local save persists, the draft remains, and the failure is shown without losing the draft.
- [x] 7.6 Verify the interface never uses commit, branch, remote, fetch, or push wording in the Publishing section, banner, indicators, and errors; verify by reviewing the rendered strings in the browser harness snapshot.

## 8. Refactors bundled with the change

- [x] 8.1 Extract settings validation shared by the host settings command and the domain settings normalizer, removing the duplicated checks; verify the existing settings tests pass and a new test covers the shared rules once.
- [x] 8.2 Confirm `HubState`, `HubStateSchema`, `HubRepository`, and `HubStore` gained no publishing members; verify by diff review of those files.

## 9. Documentation and verification

- [x] 9.1 Document publishing in `README.md` and `docs/operations.md`: enable, clone location, publishing and updates, refusals and orphans, intervals, disabling, and the fact that no secret is stored; verify the docs describe only implemented behavior.
- [x] 9.2 Run `pnpm check` (host and client typechecks, vitest, build) and fix every failure.
- [x] 9.3 Run `pnpm test:browser` and fix every failure.
- [x] 9.4 Run `openspec validate hub-sharing --strict` and fix every artifact finding.
