# Proposal

## Why

A deterministic stage can fail inside the isolated Bash guard, and the host reports that as if it were the script's own failure. The host discards the guard's exit code, signal, and stderr; the only value that crosses the native TypeScript boundary is the exception message, which arrives as a stack trace with local paths; and the failure follows the configured `error` destination, a correction stage with nothing to correct. A transient guard failure therefore moves the card and hands the next agent infrastructure noise instead of evidence of what happened.

## What Changes

- **Guard failure diagnostics.** A guard failure keeps its root cause and the observable facts: exit code, signal, timeout/abort flags, elapsed time, received stdout size and bounded head, and bounded, redacted stderr tail. The root cause code stays the diagnostic code; a TypeScript exception that carried it becomes a nested cause.
- **Bounded in-call retry.** The runtime repeats the *failed Bash call* only when the guard provably never admitted the command (empty stdout and stderr, exit status 125, no terminating signal, no timeout or abort). At most three attempts with a short growing delay, abortable by Stop. No automatic restart of the whole program.
- **Failure origin.** Every failed deterministic execution is classified as `script`, `contract`, `infrastructure`, or `configuration`, and the origin is persisted with the diagnostic and carried into the delivered result.
- **Reserved `infrastructure` exit.** A deterministic stage may map the reserved name `infrastructure` in its existing `exits` map, like the existing `error` name. An infrastructure failure routes to `infrastructure` when captured, otherwise to `error` when captured, otherwise it stays in the stage. It never targets the source stage.
- **Configuration never routes.** `configuration` failures (entry context, variables, capture, host capability and policy) leave the task in its stage with Play, instead of following `error`. **BREAKING** for a workflow that relies on a context or capability refusal moving the card today.
- **Truthful failure message.** A delivered failure states its origin, the number of attempts, and where the detail lives. An infrastructure failure never includes a stack trace or a local path.
- **Cleanup failure no longer hides the cause.** When native cleanup cannot confirm quiescence, the original diagnostic is preserved beside the ownership diagnostic instead of being replaced by it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deterministic-steps`: guard failure diagnostics, bounded retry of a call the guard never admitted, failure origin classification, the reserved `infrastructure` exit and its routing/fallback rules, configuration refusals that never follow a route, and the failure message contract.
- `task-history`: a settled deterministic failure row carries the failure origin and the bounded attempt facts as part of its diagnostic detail.

## Impact

- **Execution runtime**: the deterministic executor, its failure and retry collaborators, the execution ports' diagnostic shape, and the runtime's shutdown path.
- **Supervision and routing**: the supervisor's failure settlement (classification, message, destination choice) and the control adapter that currently drops diagnostic detail.
- **Client**: the script panel and History detail for the new fields, and the stage editor hint for the reserved exit name.
- **Documentation and distribution**: deterministic-steps documentation, the workflow-architect reference, and a version bump for the distributed artifact.
- **Storage**: no migration. The diagnostic detail is stored in the task's own record, and every schema that validates a problem already accepts it.
- **Compatibility**: an execution already captured keeps its captured exit mapping; a stage gains the new destination only through a new capture, which invalidates its local executable approval because exits are part of the approved fingerprint.
- **Dependencies**: none added.
