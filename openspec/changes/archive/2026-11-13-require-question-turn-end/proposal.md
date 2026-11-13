# Proposal

## Why

The `decision_request` tool already tells the agent to finish the turn, but that instruction is buried inside a paragraph that begins with "This tool returns immediately", so some agents keep writing or working after their last question page. A round only becomes submittable when the agent's turn actually ends, so the user is left with a disabled Submit while the agent continues.

## What Changes

- Rewrite the `decision_request` tool description to state the required order explicitly: send every page the round needs in this turn, then **ALWAYS end the turn** after the last page. Explain that the user cannot submit until the turn ends and that continuing to write keeps Submit unavailable.
- Replace the per-call result text with the short rule only: `ALWAYS end your turn after finishing all pages of the round.`
- Extract the description and the result text into named constants so the turn-ending rule has one source and the regression test can assert it.
- Add a regression test that the description states the turn-ending rule and the Submit gate, and that the result repeats the short rule.
- Add a `structured-questions` requirement with scenarios covering the model-facing guidance.
- Update `README.md` and `docs/operations.md` to describe the guidance and the Submit gate.
- Bump `package.json` from `0.31.0` to `0.31.1`.

The tool still returns immediately and still does not conclude the turn itself. No parameter, schema, storage, or UI behavior changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `structured-questions`: adds a requirement that the tool's model-facing guidance directs the agent to end its turn after its last question page and explains the Submit gate, and that the per-call result repeats the short rule.

## Impact

- `src/host/tools/questions.ts`: description and result text moved to named constants and rewritten.
- `tests/host/tools.test.ts`: new regression test for the guidance.
- `openspec/changes/require-question-turn-end/specs/structured-questions/spec.md`: new requirement and scenarios, synced to the main spec on archive.
- `README.md`, `docs/operations.md`: updated question guidance documentation.
- `package.json`: patch version bump.
- `tests/distribution/compatibility.test.ts`: the manifest-version expectation follows the patch bump.
- No API, dependency, storage, or host-contract change. No enforcement via `concludeTurn()`.
