# Spec Delta

## ADDED Requirements

### Requirement: Bounded retry of an unadmitted Bash call

The host SHALL repeat a guarded Bash call only when the guard provably did not start the command: it produced no output on either stream, exited with status 125, was not terminated by a signal, and was neither timed out nor aborted by the caller. A guard failure with any evidence — command output, a terminating signal, a guard diagnostic line, another exit status, or a timeout — SHALL NOT be repeated, because the host cannot prove that the command produced no effect. The host SHALL make at most three attempts within one call, with a short growing delay before each repetition, and SHALL abandon the wait when the execution is stopped. A repeated call SHALL remain one logical call to the program, which observes only the final result or failure. The host SHALL NOT restart the whole program because of an infrastructure failure; automatic whole-program restart remains reserved for loss of the host.

#### Scenario: Repeat a guard that never admitted the command

- **WHEN** a guarded Bash call returns no output on either stream, status 125 and no terminating signal
- **THEN** the host repeats the same command, at most three attempts in total, without exposing the attempts to the program
- **AND** a program that then receives a result continues in the same execution

#### Scenario: Do not repeat a command that may have run

- **WHEN** the guard reports an unproven process tree, is terminated by a signal, prints a guard diagnostic, or exits with another status
- **THEN** the host does not repeat the command
- **AND** the execution settles as one failure

#### Scenario: Do not extend a stop

- **WHEN** Stop is requested while the host waits between attempts
- **THEN** no further attempt starts
- **AND** the execution settles as stopped without a handoff

#### Scenario: Do not restart the program

- **WHEN** every attempt of the call fails
- **THEN** the execution settles as one failure
- **AND** the captured program is not restarted automatically

### Requirement: Failure origin classification

Every failed deterministic execution SHALL be classified by origin before it is reported or routed: `script` when the captured program threw or returned an exit that its captured mapping does not name; `contract` when the program's completion value violates the required completion shape or its size bound; `infrastructure` when the guard, its transport, the execution runtime, or the host failed while the program was running; and `configuration` when the execution could not be attempted as configured, including an entry context that changed, a missing or out-of-scope variable, an unrecoverable capture, a missing host capability, or a file policy the host cannot establish. The origin SHALL be persisted with the diagnostic as part of the execution record and SHALL remain readable after the process that produced it ends. An infrastructure failure SHALL keep the root-cause code of the failure that produced it, and a program exception that carried that cause SHALL be recorded as a nested cause rather than replace it. When several host failures occur in one execution, the first one SHALL be the reported cause.

#### Scenario: A host failure inside a program keeps its cause

- **WHEN** a program does not handle a guarded Bash failure and the execution ends with a program exception
- **THEN** the diagnostic names the guard's root-cause code, the origin is `infrastructure`, and the program exception is recorded as the nested cause

#### Scenario: A program defect is a script failure

- **WHEN** the captured program throws, or returns an exit that its captured mapping does not name
- **THEN** the origin is `script`

#### Scenario: A malformed completion is a contract failure

- **WHEN** the program returns a value that is not exactly a nonempty exit name and a nonempty message within the completion size bound
- **THEN** the origin is `contract`

#### Scenario: A changed context is a configuration failure

- **WHEN** the captured execution directory is unavailable or the admitted execution context no longer matches the capture
- **THEN** the origin is `configuration`
- **AND** the task does not move and Play remains available

#### Scenario: A missing host capability or policy is a configuration failure

- **WHEN** the host lacks the required Bash or TypeScript capability, or cannot establish the selected file policy
- **THEN** the origin is `configuration`
- **AND** the diagnostic names what must be mounted or changed

### Requirement: Reserved infrastructure destination

A deterministic stage SHALL accept the reserved exit name `infrastructure` in its exit mapping on the same terms as the reserved name `error`. The host SHALL choose the synthetic destination for a settled failure in this order: the reserved `infrastructure` destination when the failure origin is `infrastructure` and the captured mapping names it; otherwise the reserved `error` destination when the captured mapping names it; otherwise no destination, leaving the task failed in its stage. A failure whose origin is `configuration` SHALL NOT follow `infrastructure`, `error`, or any other route. The reserved name SHALL be part of the captured exit mapping and the approved fingerprint, and SHALL NOT be allowed to target the source stage. A program MAY return the name itself, in which case the host SHALL treat it as an ordinary mapped exit. The synthetic result SHALL carry the reserved name as its exit when the infrastructure destination is used.

#### Scenario: Route an infrastructure failure to escalation

- **WHEN** a captured mapping names `infrastructure` and the execution settles with an infrastructure failure
- **THEN** the task moves once to that captured destination
- **AND** the saved result carries the reserved exit name

#### Scenario: Fall back to the error destination

- **WHEN** the captured mapping does not name `infrastructure` but names `error`, and the execution settles with an infrastructure failure
- **THEN** the task follows the captured `error` destination
- **AND** the delivered message states the failure origin

#### Scenario: Stay in the stage without either destination

- **WHEN** the captured mapping names neither reserved destination and an infrastructure failure settles
- **THEN** the task remains failed in its stage with Play
- **AND** no other exit is substituted

#### Scenario: Configuration never escalates

- **WHEN** the failure origin is `configuration` and the stage maps `infrastructure` and `error`
- **THEN** no destination is chosen and the task stays in its stage
- **AND** Play and the configuration action remain available

#### Scenario: Do not target the source stage

- **WHEN** an exit named `infrastructure` targets its own stage
- **THEN** saving the workflow fails and the previous workflow remains unchanged

## MODIFIED Requirements

### Requirement: Executor failure routing and repair

