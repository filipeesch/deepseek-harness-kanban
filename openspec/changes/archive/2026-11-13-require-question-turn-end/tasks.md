# Tasks

## 1. Tool guidance

- [x] 1.1 Add `QUESTION_TOOL_DESCRIPTION` and `QUESTION_TOOL_RESULT` module constants in `src/host/tools/questions.ts` with the approved description and the short result sentence; verify no inline copy of either string remains in the tool definition.
- [x] 1.2 Wire the constants into the `decision_request` definition (description and `output.render`); verify the registered tool exposes the new description and result through `productToolDefinitions`.
- [x] 1.3 Add a regression test in `tests/host/tools.test.ts` asserting the description states sending every page and ending the turn plus the Submit gate, and that the rendered result is exactly `ALWAYS end your turn after finishing all pages of the round.`; verify `pnpm test tests/host/tools.test.ts` passes.

## 2. Documentation and release

- [x] 2.1 Add a clause to the "Questions and model-facing tools" section of `README.md` stating that the tool guidance directs the agent to end its turn after the last page, that Submit waits for the turn to end, and that the result repeats the short rule; verify the wording matches the implemented description.
- [x] 2.2 Add the same clause to the question behavior paragraph in `docs/operations.md`; verify it agrees with the spec delta and README.
- [x] 2.3 Confirm the `structured-questions` delta in `openspec/changes/require-question-turn-end/specs/structured-questions/spec.md` matches the implemented guidance and has no scenario the code contradicts.
- [x] 2.4 Bump `package.json` from `0.31.0` to `0.31.1`; verify `node -e "console.log(require('./package.json').version)"` reports `0.31.1`.

## 3. Verification

- [x] 3.1 Run `pnpm check`; verify typechecks, vitest, and the build pass.
- [x] 3.2 Run `openspec validate "require-question-turn-end" --strict` and `openspec status --change "require-question-turn-end"`; verify the change validates and every planning artifact is complete.
- [x] 3.3 Inspect the final diff; verify only the intended files changed and no enforcement, parameter, schema, or UI behavior was added.
