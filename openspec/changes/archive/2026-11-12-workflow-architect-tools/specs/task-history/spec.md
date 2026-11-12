# Spec Delta

## MODIFIED Requirements

### Requirement: Flow facts recorded

The record SHALL include, as separate entries: the task's creation together with the stage it was created in; every stage entry, naming the origin stage, the destination stage, and the origin of the transition that produced it; every next-stage intent recorded on the task; every auto mode change, naming whether auto mode was enabled, disabled, paused with its reason, paused by the agent, or resumed; and the settled outcome of every worktree creation, attachment, and removal, and of every failed context operation, naming the path and branch the operation acted on and the failure reason when it failed.

The origin a stage entry carries SHALL distinguish an operator move, a transition the task declared, an automatic advance, a named script exit, and the reserved error route, and SHALL name the exit when a script or the error route produced the move. An entry recorded before origins were stored SHALL remain present and SHALL read as an unrecorded origin rather than being backfilled, inferred, or rewritten.

The record SHALL additionally include the settled outcome of each deterministic execution, distinguishing a completed named result, an executor failure, and an explicit or superseding cancellation. The outcome SHALL identify its execution and source stage and SHALL carry the named exit and redacted message or diagnostic when one exists. A settled execution SHALL additionally carry, bounded, the parameter names and values that execution used, so two executions of the same entry can be compared; it SHALL NOT carry a value the execution did not receive. A completed script outcome SHALL NOT claim that its destination was entered before that transition settles. A logical deterministic handoff acceptance or failure SHALL be recorded when that fact settles, with its delivery identity and destination reference, rather than by copying raw transcript events. Replaying the same execution outcome or handoff receipt after restart SHALL NOT create another occurrence; a later explicit Play creates a different execution whose settled outcome SHALL be recorded even when its text repeats a previous outcome. These entries SHALL contain no resolved variable values, trust grants, captured code, or polling log stream and SHALL remain installation-local. Parameter values are task data, not credentials, and SHALL be recorded only on the execution that received them.

#### Scenario: Record the creation of a task

- **WHEN** a task is created in the board's initial stage
- **THEN** the record starts with an entry naming the creation and that stage

#### Scenario: Record a stage entry

- **WHEN** a task moves from one stage to another
- **THEN** the record gains an entry naming the origin stage and the destination stage

#### Scenario: Record the origin of a stage entry

- **WHEN** a task enters a stage because an operator moved it, because it declared the transition, because its automatic advance ran, because a named script exit routed it, or because the reserved error route routed it
- **THEN** that stage entry names the matching origin
- **AND** an entry produced by a script exit or by the error route names that exit

#### Scenario: Read an entry recorded before origins existed

- **WHEN** a stage entry was recorded before origins were stored
- **THEN** the entry remains in the record with its moment and its stages
- **AND** it reads as an unrecorded origin, without a backfilled or inferred value

#### Scenario: Record a next-stage intent

- **WHEN** a next-stage destination is recorded on the task
- **THEN** the record gains an entry naming the origin stage and the recorded destination
- **AND** that entry presents the recording as an intention rather than a move
- **AND** the task's stage is unchanged

#### Scenario: Record replacing a next-stage intent

- **WHEN** a task with a recorded destination records a different one
- **THEN** the record gains one entry for that recording
- **AND** the earlier entry is unchanged

#### Scenario: Record an auto mode change

- **WHEN** auto mode is enabled, disabled, paused by the host with a reason, paused by the agent with its reason, or resumed
- **THEN** the record gains one entry naming that change
- **AND** a pause entry carries the reason that paused it

#### Scenario: Record a resume caused by a placement

- **WHEN** a placement clears a paused auto mode or an agent pause
- **THEN** the record gains one entry naming the resume
- **AND** a placement that keeps an admitted agent pause adds none

#### Scenario: Record a worktree outcome

- **WHEN** a worktree creation, attachment, or removal settles
- **THEN** the record gains one entry naming the outcome and the checkout path
- **AND** a created worktree entry names its branch

#### Scenario: Record a failed operation

- **WHEN** a worktree or context operation fails
- **THEN** the record gains one entry naming the checkout it acted on
- **AND** that entry carries the failure that ended the operation

#### Scenario: A return to the base project records nothing

- **WHEN** a task returns to its base project directory
- **THEN** the record gains no entry
- **AND** a task deletion records nothing, because the record is removed with the task

#### Scenario: Record a deterministic result before claiming its move

- **WHEN** a deterministic execution saves a terminal named output while its result delivery is still held
- **THEN** history records the settled execution outcome with its source stage, output, and redacted message
- **AND** that outcome is not presented as a completed stage change or handoff acceptance

#### Scenario: Record a settled deterministic handoff once

- **WHEN** a deterministic handoff is accepted by its destination entry
- **THEN** history records its logical acceptance and delivery identity
- **AND** restarting or retrying the same delivery adds no duplicate acceptance fact

#### Scenario: Keep distinct manual reexecutions in history

- **WHEN** two different executions started by Play later settle with the same named output and message
- **THEN** history retains a settled outcome for each execution
- **AND** the equal text does not collapse those different occurrences

#### Scenario: Record the parameter values an execution used

- **WHEN** a parameterized execution settles after running with a pipeline and an app value
- **THEN** its settled outcome carries those names and values
- **AND** a later execution of the same entry that runs with a different value records its own values