A script exception, a program exit that its captured mapping does not name, an invalid completion, or an execution failure SHALL produce a structured diagnostic carrying its origin, and a synthetic result that follows the captured destination for that origin. When a captured destination for that origin still exists and remains admissible, the synthetic result SHALL follow it through the normal durable routing path. A missing or undeclared parameter value SHALL be a configuration refusal rather than an executor failure: it SHALL NOT follow any route, SHALL leave the task in its current stage with its entry preserved, and SHALL offer Play and parameter editing. A failure whose origin is configuration SHALL likewise remain in its current stage and SHALL NOT follow a route. Trust not yet granted, explicit cancellation, and a source entry that is no longer current SHALL NOT be treated as script error outcomes. An unmapped script exit SHALL become a diagnostic rather than falling back to an unrelated route. Failure to deliver a saved result SHALL be handled as transition/handoff recovery, not as a reason to execute the script again or recursively follow error routes. When the run confirmed exclusive native ownership cannot be re-established after a failure, the execution SHALL remain failed in its stage without following a route, and the original diagnostic SHALL be preserved beside the ownership diagnostic.

#### Scenario: Follow a configured error exit

- **WHEN** an executor fails before returning a valid completion, the failure origin is `script` or `contract`, and the run captured a valid error destination
- **THEN** the host saves an error result with a diagnostic message and follows that route once

#### Scenario: Repair without an error route

- **WHEN** an executor fails and there is no error route
- **THEN** the card remains in the current stage with its failure and Play action
- **AND** correcting configuration does not start code until Play is explicitly requested

#### Scenario: Repair without a destination for that origin

- **WHEN** an executor fails and the captured mapping has no destination for that failure origin
- **THEN** the card remains in the current stage with its failure, its origin, and Play

#### Scenario: Missing local trust is not a failure transition

- **WHEN** a stage has not been authorized locally
- **THEN** it waits for trust review without running code or following any route

#### Scenario: A missing parameter does not follow the error route

- **WHEN** an entry is admitted without a value for a declared parameter and the stage configures an error destination
- **THEN** the failure stays in the stage with a parameter diagnostic
- **AND** no route is followed and the entry is not replaced

#### Scenario: A configuration failure does not reach a correction stage

- **WHEN** an admitted run fails because its execution context changed or an authorized variable is unavailable
- **THEN** the task stays in its stage with the configuration diagnostic and Play
- **AND** the captured error and infrastructure destinations are not followed

#### Scenario: Uncertain cleanup keeps the cause

- **WHEN** native cleanup cannot confirm quiescence after a failed execution
- **THEN** the task stays failed in its stage without following a route
- **AND** the original failure diagnostic remains readable beside the ownership diagnostic

### Requirement: Truthful execution controls and diagnostics

Cards and drawers SHALL distinguish awaiting trust, active, stopping, stopped, failed, result-awaiting-delivery, and a parameter refusal without reporting a running agent when no conversation is running. The interface SHALL display the captured version and whether a saved edit requires Play, the relevant failure, and Stop/Play controls with accessible names and action-local progress. A failed execution SHALL present its failure origin, its root-cause code, and the number of attempts it made, in the card's script panel and in the task's history detail. The persisted and displayed diagnostic SHALL carry, bounded and redacted, the facts the host observed: the guard's exit status and terminating signal, the received output sizes and bounded beginning, the bounded end of its diagnostic stream, and whether the command was admitted. An infrastructure or configuration diagnostic SHALL NOT present a stack trace or a local filesystem path in the message delivered to a destination stage; the detailed facts SHALL remain available through the task's history. For an entry whose stage declares parameters, the card and drawer SHALL show the entry's parameter values read-only and SHALL offer parameter editing whenever the entry exists and its execution is not active or stopping. It SHALL present a parameter refusal as a recoverable configuration problem that offers both Play and editing, distinct from an executor failure. Available diagnostics SHALL be bounded and SHALL not add one task-history row per polling iteration or per retried call. The host SHALL avoid logging resolved variable values and redact known secret values from persisted/displayed diagnostics, their detailed facts, and handoff messages; documentation SHALL explain that arbitrary user code can transform or disclose secrets and that redaction is not a complete data-loss-prevention boundary. Parameter values SHALL be presented as task data and SHALL NOT be treated as secrets. Secret values SHALL NOT appear in ordinary snapshots or verification evidence. Switching panels or closing the browser SHALL not stop a host-owned active script.

#### Scenario: Observe a sleeping script without an agent

- **WHEN** a deterministic script is active while no conversation is running
- **THEN** the card identifies script execution and offers Stop without falsely claiming an agent turn is active

#### Scenario: Inspect an executor failure

- **WHEN** an execution fails
- **THEN** the card and drawer expose the failure origin, the root-cause code, the attempt count, and the appropriate recovery action without a global board-saving indicator

#### Scenario: Inspect why the guard failed without reproducing it

- **WHEN** a guarded Bash call fails and the user opens the script panel or the task history
- **THEN** the recorded facts identify whether the command was admitted, the guard's exit status or signal, and the bounded end of its diagnostic stream
- **AND** those facts are redacted before they are persisted or displayed

#### Scenario: Keep infrastructure noise out of the next stage

- **WHEN** an infrastructure failure is delivered to a destination stage
- **THEN** the delivered message states the origin, the attempt count and where the detail lives
- **AND** it contains no stack trace and no local filesystem path

#### Scenario: Keep secrets out of diagnostics

- **WHEN** captured output contains an exact resolved secret value known to the host
- **THEN** that value is redacted before diagnostic or handoff persistence and display
- **AND** tests and screenshots contain no real credentials

#### Scenario: Repair values from a failed entry

- **WHEN** an entry failed for a missing parameter and the user opens the script panel
- **THEN** the panel presents the failure, Play, and the parameter editing action
- **AND** it presents the entry's current values read-only until the user edits them
