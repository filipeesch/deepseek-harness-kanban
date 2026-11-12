# Spec Delta

## ADDED Requirements

### Requirement: Whole-tree cleanup proof per platform

The host and the program-lifetime guard SHALL prove that no process started by an
execution still runs before the execution reports a result, releases its ownership
record, or hands a result to a destination. The proof SHALL use the strongest ownership
primitive the platform offers without elevation: the kernel's per-process environment on
Linux; on macOS a marker sweep executed by the host process outside the execution's
confinement, at the guard's authenticated request, because a confined program cannot read
another process's environment; and, on a platform with no supported ownership primitive, a
refusal before any code is launched. The proof SHALL NOT require executing a setuid
program, a program the confinement denies, or any capability the execution is meant to be
restricted from. A process group SHALL be considered empty only after a signal to its
group id fails because the group no longer exists, and a member SHALL be signalled only
after its ownership was confirmed. An execution whose cleanup cannot be proven SHALL NOT
report its captured result and SHALL NOT release its ownership record as settled; it SHALL
settle as an infrastructure failure that carries the guard's own reason, bounded and
redacted, so the failure is diagnosable without reproducing it.

#### Scenario: A confined execution on macOS returns its result
- **WHEN** a deterministic stage runs a `tools.bash` call under a confined file policy on macOS and the command succeeds
- **THEN** the call returns its captured output and the execution completes normally
- **AND** no process carrying the run's ownership token remains

#### Scenario: The confined guard does not read the process table itself
- **WHEN** the guard must locate a process that left its process group
- **THEN** it obtains the marker sweep from the host over the authenticated lifetime channel
- **AND** it does not execute a setuid program or a program the confinement denies

#### Scenario: Linux proves ownership from the kernel
- **WHEN** a Linux execution sweeps its owned set
- **THEN** it reads each candidate's environment from the kernel's process filesystem
- **AND** no external process-listing program is required

#### Scenario: A descendant that left the group is still terminated
- **WHEN** a descendant detaches into another session or process group and still carries the run's ownership token
- **THEN** it is signalled as an owned process
- **AND** a process whose ownership cannot be confirmed is never signalled or frozen

#### Scenario: Unproven cleanup fails closed and names its reason
- **WHEN** the strongest available sweep cannot run, or cannot confirm an empty owned set
- **THEN** the execution reports no captured result and settles as an infrastructure failure
- **AND** its diagnostic names the guard's own reason, bounded and redacted

#### Scenario: A platform without an ownership primitive fails closed in every mode
- **WHEN** a platform has no supported ownership primitive
- **THEN** both the Bash and the TypeScript execution modes refuse to start
- **AND** no mode reports a clean process tree that it did not verify
- **AND** the refusal is an actionable configuration diagnostic

#### Scenario: A confined platform with no fully enforcing backend is refused before code
- **WHEN** the platform's file-policy backend reports partial enforcement
- **THEN** the stage is refused before the program starts
- **AND** the diagnostic names the missing enforcement instead of a generic policy failure

#### Scenario: Host loss keeps the same proof
- **WHEN** the host dies while an execution is active
- **THEN** the next startup proves the predecessor's cleanup with the same platform primitive before any replacement code runs
- **AND** an unproven predecessor blocks a concurrent duplicate instead of being assumed gone

### Requirement: Run secrets stay out of the native process command line

The authenticated lifetime authorization and the ownership marker SHALL NOT be exposed on a
native process command line or in a world-readable file. The guard SHALL read its
configuration from a private file readable only by the executing user. The reviewed Bash
program SHALL reach the guard and the executing shell through a private file rather than as
a command-line argument, so the program text cannot be read from a process listing. Those
private files SHALL be removed when the execution settles, or at the next startup if the
host did not finish. A TypeScript provider that transports its own program is outside this
guarantee.

#### Scenario: No authorization on the command line
- **WHEN** the host launches the guard for an execution
- **THEN** the command line carries only the guard program and a private path
- **AND** a process of another user cannot read the configuration, where a command line would have been world-readable

#### Scenario: The reviewed Bash program is not on the command line
- **WHEN** a standalone Bash execution or a guarded `tools.bash` call starts
- **THEN** the command line carries the program's private path and not its text
- **AND** a process listing of the guard, its leader, and the executing shell exposes no program text

#### Scenario: The private files do not outlive the execution
- **WHEN** the execution settles, or the next startup finds a configuration or a program left by a host that did not finish
- **THEN** those private files are removed
