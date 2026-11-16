# Tasks

## 1. Reader module

- [x] 1.1 Add `src/host/scripted/runtime-result.ts` with the plugin-owned `NativePtcOutput` and `NativePtcRunResult` types and the `programOutput` reader: ordered entries preferred, earlier per-call list accepted, ordered text concatenated without a separator, earlier list joined one line per entry, inspected images counted in one bounded marker, and the byte bound applied. Verify: `node_modules/typescript/bin/tsc -p tsconfig.host.json --noEmit` passes while the module imports no `PtcOutput` or `PtcRunResult` from the SDK.
- [x] 1.2 Raise the refusal inside the reader for a result that publishes neither contract or publishes entries that cannot be read, carrying the observed shape and entry types as detail, and convert any failure raised while reading into that same refusal. Verify: the reader test asserts the code, the origin, and that the detail names the observed keys.
- [x] 1.3 Add `tests/host/scripted-runtime-result.test.ts` covering ordered text with retained line breaks, the earlier list one line per entry, preference when both are published, one image marker with its count, the byte bound, and an unreadable shape. Verify: `node_modules/vitest/vitest.mjs run tests/host/scripted-runtime-result.test.ts` passes.

## 2. Port and call sites

- [x] 2.1 Give `NativePtcPort` in `src/host/scripted/ports.ts` its own `run` result type and re-export the new types so existing imports keep working. Verify: typecheck passes and every existing importer of the port still compiles.
- [x] 2.2 Replace both `result.logs` reads with the reader in `src/host/scripted/executor.ts` and `src/host/scripted/index.ts`, keeping each path's own byte bound and the existing redaction order. Verify: the completed-execution diagnostics and the isolated test result carry the same text for the same program.
- [x] 2.3 Confirm the isolated test path reports the image marker and the bound as the execution path does. Verify: a host-fixture test runs the same program through `runtime.test` and `runtime.execute` and compares their reported output.

## 3. Failure taxonomy and messages

- [x] 3.1 Add `TYPESCRIPT_RESULT_UNSUPPORTED` to the origin table in `src/domain/scripted-failure.ts` as `configuration`. Verify: the classification test asserts `configuration` and that the settlement route is `null`.
- [x] 3.2 Keep the reader's product-owned diagnosis for the new code by excluding it from the provider-message map, and give it its own configuration suffix in `src/domain/scripted-failure-message.ts` naming the host build as what must change. Verify: the message test asserts the product-owned sentence, the absence of a stack frame and of a filesystem path, and that the generic repair suffix is not used.
- [x] 3.3 Add escalation guidance per origin: `script` and `contract` direct the reader to escalate and name the user as owner; `infrastructure` names the DeepSeek Harness or Kanban plugin developers as owners and still directs escalation. Verify: the message test asserts one sentence per origin and unchanged program words for `script`.
- [x] 3.4 Name the step that owed a missing parameter in the refusal message, derived from the latest stage-history origin for the entry (`agent`, `auto`, `script:<exit>`, `manual`), falling back to today's repair text when that row is absent. Verify: tests cover each origin and the fallback, and assert the entry keeps Play with no destination.

## 4. One-time reports

- [x] 4.1 Report once per observed contract through the supervisor report channel: the earlier per-call list when a host publishes only that, and the observed shape when a contract is refused. Verify: a test runs two executions on the same host and asserts one report.

## 5. Undeclared parameter observation

- [x] 5.1 Add the observation to the workflow warning assembly for a TypeScript scripted stage whose program reads a parameter its declaration does not list, from a direct `params.<name>` read or a simple destructuring, bounded, grouped and de-duplicated like the existing warnings, and never counted as a routing defect. Verify: a write-validation test asserts the observation names the stage and each undeclared name and that publishing still succeeds.

## 6. Tests and fixtures

- [x] 6.1 Move the host fixtures in `tests/host/scripted-runtime.test.ts` to the ordered shape. Verify: `node_modules/vitest/vitest.mjs run tests/host/scripted-runtime.test.ts` passes.
- [x] 6.2 Keep the released-SDK suites proving the earlier contract and add `tests/native/ordered-output.test.ts`, gated on `DSH_CHECKOUT`, which resolves the whole provider graph from an installed checkout, runs a real program that logs and returns, and asserts the ordered text, the absence of the earlier-contract report, and the same output from the isolated test path. Verify: the lane passes against a built checkout and skips with an explicit message when the variable is unset.

## 7. Docs and version

- [x] 7.1 Record in `docs/scripted-steps.md` which host build the plugin requires, that both output contracts are accepted, and that the earlier one ends when the declared host floor rises. Verify: the packaged file contains the note and `tests/distribution/script-fixtures.test.ts` still matches its documented example.
- [x] 7.2 Bump the packaged version to `0.36.5` and update the version assertion in `tests/distribution/compatibility.test.ts`. Verify: `node_modules/vitest/vitest.mjs run tests/distribution` passes.

## 8. Validation

- [x] 8.1 Run `pnpm install` in the worktree, then `pnpm check` (host and client typechecks, vitest, build). Verify: the command exits zero.
- [x] 8.2 Prove the incident end to end on a real host build: the `DSH_CHECKOUT` lane must settle a program that returns as `completed` with its captured text and freeze that as a regression gate. Verify: `DSH_CHECKOUT=<checkout> vitest run tests/native/ordered-output.test.ts` passes, and the same run without the variable skips with the explicit message.

## 9. Recorded follow-up

- [x] 9.1 Record the follow-up in the packaged documentation: when a published SDK carries the ordered contract, raise the devDependency pin and `engines.dsh` together, import the SDK's own result type, delete the earlier-contract branch and its test, and drop the `DSH_CHECKOUT` gate. Verify: `docs/scripted-steps.md` names that sequence and `tests/distribution/script-fixtures.test.ts` still matches its documented example.
