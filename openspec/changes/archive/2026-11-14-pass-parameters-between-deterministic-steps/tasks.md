# Tasks

## 1. Completion contract and durable shapes

- [x] 1.1 Extend the shared deterministic types with an optional completion params map, an optional sent map on the saved result and the handoff, and an optional sent map on the handoff history entry; update the strict durable schemas. Verify with `pnpm typecheck` and the schema tests in `tests/domain/deterministic-state.test.ts`.
- [x] 1.2 Add one pure completion validator under `src/domain/` that accepts exit, message, and an optional params map, enforces the accepted name/value/count/total bounds and the whole-document completion bound, and returns a typed failure instead of throwing. Verify with new unit tests covering a valid map, a malformed map, an oversized map, and a completion with extra fields.
- [x] 1.3 Replace the executor's local completion shape checks with the shared validator and redact every accepted parameter value with the existing secret redactor before returning. Verify with `tests/host/deterministic-runtime.test.ts` plus a test that a known secret is redacted from a returned value.
- [x] 1.4 Replace the supervisor's duplicate completion shape checks with the shared validator and adapt its typed failure to the existing contract failure. Verify with `tests/host/deterministic-supervisor.test.ts` and `tests/host/deterministic-delivery.test.ts`.

## 2. Exact-name binding and routing

- [x] 2.1 Add a pure exact-name binding function to `src/domain/deterministic-parameters.ts` that returns only the sent values whose names the destination declares and leaves extras and missing names to the caller. Verify with `tests/domain/deterministic-parameters.test.ts` covering match, extra, missing, rename-not-matched, and bounds.
- [x] 2.2 Persist the sent map on the saved result and reuse it on delivery retry, recovery, and explicit delivery, without running the program again. Verify with the retry and recovery cases in `tests/host/deterministic-supervisor.test.ts` and `tests/host/deterministic-delivery.test.ts`.
- [x] 2.3 Resolve the captured destination's live declaration in `src/host/deterministic-routing.ts`, bind the sent values by exact name, pass the bound map through the existing `placeTask` parameters path, and attach the sent map to the new handoff in the same task transaction. Verify with `tests/host/deterministic-routing.test.ts` for a script-to-script route, a missing declared name, an extra sent name, and a changed destination declaration.
- [x] 2.4 Keep the raw sent map out of the script input while preserving the declared names in `input.params`; keep the handoff's exit and message. Verify with `tests/host/deterministic-input.test.ts` and a case where the destination declares no parameters.
- [x] 2.5 Add an integration case for a two-script chain that proves the second entry receives the first result's values, a missing value stays repairable in place, and the route does not follow the error exit. Verify with `tests/host/deterministic-app.test.ts`.

## 3. Conversation context and history

- [x] 3.1 Append a bounded "Sent parameters" section to the existing handoff context block used by agent instruction delivery and manual pre-step injection, with the same redaction and a presentation cap. Verify with `tests/host/deterministic-handoff.test.ts` and the stage-message tests.
- [x] 3.2 Record the sent map on the logical handoff entry for both acceptance and failure, bounded and redacted, without adding a duplicate occurrence on retry or recovery. Verify with the history record tests and the duplicate-prevention case in `tests/host/deterministic-supervisor.test.ts`.
- [x] 3.3 Present the sent values in the handoff row's History Detail, identified as values sent by the source, and do not present them as the destination's execution values. Verify with `tests/client/history-view.test.ts` and `tests/client/history-panel.test.tsx`.
- [x] 3.4 Confirm the drawer panel keeps the existing parameter display without a new provenance line, so history remains the only origin surface. Verify with `tests/client/deterministic-ui.test.tsx`.

## 4. Parameter editing surface

- [x] 4.1 Render the shared Modal through a portal into the plugin root, with a fallback for a harness that does not mount the usual root, while preserving the focus trap, Escape handling, outside-click close, and busy state. Verify with the existing modal tests and a new client test that the dialog is not mounted inside the card.
- [x] 4.2 Give the parameter editor a dedicated wide and tall layout with a scrollable value list, a value control that can hold a large value, and reachable save and cancel actions. Verify with `tests/client/deterministic-ui.test.tsx`.
- [x] 4.3 Cover the parameter editor from a card in both the board and the workflow diagram in both themes, including the no-overlap and scroll behavior. Verify with `pnpm test:browser` and the deterministic browser spec.

## 5. Documentation, preset, compatibility, and release

- [x] 5.1 Document the optional completion params, exact-name binding, tolerant extras and repair, the conversation context block, the script-only declared input, and the History record in `docs/deterministic-steps.md`.
- [x] 5.2 Review and update the workflow-architect preset and its references for the new deterministic value channel, keeping the persona and reference character ceilings intact. Verify the preset bundle declaration and the reference links.
- [x] 5.3 Confirm the workflow grammar, the board-log envelope, the executable fingerprint, and the approval behavior are unchanged. Verify with the existing journal and approval tests and a saved workflow parse.
- [x] 5.4 Bump the package version in `package.json`; the lockfile carries no root version. Verify `node -p "require('./package.json').version"` and a clean install/build.
- [x] 5.5 Extend the isolated deterministic fixture with a chained script destination that proves value passing, conversation context, and the repair path, then run the isolated real-composition lane with a throwaway profile and replay-only models.
- [x] 5.6 Document the rollback boundary: new local task records carry optional sent values, so reverting the plugin requires the existing local-record backup and restore, and no shared log is rewritten. Verify the rollback section in the deterministic guide.
- [x] 5.7 Run `pnpm check` and `pnpm test:browser` and confirm the new unit, host, client, and browser coverage passes.