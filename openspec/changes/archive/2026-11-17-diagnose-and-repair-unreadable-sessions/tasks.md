# Tasks

## 1. Shared classification

- [x] 1.1 Add `src/domain/session-observation.ts` exporting the state type (`unreadable` | `missing`), a pure classifier from an error's `code`, and the presentation builders; verify with unit tests covering both codes, an unrelated code, and a missing code
- [x] 1.2 Verify the classifier never maps an unknown or absent code to a state, so an unclassified failure keeps the host's own presentation

## 2. Host observation record

- [x] 2.1 Add `ConversationObservationIndex` (`src/host/conversation-observation.ts`) that records one state per Session, notifies only on a change, and clears on recovery; verify with unit tests for record, idempotent re-record, clear, and notify-once
- [x] 2.2 Add the `createObservedFactsSource` decorator that classifies a rejected facts read into the index and clears it on success; verify with unit tests that a recognised rejection records, an unrelated rejection records nothing, and a later success clears
- [x] 2.3 Wire the decorator between the facts source and `AttentionCoordinator` in `src/host/app.ts`, and publish on change through the existing change notification; verify the app test shows a snapshot carrying the observation after a failed read

## 3. Wire surface

- [x] 3.1 Add `SessionObservation` and the optional `conversationObservations` field to `src/shared/types.ts`, and the matching field to the snapshot schema in `src/remote.ts`; verify the host and client typechecks pass
- [x] 3.2 Include the resolved observations in the snapshot assembly, omitted when empty; verify with an app test that a healthy board emits no field and a failing conversation emits one entry

## 4. Card status

- [x] 4.1 Extend `cardStatusEntries` with one optional observation input that emits a failure-toned line naming the state; verify with unit tests for unreadable, missing, and absent
- [x] 4.2 Feed the aggregated observation for a task's open conversations from the board projection in `src/client/task-card.tsx`; verify with a client test that the card shows the line while movable and editable

## 5. Diagnosis in the native conversation

- [x] 5.1 Register the diagnosis seat on `conversation.input.dock` in `src/client.tsx`, reading `props.useSession(s => s.openError)`; verify the registration is present at client activation in a client test
- [x] 5.2 Implement the seat (`src/client/session-diagnosis.tsx`): state, cause, Session identity, a details disclosure for the artifact location, and the recheck action; verify with client tests for each state and for the unclassified case rendering nothing
- [x] 5.3 Remove the `openState === 'error'` early return from `TaskConversationWindow`, so the host window renders and no plugin message about the same failure remains; verify the existing drawer open-failure test now asserts the diagnosis and the host window, and that no retry instruction is rendered
- [x] 5.4 Confirm one message only: verify a browser test asserts a single diagnosis and no plugin-owned "close and reopen" text in both the drawer and an ordinary chat

## 6. Artifact location and recheck

- [x] 6.1 Add `locate(sessionId)` to `session-history.ts` using `ctx.sessionPersistence.stat` (metadata only), returning path and revision or nothing; verify with host tests for a materialized artifact and for an absent log
- [x] 6.2 Add the `session.inspect` query that re-observes one Session and returns the diagnosis with the location; verify the query re-reads a repaired artifact and clears the record without a restart
- [x] 6.3 Expose `session.inspect` through the client bridge and wire the seat's recheck and details actions; verify by browser test that rechecking a repaired fixture clears the diagnosis

## 7. Repair pipeline

- [x] 7.1 Add the artifact scan and decode as pure functions (frame boundaries, one header line, record lines), porting the proven shape; verify with unit tests for a valid artifact, a torn final frame, and a malformed header
- [x] 7.2 Add the renumber plan and the frame-preserving rewrite as pure functions: first occurrence keeps its id, later collisions continue past the highest sequence for the root, only referencing records change, record count and order preserved; verify with fixture tests reproducing a repeated dispatch identifier and asserting the exact changed records
- [x] 7.3 Add the structural self-check that refuses an unexpected diff, a changed record count, a broken frame, or a surviving duplicate; verify each refusal with a test
- [x] 7.4 Add the loader-chain validator using the published host packages, resolved from the running host; verify it accepts the repaired fixture and rejects the original corrupt one, and that it reports unavailable rather than passing when the package is absent
- [x] 7.5 Implement the pipeline order from the design: live-Session refusal, revision read, plan, rewrite, validate, backup outside the sessions tree, temp write, atomic rename, verifying re-read, restore on failure; verify with host tests for success, each refusal, and restore
- [x] 7.6 Add the `session.repair` command returning the backup path or a coded `Problem`, wire it through the remote and the bridge, and gate the seat's repair action behind an explicit confirmation; verify by browser test that declining the confirmation writes nothing and that a successful repair clears the diagnosis

## 8. Send gating and read-only guarantees

- [x] 8.1 Refuse the plugin's own send paths (card run action and stage-instruction delivery) when the target conversation is recorded as unobservable, returning the diagnosis; verify with host tests for the refusal and for the untouched artifact
- [x] 8.2 Stay silent on an unobservable target in the automatic first-execution and advance paths, so the failure is reported rather than retried; verify the affected app tests still pass
- [x] 8.3 Add the read-only test: classification, diagnosis, and recheck leave the artifact's revision unchanged; verify the test asserts the revision before and after each action
- [x] 8.4 Update the spec-derived expectations in `openspec/specs/task-conversations` and `openspec/specs/kanban-board` only through this change's deltas; verify `openspec validate --strict` passes for the change

## 9. Verification and release

- [x] 9.1 Run `pnpm check` and resolve every host, client, and unit-test failure
- [x] 9.2 Run `pnpm test:browser` and confirm the card line, the drawer seat, and the ordinary-chat seat render in both color schemes, with screenshots under `.verification/`
- [x] 9.3 Bump `version` in `package.json` and verify the manifest matches the installed artifact
- [x] 9.4 Record in the pull request that the writer fix and the official repair command remain in separate changes
