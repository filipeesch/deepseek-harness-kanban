# Design

## Context

A deterministic execution runs a captured program in a native provider. For Bash, every call goes through an isolated guard process that executes the command and prints exactly one JSON envelope (`{stdout, stderr, overflow}`) on stdout when it can prove that the tree it owns is clean. The host parses that envelope in the executor. TypeScript programs reach the same guard through a `tools.bash` binding whose exceptions cross a process boundary that carries **only the message** of an error.

Three constraints shape the approach:

1. **The guard's failure paths carry useful facts but no envelope.** The shell result already reports the exit status, the terminating signal, timeout/abort classification, and the collected streams. Today the executor discards all of it and throws a fixed sentence.
2. **The program's exception replaces the cause.** A `tools.bash` rejection surfaces to the host as a program exception whose diagnostic code is `TYPESCRIPT_EXCEPTION` and whose message is a stack trace; the root cause is never recorded.
3. **The supervisor decides routing from a flat `{code, message}` diagnostic.** Diagnostic detail is dropped twice on the way up (the control adapter and the supervisor), so nothing structured reaches the stored result, the history, or the next stage.

The existing architecture already separates capture, execution, supervision, and routing; this change keeps that separation and adds one responsibility per concern instead of growing the executor.

## Goals / Non-Goals

**Goals:**

- A failed execution states its origin and keeps the root cause and the observable facts needed to explain it without reproducing it.
- One class of transient guard failure is retried safely, inside the call, without exposing the retry to the program and without restarting the program.
- Routing distinguishes work failures from tool and configuration failures, including an opt-in reserved destination.
- The delivered message is readable by a model and by a person, and carries no stack trace for a tool failure.

**Non-Goals:**

- Changing how the guard sweeps and proves process-tree cleanup.
- Automatic whole-program restart, or a per-stage retry configuration.
- Allowing a deterministic exit to target its own stage.
- A new diagnostic schema field, journal envelope, or storage migration.
- Changing the content of the waiting scripts that motivated the change.

## Decisions

### D1. The failure origin and its facts travel in the existing diagnostic detail

The classification result is persisted as `origin`, `cause`, `attempts`, and `guard` keys inside the diagnostic's existing detail map, and a typed codec in the domain layer reads and writes that shape.

**Why:** every validator and transport that carries a problem already accepts a detail map — the task record, the history entry, the error envelope of a command, the client bridge, and the snapshot projection. A first-class field on `Problem` would require touching all of them plus a compatibility story for stored records.

**Alternatives:** a new `origin` field on `Problem` (broader contract change, stored-record migration); a dedicated persisted diagnostic type (duplicates the shape and splits reads); encoding the origin into the code string (unreadable and hard to keep exhaustive).

### D2. The executor records host failures in a per-execution ledger

The executor keeps the first host-originated failure of one execution (code, message, and observed facts). When the program then ends with an exception, the diagnostic reports that recorded cause as the root cause and the program exception as `cause`.

**Why:** the RPC boundary serializes an error down to its message, so a structured exception cannot reach the supervisor. The ledger is execution-scoped, so a program that *handles* the rejection and completes normally is unaffected — the ledger is consulted only when the execution fails. The kernel stays in the executor, next to the binding that produces the failure.

**Alternatives:** prefixing the exception message with a machine marker and parsing it (string coupling, fragile under localization and message edits); resolving `tools.bash` rejections as values (changes the program-visible contract and every existing script); publishing the failure out-of-band through a run database (new durable surface).

### D3. Guard failure classification uses only observable process facts

A pure classifier maps one shell result to either a decoded envelope or a classified failure. The facts are the exit status, the terminating signal, the timeout and abort flags, the received byte counts and a bounded head of stdout, a bounded and redacted tail of stderr, and the elapsed time of the call.

Only one combination proves the command never started: no output on either stream, exit status 125, no terminating signal, and neither timed out nor aborted. The guard's own diagnostic words are recognized to explain the failure, not to change the retry decision.

| Observation | Meaning | Retry |
| --- | --- | --- |
| empty stdout, empty stderr, status 125, no signal | the guard never admitted the command | yes |
| stderr names an unproven tree | the command ran, cleanup could not be proven | no |
| stderr names a missing or unsupported guard runtime | the guard never started; deterministic | no |
| terminated by a signal | the guard was killed; the command may have run | no |
| any other status or diagnostic | unknown; the command may have run | no |
| timeout or abort | the call was cut short as requested | not a failure |

**Why:** the guard deliberately refuses to print an envelope when it cannot prove quiescence, so the host must not invent a failure protocol for it. All the facts needed already exist on the shell result.

**Alternatives:** making the guard print a failure document (touches the trusted child infrastructure and risks weakening the "no completion without proof" property); adding a distinct stderr marker for the admission deadline (the admission deadline already produces a success envelope with status 125, so it is not a protocol failure at all).

