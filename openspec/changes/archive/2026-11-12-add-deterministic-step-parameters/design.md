# Design

## Context

See `proposal.md` - Why. The current deterministic stage is authored as `language`, exactly one `code` or `file`, `directory`, `env` names, and `exits`; admission captures an immutable primary program with a fingerprint over code, directory, exits, and env names, and local trust is keyed by that fingerprint. The supervisor builds the program input inline as an untyped record. A transition is declared by `set_next_transition` as a destination plus a reason and is consumed at the end of the turn; placement establishes the stage entry through `establishStageEntry`.

Constraints that shape this design:

- Executable authority is reviewed locally; a run must never execute bytes nobody reviewed. Values are data and must not become code.
- A stage entry can be created by several paths (agent declaration, manual move, task creation, automatic advance, deterministic routing), and the script runs without a model turn.
- The board log is shared; a reader must fail closed when it cannot represent a workflow, never treat it as invalid or conventional.
- An active or recovering run is frozen: edits to the saved configuration apply only to a later capture.
- Task data stays local; only authored workflow configuration is published.

## Goals / Non-Goals

**Goals:**

- One first-class value channel from the origin stage to a deterministic program, with a reviewed declaration and entry-bound values.
- A refusal that is recoverable in place (Play + overlay) on every entry path, without touching the executable authority.
- A typed program-input contract that parameters extend, and a pure builder that keeps the supervisor from growing a second responsibility.
- Board-log compatibility expressed as an update-required failure instead of an invalid workflow.

**Non-Goals:**

- Runtime-selected code, script variants, or a parameterized file path.
- Parameter values from a deterministic result, authored defaults, or optional parameters.
- Secrets in parameters; local variables remain the credential channel.
- The two refactors the owner did not authorize: unifying the exit mapping across review/preview/client, and removing the duplicate validation in the editor draft.

## Decisions

### 1. Declaration is reviewed authority; values are entry data outside the fingerprint

`deterministic.params: Array<{ name, description? }>` is added to the definition and to the shared type. `DeterministicCapture` gains `params: string[]` (names only); `DeterministicControl` gains `parameters?: Record<string, string>` (values). The capture fingerprint keeps covering `params` names, so adding or removing a name invalidates the local approval, and never covers values.

Alternatives: putting values in the fingerprint (every pipeline change would require re-approval) and putting the declaration outside the definition (a second authored source with its own parser and journal shape). Both were rejected.

### 2. Values travel with the transition and freeze at placement

The recorded transition carries `parameters`, the pending transition carries them forward, and `establishStageEntry` receives them and writes `control.parameters`. The entry is the unit of value lifetime: every attempt and Play of that entry reads the same values, and a later entry starts empty.

Alternatives: a task-level `stageParameters` field (would also exist for non-deterministic destinations and could leak into a later entry) and a handoff-only channel (excludes the agent origin). Both were rejected.

### 3. Admission order: capture, parameter completeness, then trust

The supervisor first captures the primary program and its declared names, then checks that `control.parameters` satisfies those names, then runs the trust gate. A missing or undeclared value settles a distinct configuration refusal: `failed` phase, a diagnostic naming the missing names, no error route, no history row, entry preserved.

Ordering before trust was chosen so the card reports both independent gaps at once; the alternative (after trust) hides the parameter problem behind a review the user may not need yet.

Recovery reads the values frozen on the control, never the saved YAML: a declaration edit while a run is active must not change that run.

### 4. Play re-captures and revalidates against the latest declaration

`play` already captures the latest saved configuration. The new capture declares a possibly larger name set; the comparison against `control.parameters` decides whether the new attempt starts. A missing value leaves the entry in place with the diagnostic and the edit action; it never invalidates the entry automatically.

