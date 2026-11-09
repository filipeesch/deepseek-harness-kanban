# Tasks

## 1. Domain model and schemas

- [x] 1.1 Add `allowedProjectKeys` to the `Board` type and to the Hub board schema as an optional list of unique project keys; verify with a schema test that a board with the field, a board without it, and a board with an empty list all round-trip, and that a duplicated key is rejected
- [x] 1.2 Add `projectKey` and `origin` to the `Project` type and schema, making `projectPath` required for a real project and forbidden-present for a published placeholder; verify with schema tests that a placeholder without a path parses, a placeholder with a path is rejected, and a real project without a path is rejected
- [x] 1.3 Create the pure project-scope module that answers "is this project allowed on this board", lists the creatable projects of a board, and lists the boards that reference a key; verify with domain tests covering an absent list, an empty list, a matching key, a missing key, and a placeholder
- [x] 1.4 Add the typed problems for a disallowed project, a placeholder project, and a duplicated project key, with messages that name the board or the key; verify each problem is asserted by the tests written in the following groups

## 2. Project key and placeholder lifecycle

- [x] 2.1 Implement deterministic key generation from a project name with a collision suffix over the existing key set; verify with a unit test that the same name and key set produce the same key, that a collision produces a suffix, and that the suffix is stable
- [x] 2.2 Backfill keys when the Hub opens, over the raw loaded records and before the aggregate is parsed, persisting once; verify with a host test that a Hub stored without keys opens with deterministic keys, that the second open writes nothing, and that two names that slug to the same value receive different keys
- [x] 2.3 Assign the key on a new project save and validate uniqueness within the Hub; verify with a host test that a duplicate key is rejected and that the stored project is unchanged
- [x] 2.4 Rewrite the key in every board scope of the Hub in the same transaction that changes a project key; verify with a host test that the board refers to the new key and no board refers to the old one
- [x] 2.5 Remove a project's key from every board scope of the Hub when the project is deleted, and allow deleting a placeholder without the project-in-use precondition; verify with a host test for both a project with cards on another board and a placeholder
- [x] 2.6 Reject every path-dependent operation for a placeholder — task creation, worktree defaults, workspace binding, and relocation — with the typed problem; verify with host tests that each operation reports adoption instead of an empty path
- [x] 2.7 Adopt a placeholder through the ordinary project save, keeping its key and requiring a project path; verify with a host test that the adopted project is selectable for a task and that its key is unchanged

## 3. Board scope write path

- [x] 3.1 Implement the board scope operation in the domain: store the list or clear it, reject a key that no project or placeholder of the Hub owns, and leave the workflow YAML untouched; verify with domain tests for restrict, unrestrict, close, and an unknown key
- [x] 3.2 Expose the scope through the board administration writer with the same revision precondition and publishing outcome as the other board writes; verify with a host test that a stale revision is rejected and that the publishing outcome matches the other board writes
- [x] 3.3 Add the wire command for the board scope with its payload validation and its client scoping rule; verify with a wire-schema test that a valid payload round-trips and that a duplicated key is rejected
- [x] 3.4 Keep the scope out of the workflow editor and out of the published workflow text; verify with a test that saving a scope leaves the workflow YAML byte-identical

## 4. Creation gate and agent surface

- [x] 4.1 Enforce the gate in the single domain task-creation entry: the project exists in the Hub, is not a placeholder, and the board either has no restriction or allows its key; verify with host tests for an unrestricted board, an allowed project, a disallowed project, a closed board, and a placeholder
- [x] 4.2 Remove the duplicated Hub-project check from `create_card` so the domain remains the only authority, and report the gate's problem with the board and project named; verify with a tool test that a disallowed project is rejected before any task is created
- [x] 4.3 Keep cross-board creation working: a task of one board creates a card on another board of the same Hub when the destination allows the project; verify with a tool test that the creating board's scope does not affect the destination
- [x] 4.4 Make `list_projects` return every project of the board's Hub with an `allowed` flag for the requested board, and make `get_board_summary` report the scope including the closed state; verify with tool tests for an unrestricted board, a restricted board, and a closed board

## 5. Client: board configuration, creation, and filter

