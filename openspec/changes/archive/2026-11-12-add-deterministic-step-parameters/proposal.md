# Proposal

## Why

A deterministic stage runs one fixed program but has no way to say *what* it should watch: every script that monitors a specific pipeline, app, or environment needs its own stage, and an upstream agent can only pass free text that the script must parse. Stage parameters give the origin step a first-class structured value channel without letting runtime content become executable code.

## What Changes

- Deterministic stages declare required parameters as `deterministic.params: [{ name, description? }]`. The declaration is authored workflow configuration and joins the locally reviewed executable authority; parameter values never do.
- `set_next_transition` accepts a `parameters` object for a configured destination that declares parameters. It rejects unknown, missing, and malformed values with an actionable error so the agent can correct in the same turn, and `list_allowed_transitions` exposes each target's declared parameters. Placement revalidates the declaration against the destination before the entry is created.
- A new `input.params` object carries the entry's values to the program for both Bash (stdin JSON) and TypeScript (`stepContext.read`). The completion contract stays `{ exit, message }`.
- Missing or unknown values fail admission immediately with a parameter diagnostic. The failure stays in the stage, never follows the `error` route, and survives Play; Play revalidates against the latest saved declaration.
- The card/drawer script panel shows the entry's values read-only and offers an **Edit parameters** action in any non-active phase. An overlay edits the declared values for the current entry only; editing needs no new trust approval and creates no history event.
- Every entry path is allowed (agent, drag, creation, auto-advance, script exit). A stage that declares parameters may be the initial stage and an exit destination; it never starts until values are supplied.
- The values an execution used are recorded on its settled history entry. A parameter validation refusal is not an execution attempt and adds no row.
- **BREAKING (shared board log):** the deterministic definition grows a field, so the board-log and event format versions move to 3. A previous installation fails closed through the existing update-required path instead of reading the log as invalid.
- Extract the deterministic program input into one typed `DeterministicInput` value with a pure builder, replacing the supervisor's inline `Record<string, unknown>`; parameters extend that typed contract instead of the supervisor.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deterministic-steps`: parameter declaration, entry values, `input.params`, immediate admission failure, Play revalidation, overlay repair, and the repair rules.
- `stage-editing`: the deterministic form edits parameter declarations (names and optional descriptions).
- `task-history`: the settled execution entry carries the parameter values that execution used; validation refusals add no entry.
- `hub-sharing`: published deterministic configuration includes the declarations, never values, and the board-log format version becomes 3.
- `product-tools`: `list_allowed_transitions` exposes a target's declared parameters and `set_next_transition` accepts and validates them.

## Impact

Host: workflow parsing and editing, the shared journal, stage placement and entry establishment, the deterministic supervisor and runtime capture, the new parameters command, snapshot summaries, and task history. Client: stage editor, script panel, the new parameters overlay, and command scope. Docs: the deterministic steps guide and script ABI. Compatibility: board-log and event format 3, plus a package version bump. Refactor: a new `src/host/deterministic/input.ts` with a shared `DeterministicInput` type.

Out of scope: script variants or runtime-selected code, parameters supplied by a script result, authored defaults or optional parameters, secrets in parameters (local variables remain the secret channel), and the two refactors not authorized (exit-mapping deduplication and editor-draft validation deduplication).