### D4. Retry is an injected policy over the failed call

The executor runs a call through a small retry policy object with an attempt limit (three in total), a short growing delay, and an abortable wait. The policy is injected, so tests control the delay and the attempt count. Only the failed call is retried; the program is never restarted.

**Why:** the only safe repetition is the one the host can prove had no effect. A whole-program restart would re-run every earlier call, which the specification already treats as the script's business and reserves for host loss. The dependency-injected policy keeps the delay out of the executor's logic and follows the existing bounded-retry pattern used elsewhere in the host.

**Alternatives:** retrying every transport failure (may duplicate a `git push` or a review comment); restarting the execution when nothing ran yet (new attempt semantics, wider blast radius); a per-stage retry setting (new authored surface with no evidence it is needed).

### D5. The supervisor owns failure settlement; routing reads the origin

A pure settlement step takes the failed outcome, the captured exit mapping, and the origin, and returns one of: a synthetic result for `infrastructure` or `error`, or a stay-in-stage failure with the diagnostic. The composition of the short message also lives there, as a pure function. The destination order is `infrastructure` (only for the infrastructure origin) → `error` → none. A `configuration` failure never produces a destination, and ownership uncertainty keeps its existing non-routing behavior.

**Why:** routing authority belongs to the supervisor, while knowing how to interpret a guard belongs to the runtime. The runtime describes; the supervisor decides. A pure step makes the whole matrix testable without a process.

**Alternatives:** choosing the destination inside the runtime (leaks routing policy into the execution port); inferring the origin from the code in the router (duplicates a classification the producer already knows).

### D6. The reserved destination is an ordinary exit name

`infrastructure` is authored in the same exit map as `error` and captured like any other exit, so it is part of the approved fingerprint. It cannot target the source stage, which keeps the existing ban in the workflow parser and the router and avoids an unbounded re-entry loop.

**Why:** the model already supports arbitrary exit names; a separate field would touch the definition schema, the YAML writer, the editor, the documentation, and possibly the journal envelope for no behavioral gain. The fingerprint cost is the intended safety property: changing where a failure goes re-requires local review.

**Alternatives:** a dedicated `on_infrastructure_failure` field (more surface); allowing a self-target with a re-entry counter (new durable counter, new loop semantics, and the same effect as the in-call retry for the safe class).

### D7. Attempt facts ride the settled execution row

The failed history row carries the bounded attempt facts; the host does not append a row per attempt, and a successful execution carries the count only.

**Why:** the history contract records settled facts and explicitly refuses per-poll and per-attempt progress rows. The attempt facts are part of the same settled failure, so they belong to that entry.

**Alternatives:** one row per attempt (contradicts the history contract and floods the section); a separate attempts array on the execution control (visible on the card but absent from the record).

### D8. Cleanup failure is merged, not returned

The runtime's shutdown path currently returns from a `finally` block, which discards whatever the execution had already settled on — including an abort. The shutdown result becomes a value that is merged into the settled outcome, keeping the original diagnostic as the reported cause and attaching the ownership diagnostic beside it.

**Why:** losing the cause is what made the reported incident undiagnosable; the ownership diagnostic alone does not explain what the program hit.

## Risks / Trade-offs

- **Retry hide-and-seek** → the retry is bounded and recorded; a persistent condition still fails after three attempts and shows the attempt facts.
- **A command whose output the guard never flushed looks "not admitted"** → the envelope is written only after the command's streams are captured, so an empty stdout with status 125 cannot describe a completed command; the conservative branch is the one that does not retry.
- **Capability and policy failures stop moving cards** → this is the intended correction, but it changes behavior for workflows that relied on those refusals reaching a correction stage; the failure origin is visible in the panel and in history, and documented in the compatibility note.
- **Message change is user-visible** → a delivered infrastructure failure no longer contains a stack trace; the detail stays in history, and the destination instruction keeps working with the shorter text.
- **Bounded detail can still be large** → the detail map is bounded before it is persisted, and redaction runs over every string it carries, so a command's stderr cannot smuggle a secret or a large payload into a stored record.
- **Fingerprint invalidation** → adding the reserved destination requires a new capture and local approval for each affected stage; this is documented and is the same cost as any exit edit.

## Migration Plan

1. Ship the runtime and supervisor behavior first: diagnostics, classification, retry, and the non-routing rule for configuration failures.
2. The reserved destination is additive: existing captures keep their exit map, and the fallback keeps today's behavior for a stage that only maps `error`.
3. No stored-record migration. Older records without the detail keys read as unknown origin, which is displayed as a generic failure.
4. Rollback is the previous plugin version; active executions are stopped first, as the documented procedure requires.
5. Bump the distributed artifact version in the same change and review the workflow-architect reference for the reserved destination.

## Open Questions

None that affect the specs, the approach, or the task breakdown. The precise wording of each delivered sentence is a copy decision that can change without changing behavior.