- [x] 5.1 Split the board settings component into an identity block, a deletion block, and a project-scope block without changing the existing behavior of the first two; verify with a client test that the board section renders the three blocks and still saves a name and deletes an empty board
- [x] 5.2 Build the scope block: choose all projects or selected projects, list the Hub's projects with the number of cards each one has on the board, warn when no project is selected, and save with the Hub revision; verify with client tests for restrict, unrestrict, and the closed warning
- [x] 5.3 Make the New task project input offer only the projects the active board allows, omit placeholders, and present an explanation with saving unavailable when the board allows none; verify with client tests for an unrestricted board, a restricted board, and a closed board
- [x] 5.4 Derive the board's project filter options from the projects that already have cards on the board, independent of the scope; verify with a client test that a project with no cards is absent and a project that left the scope but still has cards is present
- [x] 5.5 Expose the project key in the project editor with its uniqueness error, and make the editor adopt a placeholder by requiring a path; verify with client tests for an edited key and for adopting a placeholder
- [x] 5.6 Present a placeholder in the project list as awaiting adoption, with no path and a way to edit it; verify with a client test that the placeholder row offers edit and does not offer deletion as an unusable project

## 6. Sharing: document version 2

- [x] 6.1 Extend the published document to version 2 with an optional project key list per board, omitted for an unrestricted board, and include the scope in the content key and the document token; verify with domain tests that a scope-only change changes the token and that an unrestricted board serializes without the field
- [x] 6.2 Read a version 1 document and normalize it to boards with no scope; verify with domain tests that a version 1 document parses, that its boards are unrestricted, and that a version 2 document round-trips
- [x] 6.3 Normalize the persisted publishing state to version 2 when it is loaded, before the stored documents are re-validated, so a record written against version 1 keeps its bindings, orphans, and removals; verify with a host test that opens version 1 state and asserts nothing was dropped
- [x] 6.4 Carry the scope through the three-way comparison: a scope difference counts as a board change, a team-only scope change applies, a both-sides scope change requires the per-board choice, and choosing local or team moves workflow and scope together; verify with plan tests for each case
- [x] 6.5 Apply a received scope to the board and create a placeholder for every key the Hub does not own; verify with apply tests that the board stores the keys, the placeholders appear once, and a repeated application creates no duplicate
- [x] 6.6 Block applying and publishing when the document version is newer than supported, keep local edits, and expose the state on the Hub publishing view; verify with a host test that nothing is applied, nothing is written to storage, and the local draft survives
- [x] 6.7 Present the outdated-plugin warning in the Team Settings panel and in the Hub publishing status, and clear it without user action once a supported document is read; verify with client tests for the warning and for its absence on a supported version

## 7. Workflow viewport persistence

- [x] 7.1 Add the per-board viewport preference map beside the existing presentation preference, with tolerant parsing and a best-effort write; verify with unit tests for a missing key, a malformed value, and a stored value
- [x] 7.2 Restore the stored position and zoom when a board opens and store the position when navigation settles, keeping each board's position separate; verify with a browser test that two boards keep different viewports across a switch
- [x] 7.3 Keep the workflow-change and fit paths re-framing the diagram and overwriting the stored position; verify with a browser test that a fit and a workflow change both become the stored value
- [x] 7.4 Confirm that navigation sends no command and changes no board data; verify with a browser test that panning and zooming issue no command and that the workflow YAML is unchanged

## 8. Integration, documentation, and release

- [x] 8.1 Update the README sections for board configuration, project keys and placeholders, the published document version, and the diagram viewport; verify the documented behavior matches the specs
- [x] 8.2 Bump the package version for the published artifact; verify the version is newer than the last released one and is not reused
- [x] 8.3 Run `pnpm check` and confirm host and client typechecks, unit tests, and the build pass
- [x] 8.4 Run `pnpm test:browser` and confirm the plugin-owned browser lane passes with the new viewport and board-configuration cases
- [x] 8.5 Run the isolated real-composition lane for the board, project, and sharing cases and confirm the gate, the placeholder lifecycle, and the version warning behave in the real composition
- [x] 8.6 Run the isolated web smoke from AGENTS.md and confirm the New task project input reflects the board scope, including with a project filter active, and that the publishing status reports an unsupported version when a newer document is present