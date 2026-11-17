# Tasks

## 1. Board default in the published log

- [x] 1.1 Add `board.preset-changed` to the event vocabulary at event format 6, carrying the board's default preset choice, and stamp it through `eventVersion`; verify the new event decodes and an unknown field shape is rejected in `tests/domain/journal-event.test.ts`.
- [x] 1.2 Fold the choice while folding the board's identity events so recovery obtains it independently of a whole-workflow checkpoint; verify a log with the event before a later checkpoint still yields the choice in `tests/domain/journal-log.test.ts`.
- [x] 1.3 Derive the event for a new board and for a changed choice in `deriveBoardChanges`, emitting nothing when the board records no choice; verify `tests/domain/journal-derive.test.ts` covers both and a legacy board.
- [x] 1.4 Summarize the change for the interface in `summarizeChanges` and label it in `src/client/sharing/status.ts`; verify the summary appears in `tests/domain/sharing-board-plan.test.ts` and the label renders in the changes list.

## 2. Apply and preserve the choice

- [x] 2.1 Add the applied choice as an optional field of `StoredBoard` and its strict schema, keeping the record layout version; verify an existing stored record without the field still loads in `tests/host/sharing-per-board-service.test.ts`.
- [x] 2.2 Apply the choice in `applyKey` when the installation creates or updates a board, removing the current deletion of the field on receive; verify a receive test asserts the created board's recorded choice and exact authored YAML.
- [x] 2.3 Include the choice in the board projection and in the revision records so a publish and an applied update both preserve it; verify the revision tests assert provenance on both sides.
- [x] 2.4 Publish the choice: append the event when the local board differs, and store the applied value in the mirror; verify publishing a board whose only difference is the choice appends exactly one event and leaves the board up to date.

## 3. Remove the blanket compatibility gate

- [x] 3.1 Delete `assertLegacyShareable`, `requiresProtectedStorage`, `compatibilityMessage`, and `incompatibleStorage` together with every call site; verify `grep -rn "SHARING_COMPATIBILITY_UNAVAILABLE\|assertLegacyShareable\|requiresProtectedStorage" src/` returns nothing.
- [x] 3.2 Add the per-board compatibility policy that decides whether this installation can read a board's log from its event kinds and versions; verify unit tests for a readable log, an unknown kind, and an unknown version.
- [x] 3.3 Accept a log that carries format 4, 5, or 6 events in apply, resolve, connection preview, and publish-initial; verify new suite cases that apply, resolve, preview, and replace a board carrying descriptions and a decision configuration.
- [x] 3.4 Derive before appending and make a publish with no difference a no-op that refreshes the board; verify a clean board publishes nothing, reports success, and stays up to date.
- [x] 3.5 Rewrite the suite cases that encode the gate and the permanent draft, keeping the black-box contract for every other behavior; verify `pnpm vitest run tests/host/sharing-per-board-service.test.ts tests/host/google-drive-local-runtime.test.ts` passes with no compatibility expectation left.

## 4. One comparison for local changes

- [x] 4.1 Create the domain comparison that decides whether two board documents differ, covering name, project scope, position, canonical workflow meaning, workflow description, stage descriptions, decision configurations, and the default preset choice; verify one unit test per field in `tests/domain/sharing-document.test.ts`.
- [x] 4.2 Use it in `evaluateBoard` for the board's state and draft flag, removing the preset presence shortcut and the description heuristic, and delete the duplicated `sameWorkflow`; verify `tests/domain/sharing-board-plan.test.ts` shows a matching board with a recorded choice as in sync.
- [x] 4.3 Use the same comparison for the change list and the publish derivation; verify a test asserting the invariant that a board is a draft exactly when the derivation is non-empty.
- [x] 4.4 Verify the Hub view reports no draft for a board whose only activity was moving tasks, in `tests/host/sharing-per-board-service.test.ts` (a task move leaves the board in sync) and `tests/domain/sharing-board-plan.test.ts`.

## 5. Interface reporting

- [x] 5.1 Make the team-changes banner name the active board when the change is that board's, state that another board of the Hub has pending work when it is not, and offer no publish action for an untouched board; verify `tests/client/team-banner.test.tsx` covers both texts and the absent action.
- [x] 5.2 Present a board's publish block where the publish action is offered instead of only failing after activation; verify `tests/client/team-banner.test.tsx` presents the reason in place of the action, and `tests/browser/board-banner-reporting.spec.ts` captures both the storage block and the per-board plugin update.
- [x] 5.3 Keep the banner dismissible with unchanged behavior for an unchanged pending state; verify the dismissal cases in `tests/client/team-banner.test.tsx` still pass.

## 6. Specs, documentation, and release

- [x] 6.1 Update `docs/user/team-sharing.md`, `docs/user/hubs-and-boards.md`, and `docs/operations/recovery.md` to describe the published default, the per-board plugin-update boundary, and the removal of the blanket incompatibility; verify `pnpm check` passes the documentation gate.
- [x] 6.2 Update `presets/skills/kanban-workflow-design/references/operations.md` so it no longer reports an unavailable compatibility boundary when a board carries descriptions, decisions, or a default; verify the reference stays under its size ceiling and still describes the plugin-update state.
- [x] 6.3 Bump `version` in `package.json` for the release that changes the installed artifact; verify the documentation gate reports no version contradiction.

## 7. Decompose the publishing service

- [x] 7.1 Introduce the session that owns record loading and saving, layout resolution, the readiness guard, and failure persistence, and inject it into the existing class; verify the suite passes with no behavior change.
- [x] 7.2 Extract the observer (check, observation, refresh, orphan reconnection) with focused unit tests; verify the black-box suite passes unchanged.
- [x] 7.3 Extract the applier (apply one or all boards, removal application, conflict resolution); its behavior is covered by the black-box contract in `tests/host/sharing-per-board-service.test.ts`, which passes unchanged.
- [x] 7.4 Extract the publisher (single and bulk publication, position calculation, stage-identity seeding); its behavior is covered by the black-box contract in `tests/host/sharing-per-board-service.test.ts`, which passes unchanged.
- [x] 7.5 Extract the removal operations (local removal, removal events, pending removals, restore) with focused unit tests for a retried and a refused removal in `tests/host/sharing-collaborators.test.ts`; verify the black-box suite passes unchanged.
- [x] 7.6 Extract the connection operations (preview, receive, publish-initial, orphan publication) and narrow the lifecycle port to exactly those four operations; verify focused tests in `tests/host/sharing-collaborators.test.ts` cover a preview that skips an unreadable board and a binding by name, and the lifecycle tests compile against the narrow port.
- [x] 7.7 Extract the layout-stamp policy (stamp creation and format negotiation) with focused unit tests; verify the version-negotiation cases pass.
- [x] 7.8 Reduce the original class to the facade over the collaborators, keeping its public surface, and delete what no longer belongs; verify no collaborator holds a mixed responsibility and the full suite passes.

## 8. Verification

- [x] 8.1 Run `pnpm check` and confirm typechecks, vitest, the build, and the documentation gate all pass.
- [x] 8.2 Run `pnpm test:browser` and confirm the banner and changes surfaces render in the light and dark fixtures with the pinned theme tokens.
- [x] 8.3 Run the isolated web lane from `docs/development/verification.md` against a throwaway `DSH_HOME` and confirm Team Settings reports per-board states, publishing a board with descriptions and a default succeeds, and a peer-facing plugin-update state is presented without blocking another board; store evidence under `.verification/` and never commit it.
- [x] 8.4 Run `openspec validate publish-board-metadata --strict` and confirm the change is valid before review.