Alternatives: invalidate the entry when the declaration changes (removes the user's control over when to re-run) and ignore new names (the program would receive an input that does not match its own reviewed declaration). Both were rejected.

### 5. Exact-set validation in the tool, revalidation at placement

`list_allowed_transitions` adds `parameters: Array<{ name, description? }>` to each target that declares them. `set_next_transition` accepts an open object `parameters` (the DSH tool schema supports an object property with open additional properties) and enforces exactly the declared names, nonempty string values, and the size limits; a rejection names the accepted names so the model corrects in the same turn. Placement revalidates the recorded values against the destination's current declaration and fails the pending transition through the existing failed-advance path instead of creating a mismatched entry.

Alternatives: partial value sets delegated to the user (ambiguity about who owns a value) and validation only at admission (the failure would arrive after the agent's turn, with no chance to correct). Both were rejected.

### 6. Every placement may create the entry; the supervisor owns the refusal

`placeTask` and creation always establish the entry. The parameter check is not duplicated in each placement path: it lives in admission, so drag, creation, automatic advance, deterministic routing, and agent declaration share one rule.

The earlier design refused the entry before placement. That was coherent while the user could not supply values; with the repair overlay it produced an entry that the user could never fix, so the rule moved into admission.

### 7. A dedicated repair command, not the variable command

New command `task.deterministicParameters { taskId, entryId, values }`. It rejects a stale entry, an active or stopping execution, a saved stage that no longer declares parameters, and a value set that does not match the declaration exactly. It writes `control.parameters` only. It does not grant trust, does not start code, and does not append history: a later Play admits the new execution.

`entryId` is the staleness guard because an entry survives Play while an execution identity does not. Reusing `task.deterministicVariable` was rejected: that command writes native credential values scoped by project and stable stage, and parameters are task data that must not enter the credential store.

The overlay is a new client component opened from the script panel. The panel shows the entry's values read-only and offers editing whenever the entry exists and is not active or stopping; the published summary carries `parameters` so the panel can render without reading the private control.

### 8. Typed input and a pure builder

`shared/deterministic.ts` gains `DeterministicParameter` and `DeterministicInput` (task, hub, board, stage, project, directory, worktree, entry, execution, attempt, handoff, params). `src/host/deterministic/input.ts` gains `buildDeterministicInput(located, control, capture)`, a pure function; the supervisor delegates to it. This is the only authorized refactor.

Why now: parameters are a new field in the same untyped record, and extending a typed contract with a testable builder is cheaper than another inline branch in a 492-line class. The alternative (keep the inline builder and add a field) was rejected.

### 9. Board-log envelope and event format move to 3

Adding a field to the deterministic definition changes the workflow grammar the log carries. `EVENT_FORMAT_VERSION` and `BOARD_LOG_VERSION` move from 2 to 3. `executableChange` already stamps new executable events with the current version, and `decodeEvent`/`decodeBoardLog` already reject a newer version with `unsupported-version`; the previous release will therefore report the affected board as requiring an update instead of failing its strict definition schema as `invalid`. The hub manifest format version remains 3 and is not affected; the board-log envelope is independent.

The alternative (stay at 2) would make an older reader treat the log as invalid, which is the silent divergence the protocol forbids.

Authored YAML stays untouched where possible: `updateDeterministicFields` gains `params` in its field list and renders it the way `env` is rendered; the journal already serializes the complete definition as one value, so creation, edits, and clearing need no new event kind.

### 10. History records the values an execution used

The `deterministic-execution` history entry gains bounded `parameters`. A refusal and an edit produce no entry. This answers “which pipeline did it watch?” without a per-edit event kind, and matches the owner's decision that editing itself is not a settled fact.

### 11. Concrete limits

One shared constant set in the domain schema, enforced at the tool, at placement, at admission, and at repair: at most 32 parameters; a name of 1-64 characters matching `[A-Za-z_][A-Za-z0-9_]*`; a description of 1-200 characters when present; a value of 1-4096 characters; total values at most 32 KiB.

### 12. Preset and documentation follow the tool surface

The `kanban-workflow-architect` preset and its workflow-design references describe `set_next_transition`. They are reviewed and updated in this change, including the new validation error and the read surface that exposes declared parameter names. `docs/deterministic-steps.md` gains the declaration, the input field, the refusal, and the repair overlay; the package version is bumped in the same change.

## Risks / Trade-offs

- **A previous plugin cannot read a new board log** → the envelope bump turns that into an explicit update-required state per board; documented in the rollback guidance. Nothing is rewritten by an older reader.
- **Strict tool validation can stall an agent that does not know a value** → `list_allowed_transitions` exposes the declaration and the rejection names the accepted names, so the agent can ask the user instead of guessing.
- **Parameters are not redacted** → documented as task data; secrets stay in local variables. A user who puts a token in a parameter accepts that it is visible in the panel and history.
- **A repaired value is lost on re-entry** → intentional: values are entry-bound, and the origin must supply them for a new entry. The panel and history make the loss visible.
- **The supervisor still owns too much** → only the input builder is extracted in this change; the remaining debt (review/preview mapping, draft validation) is recorded for a later change.
- **Board-log version 3 is a team-wide compatibility step** → every member must update before a board that uses parameters is applied; the existing per-board isolation keeps other boards working.

## Migration Plan

- Existing workflows parse unchanged: an absent `params` means no parameters, and admission behaves as today.
- Existing entries have no parameter values. A stage that later declares parameters fails its next Play or admission until the value is supplied or repaired.
- New board-log writes use envelope 3. Envelope 2 logs remain readable. An older installation reports a board that carries envelope 3 as requiring an update and does not apply or publish over it.
- Rollback: stop active scripts, keep a backup of local records and credentials, and revert the plugin. A log written with envelope 3 stays unreadable to the reverted version by design; the revert does not rewrite it. The package version is bumped in the same pull request that changes the installed artifact.
- Verification: pure-domain tests for the declaration and validation, host tests for placement, admission, Play, recovery, repair, and journal compatibility, client tests for the editor and overlay, browser tests for both themes, and the isolated real-composition lane with a parameterized fixture. No personal profile, real model, or real credential is used.

## Open Questions

None that would change the specs, the approach, or the task breakdown. The exact diagnostic code string is an implementation detail; the specs require an actionable diagnostic naming the missing names.
