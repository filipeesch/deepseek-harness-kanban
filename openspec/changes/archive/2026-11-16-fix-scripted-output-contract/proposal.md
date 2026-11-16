# Proposal

## Why

Every TypeScript scripted step that returns normally currently settles as `EXECUTOR_FAILED` ("The execution provider failed before returning a result"). The program finishes with a valid completion, and the failure happens afterwards, in the plugin code that reads the host's program runtime result: `src/host/scripted/executor.ts` and `src/host/scripted/index.ts` read `result.logs`, a field the running host no longer publishes. The current runtime publishes ordered `output` entries of text and inspected images, and that contract reached the running host build without reaching any published SDK version, so the plugin's compiled code reads a field that no longer exists. The resulting `TypeError` is classified as a host defect and routed to the failure destination, so a healthy pull request landed three times in a fix stage with nothing to fix.

The evidence also exposed a second, quieter gap: a scripted program that reads a stage parameter its declaration never names receives `undefined` with no warning anywhere, so neither the author nor the next agent can discover that a value was expected.

## What Changes

- The plugin reads a program's captured output from the ordered `output` entries and, while a supported host publishes only the earlier per-call text list, from that list as well. Ordered text entries are concatenated without inserting a separator; the earlier list keeps one line per entry. An inspected image becomes one marker that counts the omitted images.
- A host that publishes neither contract, or whose entries cannot be read, is refused as a `configuration` failure whose diagnosis names the shape and the entry types it observed. The entry stays in its stage with Play, no destination is chosen, and the refusal is never reported as an executor or provider failure.
- When a host publishes only the earlier list, the plugin reports that fact once and states that this support ends when the declared host floor rises.
- Settled failure messages gain explicit ownership and escalation guidance. A `script` or `contract` failure states that the user must correct it and that the reader must escalate it; an `infrastructure` failure states that it is a defect of the DeepSeek Harness or the Kanban plugin, to be addressed by their developers, and must also be escalated; a host-contract refusal names the host build as what must change. A parameter refusal keeps its repair-and-Play path and additionally names the step that owed the value, derived from the entry's recorded origin. A configuration failure that the stage or entry can repair keeps its repair guidance.
- A TypeScript program that reads a parameter its stage does not declare becomes a written cross-stage observation in the workflow write-validation report, naming the stage and each undeclared name.
- The program result becomes a plugin-owned port shape instead of the host SDK's own type, and one reader owns the contract for both the execution path and the isolated test path. A failure while reading that result becomes a typed diagnosis with the observed shape instead of an unclassified exception.
- Host fixtures move to the ordered shape; a unit test covers the reader; the released-SDK suites keep proving the earlier contract, and a lane gated on `DSH_CHECKOUT` runs the ordered contract against a real host build and skips with an explicit message when no checkout is configured.
- Documentation records the host build the plugin requires, and the follow-up to raise the SDK pin and the `engines.dsh` floor together with removing the earlier-contract branch is recorded as a task.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `scripted-steps`: adds the program-output contract (ordered entries and the earlier list, image marker, refusal of an unknown host contract as a `configuration` failure, and its one-time deprecation report) and adds ownership and escalation guidance to every settled failure message.
- `workflow-authoring`: extends the write-validation report with a cross-stage observation for a scripted program that reads a parameter its stage does not declare.

## Impact

- Code: `src/host/scripted/ports.ts`, `executor.ts`, `index.ts`, a new `runtime-result.ts`, the failure origin table and message composer in `src/domain/scripted-failure.ts` and `src/domain/scripted-failure-message.ts`, and the workflow warning assembly behind the write-validation report.
- Tests: `tests/host/scripted-runtime.test.ts` fixtures, a new reader unit test, the new `DSH_CHECKOUT` lane `tests/native/ordered-output.test.ts`, and the workflow report tests.
- Docs and version: `docs/scripted-steps.md`, the packaged version in `package.json`, and the version assertion in `tests/distribution/compatibility.test.ts`.
- Unchanged: no new dependency, no change to the SDK pin or `engines.dsh`, no workflow schema change, no client surface change, and no change to how an unmapped exit is routed.
