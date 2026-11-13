# Design

## Context

See `proposal.md` — Why. The relevant current state:

- `decision_request` returns immediately and deliberately does not conclude the turn, so pages can stream into the strip while the user starts answering.
- A round becomes `complete` only when a `turn/end` record follows the last page (`src/questions/indexer.ts`). Submit stays disabled until then, and the form footer explains that gate (`src/questions/QuestionForm.tsx`).
- The model-facing guidance lives in two inline strings in `src/host/tools/questions.ts`: the tool description and the per-call result text. The preset skill already repeats "end the turn" for the workflow architect.
- The repository forbids real-model acceptance traffic, so validation can assert the guidance is present and consistent, not that a model obeys it (`AGENTS.md`).

## Goals / Non-Goals

**Goals:**

- Make the required order explicit: one page per call, every page the round needs in this turn, then end the turn.
- State the Submit gate as the reason, so the agent does not read "returns immediately" as permission to continue.
- Make the per-call result reinforce the rule with one short sentence.
- Keep one authoritative copy of the rule for both surfaces and guard it with a test.
- Record the guidance in the spec and in user documentation.
- Keep tool behavior, parameters, projection, and UI unchanged.

**Non-Goals:**

- No `concludeTurn()` enforcement, final-page flag, or multi-page call shape.
- No change to the parameter schema or missing parameter descriptions.
- No refactor of the `normal()` helper in `src/host/tools/support.ts`.
- No edit to the workflow-architect preset skill; it already states the rule.
- No change to the form footer copy or the Submit gate.

## Decisions

### Decision: Lead with the order and reframe "returns immediately"

The description starts with what the call adds, then gives the required order before the existing optional-form rules. The old "This tool returns immediately" sentence remains in substance, but now says the reply arrives as the next ordinary message, so "immediate" no longer competes with ending the turn.

Alternative considered: keep the current sentence order and only strengthen the middle sentence. Rejected because the failure is exactly a model reading the early sentence as permission to continue.

### Decision: Use the exact rule the user approved

Both surfaces carry the sentence `ALWAYS end your turn after finishing all pages of the round.` The uppercase emphasis is intentional and appears once in the description and once in the result.

Alternative considered: sentence-case "Always" for consistency with other descriptions. Rejected because the user chose the uppercase form for salience.

### Decision: The result text is only the short rule

The per-call result is exactly `ALWAYS end your turn after finishing all pages of the round.` It does not add a confirmation or a second instruction.

Alternative considered: prefix "Question page added." so the model sees the call succeeded. Rejected because the user asked for the short rule only, and the tool result itself already confirms the call.

### Decision: Named constants in `questions.ts`

Extract `QUESTION_TOOL_DESCRIPTION` and `QUESTION_TOOL_RESULT` at module scope. The rule has one textual source per surface, the definition line stays readable, and the regression test can import or read the constants through the registered tool.

Alternative considered: edit the inline strings in place. Rejected because the file is a single dense definition line and the rule would remain hard to locate and assert.

### Decision: No product enforcement

Wording only. The tool keeps returning immediately; no `concludeTurn()` call, no final-page flag, and no multi-page parameter.

Alternatives considered: a `final: true` flag that calls `concludeTurn()`, and one call carrying all pages. Both change the tool contract, end the turn before later pages can stream, or lose incremental answering; the user chose to keep this change wording-only.

### Decision: Extend `structured-questions`

The capability already owns the question round and its Submit gate, so the new requirement belongs there. No new capability is introduced and `product-tools` does not change because the tool surface and parameters are unchanged.

### Decision: Patch version bump

`package.json` moves from `0.31.0` to `0.31.1` because the installed artifact changes, per `AGENTS.md`. The distribution compatibility test pins the manifest version, so its expectation moves with the bump.

## Risks / Trade-offs

- **Prompt-only fixes cannot be proven in this repository** → Validation asserts the guidance is present and consistent; real behavior is observable only in product use. If the failure persists, the next step is a separate product change, not another copy tweak.
- **Prose tests are brittle** → Assert short semantic substrings ("end your turn", "cannot submit", "all pages") and the exact result sentence, not the whole description.
- **Uppercase emphasis can distract** → Keep a single occurrence per surface and no other capitalization changes.
- **The preset skill repeats the rule** → Leave it as a short second surface; the tool description is authoritative and the test covers it.
- **Description length grows** → The added sentences replace weaker ones where possible; keep the description under about 130 words.

## Migration Plan

None. This is a source-only wording change with a patch version bump. No data, storage, or API migration; rolling back is reverting the strings and the version.
