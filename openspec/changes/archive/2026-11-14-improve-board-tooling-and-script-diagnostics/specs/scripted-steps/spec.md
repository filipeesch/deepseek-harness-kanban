# Spec Delta

## ADDED Requirements

### Requirement: Scripted execution state read

The plugin SHALL expose `get_script_execution`, a read-only read of one task's scripted-step state. It SHALL accept one task identifier and SHALL report: the current stage entry and whether the execution still owns it; the execution phase; whether a saved result exists and its delivery status; the saved result's chosen exit, message, and destination stage; the hold record that currently withholds delivery, including its code, the observation moment, the pending user-work kinds, and the bounded background facts; the entry-bound parameter values together with the declared names, and which declared names hold no value; the captured executable version identifier and the captured source form; the attempt and restart counts; and a bounded list of the task's most recent execution and handoff records with their outcome and moment.

It SHALL NOT start, stop, retry, or deliver an execution; SHALL NOT approve an executable version; SHALL NOT append a history row or a diagnostic record; SHALL NOT route or move a task; and SHALL NOT change the board. It SHALL NOT carry a stored variable value, a secret, or captured program source. When the calling host cannot run scripted stages, it SHALL report the stage and that execution is unavailable instead of reporting a failed execution.

#### Scenario: Explain why a saved result is not delivered

- **WHEN** an agent reads the execution state of a task whose saved result is held
- **THEN** the result names the hold code and the bounded facts behind it
- **AND** it names the saved result's exit and destination
- **AND** it reports the recent execution records

#### Scenario: Read an execution that has no saved result yet

- **WHEN** an agent reads the execution state of a task whose program is still running
- **THEN** the result reports the phase and the attempt count
- **AND** it reports that no saved result exists

#### Scenario: Read a task with no scripted execution

- **WHEN** an agent reads the execution state of a task whose stage authors no program
- **THEN** the result reports that the task holds no scripted execution
- **AND** no execution is started

#### Scenario: Read without changing anything

- **WHEN** an agent reads the execution state
- **THEN** no history row, diagnostic, revision, or board change is recorded
- **AND** no delivery is attempted

#### Scenario: Report a host without scripted execution capability

- **WHEN** an agent reads the execution state on a host that cannot run scripted stages
- **THEN** the result reports that execution is unavailable on that host
- **AND** it does not report the execution as failed

### Requirement: Isolated script test execution

The plugin SHALL expose `test_script`, which runs one stage's authored program against a caller-supplied input and a simulated shell, so a program can be debugged without changing a card, a workflow, an entry, or a team document. It SHALL accept one board identifier, one stage identifier, the parameter values for that stage's declaration, a list of simulated shell responses, and an optional default response, and it MAY accept one project of the board whose directory the program sees.

Each simulated response SHALL associate a match with a shell result: the exit code, the standard output text, and the standard error text. A `tools.bash` call SHALL be resolved against the declared responses in order and SHALL use the first match; a call that matches none SHALL use the declared default when one was supplied. The result SHALL report every shell call the program made, in order, with the command it requested, the response that resolved it, and the output the program received.

The result SHALL report the program's chosen exit, its message, the destination stage that exit names in the stage's current authored configuration, the program's own output, and the failure classification when the program failed to produce a completion. Parameter values SHALL be validated against the stage's declaration before anything runs, and a missing or undeclared value SHALL fail the call with an actionable problem. Both the parameter values and the simulated shell results SHALL be bounded, and every reported text SHALL be bounded.

The test execution SHALL verify, before running anything, that the provider holds the same isolated program-runtime contract a real execution requires, and SHALL refuse a provider that retains state, evaluates in process, or uses any format other than a fresh isolated function-body program. It SHALL run the authored program in that contract, with no filesystem, network, or process binding other than the simulated shell. The result SHALL report the shell calls the program made, bounded, and SHALL count any it leaves out. It SHALL NOT capture or store an executable version, request or grant an executable-version approval, create or take a stage entry, create a conversation or worktree, deliver a handoff, route a task, append a history row, record a revision, or change a workflow. It SHALL NOT resolve the shell from the host's native execution capability, and a program that requires a real shell SHALL fail with the simulated result instead of reaching the host. A Bash primary program SHALL be refused with an actionable problem, because a Bash program is the shell script itself and no simulated shell can stand in for it.

#### Scenario: Debug a program that reads a command output

- **WHEN** an agent tests a stage's program with parameter values and a simulated response for a command it expects
- **THEN** the program receives the simulated output
- **AND** the result reports that command, the response that resolved it, the chosen exit, the message, and the destination that exit names

#### Scenario: Fall back to the default response

- **WHEN** the program runs a command that matches no declared response and a default response was supplied
- **THEN** the call receives the default response
- **AND** the result names the response that resolved it

#### Scenario: Report a command no response covers

- **WHEN** the program runs a command that matches no declared response and no default was supplied
- **THEN** the call does not reach the host shell
- **AND** the result reports the command that was not covered and the failure the program saw

#### Scenario: Reject values that do not match the declaration

- **WHEN** a caller supplies a missing or undeclared parameter value
- **THEN** nothing runs and the problem names the accepted names

#### Scenario: Test without touching a card

- **WHEN** an agent tests a stage's program
- **THEN** no task, stage entry, execution, handoff, history row, revision, or workflow changes
- **AND** no executable version is captured or approved
- **AND** no approval is requested

#### Scenario: Refuse a provider that is not isolated

- **WHEN** the host's TypeScript provider retains state, evaluates in process, or is not a function-body program
- **THEN** the test is refused with the executable-format problem
- **AND** the program body is not evaluated

#### Scenario: Bound a long run of shell calls

- **WHEN** a tested program runs more shell commands than one result lists
- **THEN** the result lists the bounded set
- **AND** it states how many calls it left out

#### Scenario: Refuse to test a Bash program

- **WHEN** a caller tests a stage whose program is Bash
- **THEN** nothing runs and the problem says a Bash program is the shell script itself
- **AND** no shell command is executed

#### Scenario: Testing never reaches the real shell

- **WHEN** a tested program runs any command
- **THEN** the command resolves against the simulated responses
- **AND** the host's native shell capability is not used
