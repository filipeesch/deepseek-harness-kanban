# Tasks

## 1. Failure vocabulary and classification

- [x] 1.1 Add the failure origin vocabulary (`script`, `contract`, `infrastructure`, `configuration`) and the typed codec that reads and writes the diagnostic detail keys (`origin`, `cause`, `attempts`, `guard`), bounded and tolerant of older records without them; verify with unit tests covering a full detail map, a legacy diagnostic with no detail, and an oversized map.
- [x] 1.2 Add one pure classification table from failure code to origin, covering every code the runtime and the supervisor can raise, with `infrastructure` as the documented default for an unrecognized code and the ownership-uncertainty codes marked as never routing; verify with a table-driven unit test that asserts an origin for each known code and the default.
- [x] 1.3 Add the pure failure-message composer that renders origin, root cause, attempt count and where the detail lives, and that omits any stack trace and local path for an infrastructure or configuration failure; verify with unit tests for each origin and for a message containing a stack trace and an absolute path.

## 2. Guard classification and retry in the execution runtime

- [x] 2.1 Extract guard envelope decoding and guard failure classification into one module that returns either decoded command output or a classified failure carrying the observed facts (exit status, signal, timeout/abort, byte counts, bounded stdout head, bounded stderr tail, elapsed time); verify with the fake shell in `tests/host/deterministic-runtime.test.ts`, one case per row of the observation table in `design.md`.
- [x] 2.2 Add the injectable retry policy (three attempts, short growing delay, abortable wait) and use it for the failed call only; verify with tests that a not-admitted guard is retried, an unclean or signal-terminated guard is not, a stop during the wait starts no further attempt, and every attempt fails to one settled failure.
- [x] 2.3 Record the first host failure of one execution in an execution-scoped ledger and make the supervisor-visible diagnostic report it as the root cause with the program exception as the nested cause; verify with a test where the program does not handle a `tools.bash` rejection and one where it handles it and completes normally.
- [x] 2.4 Carry the bounded detail through the diagnostic on its way up, including redaction of every string in the detail map; verify with a test whose command writes a known secret to stderr and whose stored detail contains the redaction marker instead of the value.
- [x] 2.5 Merge a shutdown failure into the settled outcome instead of returning it from the `finally` block, so the original diagnostic survives beside the ownership diagnostic; verify with a test where cleanup fails and the execution keeps its earlier failure or abort.

## 3. Settlement and routing

- [x] 3.1 Add the supervisor settlement step that maps a settled failure to one of the captured `infrastructure` destination, the captured `error` destination, or no destination, and that never routes a `configuration` failure or an ownership-uncertainty failure; verify with unit tests for the full matrix, including a stage that maps only `error` and a stage that maps neither.
- [x] 3.2 Use the composed message for the synthetic result and keep the structured detail on that result; verify that a delivered infrastructure failure states its origin and attempts, contains no stack trace, and that a script failure still carries its program message.
- [x] 3.3 Confirm the reserved exit name needs no definition-schema change and that the existing self-target ban covers it; verify with a workflow-parser test that a stage mapping `infrastructure` to another stage is accepted and one mapping it to itself is rejected with the previous workflow unchanged.
- [x] 3.4 Record the failure origin, root-cause code and bounded attempt facts on the single settled execution row, and add no row for an attempt; verify with a history test that a retried failure produces one entry carrying the attempt facts.

## 4. Client surfaces

- [x] 4.1 Present the failure origin, root-cause code, attempt count and bounded guard facts in the script panel, with a generic label for a record that has no origin; verify with the deterministic-view client tests and an assertion that a stack trace is not rendered as the failure message.
- [x] 4.2 Present the same facts in the deterministic execution row of the History section, distinguishing a guard failure from a program failure; verify with the history view test data and a rendered-detail assertion.
- [x] 4.3 Update the stage editor hint to name the reserved `error` and `infrastructure` destinations; verify with the deterministic draft test that the hint copy mentions both and that the exit target choices are unchanged.

## 5. Documentation and distribution

- [x] 5.1 Document the retry rule, the failure origins, the reserved destination with its fallback, the configuration-never-routes rule and the compatibility note in `docs/deterministic-steps.md`; verify the documented rules match the implemented matrix by reading both side by side.
- [x] 5.2 Replace the affected guidance in `README.md` and in the workflow-architect reference, keeping each edited reference under its character ceiling; verify with a length check of every edited file and a read-through that no text was appended as an exception list.
- [x] 5.3 Bump the distributed artifact version in `package.json`; verify the reported version matches the manifest.
- [x] 5.4 Run `pnpm check` and the native deterministic lane (`pnpm vitest run tests/native/deterministic-runtime.test.ts`); verify both pass and record the commands and outcomes in the change.
