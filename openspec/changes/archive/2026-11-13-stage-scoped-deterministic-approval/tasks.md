# Tasks

## 1. Executable version and scope foundation

- [x] 1.1 Add a stage-scoped approval type (`hubId`, `boardId`, `stageIdentity`) and an `approvalScopeKey` helper, keeping the existing project-scoped key for variables and ownership; verify with a unit test that the stage key ignores the project and the variable key does not.
- [x] 1.2 Split capture planning into version computation and capture resolution so the version excludes `executionDirectory`; verify a unit test that the fingerprint is stable across task directories and changes for each reviewed input (bytes, language, source form or authored path, directory choice, exits, environment names, parameter names).
- [x] 1.3 Update the shared capture/version types and the admission checks so a capture still records its resolved directory and an execution is refused when that directory no longer matches the task; verify with the existing context-change test plus a new cross-directory reuse test.
- [x] 1.4 Move the trust store to the stage scope, record `approvedAt`, remove the unused `reject` method, and keep corrupt-record handling; verify lookup, idempotent approval, a project-scoped legacy file being ignored, and a corrupt record failing closed.

## 2. Supervisor approval behavior

- [x] 2.1 Use the approval scope for trust and keep the project scope for variables and ownership in the supervisor ports; verify a host test asserting both scopes reach the native runtime.
- [x] 2.2 Add stage-scoped approval (board, stage identity or id, fingerprint, optional task) with a stale-version rejection; verify approving a changed fingerprint fails with `STALE_VERSION` and runs nothing.
- [x] 2.3 Reconcile every waiting task of the board and stage whose capture matches the approved version; verify a host test where approving from one task starts two waiting tasks and leaves a task with a different version waiting.
- [x] 2.4 Present and enforce awaiting approval without Stop or Play, and resume the same captured execution on approval; verify a host test that approval keeps the execution identity and that the interface state exposes no Stop in that phase.
- [x] 2.5 Keep the runtime `TRUST_REQUIRED` recovery path and restart recovery working under the stage scope; verify recovery of an approved entry without a new request and a revoked native trust returning to awaiting approval.

## 3. Host commands and projections

- [x] 3.1 Add a stage-scoped version review projection covering captured and authored versions, the representative project used for a directory-dependent source, and the `directoryDependent` flag; verify with a host test for both captured and authored review.
- [x] 3.2 Replace the task-addressed review command and remote codec with the stage-scoped review, keeping an optional task context; verify the remote round trip and that an authored review creates no entry, conversation, or worktree.
- [x] 3.3 Replace the task-addressed approval command with the stage-scoped approval in the application dispatch, remote, and client bridge; verify approving from the editor with no entry and from a waiting card.
- [x] 3.4 Add a task-scoped local-variables query returning authorized names and configured state only; verify a host test that returns no values and a client test that never receives one.
- [x] 3.5 Change the script impact report to one authorization entry per deterministic stage for the board, with reasons for source, exits, environment, directory choice, parameters, unapproved version, and directory-dependent bytes; verify the impact tests and the write report tests.
- [x] 3.6 Remove the per-project authorization loop and the `execution-directory` verdict from the impact code, and update the workflow write response consumers; verify the report carries no project id per stage and no per-card verdict.

## 4. Client surfaces

- [x] 4.1 Extract a read-only CodeMirror view with TypeScript and Bash highlighting and add the language dependencies; verify a client test renders the exact reviewed bytes and the correct language mode.
- [x] 4.2 Rework the review dialog to the stage-scoped view model: exact program with highlighting, reviewed capabilities, no project variables, an approval action labeled for starting the waiting cards; verify the client tests for captured and authored reviews and for an absent approval on a replaced version.
- [x] 4.3 Extract the local-variables form into its own dialog opened from the script panel and from the missing-variable diagnostic; verify a client test that values are write-only, scoped to project and stage, and absent from the review.
- [x] 4.4 Present pending approval on the card through the existing presence pipeline: attention tint, approval mark with an accessible name, pending status line, and `Approve and run` replacing Stop and Play; verify dominance, priority, accessible names, and the one-line activity height in client tests.
- [x] 4.5 Add the board approval queue as a non-dismissible notice: one item per waiting stage version with its waiting card count and review action, ordered by board column; verify grouping, count, action, removal after approval, and absence with no waiting cards.
- [x] 4.6 Update the stage editor to present the stored version's approval state, keep the editor open after saving an unapproved version, and offer review and approval without saving or running code; verify approved, unapproved, and draft-versus-stored cases.
- [x] 4.7 Consolidate the duplicated script labels and phase predicates into one presentation module used by the card, drawer, and editor; verify the existing label tests pass through the single source.

## 5. Documentation and verification

- [x] 5.1 Update the workflow architect skill references that describe deterministic approval and stage execution, keeping the preset under its character limits; verify the bundle and skill paths in an isolated composition check.
- [x] 5.2 Extend the browser lane for light and dark appearance: card approval tint and contrast, approval mark size and name, queue layout, review highlighting, and the editor approval flow; verify `pnpm test:browser` and the screenshots under `.verification/`.
- [x] 5.3 Extend the isolated real-composition lane with card approval resuming a second waiting card, editor approval before the first card, a team update requiring new approval, and a directory-dependent source reporting its limitation; verify the `deterministic` lane passes.
- [x] 5.4 Run the full gates (`pnpm check`, `pnpm test:browser`, and the deterministic e2e lane) and record the results in the change; verify all pass with no owner profile or real model traffic.
- [x] 5.5 Bump the installed plugin version in `package.json` and confirm the profile reports the built artifact; verify the version in the packaged manifest and an isolated profile load.
